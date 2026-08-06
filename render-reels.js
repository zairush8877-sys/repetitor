#!/usr/bin/env node
/**
 * Рендер Reels из content/queue.json: анимированная таблица «говорят → правильно».
 *
 *   node render-reels.js <id>   — собрать видео для поста с format: "Reels" и полем rows
 *
 * Кадры рисуются Playwright-ом (1080×1920, 30 кадров/с), собираются ffmpeg-ом
 * в MP4 (H.264 + тихая AAC-дорожка — без аудиопотока Instagram может отклонить видео).
 * Результат: content/reels/<id>.mp4
 *
 * Тайминг: заставка → строки появляются по одной (ошибка зачёркивается,
 * рядом возникает правильный вариант) → готовая таблица держится в конце,
 * чтобы её успели заскринить и сохранить.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ffmpeg = require('ffmpeg-static');
const FONTS = require('./fonts');

// Палитра системы «Правка» (design/PHILOSOPHY.md): бумага, цвет ошибки
// (землистый, ближе к кирпичу, чем к тревожному красному) и цвет нормы —
// приглушённая хвоя. Больше акцентов в кадре нет.
const PRAVKA = { err: '#8a3a24', ok: '#2f5748', ink: '#211d18', field: 'rgba(33,29,24,.10)' };

const QUEUE = path.join(__dirname, 'content', 'queue.json');
const OUT_DIR = path.join(__dirname, 'content', 'reels');

const W = 1080, H = 1920, FPS = 30;
const INTRO = 1.4;      // заставка, сек
const ROW_STEP = 1.45;  // интервал между строками
const OUTRO = 2.2;      // финальный стоп-кадр с полной таблицей

const PALETTE = {
  bg: '#fbf8f3',
  ink: '#1f1d1a',
  muted: '#8a8377',
  accent: '#8c3f2b',
  right: '#2f6f4f',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pageHtml(post, handle) {
  const rows = post.rows.map(([bad, good], i) => `
    <div class="row" id="row${i}">
      <span class="bad"><span class="badtext">${esc(bad)}</span><span class="strike"></span></span>
      <span class="good">${esc(good)}</span>
    </div>`).join('');

  // С фоном-фотографией заголовок ложится прямо на снимок (белым, с тенью),
  // а таблица — на кремовую карточку, чтобы красный/зелёный оставались читаемыми.
  const bgFile = post.background && path.join(__dirname, post.background);
  const hasPhoto = bgFile && fs.existsSync(bgFile);
  const bgCss = hasPhoto
    ? `background: url(data:image/jpeg;base64,${fs.readFileSync(bgFile).toString('base64')}) center/cover`
    : `background: ${PALETTE.bg}`;
  // Светлый фон: без затемнения, заголовок тёмный (белый бы выцвел)
  const light = !!post.lightBg;
  const titleColor = light ? PALETTE.ink : '#fdf9f2';
  const kickerColor = light ? PALETTE.accent : 'rgba(255,244,230,.92)';
  const footColor = light ? PALETTE.muted : 'rgba(255,244,230,.85)';
  const footBold = light ? PALETTE.ink : '#fff';

  // Кегль таблицы не может быть постоянным: длинные пары переносятся на вторую
  // строку, и при десяти парах нижняя уезжает за нижнюю границу кадра — на
  // превью это видно, а в готовом ролике уже поздно.
  const longest = Math.max(...post.rows.flat().map(s => s.length));
  const rowSize = post.rows.length >= 9 || longest > 18
    ? (post.rows.length >= 10 && longest > 18 ? 34 : 39)
    : 46;
  const rowPad = rowSize >= 46 ? 21 : rowSize >= 39 ? 15 : 11;
  const shadow = light ? '' : 'text-shadow: 0 2px 14px rgba(0,0,0,.45);';

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    ${FONTS.fontFaceCss()}
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px; overflow: hidden;
      ${bgCss}; color: ${PALETTE.ink};
      font-family: ${FONTS.serif()};
      display: flex; flex-direction: column;
      /* Сверху Instagram рисует шапку с ником, снизу — подпись и кнопки:
         контент держим внутри безопасной зоны */
      padding: 300px 80px 150px;
      position: relative;
    }
    ${hasPhoto && !light ? `body::before {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(24,18,12,.30) 0%, rgba(24,18,12,.10) 40%, rgba(24,18,12,.28) 100%);
    }` : ''}
    ${hasPhoto ? `.kicker, .title, .card, .foot { position: relative; z-index: 1 }` : ''}
    .kicker {
      font-family: ${FONTS.mono()};
      font-size: 30px; font-weight: 400; letter-spacing: .3em; text-transform: uppercase;
      color: ${hasPhoto ? kickerColor : PALETTE.accent}; margin-bottom: 40px;
      ${hasPhoto ? shadow : ''}
    }
    .title {
      font-family: ${FONTS.serif()};
      font-size: 86px; letter-spacing: -.01em; line-height: 1.16; font-weight: 700; margin-bottom: 64px;
      ${hasPhoto ? `color: ${titleColor}; ${light ? '' : 'text-shadow: 0 3px 22px rgba(0,0,0,.5);'}` : ''}
    }
    .card {
      ${hasPhoto ? `background: #ffffff; border-radius: 22px;
      padding: 30px 44px 20px; box-shadow: 0 24px 70px rgba(0,0,0,.35);` : 'flex: 1;'}
      display: flex; flex-direction: column; justify-content: flex-start;
    }
    .foot { margin-top: auto }
    .head {
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
      font-family: ${FONTS.mono()};
      font-size: 26px; font-weight: 400; letter-spacing: .22em; text-transform: uppercase;
      padding-bottom: 18px; border-bottom: 2px solid ${PRAVKA.ink};
    }
    .head .h-bad { color: ${PRAVKA.err} }
    .head .h-good { color: ${PRAVKA.ok} }
    /* Крестик и галочку рисуем линиями, а не знаками: моноширинные шрифты
       обычно не несут ✓, и он молча вырождается в латинскую «V». */
    .head i { display: inline-block; position: relative; width: 26px; height: 26px;
              margin-right: 16px; vertical-align: -3px }
    .head i::before, .head i::after {
      content: ""; position: absolute; background: currentColor; border-radius: 1px;
    }
    .m-x::before, .m-x::after { left: 0; top: 11px; width: 26px; height: 4px }
    .m-x::before { transform: rotate(45deg) }
    .m-x::after { transform: rotate(-45deg) }
    .m-v::before { left: 1px; top: 12px; width: 13px; height: 4px; transform: rotate(45deg) }
    .m-v::after { left: 8px; top: 9px; width: 22px; height: 4px; transform: rotate(-52deg) }
    .row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: baseline;
      padding: ${rowPad}px 0; border-bottom: 1px solid ${PRAVKA.field};
      font-size: ${rowSize}px; font-weight: 700; opacity: 0;
    }
    .row:last-of-type { border-bottom: none }
    .bad { position: relative; color: ${PRAVKA.err}; justify-self: start }
    .strike {
      position: absolute; left: 0; top: 55%; height: 5px; width: 0%;
      background: ${PRAVKA.err};
    }
    .good { color: ${PRAVKA.ok}; opacity: 0 }
    .foot {
      font-family: ${FONTS.mono()};
      font-size: 32px;
      color: ${hasPhoto ? footColor : PALETTE.muted};
      display: flex; justify-content: space-between; align-items: baseline;
      ${hasPhoto ? shadow : ''}
    }
    .foot b { color: ${hasPhoto ? footBold : PALETTE.ink}; font-weight: 650 }
  </style></head><body>
    <div class="kicker">${esc(post.kicker || '')}</div>
    <div class="title">${esc(post.title || '').replace(/\n/g, '<br>')}</div>
    <div class="card">
      <div class="head">
        <span class="h-bad"><i class="m-x"></i>Неправильно</span>
        <span class="h-good"><i class="m-v"></i>Правильно</span>
      </div>
      ${rows}</div>
    <div class="foot"><b>@${esc(handle)}</b><span>подготовка к ЕГЭ и ОГЭ</span></div>
    <script>
      const easeOut = x => 1 - Math.pow(1 - x, 3);
      // Фаза внутри строки: появление ошибки → зачёркивание → правильный вариант.
      // Строки до своего времени скрыты совсем — карточка растёт с каждой новой.
      window.seek = (t, intro, step) => {
        let any = false;
        document.querySelectorAll('.row').forEach((row, i) => {
          const local = t - intro - i * step;
          row.style.display = local > 0 ? 'grid' : 'none';
          if (local > 0) any = true;
          const appear = easeOut(Math.min(Math.max(local / 0.3, 0), 1));
          row.style.opacity = appear;
          row.style.transform = 'translateY(' + (1 - appear) * 26 + 'px)';
          const strike = Math.min(Math.max((local - 0.32) / 0.3, 0), 1);
          row.querySelector('.strike').style.width = easeOut(strike) * 100 + '%';
          const good = easeOut(Math.min(Math.max((local - 0.55) / 0.35, 0), 1));
          const g = row.querySelector('.good');
          g.style.opacity = good;
          g.style.transform = 'translateX(' + (1 - good) * 22 + 'px)';
        });
        const card = document.querySelector('.card');
        if (card) card.style.opacity = any ? 1 : 0;
      };
    </script>
  </body></html>`;
}

/**
 * Ротация по id: если фон и трек выбирать случайно, один и тот же пост при
 * повторном рендере выйдет другим, а лента станет пёстрой без всякой системы.
 * Хеш от id даёт разброс между постами и постоянство внутри поста.
 */
function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

function pickFrom(list, id, salt) {
  return list[hash(id + salt) % list.length];
}

/** Фон берётся из ротации, если у поста не задан свой. */
function chooseBackground(post) {
  if (post.background) return { file: post.background, light: !!post.lightBg };
  const idx = path.join(__dirname, 'content', 'bg', 'index.json');
  if (!fs.existsSync(idx)) return null;
  const list = JSON.parse(fs.readFileSync(idx, 'utf8')).backgrounds || [];
  return list.length ? pickFrom(list, post.id, 'bg') : null;
}

/** Фрагмент классики из библиотеки: у каждого поста свой, но всегда один и тот же. */
function chooseTrack(id) {
  const idx = path.join(__dirname, 'content', 'music', 'index.json');
  if (!fs.existsSync(idx)) return null;
  const list = (JSON.parse(fs.readFileSync(idx, 'utf8')).tracks || [])
    .filter(t => fs.existsSync(path.join(__dirname, 'content', 'music', t.file)));
  return list.length ? pickFrom(list, id, 'music') : null;
}

(async () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const id = process.argv[2];
  const post = queue.posts.find(p => p.id === id);
  if (!post) { console.error(`Пост «${id}» не найден в очереди.`); process.exit(1); }
  if (!post.rows) { console.error(`У поста «${id}» нет поля rows — нечего анимировать.`); process.exit(1); }

  const bg = chooseBackground(post);
  if (bg) {
    post.background = bg.file;
    post.lightBg = bg.light;
    console.log(`фон: ${path.basename(bg.file)} (${bg.light ? 'светлый' : 'тёмный'})`);
  }

  const total = INTRO + post.rows.length * ROW_STEP + OUTRO;
  const frames = Math.round(total * FPS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));

  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(post, queue.account));

  // --frame: только финальный кадр (быстрое превью, без сборки видео)
  if (process.argv.includes('--frame')) {
    await page.evaluate(
      ([t, intro, step]) => window.seek(t, intro, step),
      [total - 0.1, INTRO, ROW_STEP]);
    const file = path.join(OUT_DIR, `${id}-frame.jpg`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    await browser.close();
    console.log(`Превью: ${file}`);
    return;
  }

  for (let f = 0; f < frames; f++) {
    await page.evaluate(
      ([t, intro, step]) => window.seek(t, intro, step),
      [f / FPS, INTRO, ROW_STEP]);
    await page.screenshot({ path: path.join(tmp, `f${String(f).padStart(4, '0')}.png`) });
    if (f % 60 === 0) console.log(`кадр ${f}/${frames}`);
  }
  await browser.close();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${id}.mp4`);

  // Без музыки ролик в ленте звучит как сбой звука, поэтому дорожка обязательна.
  // Если библиотека пуста, кладём тишину — это хуже, но лучше, чем упасть.
  const track = chooseTrack(id);
  const audioIn = track
    ? ['-i', path.join(__dirname, 'content', 'music', track.file)]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];

  // Обрыв на полуслове слышен как брак, поэтому в конце уводим громкость.
  const fade = `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2`;

  execFileSync(ffmpeg, [
    '-y',
    '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
    ...audioIn,
    '-t', total.toFixed(2),
    ...(track ? ['-af', fade] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  if (track) console.log(`музыка: ${track.title} (${track.license})`);
  else console.log('музыка: библиотека пуста, дорожка тихая — запустите node fetch-music.js');

  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`\nГотово: ${out} (${total.toFixed(1)} сек, ${mb} МБ)`);
})();
