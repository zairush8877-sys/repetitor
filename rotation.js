/**
 * Общая ротация фонов и музыки для всех рендеров.
 *
 * Выбор ведётся хешем от id: у каждого поста свой вариант, но повторный рендер
 * того же поста всегда даёт тот же результат. Раньше у каждого рендера была
 * своя копия этой логики, и копии успели разойтись: рендер статики солил хеш
 * иначе, чем рендер Reels (один и тот же пост получал разные фоны в ленте
 * и в видео), а поле generated из content/bg/index.json понимал только один
 * из трёх потребителей.
 */

const fs = require('fs');
const path = require('path');

const BG_INDEX = path.join(__dirname, 'content', 'bg', 'index.json');
const MUSIC_DIR = path.join(__dirname, 'content', 'music');

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

function pickFrom(list, key) {
  return list[hash(key) % list.length];
}

function backgrounds() {
  if (!fs.existsSync(BG_INDEX)) return [];
  const list = JSON.parse(fs.readFileSync(BG_INDEX, 'utf8')).backgrounds || [];
  // Правило автора — «нужно разнообразие»: фотографии из её папки идут чаще
  // (каждая учтена дважды), но между ними попадаются и рисованные фоны —
  // лента не сливается ни в сплошные снимки, ни в сплошную графику.
  const photos = list.filter(b => path.basename(b.file).startsWith('foto-'));
  return photos.length ? [...photos, ...photos, ...list.filter(b => !photos.includes(b))] : list;
}

/**
 * Фон поста: закреплённый вручную или из ротации.
 *
 * generated означает «нарисован кодом»: такой фон построен под текст, и
 * затемняющая плёнка ему не нужна. Фотографии с тёмными участками плёнка
 * нужна — без неё светлый заголовок тонет в ярком пятне снимка.
 *
 * Закреплённый фон ищется в индексе, а не описывается заново с полей поста:
 * иначе один и тот же файл получает разные свойства в зависимости от того,
 * пришёл он из ротации или был закреплён. Неизвестный файл считается
 * фотографией: лишняя плёнка видна на превью и чинится сразу, а пропавшая
 * обнаруживается только в опубликованном ролике.
 */
function chooseBackground(post) {
  const list = backgrounds();
  if (post.background) {
    const meta = list.find(b => b.file === post.background);
    return {
      file: post.background,
      light: meta ? meta.light : !!post.lightBg,
      generated: meta ? meta.generated === true : false,
    };
  }
  if (!list.length) return null;
  const bg = pickFrom(list, post.id + 'bg');
  return { ...bg, generated: bg.generated === true };
}

/** Фрагмент классики: свой у каждого id, постоянный между рендерами. */
function chooseTrack(id, salt = 'music') {
  const idx = path.join(MUSIC_DIR, 'index.json');
  if (!fs.existsSync(idx)) return null;
  const list = (JSON.parse(fs.readFileSync(idx, 'utf8')).tracks || [])
    .filter(t => fs.existsSync(path.join(MUSIC_DIR, t.file)));
  return list.length ? pickFrom(list, id + salt) : null;
}

module.exports = { hash, pickFrom, chooseBackground, chooseTrack, MUSIC_DIR };
