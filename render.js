#!/usr/bin/env node
/**
 * Рендер картинок для постов из content/queue.json.
 *
 *   node render.js            — отрисовать все посты со статусом pending и approved
 *   node render.js <id>       — отрисовать один пост
 *
 * На выходе:
 *   content/images/<id>-1.jpg ... — слайды 1080×1350 (формат 4:5, подходит и для ленты, и для API)
 *   content/preview.html          — страница для одобрения: все посты со слайдами и подписями
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const QUEUE = path.join(__dirname, 'content', 'queue.json');
const IMAGES = path.join(__dirname, 'content', 'images');

const W = 1080, H = 1350;

const PALETTE = {
  bg: '#fbf8f3',
  ink: '#1f1d1a',
  muted: '#8a8377',
  accent: '#8c3f2b',
  accentSoft: '#f6ece7',
  right: '#2f6f4f',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = s => esc(s).replace(/\n/g, '<br>');

/** Размер шрифта подбирается под длину текста, чтобы слайд не переполнялся. */
function fontSize(text) {
  const len = text.replace(/\n/g, '').length;
  if (len <= 20) return 96;
  if (len <= 40) return 76;
  if (len <= 70) return 62;
  if (len <= 110) return 52;
  return 44;
}

/** Общая обвязка слайда: подложка, кикер, футер с ником и точками. */
function frame({ body, kicker, bg, fg, accentColor, kickerColor, dotBg, dotOn, index, total, handle, extraCss = '' }) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    @page { margin: 0 }
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px;
      background: ${bg}; color: ${fg};
      font-family: Georgia, "Times New Roman", serif;
      display: flex; flex-direction: column;
      padding: 90px 80px;
      position: relative; overflow: hidden;
    }
    .kicker {
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 30px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: ${kickerColor}; margin-bottom: 40px; min-height: 36px;
    }
    .mark { font-size: 84px; line-height: 1; margin-bottom: 32px; color: ${accentColor} }
    .foot {
      display: flex; justify-content: space-between; align-items: flex-end;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 26px; color: ${PALETTE.muted};
    }
    .dots { display: flex; gap: 10px; align-items: center }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: ${dotBg} }
    .dot.on { background: ${dotOn} }
    ${extraCss}
  </style></head><body>
    <div class="kicker">${esc(kicker || '')}</div>
    ${body}
    <div class="foot">
      <span>@${esc(handle)}</span>
      ${total > 1 ? `<span class="dots">${Array.from({ length: total }, (_, i) =>
        `<span class="dot${i === index ? ' on' : ''}"></span>`).join('')}</span>` : ''}
    </div>
  </body></html>`;
}

/**
 * Слайд-таблица «говорят → правильно». Формат, который лучше всего расходится
 * репостами: один экран, всё видно сразу, никуда не надо листать.
 * Задаётся полем rows: [["Ложат", "Кладут"], ...]
 */
function tableHtml(slide, index, total, handle) {
  const rows = slide.rows || [];
  // Чем больше строк, тем мельче шрифт — таблица должна уместиться целиком
  const size = rows.length <= 6 ? 46 : rows.length <= 8 ? 40 : rows.length <= 10 ? 35 : 30;

  const body = `
    <div class="title">${nl2br(slide.text || '')}</div>
    <table>${rows.map(([bad, good]) => `<tr>
      <td class="bad">${esc(bad)}</td>
      <td class="arrow">→</td>
      <td class="good">${esc(good)}</td>
    </tr>`).join('')}</table>`;

  return frame({
    body, kicker: slide.kicker, bg: PALETTE.bg, fg: PALETTE.ink,
    accentColor: PALETTE.accent, kickerColor: PALETTE.accent,
    dotBg: '#ded6c8', dotOn: PALETTE.accent,
    index, total, handle,
    extraCss: `
      .title { font-size: 44px; line-height: 1.2; font-weight: 700; margin-bottom: 36px }
      table { flex: 1; width: 100%; border-collapse: collapse; font-size: ${size}px }
      td { padding: ${size > 34 ? 14 : 10}px 0; border-bottom: 1px solid #e5ded1; vertical-align: middle }
      .bad { color: ${PALETTE.accent}; text-decoration: line-through;
             text-decoration-thickness: 2px; width: 44% }
      .arrow { color: ${PALETTE.muted}; text-align: center; width: 12%; font-size: ${size - 6}px }
      .good { color: ${PALETTE.right}; font-weight: 700; width: 44% }
      tr:last-child td { border-bottom: none }`,
  });
}

function slideHtml(slide, index, total, handle) {
  if (slide.layout === 'table') return tableHtml(slide, index, total, handle);
  const mark = slide.mark;
  const badge =
    mark === 'wrong' ? `<div class="mark wrong">✕</div>` :
    mark === 'right' ? `<div class="mark right">✓</div>` : '';
  const accentColor = mark === 'right' ? PALETTE.right : PALETTE.accent;

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    @page { margin: 0 }
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      width: ${W}px; height: ${H}px;
      background: ${mark === 'cta' ? PALETTE.accent : PALETTE.bg};
      color: ${mark === 'cta' ? '#fff' : PALETTE.ink};
      font-family: Georgia, "Times New Roman", serif;
      display: flex; flex-direction: column;
      padding: 90px 80px;
      position: relative; overflow: hidden;
    }
    .kicker {
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 30px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: ${mark === 'cta' ? 'rgba(255,255,255,.75)' : accentColor};
      margin-bottom: 40px; min-height: 36px;
    }
    .mark {
      font-size: 84px; line-height: 1; margin-bottom: 32px;
      color: ${mark === 'wrong' ? PALETTE.accent : PALETTE.right};
    }
    .text {
      flex: 1; display: flex; align-items: center;
      font-size: ${fontSize(slide.text)}px; line-height: 1.28; font-weight: 600;
    }
    .foot {
      display: flex; justify-content: space-between; align-items: flex-end;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 26px;
      color: ${mark === 'cta' ? 'rgba(255,255,255,.7)' : PALETTE.muted};
    }
    .dots { display: flex; gap: 10px; align-items: center }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: ${mark === 'cta' ? 'rgba(255,255,255,.35)' : '#ded6c8'} }
    .dot.on { background: ${mark === 'cta' ? '#fff' : accentColor} }
  </style></head><body>
    <div class="kicker">${esc(slide.kicker || '')}</div>
    ${badge}
    <div class="text">${nl2br(slide.text)}</div>
    <div class="foot">
      <span>@${esc(handle)}</span>
      ${total > 1 ? `<span class="dots">${Array.from({ length: total }, (_, i) =>
        `<span class="dot${i === index ? ' on' : ''}"></span>`).join('')}</span>` : ''}
    </div>
  </body></html>`;
}

function previewHtml(queue, rendered) {
  // Картинки вшиваются в страницу как data URI — превью можно открыть где угодно,
  // включая телефон, без папки images рядом.
  const dataUri = f => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;

  const card = p => {
    const imgs = (rendered[p.id] || []).map((f, i) =>
      `<img src="${dataUri(f)}" alt="слайд ${i + 1}">`).join('');
    const label = { pending: 'ждёт одобрения', approved: 'одобрен', published: 'опубликован', rejected: 'отклонён' };
    const day = new Date(p.date + 'T00:00:00');
    const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    return `<article class="post ${esc(p.status)}">
      <header>
        <div class="when">
          <span class="date">${day.getDate()} ${MON[day.getMonth()]}</span>
          <span class="dow">${DAYS[day.getDay()]}</span>
        </div>
        <div class="meta">
          <span class="rubric">${esc(p.rubric)}</span>
          <span class="format">${esc(p.format)}</span>
        </div>
        <span class="status">${label[p.status] || esc(p.status)}</span>
      </header>
      ${imgs ? `<div class="slides">${imgs}</div>` : ''}
      ${p.script ? `<section class="script"><h3>Сценарий</h3><pre>${esc(p.script)}</pre></section>` : ''}
      <section class="caption"><h3>Подпись</h3><p>${nl2br(p.caption)}</p>
        <p class="tags">${esc((p.hashtags || []).join(' '))}</p></section>
    </article>`;
  };

  const counts = queue.posts.reduce((a, p) => (a[p.status] = (a[p.status] || 0) + 1, a), {});
  const summary = [
    counts.pending && `${counts.pending} ждёт одобрения`,
    counts.approved && `${counts.approved} одобрено`,
    counts.published && `${counts.published} опубликовано`,
  ].filter(Boolean).join(' · ');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Очередь постов — @${esc(queue.account)}</title><style>
    :root {
      --ground: #eceef1;
      --card: #ffffff;
      --ink: #191c21;
      --muted: #646b78;
      --line: #d9dde3;
      --accent: #3a5f8a;
      --pending-bg: #fbf0da; --pending-fg: #8a6000;
      --ok-bg: #dff0e6;      --ok-fg: #23624a;
      --pub-bg: #e2eaf5;     --pub-fg: #2f5488;
      --no-bg: #f6e0dc;      --no-fg: #8f3d2c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ground: #131519; --card: #1c1f25; --ink: #e8eaee; --muted: #949cab;
        --line: #2c313a; --accent: #7ba4d6;
        --pending-bg: #3a2f14; --pending-fg: #e6c179;
        --ok-bg: #16332a;     --ok-fg: #7fcfa6;
        --pub-bg: #1b2a42;    --pub-fg: #97bbe9;
        --no-bg: #3a201b;     --no-fg: #e09384;
      }
    }
    :root[data-theme="dark"] {
      --ground: #131519; --card: #1c1f25; --ink: #e8eaee; --muted: #949cab;
      --line: #2c313a; --accent: #7ba4d6;
      --pending-bg: #3a2f14; --pending-fg: #e6c179;
      --ok-bg: #16332a;     --ok-fg: #7fcfa6;
      --pub-bg: #1b2a42;    --pub-fg: #97bbe9;
      --no-bg: #3a201b;     --no-fg: #e09384;
    }
    :root[data-theme="light"] {
      --ground: #eceef1; --card: #ffffff; --ink: #191c21; --muted: #646b78;
      --line: #d9dde3; --accent: #3a5f8a;
      --pending-bg: #fbf0da; --pending-fg: #8a6000;
      --ok-bg: #dff0e6;      --ok-fg: #23624a;
      --pub-bg: #e2eaf5;     --pub-fg: #2f5488;
      --no-bg: #f6e0dc;      --no-fg: #8f3d2c;
    }

    * { box-sizing: border-box }
    body {
      margin: 0; background: var(--ground); color: var(--ink);
      font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 860px; margin: 0 auto; padding: 40px 20px 64px;
      display: flex; flex-direction: column; gap: 18px }

    .top { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px }
    h1 { font-size: 24px; font-weight: 650; letter-spacing: -.01em; margin: 0 }
    .top p { margin: 0; color: var(--muted); font-size: 15px }
    .top .counts { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums }

    .post {
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      padding: 20px; display: flex; flex-direction: column; gap: 16px;
    }
    .post header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap }
    .when { display: flex; align-items: baseline; gap: 7px; font-variant-numeric: tabular-nums }
    .date { font-size: 17px; font-weight: 650 }
    .dow { color: var(--muted); font-size: 14px }
    .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      color: var(--muted); font-size: 14px; margin-right: auto }
    .rubric { color: var(--ink); font-weight: 550 }
    .format::before { content: "·"; margin-right: 8px }
    .status {
      font-size: 12.5px; font-weight: 650; letter-spacing: .02em;
      padding: 4px 11px; border-radius: 999px; white-space: nowrap;
    }
    .pending .status  { background: var(--pending-bg); color: var(--pending-fg) }
    .approved .status { background: var(--ok-bg);      color: var(--ok-fg) }
    .published .status{ background: var(--pub-bg);     color: var(--pub-fg) }
    .rejected .status { background: var(--no-bg);      color: var(--no-fg) }

    .slides { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px;
      scroll-snap-type: x mandatory }
    .slides img { width: 178px; flex: 0 0 auto; border-radius: 8px;
      border: 1px solid var(--line); scroll-snap-align: start }

    h3 { font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--muted); margin: 0 0 8px }
    .caption, .script { border-top: 1px solid var(--line); padding-top: 16px }
    .caption p { margin: 0; white-space: pre-wrap; max-width: 62ch }
    .tags { color: var(--accent); margin-top: 10px !important; font-size: 15px }
    .script pre { margin: 0; white-space: pre-wrap; font: inherit; color: var(--muted) }
  </style></head><body>
    <div class="wrap">
      <div class="top">
        <h1>Очередь постов</h1>
        <p>Аккаунт @${esc(queue.account)}</p>
        <p class="counts">${esc(summary)}</p>
        <p>Напишите, какие посты одобряете, — Claude проставит статусы и подготовит публикацию.</p>
      </div>
      ${queue.posts.map(card).join('')}
    </div>
  </body></html>`;
}

(async () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const only = process.argv[2];
  const targets = queue.posts.filter(p =>
    only ? p.id === only : p.status === 'pending' || p.status === 'approved');

  if (targets.length === 0) {
    console.log(only ? `Пост «${only}» не найден.` : 'Нечего рендерить: нет постов со статусом pending или approved.');
    return;
  }

  fs.mkdirSync(IMAGES, { recursive: true });
  // В этом окружении Chromium предустановлен отдельно от версии, которую ждёт playwright
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const rendered = {};

  for (const post of targets) {
    rendered[post.id] = [];
    const total = post.slides.length;
    for (let i = 0; i < total; i++) {
      await page.setContent(slideHtml(post.slides[i], i, total, queue.account));
      const file = path.join(IMAGES, `${post.id}-${i + 1}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
      rendered[post.id].push(file);
    }
    console.log(`${post.id}: ${total} слайд(ов)`);
  }

  await browser.close();

  // Превью строим по всей очереди, но картинки показываем только у отрисованных
  for (const p of queue.posts) {
    if (!rendered[p.id]) {
      rendered[p.id] = (p.slides || []).map((_, i) =>
        path.join(IMAGES, `${p.id}-${i + 1}.jpg`)).filter(fs.existsSync);
    }
  }
  fs.writeFileSync(path.join(__dirname, 'content', 'preview.html'), previewHtml(queue, rendered));

  console.log(`\nГотово. Откройте content/preview.html — там все посты со слайдами и подписями.`);
})();
