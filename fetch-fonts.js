#!/usr/bin/env node
/**
 * Шрифты для рендера — скачиваются один раз и лежат в репозитории.
 *
 *   node fetch-fonts.js
 *
 * Рендер идёт в headless-Chromium, где из кириллических шрифтов есть почти
 * только DejaVu: без своих файлов заголовки везде выходят одним и тем же
 * системным начертанием. Поэтому нужные семейства кладём рядом и подключаем
 * в разметку как data URI.
 *
 * Что берём и почему:
 *   Golos Text — гротеск ParaType, рисовался под кириллицу, хорошо держит
 *                мелкий кегль на телефоне; идёт в заголовки и кикеры;
 *   Manrope    — нейтральный гротеск для длинных строк таблицы;
 *   Caveat     — почерк, только на пометки и стрелки, никогда на текст.
 *
 * Все три под OFL: использовать в коммерческом контенте можно, указывать
 * авторство в подписи не требуется.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, 'assets', 'fonts');

// woff2 отдаётся только современным браузерам: со старым User-Agent Google
// присылает ttf, который весит втрое больше.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const FAMILIES = [
  { name: 'Golos Text', spec: 'Golos+Text:wght@500;600;700', slug: 'golos' },
  { name: 'Manrope', spec: 'Manrope:wght@400;600;700', slug: 'manrope' },
  { name: 'Caveat', spec: 'Caveat:wght@600', slug: 'caveat' },
];

function get(url, extra = []) {
  return execFileSync('curl', ['-sSL', '--max-time', '60', '-A', UA, ...extra, url],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];

  for (const fam of FAMILIES) {
    const css = get(`https://fonts.googleapis.com/css2?family=${fam.spec}&display=swap`).toString('utf8');

    // В одном ответе несколько @font-face: по одному на диапазон символов.
    // Кириллических подмножеств два, и «cyrillic-ext» — это редкие буквы других
    // языков, весит пару килобайт и русского текста не покрывает. Нужен ровно
    // основной блок с U+0400–045F, иначе в макете вместо букв будут квадраты.
    const blocks = css.split('@font-face').slice(1);
    const byWeight = new Map();
    for (const b of blocks) {
      const range = (b.match(/unicode-range:\s*([^;]+)/i) || [])[1] || '';
      const isMainCyrillic = /U\+04(00|01)-045F/i.test(range);
      if (range && !isMainCyrillic) continue;
      const w = (b.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
      byWeight.set(w, b);
    }

    for (const block of byWeight.values()) {
      const weight = (block.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
      const url = (block.match(/src:\s*url\(([^)]+)\)/) || [])[1];
      if (!url) continue;
      const ext = path.extname(url).replace('.', '') || 'woff2';
      const file = `${fam.slug}-${weight}.${ext}`;
      const dest = path.join(OUT, file);
      if (fs.existsSync(dest)) { continue; }

      fs.writeFileSync(dest, get(url));
      manifest.push({ family: fam.name, weight: Number(weight), file, format: ext });
      console.log(`${fam.name} ${weight}  →  ${file} (${(fs.statSync(dest).size / 1024).toFixed(0)} КБ)`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'index.json'),
    JSON.stringify({ fonts: manifest, license: 'SIL Open Font License 1.1' }, null, 2) + '\n');
  console.log(`\nФайлов: ${manifest.length}`);
})();
