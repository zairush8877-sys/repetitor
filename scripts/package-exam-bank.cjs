#!/usr/bin/env node
'use strict';
// Local-only review packager for eight Reels + six four-video carousels.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const P = require('../prepared-media');
const {sourceKey, sourcesFor} = require('../repost-state');
const root = path.resolve(__dirname, '..');
const content = path.resolve(process.env.MEDIA_CONTENT_DIR || path.join(root, 'outputs/exam-bank-2026-09-26/content'));
const contentRelative = path.relative(root, content);
if (!contentRelative.startsWith(`outputs${path.sep}`) || path.basename(content) !== 'content') throw new Error('Review output must be an isolated outputs/.../content directory');
// Resolve existing ancestors as well: an output symlink must not reach the live queue.
let ancestor = content;
while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
const resolvedContent = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, content));
if (!resolvedContent.startsWith(path.join(fs.realpathSync(root), 'outputs') + path.sep)) throw new Error('Review output resolves outside the isolated outputs directory');
const argv = process.argv.slice(2);
const flags = new Set(['--config', '--ffmpeg', '--ffprobe', '--python']);
for (let i = 0; i < argv.length; i += 2) {
  if (!flags.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
}
const option = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const compositor = path.join(root, 'video-lab/remotion/node_modules/@remotion/compositor-darwin-arm64');
const ffmpeg = option('--ffmpeg', process.env.FFMPEG_BIN || (process.platform === 'darwin' ? path.join(compositor, 'ffmpeg') : 'ffmpeg'));
const ffprobe = option('--ffprobe', process.env.FFPROBE_BIN || (process.platform === 'darwin' ? path.join(compositor, 'ffprobe') : 'ffprobe'));
const python = option('--python', process.env.PYTHON_BIN || 'python3');
const config = path.resolve(option('--config', path.join(root, 'video-lab/exam-bank.json')));
const env = {...process.env, ...(process.platform === 'darwin' ? {DYLD_LIBRARY_PATH: [compositor, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')} : {})};
const raw = relative => `https://raw.githubusercontent.com/zairush8877-sys/repetitor/main/${contentRelative.split(path.sep).join('/')}/${relative}`;
const need = file => { if (!fs.existsSync(file)) throw new Error(`Required file missing: ${file}`); return file; };
const read = file => JSON.parse(fs.readFileSync(need(file), 'utf8'));
const hash = file => P.sha(fs.readFileSync(need(file)));
function run(binary, args) {
  try { return execFileSync(binary, args, {env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}); }
  catch (e) { throw new Error(`${path.basename(binary)}: ${e.message}\n${String(e.stderr || '').slice(-2000)}`); }
}
function dateValid(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
function main() {
  fs.mkdirSync(content, {recursive: true});
  const lock = path.join(content, '.publish.lock');
  const lockFd = fs.openSync(lock, 'wx');
  fs.writeFileSync(lockFd, JSON.stringify({pid: process.pid, purpose: 'package-exam-bank'}));
  fs.closeSync(lockFd);
  let stage;
  try {
    const data = read(config), bank = Array.isArray(data) ? data : data.posts;
    if (!Array.isArray(bank) || bank.length !== 14 || bank.filter(p => p.format === 'Reels').length !== 8 || bank.filter(p => p.format === 'carousel').length !== 6) throw new Error('Config must contain eight Reels and six carousel posts');
    if (new Set(bank.map(p => p.id)).size !== 14 || new Set(bank.map(p => p.proposedDate)).size !== 14) throw new Error('Duplicate bank ID or proposed date');
    if (bank.filter(p => p.exam === 'ЕГЭ').length !== 7 || bank.filter(p => p.exam === 'ОГЭ').length !== 7) throw new Error('Config must contain seven ЕГЭ and seven ОГЭ posts');
    const queuePath = path.join(content, 'queue.json');
    const readyPath = path.join(content, 'prepared/index.json');
    const repostPath = path.join(content, 'reposts/index.json');
    const storiesPath = path.join(content, 'stories.json');
    const watched = [queuePath, readyPath, repostPath, storiesPath, config];
    const snapshots = new Map(watched.map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
    const queue = fs.existsSync(queuePath) ? read(queuePath) : {account: 'mairova_a_a', _comment: 'Изолированный банк для просмотра. proposedDate — план, не дата публикации. Все новые материалы pending.', posts: []};
    const ready = fs.existsSync(readyPath) ? read(readyPath) : {version: 1, posts: {}};
    const reposts = fs.existsSync(repostPath) ? read(repostPath) : {version: 1, posts: {}};
    const stories = fs.existsSync(storiesPath) ? read(storiesPath) : {_comment: 'Обычные ежедневные Stories не входят в этот банк. Полные репосты 14 выпусков находятся в reposts/index.json.', stories: []};
    if (!Array.isArray(queue.posts) || !ready.posts || !reposts.posts) throw new Error('Invalid isolated queue or manifest shape');
    const evidenceFile = path.join(content, 'repost-evidence.json');
    const evidence = fs.existsSync(evidenceFile) ? read(evidenceFile) : {};
    if (fs.existsSync(evidenceFile)) snapshots.set(evidenceFile, fs.readFileSync(evidenceFile));
    const track = read(path.join(root, 'content/music/index.json')).tracks.find(t => t.file === 'bach-goldberg-var1-ishizaka.mp3' && t.active !== false);
    if (!track?.composer || !track.piece || !track.license || (track.attributionRequired && (!track.attribution || !track.licenseUrl))) throw new Error('Bach track credits incomplete');
    const trackPath = need(path.join(root, 'content/music', track.file));
    if (!track.sha256 || hash(trackPath) !== track.sha256) throw new Error('Bach source hash does not match music index');
    const font = need(path.join(root, 'assets/fonts/IBMPlexSerif-Bold.ttf'));
    run(python, ['-c', 'from PIL import Image, ImageDraw, ImageFont']);
    const inputs = [];
    const posts = bank.map(source => {
      if (!/^[a-zA-Z0-9_-]+$/.test(source.id) || !dateValid(source.proposedDate) || source.status !== 'pending' || !source.caption?.trim()) throw new Error(`Invalid ID/proposedDate/pending status/caption: ${source.id}`);
      if (source.date !== undefined && source.date !== null && source.date !== '') throw new Error(`${source.id}: review drafts cannot have a publication date; use proposedDate`);
      if (Object.keys(source).some(k => /published|delivery|creationId|storyRepost/i.test(k))) throw new Error(`${source.id}: delivery fields are forbidden in new content`);
      if (queue.posts.some(p => p.id === source.id) || ready.posts[source.id] || reposts.posts[source.id] || evidence.posts?.[source.id]) throw new Error(`${source.id}: existing ID or delivery evidence; never overwrite`);
      const occupied = queue.posts.find(p => p.proposedDate === source.proposedDate);
      if (occupied) throw new Error(`${source.proposedDate}: already proposed for ${occupied.id}`);
      if (!Array.isArray(source.scenes) || source.scenes.some(s => s.seconds !== 6 || !s.headline?.trim() || !s.body?.trim())) throw new Error(`${source.id}: scenes need headline, body and exactly six seconds`);
      const reel = source.format === 'Reels';
      if (source.scenes.length !== (reel ? 5 : 4)) throw new Error(`${source.id}: expected ${reel ? 'five Reels' : 'four carousel'} scenes`);
      const post = {...source, format: reel ? 'Reels' : 'Карусель', plainBg: true, music: {...track}};
      delete post.date;
      // Media/delivery URLs are derived locally, never trusted from the brief.
      for (const key of P.MEDIA_FIELDS) if (key !== 'music') delete post[key];
      if (!reel) post.slides = source.scenes.map(s => ({...s}));
      const paths = reel ? [`reels/${source.id}.mp4`] : source.scenes.map((_, i) => `images/${source.id}-${i + 1}.mp4`);
      const records = paths.map((relative, i) => {
        const file = need(P.localFile(relative, content));
        const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
        const visual = probe.streams.find(s => s.codec_type === 'video');
        const audio = probe.streams.find(s => s.codec_type === 'audio');
        const duration = Number(probe.format.duration);
        const expected = reel ? source.scenes.reduce((n, s) => n + s.seconds, 0) : source.scenes[i].seconds;
        if (visual?.width !== 1080 || visual?.height !== (reel ? 1920 : 1350) || !audio || Math.abs(duration - expected) > 0.15 || !Number.isFinite(duration)) throw new Error(`${relative}: dimensions/audio/duration mismatch`);
        const jpg = relative.replace(/\.mp4$/, reel ? '-frame.jpg' : '.jpg');
        need(file);
        if (fs.existsSync(P.localFile(jpg, content))) throw new Error(`Output already exists: ${jpg}`);
        const storyRelative = `reposts/${source.id}-${i + 1}.jpg`;
        if (fs.existsSync(P.localFile(storyRelative, content))) throw new Error(`Output already exists: ${storyRelative}`);
        return {relative, jpg, storyRelative, file, sha256: hash(file), duration, coverSeconds: duration - 1};
      });
      inputs.push({post, reel, records});
      if (reel) { post.videoUrl = raw(paths[0]); post.coverOffsetMs = Math.round(records[0].coverSeconds * 1000); }
      else { post.imageUrls = records.map(r => raw(r.jpg)); post.videoUrls = paths.map(raw); }
      return post;
    });
    stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mama-exam-package-'));
    for (const dir of ['reels', 'images', 'reposts']) fs.mkdirSync(path.join(stage, dir));
    const builtAt = new Date().toISOString();
    const generated = [];
    for (const {post, reel, records} of inputs) {
      const assets = [];
      for (const r of records) {
        const video = P.localFile(r.relative, stage), cover = P.localFile(r.jpg, stage), story = P.localFile(r.storyRelative, stage);
        fs.copyFileSync(r.file, video);
        if (hash(video) !== r.sha256) throw new Error(`${r.relative}: source changed while staging`);
        run(ffmpeg, ['-v', 'error', '-y', '-ss', String(r.coverSeconds), '-i', video, '-frames:v', '1', '-q:v', '2', cover]);
        const geometry = JSON.parse(run(python, ['-c', `
import json,sys
from PIL import Image,ImageDraw,ImageFont
source,target,font,is_reel=sys.argv[1:]
im=Image.open(source).convert('RGB'); sw,sh=im.size
if is_reel=='1':
 # Reels already has shared text safe zones: preserve its full photo frame.
 if (sw,sh)!=(1080,1920): raise ValueError('Expected 1080x1920 Reels cover')
 x,y,w,h=0,0,sw,sh
 out=im.copy()
 ImageDraw.Draw(out).text((90,1595),'Анонс Reels',font=ImageFont.truetype(font,36),fill='white',stroke_width=2,stroke_fill='#152a39')
else:
 # Every carousel slide is preserved in full, with uniform contain scaling.
 scale=min(900/sw,1260/sh); w,h=round(sw*scale),round(sh*scale)
 x,y=(1080-w)//2,380+(1260-h)//2
 out=Image.new('RGB',(1080,1920),'#f7f3e9')
 out.paste(im.resize((w,h),Image.Resampling.LANCZOS),(x,y))
out.save(target,quality=95,subsampling=0)
print(json.dumps(dict(sourceWidth=sw,sourceHeight=sh,x=x,y=y,width=w,height=h,outputWidth=1080,outputHeight=1920)))
`, cover, story, font, reel ? '1' : '0']));
        assets.push({sourceUrl: raw(r.jpg), file: path.basename(r.storyRelative), url: raw(r.storyRelative), width: 1080, height: 1920, sha256: hash(story), geometry: {...geometry, sourceSha256: hash(cover), sha256: hash(story)}});
        generated.push(r.jpg, r.storyRelative);
      }
      reposts.posts[post.id] = {kind: reel ? 'reel_frame' : 'carousel_slides', sourceKey: sourceKey(post), renderedAt: builtAt, publicationStatus: 'export_only', assets};
      const media = Object.fromEntries(P.MEDIA_FIELDS.filter(k => post[k] !== undefined).map(k => [k, post[k]]));
      const urls = reel ? [post.videoUrl, ...sourcesFor(post)] : [...post.imageUrls, ...post.videoUrls];
      ready.posts[post.id] = {version: 1, builtAt, draftKey: P.draftKey(post), media, files: urls.map(url => {
        const relative = P.relativeUrl(url), file = P.localFile(relative, stage);
        return {relative, url, size: fs.statSync(file).size, sha256: hash(file)};
      })};
      P.validate(post, {contentDir: stage, entry: ready.posts[post.id], manifest: reposts});
    }
    for (const [file, bytes] of snapshots) {
      if (bytes === null ? fs.existsSync(file) : !fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) throw new Error(`${file}: changed during packaging`);
    }
    for (const {records} of inputs) for (const r of records) if (hash(r.file) !== r.sha256) throw new Error(`${r.relative}: changed during packaging`);
    // Only the isolated review queue receives new pending drafts.
    queue.posts.push(...posts);
    const installed = [];
    try {
      for (const relative of generated) {
        const dest = P.localFile(relative, content);
        fs.mkdirSync(path.dirname(dest), {recursive: true});
        fs.copyFileSync(P.localFile(relative, stage), dest, fs.constants.COPYFILE_EXCL);
        installed.push(dest);
      }
      for (const [file, value] of [[repostPath, reposts], [readyPath, ready], [storiesPath, stories], [queuePath, queue]]) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file + '.exam-tmp', JSON.stringify(value, null, 2) + '\n');
        fs.renameSync(file + '.exam-tmp', file);
      }
    } catch (e) {
      for (const file of [repostPath, readyPath, storiesPath, queuePath]) {
        const bytes = snapshots.get(file);
        if (bytes === null) fs.rmSync(file, {force: true});
        else fs.writeFileSync(file, bytes);
        fs.rmSync(file + '.exam-tmp', {force: true});
      }
      for (const file of installed) fs.rmSync(file, {force: true});
      throw e;
    }
    console.log(JSON.stringify({contentDir: content, packaged: posts.map(p => ({id: p.id, proposedDate: p.proposedDate, status: p.status, format: p.format})), liveQueueChanged: false, publicationPerformed: false, storyFrames: inputs.reduce((n, x) => n + x.records.length, 0)}, null, 2));
  } finally {
    if (stage) fs.rmSync(stage, {recursive: true, force: true});
    fs.unlinkSync(lock);
  }
}
try { main(); } catch (e) { console.error(`Exam packaging aborted: ${e.message}`); process.exitCode = 1; }
