#!/usr/bin/env node
/**
 * Контент-завод: генератор плана публикаций для Instagram репетитора.
 *
 * Использование:
 *   node factory.js                  — план на 4 недели с сегодняшнего дня
 *   node factory.js 2                — план на 2 недели
 *   node factory.js 4 2026-08-01     — план на 4 недели с 1 августа
 *
 * Результат: content/plan.md (человекочитаемый) и content/plan.json (для автоматизации).
 * Использованные темы запоминаются в content/used-topics.json и не повторяются,
 * пока банк тем не будет исчерпан.
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, 'content');
const USED_FILE = path.join(CONTENT_DIR, 'used-topics.json');

const POSTS_PER_WEEK = 4; // пн, ср, пт + одно «за кадром» на выходных
const POST_DAYS = [1, 3, 5, 6]; // дни недели: пн=1 ... вс=0

const rubricsData = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'rubrics.json'), 'utf8'));
const topicsData = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'topics.json'), 'utf8'));

const weeks = Math.max(1, parseInt(process.argv[2], 10) || 4);
const startArg = process.argv[3];
const start = startArg ? new Date(startArg + 'T00:00:00') : new Date();
if (isNaN(start)) {
  console.error(`Не понимаю дату «${startArg}». Формат: ГГГГ-ММ-ДД, например 2026-08-01.`);
  process.exit(1);
}

// --- Учёт использованных тем ---
let used = {};
if (fs.existsSync(USED_FILE)) {
  try { used = JSON.parse(fs.readFileSync(USED_FILE, 'utf8')); } catch { used = {}; }
}

function takeTopic(rubricId) {
  const bank = topicsData.topics[rubricId] || [];
  if (bank.length === 0) return '(добавьте темы в content/topics.json)';
  const usedSet = new Set(used[rubricId] || []);
  let fresh = bank.filter(t => !usedSet.has(t));
  if (fresh.length === 0) {
    // Банк исчерпан — начинаем круг заново
    used[rubricId] = [];
    fresh = bank.slice();
  }
  const topic = fresh[0];
  used[rubricId] = [...(used[rubricId] || []), topic];
  return topic;
}

// --- Взвешенная очередь рубрик (детерминированная, без Math.random) ---
// Раскладываем рубрики пропорционально весам методом наибольших остатков,
// затем перемешиваем так, чтобы одинаковые рубрики не шли подряд.
function buildRubricQueue(totalPosts) {
  const rubrics = rubricsData.rubrics;
  const totalWeight = rubrics.reduce((s, r) => s + r.weight, 0);
  const counts = rubrics.map(r => ({ r, exact: (r.weight / totalWeight) * totalPosts }));
  counts.forEach(c => { c.n = Math.floor(c.exact); c.rem = c.exact - c.n; });
  let assigned = counts.reduce((s, c) => s + c.n, 0);
  counts.sort((a, b) => b.rem - a.rem);
  for (let i = 0; assigned < totalPosts; i++, assigned++) counts[i % counts.length].n++;

  // Раскладка с чередованием: каждый раз берём рубрику с наибольшим остатком постов,
  // избегая повтора предыдущей.
  const pool = counts.map(c => ({ id: c.r.id, left: c.n })).filter(c => c.left > 0);
  const queue = [];
  let prev = null;
  while (queue.length < totalPosts) {
    pool.sort((a, b) => b.left - a.left);
    const pick = pool.find(c => c.left > 0 && c.id !== prev) || pool.find(c => c.left > 0);
    pick.left--;
    queue.push(pick.id);
    prev = pick.id;
  }
  return queue;
}

// --- Даты публикаций ---
function postDates(from, totalPosts) {
  const dates = [];
  const d = new Date(from);
  while (dates.length < totalPosts) {
    if (POST_DAYS.includes(d.getDay())) dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

const totalPosts = weeks * POSTS_PER_WEEK;
const queue = buildRubricQueue(totalPosts);
const dates = postDates(start, totalPosts);
const rubricById = Object.fromEntries(rubricsData.rubrics.map(r => [r.id, r]));

const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const fmt = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;

const plan = queue.map((rubricId, i) => {
  const r = rubricById[rubricId];
  return {
    date: dates[i].toISOString().slice(0, 10),
    day: DAYS_RU[dates[i].getDay()],
    rubric: r.name,
    format: r.format,
    topic: takeTopic(rubricId),
    structure: r.structure,
  };
});

// --- Вывод ---
let md = `# План публикаций на ${weeks} нед. (с ${fmt(dates[0])})\n\n`;
md += `Постов: ${totalPosts}. Шаблоны текстов — в content/templates.md (ищите рубрику по названию).\n\n`;
md += `| Дата | День | Рубрика | Формат | Тема |\n|---|---|---|---|---|\n`;
for (const p of plan) {
  md += `| ${fmt(new Date(p.date + 'T00:00:00'))} | ${p.day} | ${p.rubric} | ${p.format} | ${p.topic} |\n`;
}
md += `\n## Съёмочный день\n\nВсе Reels недели снимаются за один заход. Reels в этом плане:\n\n`;
for (const p of plan.filter(p => p.format.includes('Reels'))) {
  md += `- ${fmt(new Date(p.date + 'T00:00:00'))} — ${p.topic}\n`;
}
md += `\n## Чек-лист перед публикацией\n\n- [ ] Хук в первые 2 секунды / первую строку\n- [ ] Один CTA, не три\n- [ ] Перечитано дважды: ошибок нет\n- [ ] 3–5 узких хэштегов\n- [ ] Ссылка в шапке профиля актуальна\n`;

fs.writeFileSync(path.join(CONTENT_DIR, 'plan.md'), md);
fs.writeFileSync(path.join(CONTENT_DIR, 'plan.json'), JSON.stringify(plan, null, 2));
fs.writeFileSync(USED_FILE, JSON.stringify(used, null, 2));

console.log(`Готово: план на ${weeks} нед. (${totalPosts} постов)`);
console.log(`  content/plan.md   — план таблицей + съёмочный день + чек-лист`);
console.log(`  content/plan.json — то же в JSON для автоматизации`);
console.log(`\nПервые публикации:`);
for (const p of plan.slice(0, 4)) console.log(`  ${fmt(new Date(p.date + 'T00:00:00'))} ${p.day} — [${p.rubric}] ${p.topic}`);
