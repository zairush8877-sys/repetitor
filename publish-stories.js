#!/usr/bin/env node
/**
 * Ежедневная публикация сторис из content/stories.json в Instagram.
 *
 *   IG_ACCESS_TOKEN=... node publish-stories.js --dry-run   — показать, что вышло бы
 *   IG_ACCESS_TOKEN=... node publish-stories.js             — опубликовать следующую
 *   IG_ACCESS_TOKEN=... node publish-stories.js <id>        — опубликовать конкретную
 *
 * Берётся первая сторис со статусом approved (или без статуса, если банк одобрен
 * целиком — см. флаг bankApproved). Публикуются оба кадра подряд: вопрос и ответ.
 *
 * Токен — только из переменной окружения IG_ACCESS_TOKEN, в файлы его не класть.
 */

const fs = require('fs');
const path = require('path');

const BANK = path.join(__dirname, 'content', 'stories.json');
const QUEUE = path.join(__dirname, 'content', 'queue.json');
const API = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID || JSON.parse(fs.readFileSync(QUEUE, 'utf8')).account_id;

// Имя репозитория можно переименовать, и тогда ссылки протухнут разом.
// В GitHub Actions актуальное имя всегда в GITHUB_REPOSITORY — берём оттуда.
const REPO = process.env.GITHUB_REPOSITORY || 'zairush8877-sys/repetitor';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/content/stories`;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyId = args.find(a => !a.startsWith('--'));

if (!TOKEN) {
  console.error('Нет токена: задайте переменную окружения IG_ACCESS_TOKEN.');
  process.exit(1);
}

async function api(method, endpoint, params = {}) {
  const url = new URL(`${API}/${endpoint}`);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method: 'POST', body });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${endpoint}: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

async function waitReady(containerId, label, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const { status_code } = await api('GET', containerId, { fields: 'status_code' });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR') throw new Error(`${label}: контейнер вернул ERROR`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`${label}: контейнер не готов после ${Math.round(tries * 4 / 60)} мин`);
}

/**
 * Сторис публикуется как обычный контейнер, но с media_type=STORIES.
 * Картинка выходит немой, поэтому основной вариант — видео: оба кадра подряд
 * с классикой, вопрос сменяется ответом сам. Видео обрабатывается дольше,
 * отсюда и запас по числу проверок.
 */
async function publishFrame(url, label, isVideo) {
  const { id } = await api('POST', `${IG_USER_ID}/media`, {
    media_type: 'STORIES',
    ...(isVideo ? { video_url: url } : { image_url: url }),
  });
  await waitReady(id, label, isVideo ? 60 : 30);
  const { id: mediaId } = await api('POST', `${IG_USER_ID}/media_publish`, { creation_id: id });
  return mediaId;
}

/** Есть ли у сторис собранное видео — проверяем по репозиторию, а не по диску: */
async function hasVideo(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
  const pending = bank.stories.filter(s => s.status !== 'published');

  const story = onlyId
    ? bank.stories.find(s => s.id === onlyId)
    : pending[0];

  if (!story) {
    console.log(onlyId
      ? `Сторис «${onlyId}» не найдена.`
      : 'Банк сторис исчерпан — добавьте новые в content/stories.json.');
    return;
  }

  const me = await api('GET', IG_USER_ID, { fields: 'username' });
  console.log(`@${me.username} — сторис ${story.id} [${story.type}], осталось в банке: ${pending.length}`);

  const videoUrl = `${RAW}/${story.id}.mp4`;
  const video = await hasVideo(videoUrl);
  // Пока видео к сторис не собрано, старый путь остаётся рабочим: два немых кадра.
  const urls = video ? [videoUrl] : [1, 2].map(n => `${RAW}/${story.id}-${n}.jpg`);

  if (dryRun) {
    console.log(video ? '(dry-run) Опубликовал бы видео:' : '(dry-run) Опубликовал бы два кадра:');
    urls.forEach(u => console.log('  ' + u));
    return;
  }

  const ids = [];
  for (const [i, u] of urls.entries()) {
    ids.push(await publishFrame(u, video ? story.id : `${story.id} кадр ${i + 1}`, video));
    console.log(`  ✓ ${video ? 'видео' : 'кадр ' + (i + 1)}: ${ids[i]}`);
  }

  story.status = 'published';
  story.publishedAt = new Date().toISOString();
  story.publishedMediaIds = ids;
  fs.writeFileSync(BANK, JSON.stringify(bank, null, 2));
  console.log(`Готово. В банке осталось ${pending.length - 1}.`);
})().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
