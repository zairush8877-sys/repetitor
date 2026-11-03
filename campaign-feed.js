'use strict';
// One explicit calendar and one sender. Extra slots never wake the legacy queue.
const fs = require('fs');
const path = require('path');
const EXPECTED_CAMPAIGN = 'anna-retouch-music-v3-20261031';
const EXPECTED_ACCOUNT = 'mairova_a_a';
const EXPECTED_ACCOUNT_ID = '17841456632615750';
function readCampaign(contentDir) {
  const file = path.join(contentDir, 'active-feed-campaign.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
function moscowDate(now) { return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); }
function normalizeCaption(s) { return String(s || '').normalize('NFC').replace(/\r\n/g, '\n').trim(); }
function allSlots(campaign) {
  if (!campaign || !Array.isArray(campaign.slots)
    || (campaign.additionalSlots !== undefined && !Array.isArray(campaign.additionalSlots))) {
    throw new Error('Invalid explicit campaign slots');
  }
  return [...campaign.slots, ...(campaign.additionalSlots || [])];
}
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
  const ids = new Set(), dates = new Set(), captions = new Set();
  const slots = allSlots(campaign);
  const byId = new Map();
  for (const post of posts) {
    if (!post || typeof post.id !== 'string' || byId.has(post.id)) throw new Error('Invalid or duplicate queue ID');
    byId.set(post.id, post);
  }
  slots.forEach((slot, i) => {
    if (!slot || typeof slot.postId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slot.postId)
      || typeof slot.date !== 'string' || typeof slot.scheduledAt !== 'string') throw new Error('Invalid campaign slot fields');
    const post = byId.get(slot.postId);
    const at = new Date(slot.scheduledAt);
    if (!post || ids.has(slot.postId) || dates.has(slot.date) || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !Number.isFinite(at.getTime())) throw new Error('Invalid or duplicate campaign slot');
    const localTime = at.toLocaleTimeString('en-GB', { timeZone: campaign.timezone, hour12: false }).slice(0, 5);
    if (post.campaignId !== campaign.id || post.date !== slot.date || post.scheduledAt !== slot.scheduledAt
      || moscowDate(at) !== slot.date || localTime !== targetTime) throw new Error(`Campaign calendar mismatch: ${slot.postId}`);
    if (!['pending', 'approved', 'published'].includes(post.status)) throw new Error(`Campaign post is not approved, pending or published: ${slot.postId}`);
    if (post.format !== 'Reels') throw new Error(`Campaign requires Reels: ${slot.postId}`);
    if (i > 0 && i < campaign.slots.length
      && at - new Date(campaign.slots[i - 1].scheduledAt) !== 2 * 86400000) throw new Error('Primary campaign interval must be two days');
    if (typeof post.caption !== 'string' || !post.caption.trim()) throw new Error(`Campaign caption required: ${slot.postId}`);
    const caption = normalizeCaption(fullCaption(post));
    if (captions.has(caption)) throw new Error('Campaign captions must be distinct for live reconciliation');
    ids.add(slot.postId); dates.add(slot.date); captions.add(caption);
  });
  return campaign;
}
function select(campaign, posts, now = new Date(), onlyId) {
  validate(campaign, posts);
  const today = moscowDate(now);
  const slots = allSlots(campaign);
  if (onlyId && !slots.some(s => s.postId === onlyId)) throw new Error('Active campaign blocks posts outside the explicit slots');
  const slot = slots.find(s => s.date === today);
  if (!slot) return { post: null, reason: 'No campaign slot today; legacy queue stays paused' };
  if (onlyId && onlyId !== slot.postId) throw new Error('Requested post is outside today\'s campaign slot');
  if (new Date(now) < new Date(slot.scheduledAt)) return { post: null, reason: `Next slot: ${slot.scheduledAt}` };
  const hour = Number(new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
  if (hour < 8 || hour >= 22) return { post: null, reason: 'Publishing window closed; no automatic catch-up on off days' };
  const post = posts.find(p => p.id === slot.postId);
  if (post.status === 'published' || post.publishedMediaId || post.publishedAt) return { post: null, reason: 'Today\'s campaign post already has a receipt' };
  if (posts.some(p => p.publishedAt && moscowDate(p.publishedAt) === today)) return { post: null, reason: 'Feed already published today; limit one' };
  if (post.status !== 'approved') throw new Error(`${post.id}: slot is not approved`);
  if (['publishing', 'unknown', 'needs_review', 'published'].includes(post.feedDelivery?.phase || post.feedDelivery?.status)) throw new Error(`${post.id}: feed outcome needs reconciliation; automatic retry blocked`);
  return { post, reason: 'One approved explicit campaign slot is due' };
}
function reconcile(campaign, posts, media, now = new Date(), publishingPost) {
  validate(campaign, posts);
  if (!Array.isArray(media)) throw new Error('Instagram feed history unavailable; publication stopped');
  const expected = new Map(allSlots(campaign).map(s => {
    const p = posts.find(p => p.id === s.postId);
    return [normalizeCaption(fullCaption(p)), p];
  }));
  const matches = [];
  for (const item of media) {
    const post = expected.get(normalizeCaption(item.caption));
    if (!post) continue;
    matches.push({ postId: post.id, mediaId: item.id, timestamp: item.timestamp, permalink: item.permalink });
    if (post.publishedMediaId !== item.id) throw new Error(`${post.id}: matching caption already exists on Instagram (${item.id}); reconcile before publishing`);
  }
  if (publishingPost && media.some(m => m.timestamp && moscowDate(m.timestamp) === moscowDate(now))) throw new Error('Instagram already has a feed publication today; limit one');
  return matches;
}
module.exports = { readCampaign, allSlots, validate, select, fullCaption, reconcile, moscowDate };
