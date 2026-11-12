'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const calendar = require('../campaign-feed');
const prepared = require('../prepared-media');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const DATES = [
  '2026-10-31', '2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08',
  '2026-11-10', '2026-11-12', '2026-11-14', '2026-11-16', '2026-11-18',
  '2026-11-20', '2026-11-22', '2026-11-24', '2026-11-26', '2026-11-28',
];

function live() {
  return {
    c: JSON.parse(fs.readFileSync(path.join(CONTENT, 'active-feed-campaign.json'), 'utf8')),
    posts: JSON.parse(fs.readFileSync(path.join(CONTENT, 'queue.json'), 'utf8')).posts,
  };
}
function scenario() {
  const { c, posts: source } = live();
  const ids = new Set(c.slots.map(slot => slot.postId));
  // Simulate each future calendar date independently. Do not depend on mutable
  // delivery receipts when these tests are rerun after the series starts.
  const posts = source.filter(post => ids.has(post.id)).map(post => {
    const copy = { ...post, status: 'approved' };
    for (const key of ['publishedAt', 'publishedMediaId', 'feedDelivery', 'storyRepost']) delete copy[key];
    return copy;
  });
  posts.push({ id: 'legacy-approved-morning-fixture', date: '2026-09-01', status: 'approved', caption: 'Old approved bank' });
  return { c, posts };
}
function at(date, time = '09:00:00') { return new Date(`${date}T${time}+03:00`); }

test('live campaign is exactly fifteen slots from 31 October to 28 November, with matching queue dates', () => {
  const { c, posts } = live();
  assert.equal(c.targetTime, '09:00');
  assert.equal(c.timezone, 'Europe/Moscow');
  assert.deepEqual(c.slots.map(slot => slot.date), DATES);
  assert.equal(c.slots.length, 15);
  assert.equal(calendar.validate(c, posts), c);
  for (const slot of c.slots) {
    const post = posts.find(post => post.id === slot.postId);
    assert.equal(slot.scheduledAt, `${slot.date}T06:00:00.000Z`);
    assert.equal(post.date, slot.date);
    assert.equal(post.scheduledAt, slot.scheduledAt);
  }
});

for (let i = 0; i < DATES.length; i++) {
  test(`${DATES[i]} selects its one approved Reel exactly at 09:00 Moscow, never at 08:59:59`, () => {
    const { c, posts } = scenario(), before = JSON.stringify({ c, posts });
    assert.equal(calendar.select(c, posts, at(DATES[i], '08:59:59')).post, null);
    assert.equal(calendar.select(c, posts, at(DATES[i])).post.id, c.slots[i].postId);
    assert.equal(calendar.select(c, posts, new Date(`${DATES[i]}T06:00:00.000Z`)).post.id, c.slots[i].postId);
    assert.equal(JSON.stringify({ c, posts }), before, 'selection may not rewrite the calendar or approvals');
  });
}

for (const date of ['2026-10-30', '2026-11-01', '2026-11-03', '2026-11-27', '2026-11-29', '2026-11-30', '2026-12-01']) {
  test(`${date} cannot release an old slot or fall back to legacy approvals`, () => {
    const { c, posts } = scenario();
    for (const time of ['09:00:00', '19:30:00', '21:59:59']) assert.equal(calendar.select(c, posts, at(date, time)).post, null);
  });
}

test('explicit release-now request can use the first slot at noon on 31 October, while 1 November stays paused', () => {
  const { c, posts } = scenario();
  assert.equal(calendar.select(c, posts, at('2026-10-31', '12:00:00')).post.id, c.slots[0].postId);
  assert.equal(calendar.select(c, posts, at('2026-11-01', '09:00:00')).post, null);
});

test('morning calendar retains the 08:00-22:00 publication guard', () => {
  const { c, posts } = scenario();
  for (const time of ['00:00:00', '07:59:59', '08:00:00', '08:59:59', '22:00:00', '23:59:59']) {
    assert.equal(calendar.select(c, posts, at(DATES[0], time)).post, null);
  }
  assert.equal(calendar.select(c, posts, at(DATES[0], '09:00:00')).post.id, c.slots[0].postId);
  assert.equal(calendar.select(c, posts, at(DATES[0], '21:59:59')).post.id, c.slots[0].postId);
});

test('changing targetTime without changing the approved timestamps fails closed', () => {
  const { c, posts } = scenario();
  c.targetTime = '19:30';
  assert.throws(() => calendar.validate(c, posts), /calendar mismatch/i);
});

test('changing every timestamp away from 09:00 still fails even when dates, cadence and queue agree', () => {
  const { c, posts } = scenario();
  for (const slot of c.slots) {
    slot.scheduledAt = `${slot.date}T06:30:00.000Z`;
    posts.find(post => post.id === slot.postId).scheduledAt = slot.scheduledAt;
  }
  assert.throws(() => calendar.validate(c, posts), /calendar mismatch/i);
});

test('one queue timestamp cannot disagree with its approved campaign slot', () => {
  const { c, posts } = scenario();
  posts.find(post => post.id === c.slots[0].postId).scheduledAt = `${DATES[0]}T06:01:00.000Z`;
  assert.throws(() => calendar.validate(c, posts), /calendar mismatch/i);
});

for (const targetTime of ['9:00', '09:60', '24:00', '09:00:00']) {
  test(`invalid or mismatched targetTime ${targetTime} is rejected`, () => {
    const { c, posts } = scenario(); c.targetTime = targetTime;
    assert.throws(() => calendar.validate(c, posts), /target time|calendar mismatch/i);
  });
}

test('all fifteen live prepared manifests remain valid after the authorised date change', () => {
  const { c, posts } = live();
  const index = prepared.readIndex(CONTENT);
  for (const slot of c.slots) {
    const post = posts.find(post => post.id === slot.postId);
    const entry = index.posts[slot.postId];
    assert.ok(entry, `missing prepared entry for ${slot.postId}`);
    assert.equal(entry.draftKey, prepared.draftKey(post), `stale calendar fingerprint for ${slot.postId}`);
    const result = prepared.validate(post, { contentDir: CONTENT, entry });
    assert.equal(result.summary.prepared, true);
    assert.equal(result.summary.id, slot.postId);
  }
});

for (const timezone of ['UTC', 'Europe/Moscow', 'America/Los_Angeles']) {
  test(`live morning slot is selected at 06:00 UTC with host TZ=${timezone}`, () => {
    const { c, posts } = scenario();
    const script = `const x=JSON.parse(process.env.MORNING_FIXTURE);const c=require(${JSON.stringify(path.join(ROOT, 'campaign-feed'))});const p=c.select(x.c,x.posts,new Date('2026-10-31T06:00:00Z')).post;process.stdout.write(p.id);`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: timezone, MORNING_FIXTURE: JSON.stringify({ c, posts }) } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, c.slots[0].postId);
  });
}
