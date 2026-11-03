'use strict';
// One explicit calendar, one sender, one publication per execution.
const fs = require('fs');
const path = require('path');
const EXPECTED_CAMPAIGN = 'anna-retouch-music-v3-20261031';
const EXPECTED_ACCOUNT = 'mairova_a_a';
const EXPECTED_ACCOUNT_ID = '17841456632615750';
const CADENCE_START = '2026-11-04';
const CLASSIC_TIMES = ['10:00', '14:00', '19:00'];
const AMBIGUOUS = new Set(['publishing', 'unknown', 'needs_review', 'published']);
function readCampaign(contentDir) {
  const file = path.join(contentDir, 'active-feed-campaign.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
function moscowDate(now) { return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); }
function normalizeCaption(s) { return String(s || '').normalize('NFC').replace(/\r\n/g, '\n').trim(); }
function allSlots(campaign) {
  if (!campaign || !Array.isArray(campaign.slots)
    || (campaign.additionalSlots !== undefined && !Array.isArray(campaign.additionalSlots))) throw new Error('Invalid explicit campaign slots');
  return [...campaign.slots, ...(campaign.additionalSlots || [])];
}
function cadencePolicy(campaign) {
  if (campaign.cadence === undefined) return null;
  const p = campaign.cadence;
  if (!p || p.startsOn !== CADENCE_START || !Array.isArray(p.classicTimes)
    || JSON.stringify(p.classicTimes) !== JSON.stringify(CLASSIC_TIMES)
    || Object.keys(p).some(k => !['startsOn', 'classicTimes'].includes(k))) throw new Error('Invalid authorised daily cadence');
  if (campaign.targetTime !== '09:00') throw new Error('Voice target time must remain 09:00 Moscow');
  return p;
}
function laneOf(campaign, id) {
  if (campaign.slots.some(s => s.postId === id)) return 'voice';
  if ((campaign.additionalSlots || []).some(s => s.postId === id)) return 'classic';
  return null;
}
function hasReceipt(post) { return !!(post.publishedMediaId || post.publishedAt || post.status === 'published'); }
function fullCaption(post) {
  if (post.captionComplete) return post.caption;
  return [...new Set([post.caption, post.music?.composer && `♪ ${post.music.composer} — ${post.music.piece}`, post.music?.attribution, (post.hashtags || []).join(' ')].filter(Boolean))].join('\n\n');
}
function validate(campaign, posts) {
  if (!campaign || campaign.version !== 1 || campaign.status !== 'active' || campaign.timezone !== 'Europe/Moscow') throw new Error('Invalid active feed campaign');
  if (campaign.id !== EXPECTED_CAMPAIGN || campaign.account !== EXPECTED_ACCOUNT
    || String(campaign.accountId) !== EXPECTED_ACCOUNT_ID) throw new Error('Campaign account or identity mismatch');
  if (!Array.isArray(campaign.slots) || campaign.slots.length !== 15) throw new Error('Campaign requires fifteen primary slots');
  if (!Array.isArray(posts)) throw new Error('Invalid campaign queue');
  const targetTime = campaign.targetTime || '19:30';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(targetTime)) throw new Error('Invalid campaign target time');
  const policy = cadencePolicy(campaign);
  const ids = new Set(), dates = new Set(), primaryDates = new Set(), instants = new Set(), captions = new Set();
  const classicCounts = new Map(), slots = allSlots(campaign), byId = new Map();
  for (const post of posts) {
    if (!post || typeof post.id !== 'string' || byId.has(post.id)) throw new Error('Invalid or duplicate queue ID');
    byId.set(post.id, post);
  }
  slots.forEach((slot, i) => {
    if (!slot || typeof slot.postId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slot.postId)
      || typeof slot.date !== 'string' || typeof slot.scheduledAt !== 'string') throw new Error('Invalid campaign slot fields');
    const post = byId.get(slot.postId), at = new Date(slot.scheduledAt), primary = i < campaign.slots.length;
    if (!post || ids.has(slot.postId) || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !Number.isFinite(at.getTime())) throw new Error('Invalid or duplicate campaign slot');
    const localTime = at.toLocaleTimeString('en-GB', { timeZone: campaign.timezone, hour12: false }).slice(0, 5);
    if (post.campaignId !== campaign.id || post.date !== slot.date || post.scheduledAt !== slot.scheduledAt
      || moscowDate(at) !== slot.date) throw new Error(`Campaign calendar mismatch: ${slot.postId}`);
    if (!policy && dates.has(slot.date)) throw new Error('Invalid or duplicate campaign slot');
    if (primary && primaryDates.has(slot.date)) throw new Error('Duplicate primary date');
    if (policy && (instants.has(at.getTime()) || at.getUTCSeconds() || at.getUTCMilliseconds())) throw new Error('Duplicate or inexact campaign time');
    if (primary || !policy || slot.date < policy.startsOn) {
      if (localTime !== targetTime) throw new Error(`Campaign calendar mismatch: ${slot.postId}`);
    } else {
      if (!policy.classicTimes.includes(localTime)) throw new Error(`Classic time is outside the authorised daily cadence: ${slot.postId}`);
      const count = (classicCounts.get(slot.date) || 0) + 1;
      if (count > 3) throw new Error('Classic daily limit is three');
      classicCounts.set(slot.date, count);
    }
    if (policy && !primary && slot.date < policy.startsOn
      && (post.status !== 'published' || !post.publishedMediaId || !Number.isFinite(Date.parse(post.publishedAt))
        || moscowDate(post.publishedAt) !== slot.date)) throw new Error('Pre-cadence classic must retain a confirmed historical receipt');
    if (!['pending', 'approved', 'published'].includes(post.status)) throw new Error(`Campaign post is not approved, pending or published: ${slot.postId}`);
    if (post.format !== 'Reels') throw new Error(`Campaign requires Reels: ${slot.postId}`);
    if (i > 0 && primary && at - new Date(campaign.slots[i - 1].scheduledAt) !== 2 * 86400000) throw new Error('Primary campaign interval must be two days');
    if (typeof post.caption !== 'string' || !post.caption.trim()) throw new Error(`Campaign caption required: ${slot.postId}`);
    const caption = normalizeCaption(fullCaption(post));
    if (captions.has(caption)) throw new Error('Campaign captions must be distinct for live reconciliation');
    ids.add(slot.postId); dates.add(slot.date); instants.add(at.getTime()); captions.add(caption);
    if (primary) primaryDates.add(slot.date);
  });
  return campaign;
}
function confirmedToday(campaign, posts, today) {
  const counts = { voice: 0, classic: 0 }, mediaIds = new Set();
  for (const post of posts) {
    const lane = laneOf(campaign, post.id), phase = post.feedDelivery?.phase || post.feedDelivery?.status;
    if (lane && post.date === today && AMBIGUOUS.has(phase) && !post.publishedMediaId) throw new Error(`${post.id}: feed outcome needs reconciliation; automatic retry blocked`);
    const datedToday = post.publishedAt && moscowDate(post.publishedAt) === today;
    if (lane && post.date === today && hasReceipt(post)
      && (!post.publishedMediaId || !datedToday)) throw new Error(`${post.id}: partial or off-day feed receipt needs reconciliation`);
    if (!datedToday) continue;
    if (!lane || !post.publishedMediaId || post.date !== today) throw new Error('Unrecognised or off-day feed publication today; reconcile before publishing');
    const story = post.storyRepost;
    if (!story || story.status !== 'published' || !Array.isArray(story.items) || !story.items.length
      || !story.items.every(item => item.status === 'published' && item.publishedMediaId)) throw new Error(`${post.id}: full Stories repost needs reconciliation before the next feed slot`);
    if (mediaIds.has(String(post.publishedMediaId))) throw new Error('Duplicate same-day feed receipt; reconciliation required');
    mediaIds.add(String(post.publishedMediaId)); counts[lane]++;
  }
  if (counts.classic > 3 || counts.voice > 1) throw new Error('Explicit daily feed limit already exceeded; reconcile before publishing');
  return { counts, mediaIds };
}
function select(campaign, posts, now = new Date(), onlyId) {
  validate(campaign, posts);
  const today = moscowDate(now), slots = allSlots(campaign), policy = cadencePolicy(campaign);
  if (onlyId && !slots.some(s => s.postId === onlyId)) throw new Error('Active campaign blocks posts outside the explicit slots');
  if (policy && today < policy.startsOn) return { post: null, reason: 'Daily cadence has not started; no night or earlier-day catch-up' };
  let slot;
  if (policy) {
    if (onlyId) {
      slot = slots.find(s => s.postId === onlyId);
      if (slot.date !== today) throw new Error('Requested post is outside today\'s campaign slots');
    } else {
      slot = slots.filter(s => s.date === today && !hasReceipt(posts.find(p => p.id === s.postId)))
        .sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
    }
  } else {
    slot = slots.find(s => s.date === today);
    if (slot && onlyId && onlyId !== slot.postId) throw new Error('Requested post is outside today\'s campaign slot');
  }
  if (!slot) return { post: null, reason: 'No remaining campaign slot today; legacy queue stays paused' };
  if (new Date(now) < new Date(slot.scheduledAt)) return { post: null, reason: `Next slot: ${slot.scheduledAt}` };
  const hour = Number(new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
  if (hour < 8 || hour >= 22) return { post: null, reason: 'Publishing window closed; no automatic catch-up on off days' };
  const post = posts.find(p => p.id === slot.postId);
  if (hasReceipt(post)) return { post: null, reason: 'Requested campaign post already has a receipt' };
  if (policy) {
    const firstDue = slots.filter(s => s.date === today && Date.parse(s.scheduledAt) <= new Date(now).getTime()
      && !hasReceipt(posts.find(p => p.id === s.postId)))
      .sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
    if (onlyId && firstDue && firstDue.postId !== onlyId) throw new Error('Requested slot is not the earliest pending due slot');
    const { counts } = confirmedToday(campaign, posts, today), lane = laneOf(campaign, post.id);
    if (counts[lane] >= (lane === 'classic' ? 3 : 1)) return { post: null, reason: `${lane} daily limit reached` };
  } else if (posts.some(p => p.publishedAt && moscowDate(p.publishedAt) === today)) return { post: null, reason: 'Feed already published today; limit one' };
  if (post.status !== 'approved') throw new Error(`${post.id}: slot is not approved`);
  if (AMBIGUOUS.has(post.feedDelivery?.phase || post.feedDelivery?.status)) throw new Error(`${post.id}: feed outcome needs reconciliation; automatic retry blocked`);
  return { post, reason: 'One approved explicit campaign slot is due' };
}
function reconcile(campaign, posts, media, now = new Date(), publishingPost) {
  validate(campaign, posts);
  if (!Array.isArray(media)) throw new Error('Instagram feed history unavailable; publication stopped');
  const expected = new Map(allSlots(campaign).map(s => {
    const p = posts.find(p => p.id === s.postId); return [normalizeCaption(fullCaption(p)), p];
  }));
  const matches = [];
  for (const item of media) {
    const post = expected.get(normalizeCaption(item.caption));
    if (!post) continue;
    matches.push({ postId: post.id, mediaId: item.id, timestamp: item.timestamp, permalink: item.permalink });
    if (post.publishedMediaId !== item.id) throw new Error(`${post.id}: matching caption already exists on Instagram (${item.id}); reconcile before publishing`);
  }
  if (publishingPost) {
    const policy = cadencePolicy(campaign), today = moscowDate(now);
    if (!policy) {
      if (media.some(m => m.timestamp && moscowDate(m.timestamp) === today)) throw new Error('Instagram already has a feed publication today; limit one');
    } else {
      const target = allSlots(campaign).find(s => s.postId === publishingPost.id);
      if (!target || target.date !== today || today < policy.startsOn) throw new Error('Publication is outside today\'s explicit cadence');
      const rechecked = select(campaign, posts, now, publishingPost.id);
      if (!rechecked.post) throw new Error(`Publication no longer eligible: ${rechecked.reason}`);
      const queued = confirmedToday(campaign, posts, today), counts = { voice: 0, classic: 0 }, seen = new Set();
      for (const item of media.filter(m => m.timestamp && moscowDate(m.timestamp) === today)) {
        const post = expected.get(normalizeCaption(item.caption));
        if (!post || post.publishedMediaId !== item.id || post.date !== today) throw new Error('Unrecognised or off-day Instagram publication today; reconcile before publishing');
        if (seen.has(String(item.id))) continue;
        seen.add(String(item.id)); counts[laneOf(campaign, post.id)]++;
      }
      for (const id of queued.mediaIds) if (!seen.has(id)) throw new Error('Live history omits a saved same-day receipt; reconcile before publishing');
      const lane = laneOf(campaign, publishingPost.id);
      if (counts.classic > 3 || counts.voice > 1 || counts[lane] >= (lane === 'classic' ? 3 : 1)) throw new Error('Instagram explicit daily feed limit reached');
    }
  }
  return matches;
}
module.exports = { readCampaign, allSlots, validate, select, fullCaption, reconcile, moscowDate };
