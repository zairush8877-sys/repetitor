'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers/promises');
const { deliver } = require('../feed-state');

const clone = value => JSON.parse(JSON.stringify(value));
function fixture(overrides = {}) {
  const post = { id: 'campaign-reel-01', status: 'approved', videoUrl: 'https://assets.test/reel.mp4', caption: 'Precise caption', ...overrides };
  const saves = [], calls = [], events = [];
  const options = {
    userId: 'ig-user', now: () => new Date('2026-10-31T10:00:00Z'), assetUrl: url => url,
    save: async () => { await setImmediate(); saves.push(clone(post)); events.push(`saved:${post.feedDelivery.phase}`); },
    waitReady: async id => { events.push(`ready:${id}`); return { status_code: 'FINISHED' }; },
    api: async (method, endpoint, params) => {
      calls.push({ method, endpoint, params: clone(params) }); events.push(`api:${endpoint}`);
      if (endpoint.endsWith('/media_publish')) {
        assert.equal(saves.at(-1).feedDelivery.phase, 'publishing', 'durable intent must precede irreversible publish');
        return { id: 'confirmed-media' };
      }
      return { id: 'container-1' };
    },
  };
  return { post, options, saves, calls, events };
}

test('awaits durable publishing intent, then persists the complete receipt together', async () => {
  const f = fixture();
  assert.equal(await deliver(f.post, f.options), 'confirmed-media');
  assert.ok(f.events.indexOf('saved:publishing') < f.events.indexOf('api:ig-user/media_publish'));
  const receipt = f.saves.at(-1);
  assert.equal(receipt.status, 'published');
  assert.equal(receipt.publishedMediaId, 'confirmed-media');
  assert.equal(receipt.publishedAt, '2026-10-31T10:00:00.000Z');
  assert.equal(receipt.feedDelivery.phase, 'published');
  assert.equal(receipt.feedDelivery.mediaId, receipt.publishedMediaId);
  assert.match(receipt.feedDelivery.fingerprint, /^[a-f0-9]{64}$/);
});

test('ambiguous media_publish is saved unknown and a later call performs no API work', async () => {
  const f = fixture();
  f.options.api = async (method, endpoint, params) => {
    f.calls.push({ method, endpoint, params });
    if (endpoint.endsWith('/media_publish')) throw new Error('connection reset after request');
    return { id: 'container-1' };
  };
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_OUTCOME_UNKNOWN' });
  assert.equal(f.saves.at(-1).feedDelivery.phase, 'unknown');
  assert.equal(f.post.status, 'approved');
  const before = f.calls.length;
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_OUTCOME_UNKNOWN' });
  assert.equal(f.calls.length, before);
  assert.equal(f.calls.filter(c => c.endpoint.endsWith('/media_publish')).length, 1);
});

test('an existing publishing intent blocks retry even after an Actions crash', async () => {
  const f = fixture({ feedDelivery: { version: 1, phase: 'publishing', containerId: 'container-before-crash' } });
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_OUTCOME_UNKNOWN' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.saves.length, 0);
});

test('polling failure reuses the exact saved container on a later run', async () => {
  const f = fixture(); let polls = 0;
  f.options.waitReady = async id => { assert.equal(id, 'container-1'); if (++polls === 1) throw new Error('poll timed out'); };
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_POLL_FAILED' });
  assert.equal(f.post.feedDelivery.phase, 'poll_failed');
  assert.equal(f.post.feedDelivery.containerId, 'container-1');
  const restored = clone(f.saves.at(-1));
  f.options.save = async () => { await setImmediate(); f.saves.push(clone(restored)); };
  assert.equal(await deliver(restored, f.options), 'confirmed-media');
  assert.equal(f.calls.filter(c => c.endpoint === 'ig-user/media').length, 1);
  assert.equal(f.calls.filter(c => c.endpoint === 'ig-user/media_publish').length, 1);
});

test('container ERROR never causes automatic recreation or publication', async () => {
  const f = fixture(); f.options.waitReady = async () => ({ status_code: 'ERROR' });
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_POLL_FAILED' });
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_POLL_FAILED' });
  assert.equal(f.calls.filter(c => c.endpoint === 'ig-user/media').length, 1);
  assert.equal(f.calls.filter(c => c.endpoint.endsWith('/media_publish')).length, 0);
  assert.equal(f.post.feedDelivery.containerId, 'container-1');
});

test('creation failure is saved preparing and never attempts feed publication', async () => {
  const f = fixture(); f.options.api = async () => { throw new Error('container request rejected'); };
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_CREATE_FAILED' });
  assert.equal(f.saves.at(-1).feedDelivery.phase, 'preparing');
  assert.equal(f.post.feedDelivery.failedStage, 'create');
  assert.equal(f.post.publishedMediaId, undefined);
});

test('cover_url is preferred over offset and both public URLs are resolved', async () => {
  const f = fixture({ coverUrl: 'https://assets.test/cover.jpg', coverOffsetMs: 2500 });
  f.options.assetUrl = url => url.replace('assets.test', 'cdn.test');
  await deliver(f.post, f.options);
  const params = f.calls[0].params;
  assert.equal(params.video_url, 'https://cdn.test/reel.mp4');
  assert.equal(params.cover_url, 'https://cdn.test/cover.jpg');
  assert.equal(Object.hasOwn(params, 'thumb_offset'), false);
});

test('zero is a valid finite cover offset; non-finite offsets are not sent', async () => {
  const zero = fixture({ coverOffsetMs: 0 }); await deliver(zero.post, zero.options);
  assert.equal(zero.calls[0].params.thumb_offset, '0');
  for (const value of [undefined, NaN, Infinity]) {
    const f = fixture({ coverOffsetMs: value }); await deliver(f.post, f.options);
    assert.equal(Object.hasOwn(f.calls[0].params, 'thumb_offset'), false);
  }
});

test('a changed caption cannot reuse a previously created container', async () => {
  const f = fixture(); f.options.waitReady = async () => { throw new Error('not ready'); };
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_POLL_FAILED' });
  f.post.caption = 'Changed approved asset text'; const before = f.calls.length;
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_CHANGED_AFTER_INTENT' });
  assert.equal(f.calls.length, before);
});

test('failed durable save of publishing intent prevents media_publish', async () => {
  const f = fixture();
  f.options.save = async () => {
    await setImmediate();
    if (f.post.feedDelivery.phase === 'publishing') throw new Error('remote push failed');
    f.saves.push(clone(f.post));
  };
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_STATE_NOT_SAVED' });
  assert.equal(f.calls.filter(c => c.endpoint.endsWith('/media_publish')).length, 0);
});

test('receipt persistence failure exposes the known ID without retrying publication', async () => {
  const f = fixture(); const save = f.options.save;
  f.options.save = async () => { if (f.post.feedDelivery.phase === 'published') throw new Error('push failed'); await save(); };
  await assert.rejects(deliver(f.post, f.options), error => error.code === 'FEED_RECEIPT_NOT_SAVED' && error.message.includes('confirmed-media'));
  assert.equal(f.post.feedDelivery.phase, 'published');
  assert.equal(f.post.publishedMediaId, 'confirmed-media');
  f.options.save = save;
  assert.equal(await deliver(f.post, f.options), 'confirmed-media');
  assert.equal(f.calls.filter(c => c.endpoint.endsWith('/media_publish')).length, 1);
});

test('a known published receipt returns without external calls', async () => {
  const f = fixture({ status: 'published', publishedMediaId: 'previous-media', publishedAt: '2026-10-30T10:00:00Z',
    feedDelivery: { version: 1, phase: 'published', mediaId: 'previous-media' } });
  assert.equal(await deliver(f.post, f.options), 'previous-media');
  assert.equal(f.calls.length, 0);
});

test('a container already PUBLISHED without a receipt is marked unknown', async () => {
  const f = fixture(); f.options.waitReady = async () => ({ status_code: 'PUBLISHED' });
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_OUTCOME_UNKNOWN' });
  assert.equal(f.post.feedDelivery.phase, 'unknown');
  assert.equal(f.calls.filter(c => c.endpoint.endsWith('/media_publish')).length, 0);
});

test('a missing publication ID is an ambiguous outcome and token text is redacted', async () => {
  const f = fixture();
  f.options.api = async (method, endpoint) => endpoint.endsWith('/media_publish') ? {} : { id: 'container-1' };
  await assert.rejects(deliver(f.post, f.options), { code: 'FEED_OUTCOME_UNKNOWN' });
  assert.equal(f.post.feedDelivery.phase, 'unknown');
  const other = fixture();
  other.options.api = async () => { throw new Error('failed access_token=SECRET&x=1 Authorization: Bearer SECRET2'); };
  await assert.rejects(deliver(other.post, other.options), { code: 'FEED_CREATE_FAILED' });
  assert.equal(other.post.feedDelivery.lastError.includes('SECRET'), false);
});
