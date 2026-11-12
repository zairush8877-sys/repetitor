// Shared build/publisher contract. No network, credentials or queue writes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validManifest, sourcesFor } = require('./repost-state');
const CONTENT = path.resolve(process.env.MEDIA_CONTENT_DIR || path.join(__dirname, 'content'));
const MEDIA_FIELDS = ['imageUrls', 'videoUrls', 'videoUrl', 'coverOffsetMs', 'coverUrl', 'music', 'background', 'lightBg', 'generatedBg'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function draftKey(post) {
  const excluded = new Set([...MEDIA_FIELDS, 'status', 'publishedAt', 'publishedMediaId', 'storyRepost', 'feedDelivery']);
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
  const editorial = Object.fromEntries(Object.entries(post).filter(([k]) => !excluded.has(k)));
  return sha(JSON.stringify(sorted(editorial)));
}
function localFile(relative, contentDir = CONTENT) {
  const root = path.resolve(contentDir);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Media path is outside content');
  return resolved;
}
function relativeUrl(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const at = pathname.indexOf('/content/');
  if (at < 0) throw new Error('Media URL has no content path');
  return pathname.slice(at + '/content/'.length);
}
function readIndex(contentDir = CONTENT) {
  const file = path.join(contentDir, 'prepared', 'index.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, posts: {} };
}
function verifyRepostAssets(assets, contentDir = CONTENT) {
  for (const a of assets) {
    if (path.basename(a.file) !== a.file || relativeUrl(a.url) !== `reposts/${a.file}`) throw new Error('Некорректный путь репоста.');
    const file = localFile(`reposts/${a.file}`, contentDir);
    if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== a.sha256) throw new Error('Локальный кадр репоста изменился: пересоберите манифест.');
    const source = localFile(relativeUrl(a.sourceUrl), contentDir);
    if (!fs.existsSync(source) || sha(fs.readFileSync(source)) !== a.geometry?.sourceSha256) throw new Error('Исходный кадр изменился: пересоберите репост.');
  }
}
function validate(post, { contentDir = CONTENT, entry = readIndex(contentDir).posts?.[post.id], manifest } = {}) {
  if (!entry || entry.draftKey !== draftKey(post)) throw new Error(`${post.id}: нет актуальной сборки; выполните node build-media.js ${post.id}`);
  const result = { ...post };
  // Never allow a build manifest to grant approval or change editorial content.
  for (const field of MEDIA_FIELDS) { delete result[field]; if (entry.media[field] !== undefined) result[field] = entry.media[field]; }
  const urls = [...(result.imageUrls || []), ...(result.videoUrls || []), ...(result.videoUrl ? [result.videoUrl, ...sourcesFor(result)] : []), ...(result.coverUrl ? [result.coverUrl] : [])];
  if (!urls.length || !entry.files?.length) throw new Error(`${post.id}: пустой набор медиа`);
  if (result.format === 'Reels' && (!result.videoUrl || (!result.coverUrl && !Number.isFinite(result.coverOffsetMs)))) throw new Error(`${post.id}: неполные метаданные Reels`);
  if (result.videoUrls?.length && result.videoUrls.length !== result.imageUrls?.length) throw new Error(`${post.id}: неполная видеокарусель`);
  if ((result.videoUrl || result.videoUrls?.length) && (!result.music?.composer || !result.music?.piece || (result.music.attributionRequired && !result.music.attribution))) throw new Error(`${post.id}: отсутствуют музыкальные кредиты`);
  for (const url of new Set(urls)) {
    const relative = relativeUrl(url);
    const meta = entry.files.find(f => f.url === url && f.relative === relative);
    const file = localFile(relative, contentDir);
    if (!meta || !fs.existsSync(file) || sha(fs.readFileSync(file)) !== meta.sha256) throw new Error(`${post.id}: файл медиа отсутствует или изменился: ${relative}`);
  }
  const repostManifest = manifest || JSON.parse(fs.readFileSync(path.join(contentDir, 'reposts/index.json'), 'utf8'));
  const repost = repostManifest.posts?.[post.id];
  if (!validManifest(result, repost)) throw new Error(`${post.id}: неполный или устаревший набор Stories`);
  verifyRepostAssets(repost.assets, contentDir);
  return { post: result, entry, repost, summary: { id: post.id, format: post.format, files: entry.files.length, storyFrames: repost.assets.length, status: post.status, prepared: true } };
}
module.exports = { CONTENT, MEDIA_FIELDS, sha, draftKey, localFile, relativeUrl, readIndex, verifyRepostAssets, validate };
