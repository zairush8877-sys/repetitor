#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');

class FeedDeliveryError extends Error {
  constructor(code, message, cause) {
    // Do not let a later console.error(error) reveal a provider URL/token via cause.
    super(message, cause ? { cause: new Error(errorText(cause)) } : undefined);
    this.name = 'FeedDeliveryError';
    this.code = code;
  }
}

function errorText(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/authorization\s*[:=]\s*(?:Bearer\s+)?[^&\s]+/gi, 'Authorization=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(access_token|IG_ACCESS_TOKEN)\s*[:=]\s*[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function mediaId(result) {
  const id = result?.id;
  return (typeof id === 'string' && id.length) || (typeof id === 'number' && Number.isFinite(id))
    ? String(id) : null;
}

/**
 * Deliver one approved Reel. The caller owns validation, scheduling, account lock,
 * Stories and an atomic durable save() of its queue (including remote persistence).
 * Every save is awaited. This module never retries media_publish.
 * Returns the confirmed published media ID as a string.
 */
async function deliver(post, options) {
  const { api, waitReady, userId, save, now = () => new Date() } = options || {};
  const assetUrl = options?.assetUrl || (url => url);
  if (!post?.id || !userId || typeof api !== 'function' || typeof waitReady !== 'function'
      || typeof save !== 'function' || typeof assetUrl !== 'function') {
    throw new FeedDeliveryError('FEED_INVALID_ARGUMENT', 'Feed delivery needs post.id, userId, api, waitReady, assetUrl and durable save().');
  }
  const stamp = () => {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new FeedDeliveryError('FEED_INVALID_CLOCK', 'Invalid feed delivery clock.');
    return date.toISOString();
  };
  let state = post.feedDelivery ? { ...post.feedDelivery } : null;
  const update = (phase, fields = {}) => {
    state = { ...state, ...fields, version: 1, phase, updatedAt: stamp() };
    post.feedDelivery = state;
  };
  const persist = async () => {
    try { await save(); }
    catch (error) {
      const receipt = post.publishedMediaId ? ` Confirmed media ID: ${post.publishedMediaId}.` : '';
      const container = state?.containerId ? ` Container ID: ${state.containerId}.` : '';
      throw new FeedDeliveryError(
        receipt ? 'FEED_RECEIPT_NOT_SAVED' : 'FEED_STATE_NOT_SAVED',
        `Feed state '${state?.phase || 'none'}' was not durably saved.${receipt}${container} No automatic retry is safe without checking persisted state. ${errorText(error)}`,
        error,
      );
    }
  };

  // A known receipt wins over a stale phase, without another external operation.
  const knownId = post.publishedMediaId || state?.mediaId;
  if (knownId) {
    const publishedAt = post.publishedAt || state?.publishedAt || stamp();
    const needsRepair = post.status !== 'published' || !post.publishedMediaId || !post.publishedAt
      || state?.phase !== 'published' || String(state?.mediaId) !== String(knownId);
    if (needsRepair) {
      Object.assign(post, { status: 'published', publishedMediaId: String(knownId), publishedAt });
      update('published', { mediaId: String(knownId), publishedAt, lastError: null });
    }
    // A prior call may have received the receipt but failed its durable save.
    await persist();
    return String(knownId);
  }
  if (['publishing', 'unknown', 'published'].includes(state?.phase) || post.status === 'published') {
    throw new FeedDeliveryError('FEED_OUTCOME_UNKNOWN',
      `${post.id}: feed outcome is '${state?.phase || post.status}' without a confirmed receipt. Check Instagram and persisted receipts; media_publish will not be repeated.`);
  }
  if (post.status !== 'approved') {
    throw new FeedDeliveryError('FEED_NOT_APPROVED', `${post.id}: feed delivery requires approved status.`);
  }
  if (!post.videoUrl) throw new FeedDeliveryError('FEED_NO_VIDEO', `${post.id}: Reel videoUrl is missing.`);

  const caption = typeof options.caption === 'function' ? options.caption(post)
    : (options.caption ?? post.caption ?? '');
  if (typeof caption !== 'string') throw new FeedDeliveryError('FEED_INVALID_CAPTION', `${post.id}: caption must be a string.`);
  const params = { media_type: 'REELS', video_url: assetUrl(post.videoUrl), caption, share_to_feed: 'true' };
  if (post.coverUrl) params.cover_url = assetUrl(post.coverUrl);
  else if (Number.isFinite(post.coverOffsetMs)) {
    if (post.coverOffsetMs < 0) throw new FeedDeliveryError('FEED_INVALID_COVER', `${post.id}: cover offset must not be negative.`);
    params.thumb_offset = String(Math.round(post.coverOffsetMs));
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ userId: String(userId), ...params })).digest('hex');
  if (state?.fingerprint && state.fingerprint !== fingerprint) {
    throw new FeedDeliveryError('FEED_CHANGED_AFTER_INTENT', `${post.id}: account, video, cover or caption changed after delivery intent. Reconcile the saved container before proceeding.`);
  }

  if (!state?.containerId) {
    // A failed creation may be explicitly retried: no feed publication occurred.
    // A known container is always reused, including after ERROR/poll failures.
    update('container', {
      fingerprint, startedAt: state?.startedAt || stamp(),
      creationAttempts: (state?.creationAttempts || 0) + 1, lastError: null,
    });
    await persist();
    let created;
    try {
      created = mediaId(await api('POST', `${userId}/media`, params));
      if (!created) throw new Error('Container creation returned no id.');
    } catch (error) {
      update('preparing', { failedStage: 'create', lastError: errorText(error) });
      await persist();
      throw new FeedDeliveryError('FEED_CREATE_FAILED', `${post.id}: container creation failed; no media_publish was attempted. ${errorText(error)}`, error);
    }
    update('preparing', { containerId: created, fingerprint, containerCreatedAt: stamp(), failedStage: null, lastError: null });
    await persist();
  } else {
    update('preparing', { fingerprint, failedStage: null, lastError: null });
    await persist();
  }

  let readiness;
  try {
    readiness = await waitReady(state.containerId, post.id, 120);
    const code = typeof readiness === 'string' ? readiness : readiness?.status_code;
    if (code === 'PUBLISHED') {
      update('unknown', { failedStage: 'poll', lastError: 'Container is already PUBLISHED, but no feed receipt is saved.' });
      await persist();
      throw new FeedDeliveryError('FEED_OUTCOME_UNKNOWN', `${post.id}: saved container is already PUBLISHED. Reconcile Instagram; media_publish will not be repeated.`);
    }
    if (code && code !== 'FINISHED') throw new Error(`Container status is ${code}.`);
  } catch (error) {
    if (state.phase === 'unknown') throw error;
    update('poll_failed', { failedStage: 'poll', lastError: errorText(error) });
    await persist();
    throw new FeedDeliveryError('FEED_POLL_FAILED', `${post.id}: polling failed. Retry may poll the SAME container ${state.containerId}; it will not recreate it. ${errorText(error)}`, error);
  }
  update('preparing', { readyAt: stamp(), failedStage: null, lastError: null });
  await persist();

  // This intent must survive a killed Actions runner before the irreversible POST.
  update('publishing', { publishAttemptedAt: stamp(), lastError: null });
  await persist();
  let confirmed;
  try {
    confirmed = mediaId(await api('POST', `${userId}/media_publish`, { creation_id: state.containerId }));
    if (!confirmed) throw new Error('media_publish returned no media id.');
  } catch (error) {
    update('unknown', { failedStage: 'publish', unknownSince: stamp(), lastError: errorText(error) });
    await persist();
    throw new FeedDeliveryError('FEED_OUTCOME_UNKNOWN', `${post.id}: media_publish outcome is unknown. Check Instagram and the saved container ${state.containerId}; automatic publication retry is blocked. ${errorText(error)}`, error);
  }
  const publishedAt = stamp();
  Object.assign(post, { status: 'published', publishedMediaId: confirmed, publishedAt });
  update('published', { mediaId: confirmed, publishedAt, failedStage: null, lastError: null });
  await persist();
  return confirmed;
}

module.exports = { deliver, FeedDeliveryError };
