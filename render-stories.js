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
 * Результат: content/stories/<id>-1.jpg, <id>-2.jpg и два видео <id>-1.mp4,
 * <id>-2.mp4 — вопрос и ответ отдельными роликами с общей музыкой.
 * Картинка в сторис выходит немой, поэтому публикуются видео. Двумя частями,
 * а не одним склеенным роликом: сторис смотрят тапами, и тап по видео не
 * листает кадры внутри него, а перекидывает на следующую сторис — в едином
 * видео ответ не увидел никто из тех, кто тапнул после вопроса.
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

// Первый ролик — вопрос, его надо успеть прочитать и подумать; второй — ответ
// с объяснением, он длиннее. Кто досмотрел без тапа — увидит ответ сам,
// кто тапнул — попадёт ровно на него.
const HOLD = [5, 8];

// Трек — из общей ротации; соль 'story' сохранена, чтобы уже собранные
// сторис при перерендере получали ту же музыку, что и раньше.
const ROTATION = require('./rotation');
const chooseTrack = id => ROTATION.chooseTrack(id, 'story');

// Фон — фотографии автора (foto-*.jpg из папки Google Drive): контент лежит
// на карточке, поэтому рисованные фоны здесь не нужны, а живой кабинет за
// карточкой и есть смысл ротации. Выбор тем же хешем, что и везде.
const BG_INDEX = path.join(__dirname, 'content', 'bg', 'index.json');
function choosePhoto(id) {
  if (!fs.existsSync(BG_INDEX)) return null;
  // Разнообразие (правило автора): примерно каждая третья сторис выходит
  // на чистой палитре «Правки» без снимка — лента не сливается в фоторяд.
  if (ROTATION.hash(id + 'bgmode') % 3 === 2) return null;
  const photos = (JSON.parse(fs.readFileSync(BG_INDEX, 'utf8')).backgrounds || [])
    .filter(b => path.basename(b.file).startsWith('foto-'))
    .filter(b => fs.existsSync(path.join(__dirname, b.file)));
  return photos.length ? ROTATION.pickFrom(photos, id + 'bg') : null;
}

/**
 * Каждый кадр кодируется отдельным роликом. Музыка общая: второй ролик
 * продолжает запись с того места, где остановился первый, — при досмотре
 * без тапа фрагмент звучит непрерывно.
 */
function buildVideo(id) {
  const track = chooseTrack(id);

  for (const [i, hold] of HOLD.entries()) {
    const frame = path.join(OUT, `${id}-${i + 1}.jpg`);
    const out = path.join(OUT, `${id}-${i + 1}.mp4`);
    const audioIn = track
      ? ['-ss', String(i === 0 ? 0 : HOLD[0]), '-i', path.join(MUSIC, track.file)]
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
    const fade = `afade=t=in:st=0:d=${i === 0 ? 0.6 : 0.25},afade=t=out:st=${(hold - (i === 0 ? 0.35 : 1.2)).toFixed(2)}:d=${i === 0 ? 0.35 : 1.2}`;

    execFileSync(ffmpeg, [
      '-y', '-loop', '1', '-framerate', '30', '-t', String(hold), '-i', frame,
      ...audioIn,
      '-t', String(hold),
      ...(track ? ['-af', fade] : []),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-shortest',
      out,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
  }

  // Одиночный <id>.mp4 из прежней схемы больше не публикуется — убираем,
  // чтобы публикация не нашла его раньше двухчастных.
  fs.rmSync(path.join(OUT, `${id}.mp4`), { force: true });
  return { track, total: HOLD[0] + HOLD[1] };
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

function shell(p, body, extra = '', credit = '', photo = null) {
  // Фотофон: снимок автора во весь кадр под мягкой плёнкой; контент — на
  // опаковой карточке палитры (правило системы: на фотофоне текст лежит
  // на карточке, прямо по снимку он нечитаем). Без фото — прежний фон.
  const bodyBg = photo
    ? `linear-gradient(rgba(24,18,12,.18), rgba(24,18,12,.48)),
       url(data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, photo.file)).toString('base64')}) center/cover`
    : p.bg;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    ${FONTS.fontFaceCss()}
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px; overflow: hidden;
      background: ${bodyBg}; color: ${p.ink};
      font-family: ${FONTS.serif()};
      display: flex; flex-direction: column; justify-content: center;
      /* Верх занимает аватар и кольцо прогресса, низ — поле «Отправить сообщение» */
      padding: 300px ${photo ? 70 : 90}px 260px;
      text-align: center; align-items: center;
      position: relative;
    }
    .card {
      display: flex; flex-direction: column; align-items: center;
      width: 100%;
      ${photo ? `background: ${p.bg}; border-radius: 28px;
      padding: 88px 56px; box-shadow: 0 30px 80px rgba(0,0,0,.35);` : ''}
    }
    .kicker {
      font-family: ${FONTS.mono()};
      font-size: 32px; font-weight: 400; letter-spacing: .26em; text-transform: uppercase;
      color: ${p.accent}; margin-bottom: 56px;
    }
    .foot {
      position: absolute; left: 0; right: 0; bottom: 190px;
      font-family: ${FONTS.mono()};
      font-size: 28px; letter-spacing: .12em;
      color: ${photo ? 'rgba(242,236,226,.92)' : p.soft};
      ${photo ? 'text-shadow: 0 2px 14px rgba(0,0,0,.45);' : ''}
    }
    /* Композитор указывается всегда; у сторис нет подписи, поэтому имя
       живёт на самом кадре, строкой над ником. */
    .music {
      position: absolute; left: 0; right: 0; bottom: 244px;
      font-family: ${FONTS.mono()};
      font-size: 24px; letter-spacing: .06em;
      color: ${photo ? 'rgba(242,236,226,.85)' : p.soft};
      ${photo ? 'text-shadow: 0 2px 14px rgba(0,0,0,.45);' : ''}
    }
    ${extra}
  </style></head><body><div class="card">${body}</div>
    ${credit ? `<div class="music">♪ ${esc(credit)}</div>` : ''}
    <div class="foot">@mairova_a_a</div></body></html>`;
}

/** Кадр 1: вопрос с двумя вариантами — зритель отвечает про себя. */
function askHtml(s, p, credit, photo) {
  // Вопрос — главное в кадре, а не служебная подпись: моноширинный кикер
  // вразрядку в 32 пункта с телефона просто не читался («сверху не видно»).
  // Здесь тот же серифный шрифт и та же роль, что у заголовка в Reels.
  const qLen = Math.max(...s.q.split('\n').map(l => l.length));
  const qSize = qLen <= 14 ? 68 : qLen <= 20 ? 60 : qLen <= 26 ? 52 : 46;
  return shell(p, `
    <div class="question">${nl2br(s.q)}</div>
    <div class="opts">
      <div class="opt">${esc(s.a)}</div>
      <div class="or">или</div>
      <div class="opt">${esc(s.b)}</div>
    </div>
    <div class="hint">Ответ — на следующем кадре</div>`, `
    /* Вопрос — цветом акцента: рядом с двумя вариантами основной краски он
       иначе сливается с ними в один блок. Кегль оставляем крупным. */
    .question {
      font-family: ${FONTS.serif()}; font-size: ${qSize}px; font-weight: 700;
      line-height: 1.2; color: ${p.accent}; margin-bottom: 52px;
    }
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
    }`, credit, photo);
}

/** Кадр 2: правильный ответ крупно + короткое объяснение. */
function answerHtml(s, p, credit, photo) {
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
    .why { font-size: 42px; line-height: 1.42; max-width: 22ch }`, credit, photo);
}

/** Кадр 1 для факта: интрига без вопроса. */
function factHtml(s, p, credit, photo) {
  return shell(p, `
    <div class="kicker">${esc(s.top)}</div>
    <div class="big">${nl2br(s.big)}</div>
    <div class="hint">Почему — дальше</div>`, `
    .big { font-size: ${size(s.big, 130)}px; font-weight: 700; line-height: 1.12; color: ${p.accent} }
    .hint {
      margin-top: 70px; font-family: ${FONTS.mono()};
      font-size: 28px; letter-spacing: .1em; color: ${p.soft};
    }`, credit, photo);
}

function whyHtml(s, p, credit, photo) {
  return shell(p, `
    <div class="kicker">${esc(s.top)}</div>
    <div class="why">${nl2br(s.why)}</div>`, `
    .why { font-size: 46px; line-height: 1.45; max-width: 21ch }`, credit, photo);
}

function framesFor(s, p) {
  const t = chooseTrack(s.id);
  const credit = t && t.composer ? `${t.composer} — ${t.piece || ''}`.trim() : '';
  const photo = choosePhoto(s.id);
  return s.type === 'vopros'
    ? [askHtml(s, p, credit, photo), answerHtml(s, p, credit, photo)]
    : [factHtml(s, p, credit, photo), whyHtml(s, p, credit, photo)];
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
