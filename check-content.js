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

/**
 * Пары из школьного учебника. Раньше они были браком везде: взрослому, который
 * правило знает, такой пост читается уроком, о котором не просили, — он не
 * сохранит и не перешлёт. Но и совсем без них лента отрывается от школы, для
 * которой аккаунт и существует, поэтому автор оставила квоту: одна школьная
 * единица в неделю. Разборы ЕГЭ/ОГЭ в квоту не входят — там школьный материал
 * и есть тема, а не снисходительный тон.
 */
const SCHOOL_PAIRS = [
  /одеть/i, /надеть/i, /эффектн/i, /эффективн/i, /представить/i, /предоставить/i,
  /зв[оо]́?нит/i, /в течени/i, /также.*так же|так же.*также/is, /придти/i,
  /ложить/i, /класть/i,
  // Дефисы обязательны и разбег короткий: без этого «тся» и «ться» находились
  // в любом тексте с двумя глаголами, и подсказка срабатывала где попало.
  /-тся[\s\S]{0,40}-ться|-ться[\s\S]{0,40}-тся/i,
];

/** Норма выпуска школьного: не чаще одного раза в неделю. */
const SCHOOL_PER_WEEK = 1;

/**
 * Школьное определяется полем `school: true`, а не догадкой по тексту.
 * Пока это был запрет, грубого списка слов хватало: лишний раз не пропустить —
 * малая цена. Для квоты цена другая: ложное срабатывание («в течение» в
 * подписи про запятые) съедает единственный слот недели. Поэтому список слов
 * оставлен подсказкой — он предупреждает, что материал похож на школьный, а
 * решает автор.

/** Номер недели по дате — единица календаря, в которой считается квота. */
function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Понедельник недели, к которой относится дата: воскресенье считаем седьмым днём.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function isSchool(obj) {
  return obj.school === true;
}

function looksSchool(obj) {
  const text = JSON.stringify(obj);
  return SCHOOL_PAIRS.some(re => re.test(text));
}

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

/**
 * Квота школьного контента. Считается по всей ленте и по всему банку сторис
 * сразу, а не по одному посту: одиночная проверка `node check-content.js <id>`
 * иначе всегда видела бы ровно одну единицу и квоту не поймала бы никогда.
 */
function checkSchoolQuota() {
  // Лента: неделя берётся по дате выпуска. Уже вышедшее считается — слот недели
  // оно занимает, — но ругаться есть смысл только там, где ещё можно подвинуть.
  const weeks = new Map();
  for (const p of QUEUE.posts) {
    if (p.status === 'rejected') continue;
    const exam = /ege|oge/i.test(p.id) || /ЕГЭ|ОГЭ/i.test(p.rubric || '');
    if (exam) continue;
    if (p.status !== 'published' && !isSchool(p) && looksSchool(p)) {
      warn(p.id, 'похоже на школьный материал — если это он, поставьте "school": true, иначе он пройдёт мимо квоты');
    }
    if (!isSchool(p)) continue;
    const key = weekKey(p.date);
    if (!key) { warn(p.id, 'нет разбираемой даты — школьная квота не считается'); continue; }
    const week = weeks.get(key) || { ids: [], movable: [] };
    week.ids.push(p.id);
    if (p.status !== 'published') week.movable.push(p.id);
    weeks.set(key, week);
  }
  for (const [week, { ids, movable }] of weeks) {
    if (ids.length > SCHOOL_PER_WEEK && movable.length) {
      err(movable.join(', '), `${ids.length} школьных публикации на неделе с ${week} — норма ${SCHOOL_PER_WEEK} в неделю, перенесите лишние`);
    }
  }

  // Сторис: дат в банке нет, они выходят по одной в день по порядку —
  // значит неделя это семь подряд идущих неопубликованных сторис.
  const queue = BANK.stories.filter(s => s.status !== 'published');
  const perWeek = new Map();
  queue.forEach((s, i) => {
    if (!isSchool(s) && looksSchool(s)) {
      warn(s.id, 'похоже на школьный материал — если это он, поставьте "school": true');
    }
    if (!isSchool(s)) return;
    const week = Math.floor(i / 7);
    perWeek.set(week, [...(perWeek.get(week) || []), s.id]);
  });
  for (const [week, ids] of perWeek) {
    if (ids.length > SCHOOL_PER_WEEK) {
      err(ids.join(', '), `${ids.length} школьных сторис в неделе ${week + 1} очереди — норма ${SCHOOL_PER_WEEK} в неделю`);
    }
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
  // Школьное больше не брак поштучно — оно ограничено квотой, её считает
  // checkSchoolQuota() по всей ленте разом.

  if (typeof p.caption !== 'string' || !p.caption.trim()) {
    err(p.id, 'нет подписи — публикация её не выпустит (правило «всегда подпись»)');
  }

  // Правило автора после «Слов-призраков» 09.08: таблица ОДИНОЧНЫМ статичным
  // постом не выходит — только Reels. Финальная таблица-памятка в многослайдовой
  // карусели-«диагнозе» — наоборот, механика сохранений (разбор виральных
  // каруселей, 19.08), её правило не трогает.
  const slides = p.slides || [];
  if (!isReels && slides.length === 1 && slides[0].layout === 'table') {
    err(p.id, 'таблица одиночным статичным постом — конвертируйте в Reels (анимация + музыка)');
  }

  // Карусель со звуком: слайды публикуются роликами, и каждый должен быть
  // цел. 25.08 последний слайд вышел файлом в 261 байт — музыка кончилась
  // раньше, чем до него дошла очередь, и публикация упала бы на нём одном.
  if (/карусель/i.test(p.format || '')) {
    const imgs = p.imageUrls || [];
    const vids = p.videoUrls || [];
    if (imgs.length !== slides.length) {
      err(p.id, `imageUrls: ${imgs.length} ссылок на ${slides.length} слайдов — публикация выйдет неполной`);
    }
    if (vids.length && vids.length !== slides.length) {
      err(p.id, `videoUrls: ${vids.length} роликов на ${slides.length} слайдов — звука в карусели не будет`);
    }
    for (const [i, url] of vids.entries()) {
      const file = path.join(__dirname, 'content', 'images', path.basename(url));
      if (!fs.existsSync(file)) { err(p.id, `слайд ${i + 1}: нет файла ${path.basename(file)}`); continue; }
      const a = probeAudio(file);
      if (!a.ok) err(p.id, `слайд ${i + 1}: ${a.why}`);
    }
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

// ---- Квота школьного контента ----
// Считается всегда по всей ленте и всему банку, даже при проверке одного поста:
// «одна в неделю» — свойство расписания, а не отдельной публикации.
checkSchoolQuota();

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
