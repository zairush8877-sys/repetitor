#!/usr/bin/env node
/**
 * Рендер ежедневных сторис из content/stories.json.
 *
 *   node render-stories.js            — отрисовать все неопубликованные
 *   node render-stories.js <id>       — отрисовать одну
 *   node render-stories.js --next     — только следующую в очереди (для ежедневного запуска)
 *
 * Каждая сторис — два кадра 1080×1920:
 *   <id>-1.jpg — вопрос/интрига,
 *   <id>-2.jpg — ответ с объяснением.
 * Интерактивные стикеры (опросы, викторины) через API недоступны, поэтому
 * викторина собирается двумя кадрами: люди отвечают в уме, а потом проверяют себя.
 *
 * Результат: content/stories/<id>-1.jpg, <id>-2.jpg и <id>.mp4 — оба кадра
 * подряд с музыкой. Картинка в сторис выходит немой, а немая сторис в ленте
 * читается как сбой звука, поэтому по умолчанию собирается ещё и видео.
 * Отключается флагом --no-video, когда нужны только кадры.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ffmpeg = require('ffmpeg-static');
const FONTS = require('./fonts');

const BANK = path.join(__dirname, 'content', 'stories.json');
const OUT = path.join(__dirname, 'content', 'stories');
const MUSIC = path.join(__dirname, 'content', 'music');
const W = 1080, H = 1920;

// Первый кадр — вопрос, его надо успеть прочитать и подумать; второй — ответ
// с объяснением, он длиннее.
const HOLD = [4.5, 7.5];

/** Ротация по id: разброс между сторис и постоянство внутри одной. */
function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

function chooseTrack(id) {
  const idx = path.join(MUSIC, 'index.json');
  if (!fs.existsSync(idx)) return null;
  const list = (JSON.parse(fs.readFileSync(idx, 'utf8')).tracks || [])
    .filter(t => fs.existsSync(path.join(MUSIC, t.file)));
  return list.length ? list[hash(id + 'story') % list.length] : null;
}

/**
 * Два кадра склеиваются в ролик через concat-демуксер: последний файл в списке
 * повторяется намеренно — без повтора ffmpeg отбрасывает длительность
 * последней записи и второй кадр мелькает один кадр вместо семи секунд.
 */
function buildVideo(id) {
  const track = chooseTrack(id);
  const total = HOLD[0] + HOLD[1];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const list = path.join(tmp, 'list.txt');
  const f = i => path.join(OUT, `${id}-${i}.jpg`);

  fs.writeFileSync(list,
    `file '${f(1)}'\nduration ${HOLD[0]}\n` +
    `file '${f(2)}'\nduration ${HOLD[1]}\n` +
    `file '${f(2)}'\n`);

  const out = path.join(OUT, `${id}.mp4`);
  const audioIn = track
    ? ['-i', path.join(MUSIC, track.file)]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];

  execFileSync(ffmpeg, [
    '-y', '-f', 'concat', '-safe', '0', '-i', list,
    ...audioIn,
    '-t', total.toFixed(2),
    ...(track ? ['-af', `afade=t=in:st=0:d=0.8,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2`] : []),
    '-c:v', 'libx264', '-r', '30', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  fs.rmSync(tmp, { recursive: true, force: true });
  return { out, track, total };
}

// Палитры чередуются по порядку — лента сторис не выглядит одинаковой изо дня в день
const PALETTES = [
  { bg: '#1f3d2b', ink: '#fdf9f2', accent: '#f2b544', soft: 'rgba(253,249,242,.62)' },
  { bg: '#8c3f2b', ink: '#fdf3e7', accent: '#f6d26a', soft: 'rgba(253,243,231,.62)' },
  { bg: '#2b3d63', ink: '#f2f6ff', accent: '#7fd1c1', soft: 'rgba(242,246,255,.62)' },
  { bg: '#f4ecdd', ink: '#241f18', accent: '#b5442c', soft: 'rgba(36,31,24,.55)' },
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = s => esc(s).replace(/\n/g, '<br>');

function size(text, base) {
  const longest = Math.max(...String(text).split('\n').map(l => l.length));
  if (longest <= 8) return base;
  if (longest <= 12) return Math.round(base * 0.82);
  if (longest <= 18) return Math.round(base * 0.66);
  return Math.round(base * 0.52);
}

function shell(p, body, extra = '') {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    ${FONTS.fontFaceCss()}
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px; overflow: hidden;
      background: ${p.bg}; color: ${p.ink};
      font-family: ${FONTS.body()};
      display: flex; flex-direction: column; justify-content: center;
      /* Верх занимает аватар и кольцо прогресса, низ — поле «Отправить сообщение» */
      padding: 300px 90px 260px;
      text-align: center; align-items: center;
      position: relative;
    }
    .kicker {
      font-family: ${FONTS.head()};
      font-size: 34px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
      color: ${p.accent}; margin-bottom: 56px;
    }
    .foot {
      position: absolute; left: 0; right: 0; bottom: 190px;
      font-family: ${FONTS.head()};
      font-size: 30px; color: ${p.soft};
    }
    ${extra}
  </style></head><body>${body}<div class="foot">@mairova_a_a</div></body></html>`;
}

/** Кадр 1: вопрос с двумя вариантами — зритель отвечает про себя. */
function askHtml(s, p) {
  return shell(p, `
    <div class="kicker">${esc(s.q)}</div>
    <div class="opts">
      <div class="opt">${esc(s.a)}</div>
      <div class="or">или</div>
      <div class="opt">${esc(s.b)}</div>
    </div>
    <div class="hint">Ответ — на следующем кадре</div>`, `
    .opts { display: flex; flex-direction: column; gap: 30px; align-items: center; width: 100% }
    .opt {
      font-size: ${size(s.a.length > s.b.length ? s.a : s.b, 96)}px; font-weight: 700;
      line-height: 1.15; padding: 34px 30px; width: 100%;
      border: 4px solid ${p.accent}; border-radius: 28px;
    }
    .or { font-size: 40px; color: ${p.soft}; font-style: italic }
    .hint {
      margin-top: 64px; font-family: ${FONTS.head()};
      font-size: 32px; color: ${p.soft};
    }`);
}

/** Кадр 2: правильный ответ крупно + короткое объяснение. */
function answerHtml(s, p) {
  const right = s.right === 'a' ? s.a : s.b;
  const wrong = s.right === 'a' ? s.b : s.a;
  return shell(p, `
    <div class="kicker">Правильно</div>
    <div class="right">${esc(right)}</div>
    <div class="wrong">${esc(wrong)}</div>
    <div class="why">${nl2br(s.why)}</div>`, `
    .right {
      font-size: ${size(right, 104)}px; font-weight: 700; line-height: 1.12;
      color: ${p.accent}; margin-bottom: 26px;
    }
    .wrong {
      font-size: 46px; color: ${p.soft};
      text-decoration: line-through; text-decoration-thickness: 3px; margin-bottom: 70px;
    }
    .why { font-size: 42px; line-height: 1.42; max-width: 22ch }`);
}

/** Кадр 1 для факта: интрига без вопроса. */
function factHtml(s, p) {
  return shell(p, `
    <div class="kicker">${esc(s.top)}</div>
    <div class="big">${nl2br(s.big)}</div>
    <div class="hint">Почему — дальше</div>`, `
    .big { font-size: ${size(s.big, 130)}px; font-weight: 700; line-height: 1.12; color: ${p.accent} }
    .hint {
      margin-top: 70px; font-family: ${FONTS.head()};
      font-size: 32px; color: ${p.soft};
    }`);
}

function whyHtml(s, p) {
  return shell(p, `
    <div class="kicker">${esc(s.top)}</div>
    <div class="why">${nl2br(s.why)}</div>`, `
    .why { font-size: 46px; line-height: 1.45; max-width: 21ch }`);
}

function framesFor(s, p) {
  return s.type === 'vopros'
    ? [askHtml(s, p), answerHtml(s, p)]
    : [factHtml(s, p), whyHtml(s, p)];
}

(async () => {
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
  const args = process.argv.slice(2);
  const onlyId = args.find(a => !a.startsWith('--'));
  const pending = bank.stories.filter(s => s.status !== 'published');

  let targets;
  if (onlyId) targets = bank.stories.filter(s => s.id === onlyId);
  else if (args.includes('--next')) targets = pending.slice(0, 1);
  else targets = pending;

  if (targets.length === 0) {
    console.log(onlyId ? `Сторис «${onlyId}» не найдена.` : 'Все сторис из банка уже опубликованы — добавьте новые в content/stories.json.');
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  for (const s of targets) {
    const p = PALETTES[bank.stories.indexOf(s) % PALETTES.length];
    const frames = framesFor(s, p);
    for (const [i, html] of frames.entries()) {
      await page.setContent(html);
      await page.screenshot({ path: path.join(OUT, `${s.id}-${i + 1}.jpg`), type: 'jpeg', quality: 92 });
    }
    console.log(`${s.id} [${s.type}]: 2 кадра`);
  }

  await browser.close();

  if (!process.argv.includes('--no-video')) {
    for (const s of targets) {
      const { track, total } = buildVideo(s.id);
      console.log(`${s.id}: видео ${total.toFixed(1)} сек — ${track ? track.title : 'без музыки'}`);
    }
  }

  console.log(`\nГотово: content/stories/`);
})();
