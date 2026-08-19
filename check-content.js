#!/usr/bin/env node
/**
 * Предполётная проверка контента перед публикацией (скилл my-skill-instmom).
 *
 *   node check-content.js          — проверить всё неопубликованное
 *   node check-content.js <id>     — проверить один пост или сторис
 *
 * Проверяется машинно-проверяемое: музыка в файлах и её громкость, композитор,
 * фон из папки автора, обложка Reels, подпись, лимиты текста сторис, школьные
 * пары из чёрного списка. Смысловые проверки (крючок, примитивность, читаемость
 * кадра) — глазами по чек-листу скилла .claude/skills/my-skill-instmom.
 *
 * Выход: код 1, если есть ошибки — удобно ставить перед публикацией.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROTATION = require('./rotation');

let ffmpeg = 'ffmpeg';
try { ffmpeg = require('ffmpeg-static') || 'ffmpeg'; } catch { /* системный */ }

const QUEUE = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'queue.json'), 'utf8'));
const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'stories.json'), 'utf8'));
const onlyId = process.argv.slice(2).find(a => !a.startsWith('--'));

const errors = [];
const warnings = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

/** Пары из школьного учебника — по правилам автора им не место в контенте. */
const SCHOOL_PAIRS = [
  /одеть/i, /надеть/i, /эффектн/i, /эффективн/i, /представить/i, /предоставить/i,
  /зв[оо]́?нит/i, /в течени/i, /также.*так же|так же.*также/is, /придти/i,
];

/** Звук в файле: дорожка есть и не тишина. Пустой ответ ffmpeg — сбой, не вердикт. */
function probeAudio(file) {
  const r = spawnSync(ffmpeg, ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.error) return { ok: false, why: `ffmpeg не запустился: ${r.error.message}` };
  const txt = (r.stderr || '') + (r.stdout || '');
  if (!/Stream #[^\n]*Video/.test(txt)) return { ok: false, why: 'файл не читается как видео' };
  if (!/Stream #[^\n]*Audio/.test(txt)) return { ok: false, why: 'нет звуковой дорожки' };
  const max = Number((/max_volume: ([-\d.]+) dB/.exec(txt) || [])[1]);
  if (Number.isFinite(max) && max < -35) return { ok: false, why: `дорожка есть, но почти тишина (max ${max} дБ)` };
  return { ok: true };
}

function checkSchoolPairs(id, text) {
  for (const re of SCHOOL_PAIRS) {
    if (re.test(text)) err(id, `школьная пара в тексте (${re}) — по правилам автора брак`);
  }
}

// ---- Reels и посты из очереди ----
// Проверяются только approved: pending — черновики, они и так не публикуются.
for (const p of QUEUE.posts) {
  if (onlyId && p.id !== onlyId) continue;
  if (!onlyId && p.status !== 'approved') continue;

  const isReels = /reels/i.test(p.format || '');
  // Разборы ЕГЭ/ОГЭ законно состоят из школьного материала — паронимы и есть
  // задание 5. Фильтр примитивности бьёт по контенту для взрослых.
  const isExam = /ege|oge/i.test(p.id) || /ЕГЭ|ОГЭ/i.test(p.rubric || '');
  if (!isExam) checkSchoolPairs(p.id, JSON.stringify(p));

  if (typeof p.caption !== 'string' || !p.caption.trim()) {
    err(p.id, 'нет подписи — публикация её не выпустит (правило «всегда подпись»)');
  }

  // Правило автора после «Слов-призраков» 09.08: таблица в ленте — только
  // Reels с анимацией и музыкой, статичной картинкой она не выходит.
  if (!isReels && (p.slides || []).some(s => s.layout === 'table')) {
    err(p.id, 'таблица статичным постом — конвертируйте в Reels (анимация + музыка)');
  }

  if (isReels) {
    const video = path.join(__dirname, 'content', 'reels', `${p.id}.mp4`);
    if (!fs.existsSync(video)) {
      err(p.id, 'нет файла content/reels/<id>.mp4 — ролик не отрендерен');
    } else {
      const a = probeAudio(video);
      if (!a.ok) err(p.id, `музыка: ${a.why}`);
    }
    if (!p.music || !p.music.composer || !p.music.piece) {
      err(p.id, 'нет composer/piece в очереди — подпись выйдет без «♪ Композитор — пьеса»');
    }
    if (!p.coverOffsetMs) {
      err(p.id, 'нет coverOffsetMs — Instagram выберет обложку сам, в сетке будет пустой заголовок');
    }
    if (!p.background && !p.plainBg && !p.videoBg) {
      warn(p.id, 'фон не зафиксирован в очереди — перерендерите ролик');
    }
  }
}

// ---- Сторис из банка ----
for (const s of BANK.stories) {
  if (onlyId && s.id !== onlyId) continue;
  if (!onlyId && s.status === 'published') continue;

  checkSchoolPairs(s.id, JSON.stringify(s));

  if (s.type === 'vopros') {
    for (const [k, lim] of [['q', 24], ['a', 16], ['b', 16]]) {
      if (!s[k]) err(s.id, `нет поля ${k} — вопрос без вариантов не работает`);
      else if (s[k].length > lim) err(s.id, `${k} длиннее ${lim} знаков (${s[k].length}) — не влезет в кадр`);
    }
    if (s.right !== 'a' && s.right !== 'b') err(s.id, 'right должен быть a или b');
  } else if (!s.top || !s.big) {
    err(s.id, 'у факта нужны top и big');
  }
  if (!s.why) err(s.id, 'нет why — второй кадр пуст, интрига без ответа');
  else for (const line of s.why.split('\n')) {
    if (line.length > 65) err(s.id, `строка why длиннее 65 знаков (${line.length})`);
  }
  if (!s.source) warn(s.id, 'нет source — факт нечем подтвердить при споре в комментариях');

  const track = ROTATION.chooseTrack(s.id, 'story');
  if (!track) err(s.id, 'музыкальная библиотека пуста — сторис выйдет немой');
  else if (!track.composer) err(s.id, `у трека ${track.file} нет composer — кадр выйдет без имени композитора`);

  for (const n of [1, 2]) {
    const v = path.join(__dirname, 'content', 'stories', `${s.id}-${n}.mp4`);
    if (!fs.existsSync(v)) { err(s.id, `нет видео ${s.id}-${n}.mp4 — прогоните node render-stories.js`); continue; }
    const a = probeAudio(v);
    if (!a.ok) err(s.id, `музыка в части ${n}: ${a.why}`);
  }
}

// ---- Фотофоны из папки автора ----
const bgIndex = path.join(__dirname, 'content', 'bg', 'index.json');
const photos = fs.existsSync(bgIndex)
  ? (JSON.parse(fs.readFileSync(bgIndex, 'utf8')).backgrounds || [])
      .filter(b => path.basename(b.file).startsWith('foto-'))
  : [];
if (!photos.length) errors.push('в ротации нет ни одной фотографии автора (foto-*.jpg)');
for (const b of photos) {
  if (!fs.existsSync(path.join(__dirname, b.file))) errors.push(`фон ${b.file} есть в индексе, но файла нет`);
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
if (!errors.length) console.log(`✓ Машинные проверки пройдены${warnings.length ? ` (предупреждений: ${warnings.length})` : ''}. Смысловые — по чек-листу скилла my-skill-instmom.`);
process.exit(errors.length ? 1 : 0);
