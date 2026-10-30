'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const campaignFeed = require('../campaign-feed');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, 'audit-fixture-content-does-not-exist');
const SOURCE = fs.readFileSync(path.join(ROOT, 'publish.js'), 'utf8');
const bytes = Buffer.from('matching-public-asset-fixture');
const sha = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const slots = Array.from({ length: 15 }, (_, i) => {
    const at = new Date(Date.UTC(2026, 9, 31 + 2 * i, 16, 30));
    return { postId: `audit-reel-${i + 1}`, date: at.toISOString().slice(0, 10), scheduledAt: at.toISOString() };
  });
  const campaign = { version: 1, status: 'active', timezone: 'Europe/Moscow', id: 'audit-series', account: 'mairova_a_a', accountId: '123', slots };
  const posts = slots.map(slot => ({
    id: slot.postId, campaignId: campaign.id, date: slot.date, scheduledAt: slot.scheduledAt,
    status: 'approved', captionComplete: true, caption: `Approved ${slot.postId}`,
  }));
  return { campaign, queue: { account_id: campaign.accountId, posts } };
}

async function audit({ history = { data: [] }, corruptAsset = false, unknownPhase = false, probe = false } = {}) {
  const { campaign, queue } = fixture();
  if (unknownPhase) queue.posts[0].feedDelivery = { phase: 'unknown', containerId: 'saved-container' };
  const before = JSON.stringify(queue);
  const calls = [], validated = [], forbidden = [];
  const rejectMutation = name => (...args) => {
    forbidden.push(name);
    assert.fail(`Read-only campaign audit attempted ${name}`);
  };
  const fakeFs = {
    ...fs,
    existsSync: file => path.resolve(file).startsWith(CONTENT) ? false : fs.existsSync(file),
    readFileSync: (file, ...args) => path.resolve(file) === path.join(CONTENT, 'queue.json') ? JSON.stringify(queue) : fs.readFileSync(file, ...args),
    writeFileSync: rejectMutation('writeFileSync'), renameSync: rejectMutation('renameSync'),
    openSync: rejectMutation('openSync'), unlinkSync: rejectMutation('unlinkSync'),
  };
  const prepared = {
    sha,
    validate: post => {
      validated.push(post.id);
      return { post: { ...post, videoUrl: 'https://fixture.test/exact-v3.mp4', coverUrl: 'https://fixture.test/exact-cover.jpg' }, entry: { files: [{ url: `https://fixture.test/${post.id}`, sha256: sha(bytes) }] }, repost: { assets: [] } };
    },
  };
  const proc = {
    argv: ['node', 'publish.js', probe ? '--campaign-upload-probe' : '--campaign-audit'],
    env: { IG_ACCESS_TOKEN: 'fixture-only-token', MEDIA_CONTENT_DIR: CONTENT },
    pid: 123, exitCode: 0, exit: rejectMutation('process.exit'),
  };
  const context = {
    require: name => name === 'fs' ? fakeFs
      : name === './campaign-feed' ? { ...campaignFeed, readCampaign: () => campaign }
      : name === './prepared-media' ? prepared
      : name === 'child_process' ? { execFileSync: rejectMutation('Git/child_process') }
      : require(name.startsWith('.') ? path.resolve(ROOT, name) : name),
    process: proc, __dirname: ROOT, Buffer, URL, URLSearchParams, AbortSignal, setTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, options) => {
      const request = { url: String(url), method: options?.method || 'GET' };
      calls.push(request);
      if (request.method === 'POST') {
        assert.ok(probe, 'Only an explicitly requested upload probe may create a container');
        assert.equal(new URL(request.url).pathname, '/v23.0/123/media', 'Probe must never call media_publish');
        assert.equal(options.body.get('video_url'), 'https://fixture.test/exact-v3.mp4');
        assert.equal(options.body.get('cover_url'), 'https://fixture.test/exact-cover.jpg');
        assert.equal(options.body.get('caption'), queue.posts[0].caption);
        return { json: async () => ({ id: 'upload-probe-container' }) };
      }
      assert.equal(request.method, 'GET', 'Audit must never create or publish Instagram media');
      if (request.url.startsWith('https://fixture.test/')) {
        return { ok: true, arrayBuffer: async () => corruptAsset ? Buffer.from('wrong-asset') : bytes };
      }
      if (new URL(request.url).pathname.endsWith('/media')) return { json: async () => history };
      if (new URL(request.url).pathname.endsWith('/upload-probe-container')) return { json: async () => ({ status_code: 'FINISHED' }) };
      return { json: async () => ({ username: campaign.account, followers_count: 0, media_count: 0 }) };
    },
  };
  await new vm.Script(SOURCE, { filename: 'publish.js' }).runInNewContext(context);
  assert.deepEqual(forbidden, []);
  assert.equal(JSON.stringify(queue), before, 'Audit must not mutate approvals, feed state or receipts');
  return { exitCode: proc.exitCode, calls, validated, expectedIds: queue.posts.map(p => p.id) };
}

test('campaign audit validates all fifteen, performs only GETs and never writes queue, lock or Git', async () => {
  const result = await audit();
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.validated, result.expectedIds);
  assert.equal(result.calls.length, 17, 'one account read, fifteen public asset reads, one live history read');
  assert.ok(result.calls.every(call => call.method === 'GET'));
});

test('read-only audit remains available when a feed delivery needs reconciliation', async () => {
  const result = await audit({ unknownPhase: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.validated.length, 15);
  assert.equal(result.calls.length, 17);
});

test('missing Instagram history fails closed without any publishing or state writes', async () => {
  const result = await audit({ history: {} });
  assert.equal(result.exitCode, 1);
  assert.equal(result.validated.length, 15);
  assert.equal(result.calls.length, 17);
});

test('a mismatched public asset hash stops audit before publication or live-history reconciliation', async () => {
  const result = await audit({ corruptAsset: true });
  assert.equal(result.exitCode, 1);
  assert.equal(result.validated.length, 1);
  assert.equal(result.calls.length, 2, 'account read then first invalid asset');
  assert.ok(result.calls.every(call => !new URL(call.url).pathname.endsWith('/media')));
});

test('explicit ingest probe creates exactly one unpublished container using exact V3 video and cover', async () => {
  const result = await audit({ probe: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(result.validated.length, 16);
  assert.ok(result.calls.every(c => !new URL(c.url).pathname.endsWith('/media_publish')));
});
