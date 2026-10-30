'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { sourcesFor, sourceKey, validManifest, initialize, deliver } = require('../repost-state');
const { renderPost } = require('../render-reposts');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const post = { id: 'full-video-test', storyRepostMode: 'full_video', videoUrl: 'https://example.test/content/reels/approved.mp4', status: 'published', publishedMediaId: 'feed-receipt' };
  initialize(post, true);
  const entry = { kind: 'reel_video', sourceKey: sourceKey(post), assets: [{
    sourceUrl: post.videoUrl, file: `${post.id}-full.mp4`, url: `https://example.test/content/reposts/${post.id}-full.mp4`,
    width: 1080, height: 1920, mediaType: 'VIDEO', mimeType: 'video/mp4', sha256: 'a'.repeat(64),
  }] };
  const calls = [], writes = [], polls = [];
  const deps = {
    entry, userId: 'account',
    save: async () => { await Promise.resolve(); writes.push(clone(post.storyRepost)); },
    waitReady: async (...args) => polls.push(args),
    api: async (method, endpoint, params) => {
      calls.push({ method, endpoint, params });
      if (endpoint.endsWith('/media_publish')) {
        assert.equal(writes.at(-1).items[0].status, 'publishing', 'publishing intent must finish durable save before remote POST');
        return { id: 'story-receipt' };
      }
      assert.equal(writes.at(-1).items[0].status, 'preparing');
      return { id: 'video-container' };
    },
  };
  return { post, entry, calls, writes, polls, deps };
}

test('full-video source is the exact Reel URL, while legacy frame and carousel source contracts stay unchanged', () => {
  const { post } = fixture();
  assert.deepEqual(sourcesFor(post), [post.videoUrl]);
  const legacy = { ...post }; delete legacy.storyRepostMode;
  assert.deepEqual(sourcesFor(legacy), ['https://example.test/content/reels/approved-frame.jpg']);
  assert.notEqual(sourceKey(post), sourceKey(legacy));
  assert.deepEqual(sourcesFor({ imageUrls: ['https://example.test/1.jpg', 'https://example.test/2.jpg'] }), ['https://example.test/1.jpg', 'https://example.test/2.jpg']);
});

test('full-video manifest requires the new kind, VIDEO type, MP4 MIME, complete source and vertical dimensions', () => {
  const { post, entry } = fixture();
  assert.equal(validManifest(post, entry), true);
  for (const alter of [
    e => { e.kind = 'reel_frame'; }, e => { e.assets[0].mediaType = 'IMAGE'; },
    e => { delete e.assets[0].mediaType; }, e => { e.assets[0].mimeType = 'image/jpeg'; },
    e => { e.assets[0].width = 1920; }, e => { e.assets[0].sourceUrl += '?different'; },
    e => { e.assets.pop(); },
  ]) { const copy = clone(entry); alter(copy); assert.equal(validManifest(post, copy), false); }
});

test('renderPost copies the complete approved bytes without browser, re-encoding or queue mutation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-video-repost-'));
  const reels = path.join(dir, 'reels'), reposts = path.join(dir, 'reposts');
  fs.mkdirSync(reels);
  const src = path.join(reels, 'approved.mp4');
  // Opaque bytes deliberately exercise byte-for-byte copying, not a decoder.
  // Playability/duration of production V3 assets is validated by the media pipeline.
  const bytes = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 1, 2, 3, 4, 0, 255, 65, 66]);
  fs.writeFileSync(src, bytes);
  const { post } = fixture(), before = JSON.stringify(post);
  const dest = path.join(reposts, `${post.id}-full.mp4`);
  try {
    const result = await renderPost(post, { contentDir: dir, page: {}, rawBase: 'https://example.test/content/reposts' });
    assert.equal(result.kind, 'reel_video');
    assert.equal(result.publicationStatus, 'export_only');
    assert.equal(result.assets.length, 1);
    assert.equal(validManifest(post, result), true);
    assert.deepEqual(fs.readFileSync(dest), bytes);
    assert.equal(result.assets[0].sha256, hash(bytes));
    const g = result.assets[0].geometry;
    assert.equal(g.sourceSha256, result.assets[0].sha256);
    assert.equal(g.scale, 1);
    assert.deepEqual(g.sourceRect, { x: 0, y: 0, width: 1080, height: 1920 });
    assert.deepEqual(g.targetRect, g.sourceRect);
    assert.equal(JSON.stringify(post), before, 'export must not change feed or Story delivery status');
  } finally {
    for (const file of [src, dest]) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const folder of [reels, reposts, dir]) if (fs.existsSync(folder)) fs.rmdirSync(folder);
  }
});

test('one full Reel creates exactly one video Story and one publish, then never sends it again', async () => {
  const f = fixture();
  await deliver(f.post, f.deps);
  assert.deepEqual(f.calls, [
    { method: 'POST', endpoint: 'account/media', params: { media_type: 'STORIES', video_url: f.entry.assets[0].url } },
    { method: 'POST', endpoint: 'account/media_publish', params: { creation_id: 'video-container' } },
  ]);
  assert.equal(f.polls[0][2], 120, 'full video gets the eight-minute processing budget');
  assert.equal(f.post.storyRepost.items[0].mediaType, 'VIDEO');
  assert.equal(f.post.storyRepost.items[0].publishedMediaId, 'story-receipt');
  assert.equal(f.post.storyRepost.status, 'published');
  await deliver(f.post, f.deps);
  assert.equal(f.calls.length, 2);
});

test('unknown video media_publish result is persisted and blocks every later retry', async () => {
  const f = fixture(), api = f.deps.api;
  await deliver(f.post, { ...f.deps, api: async (...args) => {
    const result = await api(...args);
    if (args[1].endsWith('/media_publish')) throw new Error('response lost after remote publish');
    return result;
  } });
  assert.equal(f.post.storyRepost.status, 'needs_review');
  assert.equal(f.post.storyRepost.items[0].status, 'unknown');
  assert.equal(f.writes.at(-1).items[0].status, 'unknown');
  await assert.rejects(deliver(f.post, f.deps), /сверки/);
  assert.equal(f.calls.length, 2);
});

test('asset verification fails before any video Story creation or publication', async () => {
  const f = fixture();
  await assert.rejects(deliver(f.post, { ...f.deps, verifyAssets: async () => { throw new Error('video hash mismatch'); } }), /video hash mismatch/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.post.storyRepost.items.length, 0);
});

test('switching a previously confirmed frame announcement to full video requires review, never a silent new send', async () => {
  const f = fixture();
  const legacyPost = { ...f.post }; delete legacyPost.storyRepostMode;
  f.post.storyRepost = { version: 1, feedMediaId: f.post.publishedMediaId, status: 'published', sourceKey: sourceKey(legacyPost), items: [{ status: 'published', publishedMediaId: 'old-frame-story' }] };
  await assert.rejects(deliver(f.post, f.deps), /Состав публикации изменился/);
  assert.equal(f.post.storyRepost.status, 'needs_review');
  assert.equal(f.calls.length, 0);
});

test('legacy static and carousel Story assets still use image_url and keep their original order', async () => {
  for (const count of [1, 3]) {
    const post = { id: `legacy-${count}`, status: 'published', publishedMediaId: 'feed', imageUrls: Array.from({ length: count }, (_, i) => `https://example.test/${i}.jpg`) };
    initialize(post, true);
    const assets = post.imageUrls.map(sourceUrl => ({ sourceUrl, url: sourceUrl, width: 1080, height: 1920, sha256: 'b'.repeat(64) }));
    const entry = { kind: count > 1 ? 'carousel_slides' : 'post', sourceKey: sourceKey(post), assets };
    const creates = [];
    await deliver(post, { entry, userId: 'account', save: async () => {}, waitReady: async (...args) => assert.equal(args.length, 2), api: async (method, endpoint, params) => {
      if (endpoint.endsWith('/media')) creates.push(params);
      return { id: `${endpoint}-${creates.length}` };
    } });
    assert.deepEqual(creates, assets.map(asset => ({ media_type: 'STORIES', image_url: asset.url })));
    assert.equal(post.storyRepost.status, 'published');
  }
});
