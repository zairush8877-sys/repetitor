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

// Трек — из общей ротации; соль 'story' сохранена, чтобы уже собранные
// сторис при перерендере получали ту же музыку, что и раньше.
const ROTATION = require('./rotation');
const chooseTrack = id => ROTATION.chooseTrack(id, 'story');

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

// Палитры системы «Правка» (design/PHILOSOPHY.md): бумага и тёмная слива.
// Чередуются по порядку — сторис не выглядят одинаковыми изо дня в день,
// но остаются одной системой с Reels. Роли цветов фиксированы: ошибка — охра,
// норма — хвоя; акцентом служит цвет ошибки, потому что интрига кадра — она.
const PALETTES = [
  {
    bg: `radial-gradient(1100px 900px at 30% 18%, #f6f2e9 0%, transparent 62%), #efe9dd`,
    ink: '#211d18', err: '#8a3a24', ok: '#2f5748',
    accent: '#8a3a24', soft: 'rgba(33,29,24,.52)', line: 'rgba(33,29,24,.28)',
  },
  {
    bg: `radial-gradient(1000px 900px at 30% 22%, rgba(120,70,95,.45) 0%, transparent 65%), linear-gradient(155deg, #3d2230 0%, #2c1a26 55%, #22141d 100%)`,
    ink: '#f2ece2', err: '#d98a63', ok: '#8fc4a4',
    accent: '#d98a63', soft: 'rgba(242,236,226,.55)', line: 'rgba(242,236,226,.30)',
  },
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

function shell(p, body, extra = '', credit = '') {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    ${FONTS.fontFaceCss()}
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px; overflow: hidden;
      background: ${p.bg}; color: ${p.ink};
      font-family: ${FONTS.serif()};
      display: flex; flex-direction: column; justify-content: center;
      /* Верх занимает аватар и кольцо прогресса, низ — поле «Отправить сообщение» */
      padding: 300px 90px 260px;
      text-align: center; align-items: center;
      position: relative;
    }
    .kicker {
      font-family: ${FONTS.mono()};
      font-size: 32px; font-weight: 400; letter-spacing: .26em; text-transform: uppercase;
      color: ${p.accent}; margin-bottom: 56px;
    }
    .foot {
      position: absolute; left: 0; right: 0; bottom: 190px;
      font-family: ${FONTS.mono()};
      font-size: 28px; letter-spacing: .12em; color: ${p.soft};
    }
    /* Композитор указывается всегда; у сторис нет подписи, поэтому имя
       живёт на самом кадре, строкой над ником. */
    .music {
      position: absolute; left: 0; right: 0; bottom: 244px;
      font-family: ${FONTS.mono()};
      font-size: 24px; letter-spacing: .06em; color: ${p.soft};
    }
    ${extra}
  </style></head><body>${body}
    ${credit ? `<div class="music">♪ ${esc(credit)}</div>` : ''}
    <div class="foot">@mairova_a_a</div></body></html>`;
}

/** Кадр 1: вопрос с двумя вариантами — зритель отвечает про себя. */
function askHtml(s, p, credit) {
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
      border: 2px solid ${p.line}; border-radius: 20px;
    }
    .or { font-size: 38px; color: ${p.soft}; font-style: italic }
    .hint {
      margin-top: 64px; font-family: ${FONTS.mono()};
      font-size: 28px; letter-spacing: .1em; color: ${p.soft};
    }`, credit);
}

/** Кадр 2: правильный ответ крупно + короткое объяснение. */
function answerHtml(s, p, credit) {
  const right = s.right === 'a' ? s.a : s.b;
  const wrong = s.right === 'a' ? s.b : s.a;
  return shell(p, `
    <div class="kicker">Правильно</div>
    <div class="right">${esc(right)}</div>
    <div class="wrong">${esc(wrong)}</div>
    <div class="why">${nl2br(s.why)}</div>`, `
    .right {
      font-size: ${size(right, 104)}px; font-weight: 700; line-height: 1.12;
      color: ${p.ok}; margin-bottom: 26px;
    }
    .wrong {
      font-size: 46px; color: ${p.err};
      text-decoration: line-through; text-decoration-color: ${p.err};
      text-decoration-thickness: 3px; margin-bottom: 70px;
    }
    .why { font-size: 42px; line-height: 1.42; max-width: 22ch }`, credit);
}

/** Кадр 1 для факта: интрига без вопроса. */
function factHtml(s, p, credit) {
  return shell(p, `
    <div class="kicker">${esc(s.top)}</div>
    <div class="big">${nl2br(s.big)}</div>
    <div class="hint">Почему — дальше</div>`, `
    .big { font-size: ${size(s.big, 130)}px; font-weight: 700; line-height: 1.12; color: ${p.accent} }
    .hint {
      margin-top: 70px; font-family: ${FONTS.mono()};
      font-size: 28px; letter-spacing: .1em; color: ${p.soft};
    }`, credit);
}

function whyHtml(s, p, credit) {
  return shell(p, `
    <div class="kicker">${esc(s.top)}</div>
    <div class="why">${nl2br(s.why)}</div>`, `
    .why { font-size: 46px; line-height: 1.45; max-width: 21ch }`, credit);
}

function framesFor(s, p) {
  const t = chooseTrack(s.id);
  const credit = t && t.composer ? `${t.composer} — ${t.piece || ''}`.trim() : '';
  return s.type === 'vopros'
    ? [askHtml(s, p, credit), answerHtml(s, p, credit)]
    : [factHtml(s, p, credit), whyHtml(s, p, credit)];
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
