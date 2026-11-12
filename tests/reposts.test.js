const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');
const { sourcesFor, sourceKey, initialize, deliver, audit } = require('../repost-state');
const { SAFE, contain } = require('../render-reposts');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(count = 1) {
  const post = { id: 'demo', status: 'published', publishedMediaId: 'feed-1', imageUrls: Array.from({ length: count }, (_, i) => `https://example.test/image-${i}.jpg`) };
  initialize(post, true);
  const entry = { kind: count > 1 ? 'carousel_slides' : 'post', sourceKey: sourceKey(post), assets: post.imageUrls.map((u, i) => ({
    sourceUrl: u, url: `https://example.test/story-${i}.jpg`, sha256: 'a'.repeat(64), width: 1080, height: 1920,
  })) };
  const calls = [], writes = [];
  const deps = { entry, userId: 'account', save: () => writes.push(clone(post.storyRepost)), waitReady: async () => {},
    api: async (method, endpoint, params) => {
      calls.push({ method, endpoint, params });
      return { id: `${endpoint.endsWith('media_publish') ? 'story' : 'container'}-${calls.length}` };
    } };
  return { post, entry, deps, calls, writes };
}
test('1080×1350, square, landscape, and vertical sources remain wholly in the safe frame without distortion', () => {
  for (const [w, h] of [[1080, 1350], [1080, 1080], [1920, 1080], [1080, 1920], [600, 2700], [600, 600]]) {
    const r = contain(w, h);
    assert.ok(r.x >= SAFE.x && r.y >= SAFE.y);
    assert.ok(r.x + r.width <= SAFE.x + SAFE.width + 1e-8);
    assert.ok(r.y + r.height <= SAFE.y + SAFE.height + 1e-8);
    assert.ok(Math.abs(r.width / r.height - w / h) < 1e-8);
  }
});
test('carousel preserves all slides and Reels uses an explicitly separate final-frame asset', () => {
  assert.equal(sourcesFor(fixture(8).post).length, 8);
  assert.deepEqual(sourcesFor({ videoUrl: 'https://example.test/reel.mp4' }), ['https://example.test/reel-frame.jpg']);
});
test('all confirmed slide IDs survive serialization; rerunning does not call API', async () => {
  const f = fixture(3);
  await deliver(f.post, f.deps);
  assert.equal(f.post.storyRepost.status, 'published');
  assert.equal(f.post.storyRepost.items.filter(i => i.publishedMediaId).length, 3);
  const calls = f.calls.length;
  await deliver(clone(f.post), { ...f.deps, save: () => {} });
  assert.equal(f.calls.length, calls);
  assert.ok(f.writes.some(s => s.items[0].status === 'publishing' && !s.items[0].publishedMediaId));
});
test('partial carousel retries preparation failure only, without repeating the confirmed first slide', async () => {
  const f = fixture(3);
  const api = f.deps.api;
  let preparations = 0;
  await deliver(f.post, { ...f.deps, api: async (...args) => {
    if (args[1].endsWith('/media') && ++preparations === 2) throw new Error('offline');
    return api(...args);
  } });
  assert.equal(f.post.storyRepost.status, 'partial');
  assert.equal(f.post.storyRepost.items[0].status, 'published');
  const firstId = f.post.storyRepost.items[0].publishedMediaId;
  await deliver(f.post, f.deps);
  assert.equal(f.post.storyRepost.status, 'published');
  assert.equal(f.post.storyRepost.items[0].publishedMediaId, firstId);
  assert.equal(f.calls.filter(c => c.endpoint.endsWith('media_publish')).length, 3);
});
test('adding slides after confirmed delivery is a review mismatch, never another send or false completion', async () => {
  const f = fixture();
  await deliver(f.post, f.deps);
  f.post.imageUrls.push('https://example.test/extra.jpg');
  assert.equal(audit({ posts: [f.post] })[0].repostStatus, 'needs_review');
  const calls = f.calls.length;
  await assert.rejects(deliver(f.post, f.deps), /Состав публикации изменился/);
  assert.equal(f.post.storyRepost.status, 'needs_review');
  assert.equal(f.calls.length, calls);
});
test('lost publish response is unknown, blocks every later resend and stops following carousel slides', async () => {
  const f = fixture(3);
  const api = f.deps.api;
  await deliver(f.post, { ...f.deps, api: async (...args) => {
    const result = await api(...args);
    if (args[1].endsWith('media_publish')) throw new Error('response lost after remote success');
    return result;
  } });
  assert.equal(f.post.storyRepost.status, 'needs_review');
  assert.equal(f.post.storyRepost.items[0].status, 'unknown');
  const calls = f.calls.length;
  await assert.rejects(deliver(f.post, f.deps), /сверки/);
  assert.equal(f.calls.length, calls);
});
test('crash after persist-before-send blocks retries; creation ID alone is never publication proof', async () => {
  const f = fixture();
  f.post.storyRepost.items = [{ index: 1, status: 'publishing', containerId: 'c-1' }];
  await assert.rejects(deliver(f.post, f.deps), /неизвестен/);
  assert.equal(f.calls.length, 0);
  assert.equal(audit({ posts: [f.post] })[0].confirmedFrames, 0);
});
test('historical records are unknown and cannot be resent merely by explicit retry', async () => {
  const f = fixture(); delete f.post.storyRepost;
  assert.equal(audit({ posts: [f.post] })[0].repostStatus, 'historical_unknown');
  await assert.rejects(deliver(f.post, f.deps), /История репоста неизвестна/);
  assert.equal(f.calls.length, 0);
});
test('incomplete carousel exports and stale source URLs block every API write', async () => {
  for (const change of [f => f.entry.assets.pop(), f => f.post.imageUrls[0] = 'https://example.test/new.jpg']) {
    const f = fixture(2); change(f);
    await assert.rejects(deliver(f.post, f.deps), /1080×1920/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.post.storyRepost.status, 'awaiting_assets');
  }
});
test('changed assets after partial send require review instead of mixing editions', async () => {
  const f = fixture(2); const ready = f.deps.waitReady; let n = 0;
  await deliver(f.post, { ...f.deps, waitReady: async (...args) => { if (++n === 2) throw new Error('bad'); return ready(...args); } });
  f.entry.assets[1].sha256 = 'b'.repeat(64);
  const calls = f.calls.length;
  await assert.rejects(deliver(f.post, f.deps), /Набор кадров изменился/);
  assert.equal(f.calls.length, calls);
});
test('remote file verification failure has no publish side effects', async () => {
  const f = fixture();
  await assert.rejects(deliver(f.post, { ...f.deps, verifyAssets: async () => { throw new Error('CDN stale'); } }), /CDN stale/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.post.storyRepost.items.length, 0);
});
test('publisher reports nonzero completion when a repost is awaiting assets, while preserving feed confirmation', async () => {
  const root = path.resolve(__dirname, '..');
  const file = path.join(root, 'content', 'queue.json');
  const f = fixture();
  const disk = new Map([[file, JSON.stringify({ account_id: 'account', posts: [f.post] })]]);
  const fakeFs = {
    existsSync: name => disk.has(name), readFileSync: name => disk.get(name),
    writeFileSync: (name, bytes) => { if (typeof name === 'string') disk.set(name, bytes); },
    renameSync: (a, b) => { disk.set(b, disk.get(a)); disk.delete(a); },
    openSync: () => 1, closeSync: () => {}, unlinkSync: name => disk.delete(name),
  };
  const proc = { argv: ['node', 'publish.js', '--repost', 'demo'], env: { IG_ACCESS_TOKEN: 'test-only' }, pid: 123, exitCode: 0,
    exit: code => { throw new Error(`unexpected exit ${code}`); } };
  let reads = 0;
  await new vm.Script(fs.readFileSync(path.join(root, 'publish.js'), 'utf8')).runInNewContext({
    require: name => name === 'fs' ? fakeFs : name === './repost-state' ? require('../repost-state')
      : name === './campaign-feed' ? { ...require('../campaign-feed'), readCampaign: () => null } : require(name),
    __dirname: root, process: proc, URL, URLSearchParams,
    console: { log: () => {}, error: () => {} },
    fetch: async (_, options) => {
      assert.ok(!options, 'repost must not write any remote media without assets'); reads++;
      return { json: async () => ({ username: 'test', followers_count: 0, media_count: 1 }) };
    },
  });
  assert.equal(proc.exitCode, 1);
  assert.equal(reads, 1);
  const saved = JSON.parse(disk.get(file)).posts[0];
  assert.equal(saved.status, 'published'); assert.equal(saved.publishedMediaId, 'feed-1');
  assert.equal(saved.storyRepost.status, 'awaiting_assets');
});
test('audit and explicit dry run work without credentials, do not mutate the queue, and do not send', () => {
  const root = path.resolve(__dirname, '..');
  const file = path.join(root, 'content', 'queue.json');
  const before = fs.readFileSync(file, 'utf8');
  const id = JSON.parse(before).posts.find(p => p.status === 'published').id;
  for (const args of [['--repost-audit'], ['--repost', id, '--dry-run']]) {
    const r = spawnSync(process.execPath, ['publish.js', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, IG_ACCESS_TOKEN: '' }, timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(JSON.parse(r.stdout).length);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
