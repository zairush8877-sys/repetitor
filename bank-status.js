#!/usr/bin/env node
/**
 * Состояние банков контента: на сколько дней хватит автопостинга.
 *
 *   node bank-status.js          — сводка
 *   node bank-status.js --warn   — код возврата 1, если банк кончается (для CI)
 *
 * Автопост публикует одну ленточную публикацию и одну сторис в день,
 * поэтому «дней» здесь равно числу оставшихся единиц контента.
 */

const fs = require('fs');
const path = require('path');

const LOW = 3; // за сколько дней предупреждать

const queue = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'queue.json'), 'utf8'));
const stories = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'stories.json'), 'utf8'));

const feed = queue.posts.filter(p => p.status === 'approved');
const feedReels = feed.filter(p => p.format === 'Reels').length;
const feedPosts = feed.length - feedReels;
const storiesLeft = stories.stories.filter(s => s.status !== 'published').length;

const fmt = (n, one, few, many) => {
  const m = n % 100, k = n % 10;
  if (m >= 11 && m <= 14) return many;
  if (k === 1) return one;
  if (k >= 2 && k <= 4) return few;
  return many;
};

console.log(`Лента:  ${feed.length} ${fmt(feed.length, 'публикация', 'публикации', 'публикаций')} (${feedReels} Reels, ${feedPosts} постов) — на ${feed.length} ${fmt(feed.length, 'день', 'дня', 'дней')}`);
console.log(`Сторис: ${storiesLeft} ${fmt(storiesLeft, 'штука', 'штуки', 'штук')} — на ${storiesLeft} ${fmt(storiesLeft, 'день', 'дня', 'дней')}`);

const low = [];
if (feed.length <= LOW) low.push(`лента (${feed.length})`);
if (storiesLeft <= LOW) low.push(`сторис (${storiesLeft})`);

if (low.length) {
  console.log(`\n⚠ Заканчивается: ${low.join(', ')}. Пора пополнить банк через фабрику.`);
  if (process.argv.includes('--warn')) process.exit(1);
} else {
  console.log('\nЗапаса хватает.');
}
