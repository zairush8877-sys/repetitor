'use strict';
// Local assets only: shared by HTML, encoding and prepared-media packaging.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = v => sha(JSON.stringify(canonical(v)));

function position(value) {
  if (typeof value !== 'string') throw new Error('backgroundPosition must be a CSS position string');
  const tokens = value.trim().split(/\s+/);
  const percentage = t => /^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(t) && Number(t.slice(0, -1)) <= 100;
  const horizontal = t => ['left', 'center', 'right'].includes(t) || percentage(t);
  const vertical = t => ['top', 'center', 'bottom'].includes(t) || percentage(t);
  if (tokens.length !== 2 || !horizontal(tokens[0]) || !vertical(tokens[1])) throw new Error('Invalid backgroundPosition; use e.g. 72% center');
  return tokens.join(' ');
}
function localAsset(root, entry, kind) {
  const prefix = `assets/${kind}/`;
  if (typeof entry.file !== 'string' || !entry.file.startsWith(prefix) || entry.file.includes('\\') || entry.file.includes('\0')
    || entry.file.split('/').some(v => !v || v === '.' || v === '..') || path.isAbsolute(entry.file)) throw new Error(`${entry.id}: invalid ${kind} asset path`);
  const absolute = path.resolve(root, entry.file);
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) throw new Error(`${entry.id}: asset escapes release directory`);
  if (!/^[a-f\d]{64}$/i.test(entry.sha256 || '')) throw new Error(`${entry.id}: missing or invalid sha256`);
  const actual = sha(fs.readFileSync(real));
  if (actual !== entry.sha256.toLowerCase()) throw new Error(`${entry.id}: asset SHA mismatch`);
  return {file: entry.file, absolute, sha256: actual};
}
function catalog(entries, name) {
  if (!Array.isArray(entries) || !entries.length) throw new Error(`${name}: nonempty catalog required`);
  const result = new Map();
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || !/^[a-zA-Z\d_-]+$/.test(e.id) || result.has(e.id)) throw new Error(`${name}: invalid or duplicate asset ID`);
    result.set(e.id, e);
  }
  return result;
}
function bool(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Invalid attributionRequired');
}
function probeAudio(file, ffprobe) {
  const data = JSON.parse(cp.execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'}));
  const audio = data.streams?.find(s => s.codec_type === 'audio');
  if (!audio) throw new Error(`No audio stream: ${file}`);
  return Number(audio.duration || data.format?.duration);
}
function createResolver({root, projectRoot, photos, tracks, ffprobe, audioProbe = file => probeAudio(file, ffprobe)}) {
  const photoMap = catalog(photos, 'photos'), musicMap = catalog(tracks, 'tracks');
  const memo = new Map();
  const getAsset = (entry, kind) => {
    const key = `${kind}:${entry.id}`;
    if (!memo.has(key)) {
      if (entry.active === false) throw new Error(`${entry.id}: inactive asset`);
      const asset = localAsset(root, entry, kind);
      if (kind === 'music') {
        const actualDuration = audioProbe(asset.absolute);
        if (!Number.isFinite(actualDuration) || actualDuration <= 0) throw new Error(`${entry.id}: invalid measured audio duration`);
        asset.actualDuration = actualDuration;
      }
      memo.set(key, asset);
    }
    return memo.get(key);
  };
  return function resolve(post, total) {
    if (!Number.isFinite(total) || total <= 0) throw new Error('Invalid video duration');
    const selection = post.assetSelection;
    if (!selection || Object.keys(selection).some(k => !['photoId', 'musicId', 'musicOffsetSeconds', 'backgroundPosition'].includes(k))) throw new Error(`${post.id}: invalid assetSelection`);
    const photo = photoMap.get(selection.photoId), music = musicMap.get(selection.musicId);
    if (!photo || !music) throw new Error(`${post.id}: unknown photoId or musicId`);
    const offset = selection.musicOffsetSeconds;
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) throw new Error(`${post.id}: invalid musicOffsetSeconds`);
    const crop = position(selection.backgroundPosition);
    const photoFile = getAsset(photo, 'photos'), musicFile = getAsset(music, 'music');
    const declared = music.durationSeconds;
    if (typeof declared !== 'number' || !Number.isFinite(declared) || declared < offset + total || musicFile.actualDuration + .001 < offset + total)
      throw new Error(`${post.id}: music duration is shorter than offset + video duration`);
    if (Math.abs(declared - musicFile.actualDuration) > .15) throw new Error(`${music.id}: stale catalog duration`);
    for (const k of ['composer', 'piece', 'license', 'attribution']) if (typeof music[k] !== 'string' || !music[k].trim()) throw new Error(`${music.id}: missing music ${k}`);
    const source = music.source || (music.commonsTitle ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(music.commonsTitle.replace(/ /g, '_'))}` : null);
    if (!source || !/^https:\/\//.test(source)) throw new Error(`${music.id}: missing music source`);
    const background = path.relative(projectRoot, photoFile.absolute).split(path.sep).join('/');
    if (background.startsWith('../') || path.isAbsolute(background)) throw new Error('Photo is outside project root');
    return {
      photo: {...photoFile, id: photo.id},
      track: {...musicFile, id: music.id},
      background, backgroundPosition: crop, musicOffsetSeconds: offset,
      music: {...music, source, attributionRequired: bool(music.attributionRequired, true),
        offsetSeconds: offset, excerptDurationSeconds: total,
        originalExcerptStartSeconds: Number(music.sourceExcerptStartSeconds || 0) + offset,
        actualDurationSeconds: musicFile.actualDuration, processingForReel: 'loudnorm I=-18 LUFS, TP=-2 dBTP, LRA=8; fade in 0.6 s, fade out 1.2 s'},
      cache: {photoId: photo.id, photoFile: photoFile.file, photoSha256: photoFile.sha256,
        musicId: music.id, musicFile: musicFile.file, musicSha256: musicFile.sha256,
        musicOffsetSeconds: offset, backgroundPosition: crop}
    };
  };
}
function validatePosts(posts) {
  if (!Array.isArray(posts) || !posts.length) throw new Error('release.json must contain posts');
  const ids = new Set();
  let previous = -Infinity;
  for (const p of posts) {
    if (!p || !/^[a-zA-Z\d_-]+$/.test(p.id || '') || ids.has(p.id)) throw new Error('Invalid or duplicate post ID');
    ids.add(p.id);
    if (p.format !== 'Reels' || p.visualStyle !== 'classic-table' || !['pending', 'approved'].includes(p.status)
      || p.publishedAt || p.publishedMediaId || p.feedDelivery || p.storyRepost) throw new Error(`${p.id}: only unpublished classic-table Reels may be rebuilt`);
    if (!p.title || !Array.isArray(p.rows) || !p.rows.length || p.rows.some(r => !Array.isArray(r) || r.length !== 2 || r.some(t => typeof t !== 'string' || !t.trim()))) throw new Error(`${p.id}: invalid table content`);
    const scheduled = Date.parse(p.scheduledAt);
    if (!Number.isFinite(scheduled) || scheduled <= previous) throw new Error('Posts must have unique scheduledAt values in chronological order');
    previous = scheduled;
  }
  return posts;
}
function verifyRotation(resolved) {
  for (let i = 1; i < resolved.length; i++) {
    const a = resolved[i - 1], b = resolved[i];
    if (a.photo.id === b.photo.id || a.photo.sha256 === b.photo.sha256 || a.track.id === b.track.id || a.track.sha256 === b.track.sha256)
      throw new Error(`Adjacent classic slots must change both photo and music (${i - 1}/${i})`);
  }
}
function cacheKey(post, resolved, code, timing) {
  return digest({version: 2, title: post.title, kicker: post.kicker, rows: post.rows, heads: post.heads,
    steps: post.steps, assets: resolved.cache, code, timing});
}
function renderMatches(receipt, key, video, cover) {
  return !!receipt && receipt.key === key && receipt.decoded === true
    && fs.existsSync(video) && fs.existsSync(cover)
    && receipt.sha256 === sha(fs.readFileSync(video)) && receipt.coverSha256 === sha(fs.readFileSync(cover));
}
async function runPool(items, jobs, action) {
  if (![1, 2].includes(jobs)) throw new Error('jobs must be 1 or 2');
  let next = 0, failure;
  await Promise.all(Array.from({length: Math.min(jobs, items.length)}, async () => {
    while (!failure && next < items.length) {
      const at = next++;
      try { await action(items[at], at); } catch (e) { failure ||= e; }
    }
  }));
  if (failure) throw failure;
}
module.exports = {sha, digest, canonical, position, localAsset, createResolver, validatePosts, verifyRotation, cacheKey, renderMatches, runPool};
