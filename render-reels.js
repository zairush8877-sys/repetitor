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
const INTRO = 1.2;      // заставка, сек
// Анимация строки занимает 0,78 сек (появление → зачёркивание → правильный
// вариант); остаток шага — время, когда готовую пару можно спокойно прочитать.
// Шаг 0,9 давал ноль такого времени: следующая строка трогалась в тот же кадр,
// когда предыдущая договаривала. Длительность ролика считается от числа пар:
// INTRO + rows × ROW_STEP + OUTRO.
const ROW_STEP = 1.15;
const OUTRO = 2.4;      // финальный стоп-кадр с полной таблицей

const PALETTE = {
  bg: '#fbf8f3',
  ink: '#1f1d1a',
  muted: '#8a8377',
  accent: '#8c3f2b',
  right: '#2f6f4f',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pageHtml(post, handle) {
  // Режим шагов (post.steps): инструкция, а не работа над ошибками — строки
  // нумеруются и появляются без зачёркивания, вся остальная механика общая.
  const steps = !!post.steps;
  const rows = post.rows.map(([bad, good], i) => steps ? `
    <div class="row" id="row${i}">
      <span class="bad"><i class="stepnum">${String(i + 1).padStart(2, '0')}</i>${esc(bad)}</span>
      <span class="good">${esc(good)}</span>
    </div>` : `
    <div class="row" id="row${i}">
      <span class="bad"><span class="badtext">${esc(bad)}</span><span class="badstrike" aria-hidden="true">${esc(bad)}</span></span>
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
  const generated = !!post.generatedBg;
  const footColor = hasPhoto ? 'rgba(255,244,230,.88)' : (light ? PALETTE.muted : 'rgba(255,244,230,.85)');
  const footBold = hasPhoto ? '#fff' : (light ? PALETTE.ink : '#fff');

  // Кегль таблицы не может быть постоянным: длинные пары переносятся на вторую
  // строку, и при десяти парах нижняя уезжает за нижнюю границу кадра — на
  // превью это видно, а в готовом ролике уже поздно.
  const longest = Math.max(...post.rows.flat().map(s => s.length));
  const rowSize = post.rows.length >= 9 || longest > 18
    ? (post.rows.length >= 10 && longest > 18 ? 34 : 39)
    : 46;
  const rowPad = rowSize >= 46 ? 21 : rowSize >= 39 ? 15 : 11;
  // Подпись на фото стоит на тёмной полосе скрима — тень нужна всегда.
  const shadow = 'text-shadow: 0 2px 14px rgba(0,0,0,.45);';

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
    ${hasPhoto ? `body::before {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(24,18,12,.10) 0%, transparent 28%, transparent 70%, rgba(24,18,12,.45) 100%);
    }` : ''}
    ${hasPhoto ? `.kicker, .title, .card, .foot { position: relative; z-index: 1 }` : ''}
    .kicker {
      font-family: ${FONTS.mono()};
      font-size: 30px; font-weight: 400; letter-spacing: .3em; text-transform: uppercase;
      color: ${PALETTE.accent}; margin-bottom: 40px;
    }
    .title {
      font-family: ${FONTS.serif()};
      font-size: 86px; letter-spacing: -.01em; line-height: 1.28; font-weight: 700; margin-bottom: 64px;
    }
    /* На фотографии текст не кладётся прямо на снимок (система «Правка»):
       кикер и заголовок живут на бумажных плашках — читаемо и на тёмном
       книжном корешке, и на светлой странице. Без фото плашка прозрачна. */
    .plate {
      ${hasPhoto ? `background: rgba(239,233,221,.94); color: ${PALETTE.ink};
      box-decoration-break: clone; -webkit-box-decoration-break: clone;
      padding: 6px 20px; border-radius: 6px;` : ''}
    }
    .kicker .plate { ${hasPhoto ? `color: ${PALETTE.accent}; padding: 10px 20px;` : ''} }
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
    /* Зачёркивание — не полоса поверх блока, а вторая копия текста с настоящим
       line-through: полоса умела пересечь только одну строку, и на паре,
       перенёсшейся на две, первая выглядела подчёркнутой, а вторая оставалась
       нетронутой. Копия переносится так же, как оригинал, поэтому черта идёт
       по каждой строке; появление слева направо даёт clip-path. */
    .badstrike {
      position: absolute; inset: 0; color: transparent;
      text-decoration: line-through;
      text-decoration-color: ${PRAVKA.err};
      text-decoration-thickness: ${Math.max(3, Math.round(rowSize * 0.1))}px;
      clip-path: inset(-10% 100% -10% 0);
    }
    .good { color: ${PRAVKA.ok}; opacity: 0 }
    ${steps ? `
    .head { visibility: hidden; height: 0; padding-bottom: 0; border-bottom: none }
    .bad { color: ${PRAVKA.ink} }
    .stepnum { font-family: ${FONTS.mono()}; font-style: normal; font-weight: 400;
               color: ${PRAVKA.err}; margin-right: 18px }
    .good { color: rgba(33,29,24,.78); font-weight: 400 }` : ''}
    .foot {
      font-family: ${FONTS.mono()};
      font-size: 32px;
      color: ${hasPhoto ? footColor : PALETTE.muted};
      display: flex; justify-content: space-between; align-items: baseline;
      ${hasPhoto ? shadow : ''}
    }
    .foot b { color: ${hasPhoto ? footBold : PALETTE.ink}; font-weight: 650 }
  </style></head><body>
    <div class="kicker"><span class="plate">${esc(post.kicker || '')}</span></div>
    <div class="title"><span class="plate">${esc(post.title || '').replace(/\n/g, '<br>')}</span></div>
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
      // Строки всегда в потоке (иначе карточка меняет размер толчками), видимость
      // гасится прозрачностью, а высота карточки следует за появлением строк —
      // без этого она либо прыгает, либо стоит пустым белым полем на весь ролик.
      window.seek = (t, intro, step) => {
        document.querySelectorAll('.row').forEach((row, i) => {
          const local = t - intro - i * step;
          const appear = easeOut(Math.min(Math.max(local / 0.3, 0), 1));
          row.style.opacity = appear;
          row.style.transform = 'translateY(' + (1 - appear) * 26 + 'px)';
          const strike = easeOut(Math.min(Math.max((local - 0.32) / 0.26, 0), 1));
          const bs = row.querySelector('.badstrike');
          if (bs) bs.style.clipPath = 'inset(-10% ' + (1 - strike) * 100 + '% -10% 0)';
          const good = easeOut(Math.min(Math.max((local - 0.5) / 0.28, 0), 1));
          const g = row.querySelector('.good');
          g.style.opacity = good;
          g.style.transform = 'translateX(' + (1 - good) * 22 + 'px)';
        });
        const card = document.querySelector('.card');
        if (!card) return;
        // Карточка входит мягко, чуть раньше первой строки, — а не вспыхивает
        // целиком в один кадр.
        card.style.opacity = easeOut(Math.min(Math.max((t - (intro - 0.4)) / 0.35, 0), 1));
        const geom = window.__geom;
        if (geom) {
          let h = geom.headBottom;
          for (let i = 0; i < geom.rows.length; i++) {
            const local = t - intro - i * step;
            const a = easeOut(Math.min(Math.max(local / 0.3, 0), 1));
            if (a <= 0) break;
            const prev = i === 0 ? geom.headBottom : geom.rows[i - 1];
            h = prev + (geom.rows[i] - prev) * a;
          }
          card.style.height = h + 'px';
          card.style.overflow = 'hidden';
        }
      };
    </script>
  </body></html>`;
}

const ROTATION = require('./rotation');

(async () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const id = process.argv[2];
  const post = queue.posts.find(p => p.id === id);
  if (!post) { console.error(`Пост «${id}» не найден в очереди.`); process.exit(1); }
  if (!post.rows || !post.rows.length) { console.error(`У поста «${id}» нет пар в rows — нечего анимировать.`); process.exit(1); }
  // Лестница кеглей рассчитана до десяти пар; дальше таблица уезжает за кадр,
  // и заметно это станет только в готовом ролике.
  if (post.rows.length > 10) { console.error(`У поста «${id}» ${post.rows.length} пар — больше десяти в кадр не помещается.`); process.exit(1); }

  const bg = ROTATION.chooseBackground(post);
  if (bg) {
    post.background = bg.file;
    post.lightBg = bg.light;
    post.generatedBg = bg.generated;
    console.log(`фон: ${path.basename(bg.file)} (${bg.light ? 'светлый' : 'тёмный'}, ${bg.generated ? 'код' : 'фото'})`);
  }

  const total = INTRO + post.rows.length * ROW_STEP + OUTRO;
  const frames = Math.round(total * FPS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));

  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(post, queue.account));

  // Геометрия карточки снимается один раз, пока все строки стоят в потоке
  // с естественной высотой, — по ней seek() и ведёт рост карточки.
  const geom = await page.evaluate(() => {
    const card = document.querySelector('.card');
    const top = card.getBoundingClientRect().top;
    const padBottom = parseFloat(getComputedStyle(card).paddingBottom) || 0;
    return {
      headBottom: document.querySelector('.head').getBoundingClientRect().bottom - top + padBottom,
      rows: [...document.querySelectorAll('.row')].map(r =>
        r.getBoundingClientRect().bottom - top + padBottom),
    };
  });
  await page.evaluate(g => { window.__geom = g; }, geom);

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
  const track = ROTATION.chooseTrack(id);
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

  if (track) console.log(`музыка: ${track.composer || '?'} — ${track.piece || track.title} (${track.license})`);
  else console.log('музыка: библиотека пуста, дорожка тихая — запустите node fetch-music.js');

  // Выбор фона и музыки записывается в очередь: подпись обязана называть
  // композитора именно той записи, что вшита в видео, — если публикация будет
  // выводить его заново из ротации, любое изменение библиотеки между рендером
  // и публикацией подпишет ролик чужой пьесой.
  {
    const fresh = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
    const qp = fresh.posts.find(p => p.id === id);
    if (qp) {
      qp.background = post.background;
      qp.lightBg = post.lightBg;
      // Обложка в сетке профиля — финальный кадр с полной таблицей (правило
      // автора): без thumb_offset Instagram берёт кадр сам, чаще всего пустой
      // заголовок из первой секунды.
      qp.coverOffsetMs = Math.round((total - 1.0) * 1000);
      if (track) qp.music = { composer: track.composer || '', piece: track.piece || track.title, license: track.license };
      fs.writeFileSync(QUEUE, JSON.stringify(fresh, null, 2) + '\n');
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`\nГотово: ${out} (${total.toFixed(1)} сек, ${mb} МБ)`);
})();
