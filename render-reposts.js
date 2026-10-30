#!/usr/bin/env node
/** Local Story export only. Never publishes or changes delivery statuses. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sourcesFor, sourceKey } = require('./repost-state');
const ROOT = __dirname;
const SAFE = Object.freeze({ x: 60, y: 360, width: 960, height: 1300 });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function contain(width, height, box = SAFE) {
  if (!(width > 0 && height > 0)) throw new Error('Invalid source dimensions');
  const scale = Math.min(box.width / width, box.height / height);
  return { x: box.x + (box.width - width * scale) / 2, y: box.y + (box.height - height * scale) / 2,
    width: width * scale, height: height * scale, scale };
}
async function browser() {
  const { chromium } = require('playwright');
  return chromium.launch({ headless: true,
    ...(process.env.REPOST_BROWSER_CHANNEL ? { channel: process.env.REPOST_BROWSER_CHANNEL } : {}) });
}
async function renderContain(inputPath, outputPath, { label = 'Публикация в ленте', index = 1, total = 1, page: suppliedPage } = {}) {
  const ownedBrowser = suppliedPage ? null : await browser();
  const page = suppliedPage || await ownedBrowser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const bytes = fs.readFileSync(inputPath);
  const mime = /\.png$/i.test(inputPath) ? 'image/png' : /\.webp$/i.test(inputPath) ? 'image/webp' : 'image/jpeg';
  try {
    await page.setViewportSize({ width: 1080, height: 1920 });
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:1080px;height:1920px;background:#f6f3ec;color:#3f5948;font-family:Arial,sans-serif}
      .safe{position:absolute;left:60px;top:360px;width:960px;height:1300px;display:flex;align-items:center;justify-content:center}
      img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
      .label{position:absolute;top:300px;left:60px;width:960px;font-size:28px;letter-spacing:.4px}
      .number{float:right}
      </style><div class="label">${escape(label)}<span class="number">${total > 1 ? `${index} / ${total}` : ''}</span></div>
      <div class="safe"><img alt="" src="data:${mime};base64,${bytes.toString('base64')}"></div></html>`);
    const measured = await page.locator('img').evaluate(async (img, box) => {
      await img.decode();
      const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
      img.style.width = `${img.naturalWidth * scale}px`;
      img.style.height = `${img.naturalHeight * scale}px`;
      const r = img.getBoundingClientRect();
      return { sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight, x: r.x, y: r.y, width: r.width, height: r.height };
    }, SAFE);
    const expected = contain(measured.sourceWidth, measured.sourceHeight);
    for (const k of ['x', 'y', 'width', 'height']) {
      if (Math.abs(measured[k] - expected[k]) > .1) throw new Error(`Contain verification failed: ${k}`);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, type: 'jpeg', quality: 96 });
    return { ...measured, outputWidth: 1080, outputHeight: 1920, sourceSha256: hash(bytes), sha256: hash(fs.readFileSync(outputPath)) };
  } finally { if (ownedBrowser) await ownedBrowser.close(); }
}
function localSource(url, contentDir = process.env.MEDIA_CONTENT_DIR || path.join(ROOT, 'content')) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const at = pathname.indexOf('/content/');
  if (at < 0) throw new Error('Source has no local content path');
  const resolved = path.resolve(contentDir, pathname.slice(at + '/content/'.length));
  if (!resolved.startsWith(path.resolve(contentDir) + path.sep)) throw new Error('Source is outside content');
  if (!fs.existsSync(resolved)) throw new Error(`Missing source: ${resolved}`);
  return resolved;
}
async function renderPost(post, { contentDir = process.env.MEDIA_CONTENT_DIR || path.join(ROOT, 'content'), outDir = path.join(contentDir, 'reposts'), rawBase, page } = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(post.id)) throw new Error('Invalid post ID');
  const sourceUrls = sourcesFor(post);
  if (!sourceUrls.length) throw new Error(`${post.id}: no prepared source URLs`);
  const base = rawBase || `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || 'zairush8877-sys/repetitor'}/main/content/reposts`;
  if (post.storyRepostMode === 'full_video' && post.videoUrl) {
    const source = localSource(post.videoUrl, contentDir);
    const filename = `${post.id}-full.mp4`;
    const destination = path.join(outDir, filename);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(source, destination);
    const sourceSha256 = hash(fs.readFileSync(source));
    const sha256 = hash(fs.readFileSync(destination));
    if (sha256 !== sourceSha256) throw new Error(`${post.id}: full Story copy does not match the approved video`);
    // This path is for the already validated 1080x1920 V3 export. Copy the
    // complete file, including audio, without encoding, scaling or clipping.
    const rect = { x: 0, y: 0, width: 1080, height: 1920 };
    const geometry = { sourceWidth: 1080, sourceHeight: 1920, outputWidth: 1080, outputHeight: 1920,
      ...rect, scale: 1, sourceRect: { ...rect }, targetRect: { ...rect }, sourceSha256, sha256 };
    return { kind: 'reel_video', sourceKey: sourceKey(post), renderedAt: new Date().toISOString(), publicationStatus: 'export_only',
      assets: [{ sourceUrl: post.videoUrl, file: filename, url: `${base}/${filename}`, width: 1080, height: 1920,
        mediaType: 'VIDEO', mimeType: 'video/mp4', sha256, geometry }] };
  }
  const assets = [];
  for (const [i, sourceUrl] of sourceUrls.entries()) {
    const filename = `${post.id}-${i + 1}.jpg`;
    const geometry = await renderContain(localSource(sourceUrl, contentDir), path.join(outDir, filename), {
      label: post.videoUrl ? 'Кадр из Reels' : sourceUrls.length > 1 ? 'Карусель целиком' : 'Публикация в ленте',
      index: i + 1, total: sourceUrls.length, page,
    });
    assets.push({ sourceUrl, file: filename, url: `${base}/${filename}`, width: 1080, height: 1920, sha256: geometry.sha256, geometry });
  }
  return { kind: post.videoUrl ? 'reel_frame' : sourceUrls.length > 1 ? 'carousel_slides' : 'post',
    sourceKey: sourceKey(post), renderedAt: new Date().toISOString(), publicationStatus: 'export_only', assets };
}
async function main() {
  const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!ids.length) throw new Error('Укажите конкретные ID: node render-reposts.js <id> [id]. Экспорт не публикует Stories.');
  const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'queue.json'), 'utf8'));
  const manifestPath = path.join(ROOT, 'content', 'reposts', 'index.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, posts: {} };
  let b, page;
  try {
    for (const id of ids) {
      const post = queue.posts.find(p => p.id === id);
      if (!post) throw new Error(`Пост не найден: ${id}`);
      if (!(post.storyRepostMode === 'full_video' && post.videoUrl) && !page) {
        b = await browser();
        page = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
      }
      manifest.posts[id] = await renderPost(post, { page });
      console.log(`${id}: экспортировано ${manifest.posts[id].assets.length} элементов Stories; не опубликовано.`);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } finally { if (b) await b.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { SAFE, contain, renderContain, renderPost, localSource };
