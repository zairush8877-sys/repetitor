#!/usr/bin/env node
'use strict';
// Local packaging only. No publication, network calls or scheduler changes.
// Overrides: --ffmpeg /path --ffprobe /path --python /path, or *_BIN env vars.
const fs = require('fs');
const path = require('path');
const os = require('os');
const {execFileSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const prepared = require('../prepared-media');
const {sourceKey} = require('../repost-state');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing --${name} value`);
  return args[index + 1];
}
const compositor = path.join(root, 'video-lab/remotion/node_modules/@remotion/compositor-darwin-arm64');
const ffmpeg = option('ffmpeg', process.env.FFMPEG_BIN || (process.platform === 'darwin' ? path.join(compositor, 'ffmpeg') : 'ffmpeg'));
const ffprobe = option('ffprobe', process.env.FFPROBE_BIN || (process.platform === 'darwin' ? path.join(compositor, 'ffprobe') : 'ffprobe'));
const python = option('python', process.env.PYTHON_BIN || 'python3');
const content = path.resolve(process.env.MEDIA_CONTENT_DIR || path.join(root, 'content'));
const env = {...process.env, ...(process.platform === 'darwin' ? {DYLD_LIBRARY_PATH: [compositor, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')} : {})};
function run(bin, argv) {
  try { return execFileSync(bin, argv, {encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}); }
  catch (e) { throw new Error(`${path.basename(bin)} failed: ${e.message}\n${String(e.stderr || '').slice(-3000)}`); }
}
function need(file) { if (!fs.existsSync(file)) throw new Error(`Required file missing: ${file}`); return file; }
function read(file) { return JSON.parse(fs.readFileSync(need(file), 'utf8')); }
const base = 'https://raw.githubusercontent.com/zairush8877-sys/repetitor/main/content/';
const shaFile = file => prepared.sha(fs.readFileSync(file));
function main() {
  const bankData = read(path.join(root, 'video-lab/bank.json'));
  const bank = Array.isArray(bankData) ? bankData : bankData.posts;
  if (!Array.isArray(bank) || bank.length !== 6) throw new Error('Expected exactly six posts in video-lab/bank.json');
  if (new Set(bank.map(p => p.id)).size !== 6) throw new Error('Duplicate bank IDs');
  const queuePath = path.join(content, 'queue.json');
  const readyPath = path.join(content, 'prepared/index.json');
  const repostPath = path.join(content, 'reposts/index.json');
  const paths = [queuePath, readyPath, repostPath];
  const before = paths.map(file => shaFile(need(file)));
  const queue = read(queuePath), ready = read(readyPath), reposts = read(repostPath);
  const music = read(path.join(root, 'content/music/index.json')).tracks.find(t => t.file === 'bach-goldberg-var1-ishizaka.mp3');
  if (!music?.composer || !music?.piece || (music.attributionRequired && !music.attribution)) throw new Error('Missing validated v2 musical credit');
  const font = need(path.join(root, 'assets/fonts/IBMPlexSerif-Bold.ttf'));
  run(python, ['-c', 'from PIL import Image, ImageFont']);
  const posts = bank.map((item, index) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || !item.caption?.trim() || !item.scenes?.length) throw new Error(`Invalid bank item: ${item.id}`);
    const date = `2026-09-${20 + index}`;
    const old = queue.posts.find(p => p.id === item.id);
    if (old?.status === 'published' || old?.publishedMediaId || old?.storyRepost) throw new Error(`${item.id}: existing delivery state; reconcile manually before packaging`);
    const conflict = queue.posts.find(p => p.id !== item.id && !bank.some(b => b.id === p.id) && p.date === date && ['approved', 'published'].includes(p.status));
    if (conflict) throw new Error(`${date}: already reserved by ${conflict.id}`);
    const video = need(path.join(content, 'reels', `${item.id}.mp4`));
    const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
    const visual = probe.streams.find(s => s.codec_type === 'video');
    const duration = Number(probe.format.duration);
    const expected = item.scenes.reduce((sum, s) => sum + s.seconds, 0);
    if (visual?.width !== 1080 || visual?.height !== 1920 || !probe.streams.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || Math.abs(duration - expected) > 0.15) throw new Error(`${item.id}: video dimensions, audio or duration do not match its brief`);
    return {...item, date, status: 'approved', format: 'Reels', plainBg: true, coverOffsetMs: Math.round((duration - 1) * 1000), videoUrl: `${base}reels/${item.id}.mp4`, music: {...music}, lightBg: true};
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mama-bank-package-'));
  const renderedAt = new Date().toISOString();
  try {
    for (const post of posts) {
      const coverName = `${post.id}-frame.jpg`, storyName = `${post.id}-1.jpg`;
      const cover = path.join(temp, coverName), story = path.join(temp, storyName);
      run(ffmpeg, ['-v', 'error', '-y', '-ss', String(post.coverOffsetMs / 1000), '-i', path.join(content, 'reels', `${post.id}.mp4`), '-frames:v', '1', '-q:v', '2', cover]);
      // Full source frame, uniform contain, inside x=90..990 / y=360..1660.
      const geometry = JSON.parse(run(python, ['-c', `
import json,sys
from PIL import Image,ImageFont,ImageDraw
source,out,font=sys.argv[1:]
im=Image.open(source).convert('RGB')
sw,sh=im.size
scale=min(900/sw,1300/sh)
w,h=round(sw*scale),round(sh*scale)
x,y=(1080-w)//2,360+(1300-h)//2
canvas=Image.new('RGB',(1080,1920),'#f7f3e9')
canvas.paste(im.resize((w,h),Image.Resampling.LANCZOS),(x,y))
draw=ImageDraw.Draw(canvas)
draw.text((90,300),'Анонс Reels',font=ImageFont.truetype(font,40),fill='#153f92')
canvas.save(out,quality=95,subsampling=0)
print(json.dumps(dict(sourceWidth=sw,sourceHeight=sh,x=x,y=y,width=w,height=h,outputWidth=1080,outputHeight=1920)))
`, cover, story, font]));
      const sourceUrl = `${base}reels/${coverName}`;
      const hash = shaFile(story);
      reposts.posts[post.id] = {kind: 'reel_frame', sourceKey: sourceKey(post), renderedAt, publicationStatus: 'export_only', assets: [{sourceUrl, file: storyName, url: `${base}reposts/${storyName}`, width: 1080, height: 1920, sha256: hash, geometry: {...geometry, sourceSha256: shaFile(cover), sha256: hash}}]};
      const media = Object.fromEntries(prepared.MEDIA_FIELDS.filter(field => post[field] !== undefined).map(field => [field, post[field]]));
      ready.posts[post.id] = {version: 1, draftKey: prepared.draftKey(post), builtAt: renderedAt, media, files: [`reels/${post.id}.mp4`, `reels/${coverName}`].map(relative => {
        const file = relative.endsWith('-frame.jpg') ? cover : path.join(content, relative);
        return {relative, url: base + relative, size: fs.statSync(file).size, sha256: shaFile(file)};
      })};
    }
    // Do not overwrite a queue or manifest updated while FFmpeg was working.
    if (paths.some((file, index) => shaFile(file) !== before[index])) throw new Error('Queue/manifests changed during packaging; retry after status synchronization');
    fs.mkdirSync(path.join(content, 'reposts'), {recursive: true});
    for (const post of posts) {
      fs.copyFileSync(path.join(temp, `${post.id}-frame.jpg`), path.join(content, 'reels', `${post.id}-frame.jpg`));
      fs.copyFileSync(path.join(temp, `${post.id}-1.jpg`), path.join(content, 'reposts', `${post.id}-1.jpg`));
      prepared.validate(post, {contentDir: content, entry: ready.posts[post.id], manifest: reposts});
      const index = queue.posts.findIndex(p => p.id === post.id);
      if (index < 0) queue.posts.push(post); else queue.posts[index] = post;
    }
    for (const [file, value] of [[readyPath, ready], [repostPath, reposts], [queuePath, queue]]) {
      fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
      fs.renameSync(file + '.tmp', file);
    }
    console.log(JSON.stringify({packaged: posts.map(p => ({id: p.id, date: p.date})), publicationPerformed: false, next: 'Run validate-prepared.js and check-content.js for each bank ID; then inspect covers and audio before authorized publication.'}, null, 2));
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
try { main(); } catch (error) { console.error(`Packaging aborted: ${error.message}`); process.exitCode = 1; }
