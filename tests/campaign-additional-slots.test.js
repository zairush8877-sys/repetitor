'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../campaign-feed');
const { deliver } = require('../feed-state');

const PRIMARY_IDS = [
  '01-nn-okno', '02-tsya', '03-udareniya', '04-chto-zapyataya', '05-po-priezde',
  '06-ne-glagol', '07-kommentariy-ege', '08-deeprichastie', '09-omonimy', '10-odna-bukva',
  '12-skuchayu', '13-lyag', '14-vetrenyy', '15-kofe', '16-oblegchit',
];
function fixture() {
  const campaign = {
    version: 1, id: 'anna-retouch-music-v3-20261031', status: 'active',
    account: 'mairova_a_a', accountId: '17841456632615750', timezone: 'Europe/Moscow',
    targetTime: '09:00', schoolQuotaOverride: true,
    slots: PRIMARY_IDS.map((suffix, i) => {
      const scheduledAt = new Date(Date.parse('2026-10-31T06:00:00Z') + i * 2 * 86400000).toISOString();
      return { postId: `anna-v3-20261031-${suffix}`, date: scheduledAt.slice(0, 10), scheduledAt };
    }),
  };
  const posts = campaign.slots.map((s, i) => ({
    id: s.postId, campaignId: campaign.id, date: s.date, scheduledAt: s.scheduledAt,
    status: 'approved', format: 'Reels', caption: `Synthetic primary caption ${i}`, captionComplete: true,
  }));
  const originalSlots = structuredClone(campaign.slots);
  return { campaign, posts, originalSlots };
}
function add(f, date = '2026-11-03', id = 'classic-synthetic-one') {
  const slot = { postId: id, date, scheduledAt: `${date}T06:00:00.000Z` };
  (f.campaign.additionalSlots ||= []).push(slot);
  const post = { id, campaignId: f.campaign.id, date, scheduledAt: slot.scheduledAt,
    status: 'approved', format: 'Reels', caption: `Synthetic classic caption ${id}`, captionComplete: true,
    videoUrl: 'https://example.invalid/content/reels/synthetic.mp4', coverOffsetMs: 11800 };
  f.posts.push(post);
  return post;
}
const NOW = new Date('2026-11-03T15:30:00Z'); // 18:30 Moscow, same-day slot.

test('baseline fifteen retain their calendar; an off-day never wakes legacy posts', () => {
  const f = fixture();
  f.posts.push({ id: 'legacy-overdue', status: 'approved', date: '2026-10-01', caption: 'Legacy' });
  c.validate(f.campaign, f.posts);
  assert.equal(c.select(f.campaign, f.posts, NOW).post, null);
  assert.throws(() => c.select(f.campaign, f.posts, NOW, 'legacy-overdue'), /outside the explicit slots/);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-04T06:00:00Z')).post.id, f.campaign.slots[2].postId);
  assert.deepEqual(f.campaign.slots, f.originalSlots);
});

test('one explicit classic can publish on the free day without moving any primary slot', () => {
  const f = fixture(), post = add(f);
  assert.equal(c.allSlots(f.campaign).length, 16);
  assert.equal(c.select(f.campaign, f.posts, NOW, post.id).post, post);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-04T06:00:00Z')).post.id, f.campaign.slots[2].postId);
  assert.deepEqual(f.campaign.slots, f.originalSlots);
  const slots = c.allSlots(f.campaign); slots.pop();
  assert.equal(f.campaign.additionalSlots.length, 1); // Returned array membership is independent of config arrays.
});

test('a pending classic is blocked while the next approved primary slot stays selectable', () => {
  const f = fixture(), post = add(f); post.status = 'pending';
  c.validate(f.campaign, f.posts);
  assert.throws(() => c.select(f.campaign, f.posts, NOW, post.id), /not approved/);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-04T09:00:00Z')).post.id, f.campaign.slots[2].postId);
});

test('an approved same-campaign post without an explicit slot remains blocked', () => {
  const f = fixture(), post = add(f); f.campaign.additionalSlots = [];
  assert.throws(() => c.select(f.campaign, f.posts, NOW, post.id), /outside the explicit slots/);
  assert.equal(c.select(f.campaign, f.posts, NOW).post, null);
});

test('account, campaign, active status, timezone and additional slot type are checked', () => {
  const mutations = [
    f => { f.campaign.account = 'another_account'; },
    f => { f.campaign.accountId = 'another_id'; },
    f => { f.campaign.id = 'another_campaign'; },
    f => { f.campaign.status = 'paused'; },
    f => { f.campaign.timezone = 'UTC'; },
    f => { f.campaign.additionalSlots = {}; },
    f => { f.campaign.targetTime = '29:70'; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => c.validate(f.campaign, f.posts)); }
});

test('duplicate IDs, primary dates, additional dates and queue IDs are rejected', () => {
  const mutations = [
    f => { f.campaign.additionalSlots.push({ ...f.campaign.additionalSlots[0] }); },
    f => { f.campaign.additionalSlots[0] = { ...f.campaign.slots[2] }; },
    f => { const p = add(f, '2026-11-03', 'classic-synthetic-two'); assert.ok(p); },
    f => { f.posts.push({ ...f.posts[0] }); },
  ];
  for (const mutate of mutations) { const f = fixture(); add(f); mutate(f); assert.throws(() => c.validate(f.campaign, f.posts), /duplicate/i); }
});

test('slot/post date, scheduledAt, campaign ID, format, status and missing caption cannot diverge', () => {
  const mutations = [
    (f,p) => { p.date = '2026-11-05'; },
    (f,p) => { p.scheduledAt = '2026-11-03T07:00:00Z'; },
    (f,p) => { p.campaignId = 'other'; },
    (f,p) => { p.format = 'Post'; },
    (f,p) => { p.status = 'rejected'; },
    (f,p) => { p.caption = ' '; },
    (f,p) => { const s=f.campaign.additionalSlots[0]; s.scheduledAt=p.scheduledAt='2026-11-03T07:00:00Z'; },
    (f,p) => { f.campaign.additionalSlots[0].scheduledAt = 'invalid'; },
  ];
  for (const mutate of mutations) { const f = fixture(), p=add(f); mutate(f,p); assert.throws(() => c.validate(f.campaign, f.posts)); }
});

test('primary count and two-day interval still apply, independently of extra dates', () => {
  let f = fixture(); add(f); f.campaign.slots.pop(); assert.throws(() => c.validate(f.campaign, f.posts), /fifteen primary/);
  f = fixture(); add(f);
  const s=f.campaign.slots[2], p=f.posts[2]; s.date=p.date='2026-11-05'; s.scheduledAt=p.scheduledAt='2026-11-05T06:00:00.000Z';
  assert.throws(() => c.validate(f.campaign, f.posts), /two days/);
});

test('eligibility threshold, Moscow date, closing window and no catch-up remain intact', () => {
  const f = fixture(), post = add(f);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-03T05:59:59Z')).post, null);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-03T06:00:00Z')).post, post);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-03T18:59:59Z')).post, post);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-03T19:00:00Z')).post, null);
  assert.equal(c.select(f.campaign, f.posts, new Date('2026-11-05T12:00:00Z')).post, null);
  assert.throws(() => c.select(f.campaign, f.posts, new Date('2026-11-04T12:00:00Z'), post.id), /outside today's/);
});

test('any already-published feed item today prevents a second primary or classic', () => {
  const f = fixture(); add(f);
  f.posts.push({ id:'manual-today', status:'published', publishedAt:'2026-11-03T08:00:00Z' });
  const selected=c.select(f.campaign,f.posts,NOW);
  assert.equal(selected.post,null); assert.match(selected.reason,/limit one/);
});

test('partial receipt is never resent; unknown and publishing phases require reconciliation', () => {
  for (const receipt of [{ status:'published' },{ publishedMediaId:'known' },{ publishedAt:'2026-11-03T08:00:00Z' }]) {
    const f=fixture(),post=add(f); Object.assign(post,receipt); assert.equal(c.select(f.campaign,f.posts,NOW).post,null);
  }
  for (const phase of ['publishing','unknown','needs_review','published']) {
    const f=fixture(),post=add(f);post.feedDelivery={phase};assert.throws(()=>c.select(f.campaign,f.posts,NOW),/reconciliation/);
  }
});

test('live reconciliation covers additional captions and mismatched historical IDs', () => {
  const f=fixture(),post=add(f);
  const media={ id:'classic-receipt',caption:post.caption,timestamp:'2026-11-03T12:00:00Z',permalink:'https://example.invalid/reel/classic' };
  assert.throws(()=>c.reconcile(f.campaign,f.posts,[media],NOW),/already exists/);
  post.publishedMediaId=media.id;
  assert.deepEqual(c.reconcile(f.campaign,f.posts,[media],NOW),[{postId:post.id,mediaId:media.id,timestamp:media.timestamp,permalink:media.permalink}]);
  f.posts[0].publishedMediaId='primary-receipt';
  assert.equal(c.reconcile(f.campaign,f.posts,[{id:'primary-receipt',caption:f.posts[0].caption}],NOW).length,1);
});

test('reconciliation rejects missing history, external same-day posts and ambiguous captions', () => {
  const f=fixture(),post=add(f);
  assert.throws(()=>c.reconcile(f.campaign,f.posts,null,NOW,post),/history unavailable/);
  assert.throws(()=>c.reconcile(f.campaign,f.posts,[{id:'external',caption:'Outside explicit campaign',timestamp:'2026-11-03T12:00:00Z'}],NOW,post),/limit one/);
  post.caption=` ${f.posts[0].caption}\r\n`;
  assert.throws(()=>c.validate(f.campaign,f.posts),/distinct/);
});

test('selected classic uses the unchanged durable sender and reuses its confirmed receipt', async () => {
  const f=fixture(),post=add(f),saved=[],calls=[];
  assert.equal(c.select(f.campaign,f.posts,NOW).post,post);
  const options={userId:f.campaign.accountId,now:()=>NOW,waitReady:async()=> 'FINISHED',save:async()=>{saved.push(structuredClone(post));},api:async(method,endpoint)=>{
    calls.push(endpoint);
    if(endpoint.endsWith('/media_publish')) { assert.equal(saved.at(-1).feedDelivery.phase,'publishing');return{id:'receipt'}; }
    return{id:'container'};
  }};
  assert.equal(await deliver(post,options),'receipt');
  assert.equal(calls.filter(x=>x.endsWith('/media_publish')).length,1);
  assert.equal(saved.at(-1).publishedMediaId,'receipt');
  assert.equal(await deliver(post,options),'receipt');
  assert.equal(calls.length,2);
  assert.equal(c.select(f.campaign,f.posts,NOW).post,null);
  assert.deepEqual(f.campaign.slots,f.originalSlots);
});

test('an unknown publish result is persisted and prevents a second creation or publish', async () => {
  const f=fixture(),post=add(f),saved=[],calls=[];
  const options={userId:f.campaign.accountId,now:()=>NOW,waitReady:async()=> 'FINISHED',save:async()=>saved.push(post.feedDelivery.phase),api:async(method,endpoint)=>{
    calls.push(endpoint);if(endpoint.endsWith('/media_publish'))throw new Error('Synthetic lost response');return{id:'container'};
  }};
  await assert.rejects(deliver(post,options),error=>error.code==='FEED_OUTCOME_UNKNOWN');
  assert.equal(saved.at(-1),'unknown');assert.throws(()=>c.select(f.campaign,f.posts,NOW),/reconciliation/);
  await assert.rejects(deliver(post,options),error=>error.code==='FEED_OUTCOME_UNKNOWN');
  assert.equal(calls.length,2);
});

test('failed intent persistence stops before any external API request', async () => {
  const f=fixture(),post=add(f);let calls=0;
  await assert.rejects(deliver(post,{userId:f.campaign.accountId,api:async()=>{calls++;},waitReady:async()=>{},save:async()=>{throw new Error('Synthetic persistence failure');}}),error=>error.code==='FEED_STATE_NOT_SAVED');
  assert.equal(calls,0);
});
