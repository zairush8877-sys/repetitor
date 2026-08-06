/**
 * Подключение своих шрифтов в разметку рендера.
 *
 * Рендер идёт в headless-Chromium: системных кириллических шрифтов там почти
 * нет, поэтому и заголовки, и таблицы выходили одним и тем же начертанием.
 * Файлы вшиваются как data URI — страница собирается из строки и внешние
 * запросы из неё всё равно не уйдут.
 *
 * Кто за что отвечает:
 *   HEAD — заголовки и кикеры (Golos Text: рисовался под кириллицу);
 *   BODY — строки таблиц и длинный текст (Manrope);
 *   HAND — только пометки и стрелки (Caveat), на текст его ставить нельзя.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'assets', 'fonts');
const INDEX = path.join(DIR, 'index.json');

const HEAD = `'Golos Text'`;
const BODY = `Manrope`;
const HAND = `Caveat`;

// Система «Правка» (design/PHILOSOPHY.md): вещество текста — антиква,
// всё служебное — моноширинный. Контраст между ними и есть контраст между
// речью и её проверкой, поэтому смешивать роли нельзя.
const SERIF = `'IBM Plex Serif'`;
const MONO = `'IBM Plex Mono'`;

// Если файлов нет, макет не должен разваливаться: подставляем то, что найдётся
// в системе. Выглядит хуже, но текст остаётся читаемым.
const FALLBACK_SANS = `-apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
const FALLBACK_SERIF = `Georgia, 'Times New Roman', serif`;

let cached = null;

/** CSS с @font-face для всех скачанных начертаний. Пустая строка, если их нет. */
function fontFaceCss() {
  if (cached !== null) return cached;
  if (!fs.existsSync(INDEX)) {
    cached = '';
    return cached;
  }
  const { fonts } = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  cached = fonts.map(f => {
    const file = path.join(DIR, f.file);
    if (!fs.existsSync(file)) return '';
    const b64 = fs.readFileSync(file).toString('base64');
    const fmt = f.format === 'ttf' ? 'truetype' : f.format;
    return `@font-face{font-family:'${f.family}';font-weight:${f.weight};`
      + `font-style:${f.style || 'normal'};font-display:block;`
      + `src:url(data:font/${f.format};base64,${b64}) format('${fmt}')}`;
  }).join('\n');
  return cached;
}

const head = () => `${HEAD}, ${FALLBACK_SANS}`;
const body = () => `${BODY}, ${FALLBACK_SANS}`;
const hand = () => `${HAND}, ${FALLBACK_SERIF}`;
const serif = () => `${SERIF}, ${FALLBACK_SERIF}`;
const mono = () => `${MONO}, 'DejaVu Sans Mono', 'DejaVu Sans', ui-monospace, monospace`;

module.exports = { fontFaceCss, head, body, hand, serif, mono };
