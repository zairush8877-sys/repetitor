/** Durable feed -> Stories delivery. No API calls on import; callers inject transport/storage. */
const crypto = require('crypto');

function sourcesFor(post) {
  if (post.storyRepostMode === 'full_video' && post.videoUrl) return [post.videoUrl];
  if (post.videoUrl) return [post.videoUrl.replace(/\.mp4(?=\?|$)/, '-frame.jpg')];
  return [...(post.imageUrls || [])];
}
function sourceKey(post) {
  return crypto.createHash('sha256').update(JSON.stringify(sourcesFor(post))).digest('hex');
}
function initialize(post, newlyPublished = false) {
  if (post.storyRepost) return post.storyRepost;
  post.storyRepost = {
    version: 1, feedMediaId: post.publishedMediaId || null,
    status: newlyPublished ? 'pending' : 'historical_unknown', items: [],
  };
  return post.storyRepost;
}
function overall(items) {
  if (!items.length) return 'pending';
  if (items.every(i => i.status === 'published' && i.publishedMediaId)) return 'published';
  if (items.some(i => ['publishing', 'unknown'].includes(i.status))) return 'needs_review';
  if (items.some(i => i.status === 'published')) return 'partial';
  if (items.some(i => i.status === 'failed')) return 'failed';
  return 'pending';
}
function matchesSnapshot(post, state) {
  return state.sourceKey === sourceKey(post) && state.items.length === sourcesFor(post).length;
}
function validManifest(post, entry) {
  const expected = sourcesFor(post);
  const fullVideo = post.storyRepostMode === 'full_video' && !!post.videoUrl;
  return !!(expected.length && entry && entry.sourceKey === sourceKey(post)
    && entry.kind === (fullVideo ? 'reel_video' : post.videoUrl ? 'reel_frame' : expected.length > 1 ? 'carousel_slides' : 'post')
    && entry.assets?.length === expected.length
    && entry.assets.every((a, i) => a.sourceUrl === expected[i]
      && a.width === 1080 && a.height === 1920 && /^https:\/\//.test(a.url)
      && (!fullVideo || (a.mediaType === 'VIDEO' && a.mimeType === 'video/mp4'))
      && typeof a.sha256 === 'string' && a.sha256.length === 64));
}

async function deliver(post, { entry, api, waitReady, save, userId, assetUrl = u => u,
  verifyAssets = async () => {}, now = () => new Date().toISOString(), log = () => {} }) {
  if (post.status !== 'published' || !post.publishedMediaId) throw new Error('Нет подтверждённой публикации в ленте.');
  const state = initialize(post);
  if (state.feedMediaId !== post.publishedMediaId) throw new Error('ID ленты изменился: требуется сверка репоста.');
  if (state.status === 'historical_unknown') throw new Error('История репоста неизвестна: сначала нужна ручная сверка, повтор заблокирован.');
  if (state.status === 'needs_review') throw new Error('Репост требует сверки: автоматический повтор заблокирован.');
  if (state.status === 'published') {
    if (!state.items.length || !state.items.every(i => i.status === 'published' && i.publishedMediaId)) {
      throw new Error('Нет подтверждённых ID всех Stories: требуется сверка.');
    }
    if (!matchesSnapshot(post, state)) {
      state.status = 'needs_review'; await save();
      throw new Error('Состав публикации изменился после подтверждения репоста: требуется сверка, новые слайды не отправлены.');
    }
    log('Все кадры репоста уже подтверждены — повтор пропущен.');
    return state;
  }
  // A killed process may have sent media_publish. Never infer failure from a timeout.
  if (state.items.some(i => ['publishing', 'unknown'].includes(i.status)
    || (i.status === 'published' && !i.publishedMediaId))) {
    state.status = 'needs_review'; await save();
    throw new Error('Результат отправки неизвестен: повтор заблокирован до сверки Instagram.');
  }
  if (!validManifest(post, entry)) {
    state.status = 'awaiting_assets'; state.reason = 'render_reposts_required'; await save();
    throw new Error('Нет полного актуального набора 1080×1920: выполните render-reposts.js для этого поста.');
  }
  if (state.items.length && (state.sourceKey !== entry.sourceKey
    || state.items.length !== entry.assets.length
    || state.items.some((i, n) => i.sha256 !== entry.assets[n].sha256))) {
    throw new Error('Набор кадров изменился после начала репоста: требуется сверка.');
  }
  // Verifier runs before any remote write. Exported files are not publication evidence.
  await verifyAssets(entry.assets);
  if (!state.items.length) {
    state.sourceKey = entry.sourceKey;
    state.items = entry.assets.map((a, i) => ({ index: i + 1, url: a.url, sha256: a.sha256,
      ...(a.mediaType ? { mediaType: a.mediaType, mimeType: a.mimeType } : {}), status: 'pending', attempts: 0 }));
    await save();
  }
  delete state.reason;
  for (const item of state.items) {
    if (item.status === 'published' && item.publishedMediaId) continue;
    const isVideo = entry.assets[item.index - 1].mediaType === 'VIDEO';
    item.attempts++; item.status = 'preparing'; item.attemptedAt = now(); await save();
    try {
      // Reuse a ready container after a crash while polling; creation alone cannot publish.
      if (!item.containerId) {
        const container = await api('POST', `${userId}/media`, { media_type: 'STORIES',
          ...(isVideo ? { video_url: assetUrl(item.url) } : { image_url: assetUrl(item.url) }) });
        if (!container.id) throw new Error('container_id_missing');
        item.containerId = container.id; await save();
      }
      if (isVideo) await waitReady(item.containerId, `${post.id} репост ${item.index}`, 120);
      else await waitReady(item.containerId, `${post.id} репост ${item.index}`);
    } catch {
      item.status = 'failed'; item.error = 'preparation_failed';
      // A failed/expired container is safe to replace: media_publish was never called.
      delete item.containerId; state.status = overall(state.items); await save();
      log(`Кадр ${item.index}: подготовка не завершена, возможен явный повтор.`);
      return state;
    }
    item.status = 'publishing'; await save(); // Persist before the irreversible call.
    let result;
    try {
      result = await api('POST', `${userId}/media_publish`, { creation_id: item.containerId });
    } catch {
      item.status = 'unknown'; item.error = 'publish_outcome_unknown';
      state.status = overall(state.items); await save();
      log(`Кадр ${item.index}: результат отправки неизвестен, автоматический повтор запрещён.`);
      return state;
    }
    if (!result.id) {
      item.status = 'unknown'; item.error = 'publish_id_missing';
      state.status = overall(state.items); await save(); return state;
    }
    item.publishedMediaId = result.id; item.publishedAt = now(); item.status = 'published';
    delete item.error; state.status = overall(state.items); await save();
    log(`Кадр ${item.index}/${state.items.length}: Stories подтверждена, id ${result.id}.`);
  }
  state.status = overall(state.items); await save();
  return state;
}

function audit(queue, historicalEvidence = {}) {
  return queue.posts.filter(p => p.status === 'published' || p.publishedMediaId).map(p => ({
    postId: p.id, feedMediaId: p.publishedMediaId || null,
    feedStatus: p.status,
    repostStatus: p.storyRepost?.status === 'published' && !matchesSnapshot(p, p.storyRepost)
      ? 'needs_review' : p.storyRepost?.status || 'historical_unknown',
    confirmedFrames: (p.storyRepost?.items || []).filter(i => i.status === 'published' && i.publishedMediaId).length,
    expectedFrames: sourcesFor(p).length,
    evidence: p.storyRepost ? 'queue.storyRepost' : 'no_linked_story_record',
    historicalLog: historicalEvidence.posts?.[p.id]?.feedMediaId === p.publishedMediaId
      ? historicalEvidence.posts[p.id] : null,
  }));
}
module.exports = { sourcesFor, sourceKey, initialize, deliver, audit, validManifest };
