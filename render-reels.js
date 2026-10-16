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
const LIGHT = require('./light-style');

// Палитра системы «Правка» (design/PHILOSOPHY.md): бумага, цвет ошибки
// (землистый, ближе к кирпичу, чем к тревожному красному) и цвет нормы —
// приглушённая хвоя. Больше акцентов в кадре нет.
const PRAVKA = { err: '#8a3a24', ok: '#2f5748', ink: '#211d18', field: 'rgba(33,29,24,.10)' };

const CONTENT = path.resolve(process.env.MEDIA_CONTENT_DIR || path.join(__dirname, 'content'));
const QUEUE = path.join(CONTENT, 'queue.json');
const OUT_DIR = path.join(CONTENT, 'reels');

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

function legacyPageHtml(post, handle) {
  // Режим шагов (post.steps): инструкция, а не работа над ошибками — строки
  // нумеруются и появляются без зачёркивания, вся остальная механика общая.
  const steps = !!post.steps;
  // Режим сравнения (post.heads): две колонки — но не «ошибка → норма».
  // Для «как написано → как прочитали» зачёркивать левую нельзя: там не
  // ошибка, а исходная фраза, и подписи колонок задаёт сам пост.
  const compare = !!post.heads && !steps;
  // Нумерация строк (post.numbered): нужна там, где задание в подписи
  // ссылается на номер — «напишите номер строки, которая не по правилу».
  // Без номеров такой призыв не имеет проверяемого ответа.
  const numbered = steps || !!post.numbered;
  const heads = post.heads || ['Неправильно', 'Правильно'];
  const rows = post.rows.map(([bad, good], i) => steps || compare ? `
    <div class="row" id="row${i}">
      <span class="bad">${numbered ? `<i class="stepnum">${String(i + 1).padStart(2, '0')}</i>` : ''}${esc(bad)}</span>
      <span class="good">${esc(good)}</span>
    </div>` : `
    <div class="row" id="row${i}">
      <span class="bad"><span class="badtext">${esc(bad)}</span><span class="badstrike" aria-hidden="true">${esc(bad)}</span></span>
      <span class="good">${esc(good)}</span>
    </div>`).join('');

  // С фоном-фотографией заголовок ложится прямо на снимок (белым, с тенью),
  // а таблица — на кремовую карточку, чтобы красный/зелёный оставались читаемыми.
  const bgFile = post.background && path.join(__dirname, post.background);
  // Видеофон: кадры рендерятся с прозрачным телом и накладываются на
  // зацикленный ролик в ffmpeg — стили (карточка, плашки, скрим) как у фото.
  const videoFile = post.videoBg && path.join(__dirname, post.videoBg);
  const hasVideoBg = videoFile && fs.existsSync(videoFile);
  const hasPhoto = (bgFile && fs.existsSync(bgFile)) || hasVideoBg;
  // plainBg: бумага «Правки» вместо фотографии — буквы прямо по бежевому,
  // без карточки и плашек (просьба автора для инструкции).
  const bgCss = post.plainBg
    ? `background: radial-gradient(1100px 900px at 30% 18%, #f6f2e9 0%, transparent 62%), #efe9dd`
    : hasVideoBg
    ? `background: transparent`
    : hasPhoto
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
  // Кегль считается не по числу пар, а по числу СТРОК с учётом переносов:
  // колонка вмещает ~16 знаков, длинная сторона занимает две-три строки,
  // и девять пар с переносами не влезали там, где влезали десять коротких.
  const lines = post.rows.reduce(
    (n, r) => n + Math.max(1, Math.ceil(Math.max(r[0].length, r[1].length) / 16)), 0);
  const rowSize = lines >= 15 ? 30 : lines >= 12 ? 34 : lines >= 10 ? 39 : 46;
  const rowPad = rowSize >= 46 ? 21 : rowSize >= 39 ? 15 : rowSize >= 34 ? 12 : 10;
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
      position: relative;
    }
    /* Полоса прогресса: рассеянному вниманию нужен сигнал «конец близко» —
       заполняющаяся полоса поднимает досмотры (разбор виральных механик 19.08). */
    .progress {
      position: absolute; top: 0; left: 0; right: 0; height: 7px;
      background: rgba(33,29,24,.10); overflow: hidden;
      border-radius: ${hasPhoto ? '22px 22px 0 0' : '4px'};
    }
    .progress i { display: block; height: 100%; width: 0; background: ${PRAVKA.err} }
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
    ${compare ? `
    /* Слева исходная фраза — спокойной краской; справа то, как её прочитали,
       и вот это здесь соль, поэтому цвет остаётся акцентным. */
    .bad { color: ${PRAVKA.ink} }
    .h-bad { color: ${PRAVKA.ink} }` : ''}
    ${numbered && !steps ? `
    .stepnum { font-family: ${FONTS.mono()}; font-style: normal; font-weight: 400;
               color: ${PRAVKA.err}; margin-right: 18px }` : ''}
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
      <div class="progress"><i></i></div>
      <div class="head">
        <span class="h-bad">${compare ? '' : '<i class="m-x"></i>'}${esc(heads[0])}</span>
        <span class="h-good">${compare ? '' : '<i class="m-v"></i>'}${esc(heads[1])}</span>
      </div>
      ${rows}</div>
    <div class="foot"><b>@${esc(handle)}</b><span>подготовка к ЕГЭ и ОГЭ</span></div>
    <script>
      const easeOut = x => 1 - Math.pow(1 - x, 3);
      // Фаза внутри строки: появление ошибки → зачёркивание → правильный вариант.
      // Строки всегда в потоке (иначе карточка меняет размер толчками), видимость
      // гасится прозрачностью, а высота карточки следует за появлением строк —
      // без этого она либо прыгает, либо стоит пустым белым полем на весь ролик.
      // Задержка ответа внутри шага строки. По умолчанию 0,5 с — ритм таблицы
      // «неправильно → правильно», где ответ и есть содержание. У теста задача
      // обратная: за полсекунды никто не успевает выбрать, и тест вырождается
      // в чтение. Такой пост ставит revealSeconds больше и шаг строки длиннее.
      const reveal = ${(() => { const r = Number(post.revealSeconds); return Number.isFinite(r) ? r : 0.5; })()};
      window.seek = (t, intro, step) => {
        document.querySelectorAll('.row').forEach((row, i) => {
          const local = t - intro - i * step;
          const appear = easeOut(Math.min(Math.max(local / 0.3, 0), 1));
          row.style.opacity = appear;
          row.style.transform = 'translateY(' + (1 - appear) * 26 + 'px)';
          const strike = easeOut(Math.min(Math.max((local - (reveal - 0.18)) / 0.26, 0), 1));
          const bs = row.querySelector('.badstrike');
          if (bs) bs.style.clipPath = 'inset(-10% ' + (1 - strike) * 100 + '% -10% 0)';
          const good = easeOut(Math.min(Math.max((local - reveal) / 0.28, 0), 1));
          const g = row.querySelector('.good');
          g.style.opacity = good;
          g.style.transform = 'translateX(' + (1 - good) * 22 + 'px)';
        });
        const bar = document.querySelector('.progress i');
        if (bar) {
          const totalT = intro + document.querySelectorAll('.row').length * step + ${Number(post.outroSeconds) || OUTRO};
          bar.style.width = Math.min(100, Math.max(0, t / totalT * 100)) + '%';
        }
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

function pageHtml(post, handle) {
  if (post.visualStyle === 'paper-collage') return require('./paper-collage').reelHtml(post, handle, legacyPageHtml);
  // Фотография занимает отдельный блок. Ни затемняющей плёнки, ни растяжения.
  const selected = LIGHT.photo(post.id);
  const copy = { ...post, background: selected?.file, lightBg: true, videoBg: undefined };
  return legacyPageHtml(copy, handle).replace('</style>', `
    body{background:#fcfbf7!important;padding:300px 72px 570px!important}
    body::before{display:none!important}
    .title{font-size:70px!important;line-height:1.15!important;margin-bottom:30px!important}
    .kicker{font-size:25px!important;letter-spacing:.08em!important;margin-bottom:26px!important}
    .plate{background:none!important;padding:0!important;box-decoration-break:initial!important}
    .card{background:#fff!important;box-shadow:none!important;border:1px solid #dbe5db;padding:24px 30px 20px!important;flex-shrink:0!important}
    .row,.head{flex-shrink:0!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
    ${post.numbered ? `
    /* Номер строки съедает начало левой колонки, и пара вариантов начинает
       переноситься там, где без номера помещалась. Левой колонке отдаём
       больше: справа всё равно стоит одно короткое слово-ответ. */
    .row,.head{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)!important}` : ''}
    .bad,.good{overflow-wrap:anywhere}
    .head{letter-spacing:.06em!important;font-size:24px!important}
    .foot,.foot *{color:#526a60!important;text-shadow:none!important}
    .photo{position:absolute;left:72px;right:72px;bottom:270px;height:270px;background:#eef2eb;border-radius:12px;overflow:hidden;display:flex;justify-content:center}
    .photo img{width:100%;height:100%;object-fit:contain}
  </style>`).replace('<body>', `<body>${LIGHT.photoHtml(selected)}`);
}

if (require.main === module) (async () => {
  if (!process.env.MEDIA_BUILD_INTERNAL && !process.argv.includes('--frame')) {
    if (!process.argv[2]) throw new Error('Укажите конкретный ID Reels.');
    return require('./build-media').main(process.argv.slice(2));
  }
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const id = process.argv[2];
  const post = queue.posts.find(p => p.id === id);
  if (!post) { console.error(`Пост «${id}» не найден в очереди.`); process.exit(1); }
  if (!post.rows || !post.rows.length) { console.error(`У поста «${id}» нет пар в rows — нечего анимировать.`); process.exit(1); }
  // Лестница кеглей рассчитана до десяти пар; дальше таблица уезжает за кадр,
  // и заметно это станет только в готовом ролике.
  if (post.rows.length > 10) { console.error(`У поста «${id}» ${post.rows.length} пар — больше десяти в кадр не помещается.`); process.exit(1); }

  const videoBgFile = post.videoBg && path.join(__dirname, post.videoBg);
  const useVideoBg = false; // Тёмные видеофоны сохранены в архиве; новая подача — реальное фото.
  const bg = post.visualStyle === 'paper-collage' ? { ...require('./paper-collage').photo(post.photo), light: true, generated: false } : post.plainBg || useVideoBg ? null : ROTATION.chooseBackground(post);
  if (bg) {
    post.background = bg.file;
    post.lightBg = bg.light;
    post.generatedBg = bg.generated;
    console.log(`фон: ${path.basename(bg.file)} (${bg.light ? 'светлый' : 'тёмный'}, ${bg.generated ? 'код' : 'фото'})`);
  }

  const rowStep = post.rowSeconds ?? ROW_STEP;
  const outro = post.outroSeconds ?? OUTRO;
  if (![rowStep, outro].every(n => Number.isFinite(n) && n >= .5 && n <= 10)) throw new Error('rowSeconds/outroSeconds: допустимо от 0.5 до 10 секунд.');
  // Ответ, который появляется позже конца шага, не появится вовсе: следующая
  // строка уже пошла. Поэтому задержка проверяется относительно шага.
  const reveal = post.revealSeconds ?? 0.5;
  if (!(Number.isFinite(reveal) && reveal >= .2 && reveal <= rowStep - .3)) {
    throw new Error(`revealSeconds: допустимо от 0.2 до ${(rowStep - .3).toFixed(2)} при шаге строки ${rowStep} с.`);
  }
  const total = INTRO + post.rows.length * rowStep + outro;
  const frames = Math.round(total * FPS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));

  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    LIGHT.browserOptions());
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(post, queue.account));
  await LIGHT.fitReelContent(page);

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
      [total - 0.1, INTRO, rowStep]);
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
      [f / FPS, INTRO, rowStep]);
    await page.screenshot({ path: path.join(tmp, `f${String(f).padStart(4, '0')}.png`), omitBackground: useVideoBg });
    if (f % 60 === 0) console.log(`кадр ${f}/${frames}`);
  }
  // Every video build also exports the exact full final frame used by Stories.
  await page.evaluate(([t, intro, step]) => window.seek(t, intro, step), [total - .1, INTRO, rowStep]);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${id}-frame.jpg`), type: 'jpeg', quality: 92 });
  await browser.close();
  const out = path.join(OUT_DIR, `${id}.mp4`);

  // Без музыки ролик в ленте звучит как сбой звука, поэтому дорожка обязательна.
  // Если библиотека пуста, кладём тишину — это хуже, но лучше, чем упасть.
  const track = ROTATION.chooseTrack(id);
  const audioIn = track
    ? ['-i', path.join(__dirname, 'content', 'music', track.file)]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];

  // Обрыв на полуслове слышен как брак, поэтому в конце уводим громкость.
  const fade = `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2`;

  // Видеофон: ролик зацикливается и кадрируется под 1080×1920, поверх него
  // ложатся PNG-кадры с прозрачным телом (карточка, плашки, скрим — в них).
  const videoBgArgs = useVideoBg
    ? ['-stream_loop', '-1', '-i', videoBgFile]
    : [];
  execFileSync(ffmpeg, [
    '-y',
    ...videoBgArgs,
    '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
    ...audioIn,
    ...(useVideoBg ? [
      '-filter_complex',
      `[0:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg];[bg][1:v]overlay=0:0:shortest=1[v]`,
      '-map', '[v]', '-map', '2:a',
    ] : []),
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
      if (track) qp.music = LIGHT.musicMeta(track);
      fs.writeFileSync(QUEUE, JSON.stringify(fresh, null, 2) + '\n');
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`\nГотово: ${out} (${total.toFixed(1)} сек, ${mb} МБ)`);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { pageHtml, legacyPageHtml, INTRO, ROW_STEP, OUTRO };
