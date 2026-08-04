#!/usr/bin/env node
/**
 * Программные фоны для Reels — рисуются кодом, без нейросетей и внешних сервисов.
 *
 *   node gen-bg.js            — отрисовать все варианты в content/bg/
 *
 * Варианты:
 *   kletka   — тетрадь в клетку с красным полем
 *   bukvy    — мягкий градиент с большими полупрозрачными буквами
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'content', 'bg');
const W = 1080, H = 1920;

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
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  for (const [name, html] of Object.entries(VARIANTS)) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`);
    const file = path.join(OUT, `fon-${name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    console.log(file);
  }
  await browser.close();
})();
