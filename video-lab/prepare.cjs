// Local staging only. Never imports publication code or edits editorial queues.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pilot = path.join(root, 'content');
const id = '2026-09-13-wordplay-reel';
const source = path.join(pilot, 'reels', `${id}.mp4`);
const bytes = fs.readFileSync(source);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const entry = JSON.parse(fs.readFileSync(path.join(pilot, 'prepared/index.json'))).posts[id];
const expected = entry.files.find(file => file.relative === `reels/${id}.mp4`);
if (!expected || expected.sha256 !== hash(bytes)) throw new Error('Исходный пилот изменился: сначала проверить его сборку.');
for (const dir of ['hyperframes/assets', 'remotion/public']) {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
  fs.writeFileSync(path.join(__dirname, dir, 'pilot.mp4'), bytes);
}
const manifest = {
  source: path.relative(root, source), sha256: hash(bytes), bytes: bytes.length,
  sourcePostId: id, music: entry.media.music,
  provenance: ['assets/photos/wordplay.json', 'content/music/index.json', 'outputs/pilot-v2-2026-09-13/editorial/'],
  timeline: {width: 1080, height: 1920, fps: 30, durationInFrames: 600},
};
fs.writeFileSync(path.join(__dirname, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const [sourceDir, targetDir, files] of [
  ['assets/fonts', 'fonts', ['IBMPlexSerif-Bold.ttf', 'Oswald-variable.ttf', 'manrope-400.woff2', 'manrope-600.woff2']],
  ['assets/photos', 'photos', ['jeshoots-notebook.jpg', 'clay-banks-notebook.jpg', 'red-phone-outdoors.jpg', 'atlas-anez.jpg', 'blue-carriage-nilov.jpg', 'envelope-kerngker.jpg', 'clock-koolshooters.jpg']],
]) {
  const target = path.join(__dirname, 'remotion/public', targetDir);
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(root, sourceDir, file), path.join(target, file));
}
fs.copyFileSync(path.join(root, 'content/music/light-easy-lemon.mp3'), path.join(__dirname, 'remotion/public/music.mp3'));
fs.copyFileSync(path.join(root, 'content/music/bach-goldberg-var1-ishizaka.mp3'), path.join(__dirname, 'remotion/public/classical.mp3'));
console.log(JSON.stringify({copied: 2, sourceHashVerified: true, queueUnchanged: true}));
