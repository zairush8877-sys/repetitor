'use strict';
// Explicit calendar for the author's selected series. Never falls back to legacy posts.
const fs = require('fs');
const path = require('path');
function readCampaign(contentDir) {
  const file = path.join(contentDir, 'active-feed-campaign.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
function moscowDate(now) { return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); }
function validate(campaign, posts) {
  if (!campaign || campaign.version !== 1 || campaign.status !== 'active' || campaign.timezone !== 'Europe/Moscow') throw new Error('Invalid active feed campaign');
  if (!campaign.id || !Array.isArray(campaign.slots) || campaign.slots.length !== 15) throw new Error('Campaign requires fifteen explicit slots');
  const ids = new Set(), dates = new Set();
  campaign.slots.forEach((slot, i) => {
    const post = posts.find(p => p.id === slot.postId);
    const at = new Date(slot.scheduledAt);
    if (!post || ids.has(slot.postId) || dates.has(slot.date) || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !Number.isFinite(at.getTime())) throw new Error('Invalid or duplicate campaign slot');
    if (post.campaignId !== campaign.id || post.date !== slot.date || post.scheduledAt !== slot.scheduledAt || moscowDate(at) !== slot.date || at.toISOString().slice(11, 16) !== '16:30') throw new Error(`Campaign calendar mismatch: ${slot.postId}`);
    if (i && at - new Date(campaign.slots[i - 1].scheduledAt) !== 2 * 86400000) throw new Error('Campaign interval must be two days');
    ids.add(slot.postId); dates.add(slot.date);
  });
  return campaign;
}
function select(campaign, posts, now = new Date(), onlyId) {
  validate(campaign, posts);
  const today = moscowDate(now);
  if (onlyId && !campaign.slots.some(s => s.postId === onlyId)) throw new Error('Active campaign blocks posts outside the selected fifteen');
  const slot = campaign.slots.find(s => s.date === today);
  if (!slot) return { post: null, reason: 'No campaign slot today; legacy queue stays paused' };
  if (onlyId && onlyId !== slot.postId) throw new Error('Requested post is outside today\'s campaign slot');
  if (new Date(now) < new Date(slot.scheduledAt)) return { post: null, reason: `Next slot: ${slot.scheduledAt}` };
  const hour = Number(new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
  if (hour >= 22) return { post: null, reason: 'Evening window closed; no automatic catch-up on off days' };
  const post = posts.find(p => p.id === slot.postId);
  if (post.status === 'published' || post.publishedMediaId || post.publishedAt) return { post: null, reason: 'Today\'s campaign post already has a receipt' };
  if (posts.some(p => p.publishedAt && moscowDate(p.publishedAt) === today)) return { post: null, reason: 'Feed already published today; limit one' };
  if (post.status !== 'approved') throw new Error(`${post.id}: slot is not approved`);
  if (['publishing', 'unknown', 'needs_review', 'published'].includes(post.feedDelivery?.phase || post.feedDelivery?.status)) throw new Error(`${post.id}: feed outcome needs reconciliation; automatic retry blocked`);
  return { post, reason: 'One approved campaign slot is due' };
}
function fullCaption(post) {
  if (post.captionComplete) return post.caption;
  return [...new Set([post.caption, post.music?.composer && `♪ ${post.music.composer} — ${post.music.piece}`, post.music?.attribution, (post.hashtags || []).join(' ')].filter(Boolean))].join('\n\n');
}
function reconcile(campaign, posts, media, now = new Date(), publishingPost) {
  const normalize = s => String(s || '').normalize('NFC').replace(/\r\n/g, '\n').trim();
  const expected = new Map(campaign.slots.map(s => { const p = posts.find(p => p.id === s.postId); return [normalize(fullCaption(p)), p]; }));
  const matches = [];
  for (const item of media) {
    const post = expected.get(normalize(item.caption));
    if (!post) continue;
    matches.push({ postId: post.id, mediaId: item.id, timestamp: item.timestamp, permalink: item.permalink });
    if (post.publishedMediaId !== item.id) throw new Error(`${post.id}: matching caption already exists on Instagram (${item.id}); reconcile before publishing`);
  }
  if (publishingPost && media.some(m => m.timestamp && moscowDate(m.timestamp) === moscowDate(now))) throw new Error('Instagram already has a feed publication today; limit one');
  return matches;
}
module.exports = { readCampaign, validate, select, fullCaption, reconcile, moscowDate };
