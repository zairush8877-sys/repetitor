#!/usr/bin/env node
/**
 * Программные фоны для Reels — рисуются кодом, без нейросетей и внешних сервисов.
 *
 *   node gen-bg.js            — отрисовать все варианты в content/bg/
 *
 * Варианты:
 *   kletka   — тетрадь в клетку с красным полем
 *   bukvy    — мягкий градиент с большими полупрозрачными буквами
 *   jade     — приглушённый зелёный между мятой и хаки
 *   lavanda  — пудровая лаванда с серым подтоном
 *   nebo     — холодный бледно-голубой
 *   sliva    — тёмный сливовый: в светлой ленте конкурентов заметен сразу
 *   ugolok   — однотонное поле с уголком тетрадного листа
 *
 * Рядом пишется content/bg/index.json: там для каждого фона указано, светлый он
 * или тёмный. Без этого рендер не знает, каким цветом ставить заголовок, и на
 * тёмном фоне тёмный текст пропадает.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'content', 'bg');
const W = 1080, H = 1920;

/** Мягкое пятно света, чтобы заливка не читалась как плоский цвет из палитры. */
const glow = (color, x, y, r) =>
  `radial-gradient(${r}px ${r}px at ${x}px ${y}px, ${color}, transparent 70%)`;

const VARIANTS = {
  // Школьная тетрадь: клетка 54px, красная линия поля, бумажный оттенок
  kletka: `<body style="margin:0;width:${W}px;height:${H}px;
    background:
      linear-gradient(90deg, transparent 148px, rgba(214,84,72,.55) 148px, rgba(214,84,72,.55) 152px, transparent 152px),
      repeating-linear-gradient(0deg, transparent 0, transparent 53px, rgba(112,146,190,.28) 53px, rgba(112,146,190,.28) 54px),
      repeating-linear-gradient(90deg, transparent 0, transparent 53px, rgba(112,146,190,.28) 53px, rgba(112,146,190,.28) 54px),
      linear-gradient(160deg, #fbfaf6 0%, #f4f1e8 60%, #efe9dc 100%);
  "></body>`,

  // Градиент с буквами: тёплый персиково-кремовый, крупные буквы едва заметны
  bukvy: `<body style="margin:0;width:${W}px;height:${H}px;position:relative;overflow:hidden;
    background: linear-gradient(165deg, #fdf3e7 0%, #f9e8d8 45%, #f3ddca 100%);
    font-family: Georgia, serif;">
    ${[
      ['Ё', 90, -40, 380, .05], ['Ъ', 700, 60, 460, .045], ['Щ', -60, 1450, 520, .05],
      ['Й', 780, 1520, 400, .045], ['Ж', 420, 820, 300, .03], ['Ф', 60, 700, 240, .035],
    ].map(([ch, x, y, size, op]) =>
      `<div style="position:absolute;left:${x}px;top:${y}px;font-size:${size}px;
        font-weight:700;color:rgba(140,63,43,${op});line-height:1">${ch}</div>`).join('')}
  </body>`,

  // Приглушённый зелёный между мятой и хаки: спокойный, но не «леденцовый»
  jade: `<body style="margin:0;width:${W}px;height:${H}px;
    background: ${glow('rgba(255,255,255,.55)', 300, 420, 900)},
                ${glow('rgba(140,158,132,.35)', 850, 1500, 800)},
                linear-gradient(155deg, #dfe6d8 0%, #cbd6c2 55%, #b9c6ae 100%);
  "></body>`,

  // Пудровая лаванда с серым подтоном — пастель без конфетности
  lavanda: `<body style="margin:0;width:${W}px;height:${H}px;
    background: ${glow('rgba(255,255,255,.6)', 780, 350, 850)},
                ${glow('rgba(150,133,168,.28)', 200, 1550, 800)},
                linear-gradient(160deg, #ece7f1 0%, #ddd5e6 55%, #cfc5db 100%);
  "></body>`,

  // Холодный бледно-голубой: самый светлый вариант, максимум контраста под текст
  nebo: `<body style="margin:0;width:${W}px;height:${H}px;
    background: ${glow('rgba(255,255,255,.7)', 540, 300, 1000)},
                ${glow('rgba(120,170,205,.25)', 900, 1600, 750)},
                linear-gradient(165deg, #eaf5fd 0%, #d7edfb 55%, #c4e2f6 100%);
  "></body>`,

  // Тёмный сливовый: лента ниши почти сплошь светлая, поэтому такой кадр
  // останавливает скролл сам по себе. Заголовок на нём — светлый.
  sliva: `<body style="margin:0;width:${W}px;height:${H}px;
    background: ${glow('rgba(120,70,95,.5)', 300, 400, 950)},
                ${glow('rgba(60,40,70,.6)', 900, 1550, 900)},
                linear-gradient(155deg, #3d2230 0%, #2c1a26 55%, #22141d 100%);
  "></body>`,

  // Однотонное поле, а тетрадный лист — деталью в углу: под текстом клетка
  // съедает контраст, а как акцент читается сразу и не мешает.
  ugolok: `<body style="margin:0;width:${W}px;height:${H}px;position:relative;overflow:hidden;
    background: linear-gradient(160deg, #faf7f1 0%, #f2ece1 60%, #eae2d3 100%);">
    <div style="position:absolute;right:-90px;top:-120px;width:560px;height:640px;
      transform:rotate(9deg);border-radius:8px;box-shadow:0 24px 60px rgba(90,70,45,.16);
      background:
        linear-gradient(90deg, transparent 60px, rgba(214,84,72,.4) 60px, rgba(214,84,72,.4) 63px, transparent 63px),
        repeating-linear-gradient(0deg, transparent 0, transparent 43px, rgba(112,146,190,.3) 43px, rgba(112,146,190,.3) 44px),
        repeating-linear-gradient(90deg, transparent 0, transparent 43px, rgba(112,146,190,.3) 43px, rgba(112,146,190,.3) 44px),
        #fffdf8;"></div>
    <div style="position:absolute;left:-140px;bottom:-180px;width:620px;height:700px;
      transform:rotate(-7deg);border-radius:8px;box-shadow:0 -18px 50px rgba(90,70,45,.12);
      background:
        repeating-linear-gradient(0deg, transparent 0, transparent 43px, rgba(112,146,190,.22) 43px, rgba(112,146,190,.22) 44px),
        #fffdf8;"></div>
  </body>`,
};

// Тёмные фоны требуют светлого заголовка, светлые — тёмного. Список ведём здесь,
// рядом с самими фонами, иначе он рассинхронизируется при следующей правке.
const DARK = new Set(['sliva']);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  const made = [];
  for (const [name, html] of Object.entries(VARIANTS)) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`);
    const file = path.join(OUT, `fon-${name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    made.push({ file: `content/bg/fon-${name}.jpg`, light: !DARK.has(name) });
    console.log(`${DARK.has(name) ? 'тёмный ' : 'светлый'}  ${file}`);
  }
  await browser.close();

  // Снятые вручную фоны-фотографии рендер тоже должен видеть в ротации.
  const PHOTO = { 'fon-mint.jpg': true, 'fon-desk.jpg': true, 'fon-interior.jpg': true };
  for (const [f, light] of Object.entries(PHOTO)) {
    if (fs.existsSync(path.join(OUT, f))) made.push({ file: `content/bg/${f}`, light });
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ backgrounds: made }, null, 2) + '\n');
  console.log(`\nВ ротации фонов: ${made.length}`);
})();
