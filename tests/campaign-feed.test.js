'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const campaign = require('../campaign-feed');

const DATES = [
  '2026-10-31', '2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08',
  '2026-11-10', '2026-11-12', '2026-11-14', '2026-11-16', '2026-11-18',
  '2026-11-20', '2026-11-22', '2026-11-24', '2026-11-26', '2026-11-28',
];
const IDS = [
  '01-nn-okno', '02-tsya', '03-udareniya', '04-chto-zapyataya', '05-po-priezde',
  '06-ne-glagol', '07-kommentariy-ege', '08-deeprichastie', '09-omonimy',
  '10-odna-bukva', '12-skuchayu', '13-lyag', '14-vetrenyy', '15-kofe', '16-oblegchit',
];
const CAMPAIGN_ID = 'anna-retouch-music-v3-20261031';
function fixture() {
  const slots = DATES.map((date, i) => ({ postId: IDS[i], date, scheduledAt: `${date}T19:30:00+03:00` }));
  const c = { version: 1, status: 'active', timezone: 'Europe/Moscow', id: CAMPAIGN_ID, slots };
  const posts = slots.map(s => ({
    id: s.postId, campaignId: c.id, date: s.date, scheduledAt: s.scheduledAt,
    status: 'approved', captionComplete: true, caption: `Approved caption ${s.postId}`,
  }));
  posts.push({ id: 'legacy-approved', status: 'approved', date: '2026-09-01', caption: 'Legacy bank' });
  return { c, posts };
}
function run(date, time = '19:30:00') { return new Date(`${date}T${time}+03:00`); }
function live(post, fields = {}) {
  return { id: 'ig-matched', caption: campaign.fullCaption(post), timestamp: '2026-10-30T16:30:00Z', permalink: 'https://example.test/reel/1', ...fields };
}

test('explicit fifteen-slot calendar crosses October/November without changing parity or order', () => {
  const { c, posts } = fixture();
  assert.equal(campaign.validate(c, posts), c);
  assert.equal(c.slots.length, 15);
  assert.deepEqual(c.slots.map(s => s.date), DATES);
  assert.deepEqual(c.slots.map(s => s.postId), IDS);
  assert.equal(new Date(c.slots[0].scheduledAt).toISOString(), '2026-10-31T16:30:00.000Z');
  assert.equal(new Date(c.slots[14].scheduledAt).toISOString(), '2026-11-28T16:30:00.000Z');
});

for (let i = 0; i < DATES.length; i++) {
  test(`scheduled day ${DATES[i]} selects only authorised slot ${IDS[i]}`, () => {
    const { c, posts } = fixture(), before = JSON.stringify({ c, posts });
    const result = campaign.select(c, posts, run(DATES[i]));
    assert.equal(result.post?.id, IDS[i]);
    assert.notEqual(result.post?.id, 'legacy-approved');
    assert.equal(JSON.stringify({ c, posts }), before, 'selection must not mutate approvals or receipts');
  });
}

for (const date of ['2026-10-30', '2026-11-01', '2026-11-03', '2026-11-27', '2026-11-29', '2026-11-30', '2026-12-01']) {
  test(`off-day ${date} never catches up or falls back to legacy approvals`, () => {
    const { c, posts } = fixture();
    assert.equal(campaign.select(c, posts, run(date)).post, null);
  });
}

test('19:30 Moscow is inclusive; early and night runs cannot publish', () => {
  const { c, posts } = fixture();
  for (const time of ['00:00:00', '19:29:59']) assert.equal(campaign.select(c, posts, run(DATES[0], time)).post, null);
  assert.equal(campaign.select(c, posts, run(DATES[0], '19:30:00')).post.id, IDS[0]);
  assert.equal(campaign.select(c, posts, run(DATES[0], '21:59:59')).post.id, IDS[0]);
  for (const time of ['22:00:00', '23:59:59']) assert.equal(campaign.select(c, posts, run(DATES[0], time)).post, null);
});

test('missing an earlier slot never displaces the exact slot on 2 November', () => {
  const { c, posts } = fixture();
  assert.equal(posts[0].status, 'approved');
  assert.equal(campaign.select(c, posts, run('2026-11-02')).post.id, IDS[1]);
  assert.equal(campaign.select(c, posts, run('2026-11-01')).post, null);
});

test('empty manual dispatch selects one due slot instead of flushing approved bank', () => {
  const { c, posts } = fixture();
  for (const onlyId of [undefined, '']) {
    const selected = campaign.select(c, posts, run(DATES[0]), onlyId);
    assert.equal(selected.post.id, IDS[0]);
    assert.equal(Array.isArray(selected.post), false);
  }
});

test('manual ID cannot bypass campaign scope or requested day', () => {
  const { c, posts } = fixture();
  assert.throws(() => campaign.select(c, posts, run(DATES[0]), 'legacy-approved'), /outside|blocks/i);
  assert.throws(() => campaign.select(c, posts, run(DATES[0]), IDS[1]), /outside|today/i);
  assert.equal(campaign.select(c, posts, run(DATES[0]), IDS[0]).post.id, IDS[0]);
});

for (const status of ['pending', 'rejected']) {
  test(`a ${status} slot cannot be published even by explicit ID`, () => {
    const { c, posts } = fixture(); posts[0].status = status;
    assert.throws(() => campaign.select(c, posts, run(DATES[0]), IDS[0]), /not approved/i);
  });
}

for (const receipt of [{ status: 'published' }, { publishedMediaId: 'ig-receipt' }, { publishedAt: '2026-10-31T16:30:01Z' }]) {
  test(`existing feed confirmation ${Object.keys(receipt)[0]} prevents resend`, () => {
    const { c, posts } = fixture(); Object.assign(posts[0], receipt);
    assert.equal(campaign.select(c, posts, run(DATES[0])).post, null);
  });
}

for (const status of ['publishing', 'unknown', 'needs_review']) {
  test(`ambiguous feed delivery ${status} blocks automatic and explicit retry`, () => {
    const { c, posts } = fixture(); posts[0].feedDelivery = { status, containerId: 'container-1' };
    for (const onlyId of [undefined, IDS[0]]) assert.throws(() => campaign.select(c, posts, run(DATES[0]), onlyId), /reconcil|retry|outcome|review/i);
  });
}

test('local confirmation of another feed item today consumes the one-post limit, using Moscow date', () => {
  const { c, posts } = fixture();
  posts.push({ id: 'manual-other', publishedAt: '2026-10-30T21:30:00Z' });
  assert.equal(campaign.select(c, posts, run(DATES[0])).post, null);
});

test('previous Moscow day confirmation does not consume today', () => {
  const { c, posts } = fixture(); posts.push({ id: 'yesterday', publishedAt: '2026-10-30T20:59:59Z' });
  assert.equal(campaign.select(c, posts, run(DATES[0])).post.id, IDS[0]);
});

for (const timezone of ['UTC', 'Europe/Moscow', 'America/Los_Angeles']) {
  test(`Moscow day and clock remain correct when host TZ=${timezone}`, () => {
    const script = `const c=require(${JSON.stringify(path.resolve(__dirname, '../campaign-feed'))}); process.stdout.write(JSON.stringify([c.moscowDate('2026-10-30T21:00:00Z'),c.moscowDate('2026-10-31T21:00:00Z')]));`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['2026-10-31', '2026-11-01']);
  });
}

test('invalid or inactive configuration fails closed', () => {
  const { c, posts } = fixture();
  for (const bad of [null, { ...c, version: 2 }, { ...c, status: 'complete' }, { ...c, timezone: 'UTC' }, { ...c, slots: [] }]) assert.throws(() => campaign.validate(bad, posts));
});

test('truncated approval calendar cannot silently become a different-sized campaign', () => {
  const { c, posts } = fixture();
  assert.throws(() => campaign.validate({ ...c, slots: c.slots.slice(0, 14) }, posts), /fifteen|15|count|calendar|slot/i);
});

test('duplicate IDs, duplicate dates and broken cadence are rejected', () => {
  for (const alter of [
    c => { c.slots[1].postId = c.slots[0].postId; },
    c => { c.slots[1].date = c.slots[0].date; },
    c => { [c.slots[1], c.slots[2]] = [c.slots[2], c.slots[1]]; },
  ]) {
    const { c, posts } = fixture(); alter(c); assert.throws(() => campaign.validate(c, posts));
  }
});

test('mismatched campaign, date, time or missing post cannot grant approval', () => {
  for (const alter of [
    f => { f.posts[0].campaignId = 'unrelated-campaign'; },
    f => { f.posts[0].date = '2026-11-01'; },
    f => { f.posts[0].scheduledAt = '2026-10-31T20:30:00+03:00'; },
    f => { f.posts.shift(); },
  ]) { const f = fixture(); alter(f); assert.throws(() => campaign.validate(f.c, f.posts)); }
});

test('assembling caption retains exact credits once and does not mutate the post', () => {
  const post = { caption: 'Caption', music: { composer: 'Composer', piece: 'Piece', attribution: 'Recording credit' }, hashtags: ['#one', '#two'] };
  const before = JSON.stringify(post);
  assert.equal(campaign.fullCaption(post), 'Caption\n\n♪ Composer — Piece\n\nRecording credit\n\n#one #two');
  assert.equal(JSON.stringify(post), before);
  assert.equal(campaign.fullCaption({ caption: 'Caption', music: { composer: 'Composer', piece: 'Piece', attribution: '♪ Composer — Piece' } }), 'Caption\n\n♪ Composer — Piece');
});

test('captionComplete preserves the approved caption byte for byte and does not append credits again', () => {
  const caption = 'Approved text\n\n♪ Existing composer — Existing piece\n\n#tag';
  assert.equal(campaign.fullCaption({ captionComplete: true, caption, hashtags: ['#extra'], music: { composer: 'Other', piece: 'Other' } }), caption);
});

test('no live matches or older unrelated live media produces no mutation', () => {
  const { c, posts } = fixture(), before = JSON.stringify(posts);
  assert.deepEqual(campaign.reconcile(c, posts, [], run(DATES[0]), posts[0]), []);
  assert.deepEqual(campaign.reconcile(c, posts, [{ id: 'old', caption: 'Other text', timestamp: '2026-10-30T16:30:00Z' }], run(DATES[0]), posts[0]), []);
  assert.equal(JSON.stringify(posts), before);
});

test('matching live caption blocks sending again when local receipt was lost', () => {
  const { c, posts } = fixture();
  assert.throws(() => campaign.reconcile(c, posts, [live(posts[0])], run(DATES[0]), posts[0]), /already exists|matching caption|reconcile/i);
});

test('matching a future campaign caption in Instagram also requires reconciliation', () => {
  const { c, posts } = fixture();
  assert.throws(() => campaign.reconcile(c, posts, [live(posts[14])], run(DATES[0]), posts[0]), /already exists|matching caption|reconcile/i);
});

test('confirmed matching live receipt is returned without overwriting queue state', () => {
  const { c, posts } = fixture(); posts[0].publishedMediaId = 'ig-matched';
  const before = JSON.stringify(posts), item = live(posts[0]);
  assert.deepEqual(campaign.reconcile(c, posts, [item], run(DATES[1])), [{ postId: IDS[0], mediaId: item.id, timestamp: item.timestamp, permalink: item.permalink }]);
  assert.equal(JSON.stringify(posts), before);
});

test('different live receipt for a known caption is blocked rather than silently rebound', () => {
  const { c, posts } = fixture(); posts[0].publishedMediaId = 'different-local-id';
  assert.throws(() => campaign.reconcile(c, posts, [live(posts[0])], run(DATES[1])), /already exists|matching caption|reconcile/i);
});

test('another manually published feed item today blocks the planned write, including Moscow midnight boundary', () => {
  const { c, posts } = fixture();
  for (const timestamp of ['2026-10-30T21:00:00Z', '2026-10-31T16:00:00Z']) {
    assert.throws(() => campaign.reconcile(c, posts, [{ id: 'manual-other', caption: 'Other text', timestamp }], run(DATES[0]), posts[0]), /already has|limit one/i);
  }
});

test('live duplicate check tolerates line endings, Unicode composition and trailing whitespace', () => {
  const { c, posts } = fixture(); posts[0].caption = 'Caf\u00e9\n\nApproved caption';
  const item = live(posts[0], { caption: 'Cafe\u0301\r\n\r\nApproved caption  ' });
  assert.throws(() => campaign.reconcile(c, posts, [item], run(DATES[0]), posts[0]), /already exists|matching caption|reconcile/i);
});

test('real feed-state phase values block retries when no confirmed receipt exists', () => {
  for (const phase of ['publishing', 'unknown', 'needs_review', 'published']) {
    const { c, posts } = fixture();
    posts[0].feedDelivery = { version: 1, phase, containerId: 'saved-container' };
    for (const onlyId of [undefined, IDS[0]]) {
      assert.throws(() => campaign.select(c, posts, run(DATES[0]), onlyId), /reconcil|retry|outcome|review/i, phase);
    }
  }
});

test('a known receipt prevents resend even when the saved feed phase is stale', () => {
  const { c, posts } = fixture();
  posts[0].publishedMediaId = 'confirmed-receipt';
  posts[0].feedDelivery = { version: 1, phase: 'unknown', containerId: 'saved-container' };
  assert.equal(campaign.select(c, posts, run(DATES[0])).post, null);
});
