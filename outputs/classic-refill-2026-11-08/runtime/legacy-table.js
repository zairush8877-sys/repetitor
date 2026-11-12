// Frozen accepted early renderer; sourced from root render-reels.js on 2026-11-03.
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../../..');
const FONTS=require(path.join(ROOT,'fonts'));
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
  const heads = post.heads || ['Неправильно', 'Правильно'];
  const rows = post.rows.map(([bad, good], i) => steps || compare ? `
    <div class="row" id="row${i}">
      <span class="bad">${steps ? `<i class="stepnum">${String(i + 1).padStart(2, '0')}</i>` : ''}${esc(bad)}</span>
      <span class="good">${esc(good)}</span>
    </div>` : `
    <div class="row" id="row${i}">
      <span class="bad"><span class="badtext">${esc(bad)}</span><span class="badstrike" aria-hidden="true">${esc(bad)}</span></span>
      <span class="good">${esc(good)}</span>
    </div>`).join('');

  // С фоном-фотографией заголовок ложится прямо на снимок (белым, с тенью),
  // а таблица — на кремовую карточку, чтобы красный/зелёный оставались читаемыми.
  const bgFile = post.background && path.join(ROOT, post.background);
  // Видеофон: кадры рендерятся с прозрачным телом и накладываются на
  // зацикленный ролик в ffmpeg — стили (карточка, плашки, скрим) как у фото.
  const videoFile = post.videoBg && path.join(ROOT, post.videoBg);
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

module.exports={legacyPageHtml};
