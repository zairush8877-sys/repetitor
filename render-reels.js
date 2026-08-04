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
      <span class="arrow">→</span>
      <span class="good">${esc(good)}</span>
    </div>`).join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px; overflow: hidden;
      background: ${PALETTE.bg}; color: ${PALETTE.ink};
      font-family: Georgia, "Times New Roman", serif;
      display: flex; flex-direction: column; padding: 130px 90px 110px;
    }
    .kicker {
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 34px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: ${PALETTE.accent}; margin-bottom: 44px;
    }
    .title { font-size: 88px; line-height: 1.16; font-weight: 700; margin-bottom: 80px }
    .rows { flex: 1; display: flex; flex-direction: column; justify-content: flex-start }
    .row {
      display: flex; align-items: baseline; gap: 26px;
      padding: 26px 0; border-bottom: 1px solid #e5ded1;
      font-size: 50px; opacity: 0;
    }
    .row:last-of-type { border-bottom: none }
    .bad { position: relative; color: ${PALETTE.accent}; flex: 0 1 auto }
    .strike {
      position: absolute; left: 0; top: 55%; height: 4px; width: 0%;
      background: ${PALETTE.accent};
    }
    .arrow { color: ${PALETTE.muted}; font-size: 42px }
    .good { color: ${PALETTE.right}; font-weight: 700; opacity: 0 }
    .foot {
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 32px; color: ${PALETTE.muted};
      display: flex; justify-content: space-between; align-items: baseline;
    }
    .foot b { color: ${PALETTE.ink}; font-weight: 650 }
  </style></head><body>
    <div class="kicker">${esc(post.kicker || '')}</div>
    <div class="title">${esc(post.title || '').replace(/\n/g, '<br>')}</div>
    <div class="rows">${rows}</div>
    <div class="foot"><b>@${esc(handle)}</b><span>подготовка к ЕГЭ и ОГЭ</span></div>
    <script>
      const easeOut = x => 1 - Math.pow(1 - x, 3);
      // Фаза внутри строки: появление ошибки → зачёркивание → правильный вариант
      window.seek = (t, intro, step) => {
        document.querySelectorAll('.row').forEach((row, i) => {
          const local = t - intro - i * step;
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
