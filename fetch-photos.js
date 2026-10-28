#!/usr/bin/env node
/**
 * Светлые реальные фотографии для нижнего окна кадра.
 *
 *   node fetch-photos.js           — скачать недостающие и дописать индекс
 *   node fetch-photos.js --list    — показать, что уже в каталоге
 *   node fetch-photos.js --force   — перекачать даже готовые файлы
 *
 * До 28.10.2026 активных снимков в assets/photos/index.json было два, и
 * ротация выдавала их по кругу: у всех роликов подряд внизу стоял один и тот
 * же блокнот. Автор попросила менять картинки.
 *
 * Источник — Викисклад, зеркало старых снимков Unsplash, которые выложены
 * под CC0 (отказ от прав). CC0 не требует указания автора в подписи, в
 * отличие от CC BY: подпись остаётся чистой, а автор и ссылка всё равно
 * записываются в индекс — этого требует чек-лист качества. Сам Unsplash и
 * Pexels из этой среды недоступны: поиск у них закрыт авторизацией и
 * защитой от ботов.
 *
 * Викисклад ограничивает частоту запросов, поэтому между загрузками пауза.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'assets/photos');
const INDEX = path.join(DIR, 'index.json');
const CHECKED = '2026-10-28';
const UA = 'mairova-content-bot/1.0 (educational Instagram content; contact zairush8877@gmail.com)';
const WIDTH = 1800;

const PICKS = [
  {
    file: 'typewriter-spratt.jpg',
    commons: 'Desk Top (Unsplash).jpg',
    author: 'Annie Spratt',
    alt: 'Голубая печатная машинка и записная книжка на светлом деревянном столе',
  },
  {
    file: 'books-marriage.jpg',
    commons: 'Laptop on desk book stacks (Unsplash).jpg',
    author: 'Freddie Marriage',
    alt: 'Стопки книг и лампа на письменном столе у белой стены',
  },
  {
    file: 'pencils-dorohovich.jpg',
    commons: 'Books, pencils, laptop, and iphone on a desk (Unsplash).jpg',
    author: 'Aleks Dorohovich',
    alt: 'Раскрытая книга, цветные карандаши и блокнот на тёплом деревянном столе',
  },
  {
    file: 'marble-pineapple.jpg',
    commons: 'Marble work desk (Unsplash).jpg',
    author: 'Pineapple Supply Co.',
    alt: 'Светлый мраморный стол с ноутбуком и очками',
  },
  {
    file: 'tulips-filonchik.jpg',
    commons: 'Tulips on a computer desk (Unsplash).jpg',
    author: 'Alexander Filonchik',
    alt: 'Букет тюльпанов рядом с ноутбуком на рабочем столе',
  },
  {
    file: 'cactus-webb.jpg',
    commons: 'Home desk (Unsplash).jpg',
    author: 'Scott Webb',
    alt: 'Домашний стол у белой стены: ноутбук, рамка и цветущий кактус',
  },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Карточка файла на Викискладе: прямая ссылка на нужную ширину и лицензия. */
async function describe(title) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', titles: `File:${title}`,
    prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: String(WIDTH),
  });
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${title}: HTTP ${response.status}`);
  const pages = Object.values((await response.json()).query?.pages || {});
  const info = pages[0]?.imageinfo?.[0];
  if (!info) throw new Error(`${title}: файла нет на Викискладе`);
  const license = info.extmetadata?.LicenseShortName?.value || '';
  // Лицензия проверяется здесь, а не глазами при отборе: файл на Викискладе
  // могут перелицензировать, и тогда снимок молча уедет в ролик с чужими
  // условиями. CC BY потребовал бы строки с автором в каждой подписи.
  if (!/^CC0|public domain/i.test(license)) throw new Error(`${title}: лицензия ${license}, нужна CC0`);
  return {
    download: info.thumburl || info.url,
    page: info.descriptionurl,
    license: license.startsWith('CC0') ? 'CC0 1.0' : license,
  };
}

async function main() {
  const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : { photos: [] };
  if (process.argv.includes('--list')) {
    for (const p of index.photos) console.log(`${p.active === false ? 'выключено' : 'активно'}: ${p.file} — ${p.author} (${p.license})`);
    return;
  }
  const force = process.argv.includes('--force');
  const photos = index.photos.map(p => ({ ...p }));
  let added = 0;
  for (const pick of PICKS) {
    const file = `assets/photos/${pick.file}`;
    const local = path.join(__dirname, file);
    if (fs.existsSync(local) && !force) { console.log(`Пропуск: ${pick.file} — уже скачан.`); continue; }
    const meta = await describe(pick.commons);
    const response = await fetch(meta.download, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`${pick.file}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 50000) throw new Error(`${pick.file}: скачан слишком маленький файл`);
    fs.writeFileSync(local, bytes);
    const entry = {
      file, author: pick.author, alt: pick.alt,
      source: meta.page, download: meta.download,
      license: meta.license, licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      origin: 'Викисклад, зеркало Unsplash времён CC0',
      checkedAt: CHECKED, active: true,
    };
    const at = photos.findIndex(p => p.file === file);
    if (at >= 0) photos[at] = entry; else photos.push(entry);
    added++;
    console.log(`Готово: ${pick.file}, ${Math.round(bytes.length / 1024)} КБ, ${meta.license}`);
    await sleep(6000);
  }
  if (!added) { console.log('Новых снимков нет; индекс не менялся.'); return; }
  fs.writeFileSync(INDEX, JSON.stringify({ ...index, checkedAt: CHECKED, photos }, null, 2) + '\n');
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { PICKS };
