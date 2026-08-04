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

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px; overflow: hidden;
      ${bgCss}; color: ${PALETTE.ink};
      font-family: Georgia, "Times New Roman", serif;
      display: flex; flex-direction: column;
      /* Сверху Instagram рисует шапку с ником, снизу — подпись и кнопки:
         контент держим внутри безопасной зоны */
      padding: 300px 80px 150px;
      position: relative;
    }
    ${hasPhoto ? `body::before {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(24,18,12,.30) 0%, rgba(24,18,12,.10) 40%, rgba(24,18,12,.28) 100%);
    }
    .kicker, .title, .card, .foot { position: relative; z-index: 1 }` : ''}
    .kicker {
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 34px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: ${hasPhoto ? 'rgba(255,244,230,.92)' : PALETTE.accent}; margin-bottom: 40px;
      ${hasPhoto ? 'text-shadow: 0 2px 14px rgba(0,0,0,.45);' : ''}
    }
    .title {
      font-size: 86px; line-height: 1.16; font-weight: 700; margin-bottom: 64px;
      ${hasPhoto ? `color: #fdf9f2; text-shadow: 0 3px 22px rgba(0,0,0,.5);` : ''}
    }
    .card {
      ${hasPhoto ? `background: #ffffff; border-radius: 22px;
      padding: 30px 44px 20px; box-shadow: 0 24px 70px rgba(0,0,0,.35);` : 'flex: 1;'}
      display: flex; flex-direction: column; justify-content: flex-start;
    }
    .foot { margin-top: auto }
    .head {
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 34px; font-weight: 700;
      padding-bottom: 20px; border-bottom: 3px solid #1f1d1a;
    }
    .head .h-bad { color: ${PALETTE.accent} }
    .head .h-good { color: ${PALETTE.right} }
    .row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: baseline;
      padding: 21px 0; border-bottom: 1px solid #e2ddd4;
      font-size: 46px; font-weight: 700; opacity: 0;
    }
    .row:last-of-type { border-bottom: none }
    .bad { position: relative; color: ${PALETTE.accent}; justify-self: start }
    .strike {
      position: absolute; left: 0; top: 55%; height: 5px; width: 0%;
      background: ${PALETTE.accent};
    }
    .good { color: ${PALETTE.right}; opacity: 0 }
    .foot {
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 32px;
      color: ${hasPhoto ? 'rgba(255,244,230,.85)' : PALETTE.muted};
      display: flex; justify-content: space-between; align-items: baseline;
      ${hasPhoto ? 'text-shadow: 0 2px 12px rgba(0,0,0,.45);' : ''}
    }
    .foot b { color: ${hasPhoto ? '#fff' : PALETTE.ink}; font-weight: 650 }
  </style></head><body>
    <div class="kicker">${esc(post.kicker || '')}</div>
    <div class="title">${esc(post.title || '').replace(/\n/g, '<br>')}</div>
    <div class="card">
      <div class="head"><span class="h-bad">✕ Неправильно</span><span class="h-good">✓ Правильно</span></div>
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

(async () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const id = process.argv[2];
  const post = queue.posts.find(p => p.id === id);
  if (!post) { console.error(`Пост «${id}» не найден в очереди.`); process.exit(1); }
  if (!post.rows) { console.error(`У поста «${id}» нет поля rows — нечего анимировать.`); process.exit(1); }

  const total = INTRO + post.rows.length * ROW_STEP + OUTRO;
  const frames = Math.round(total * FPS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));

  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(post, queue.account));

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
  execFileSync(ffmpeg, [
    '-y',
    '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    out,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`\nГотово: ${out} (${total.toFixed(1)} сек, ${mb} МБ)`);
})();
