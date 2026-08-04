#!/usr/bin/env node
/**
 * Публикация одобренных постов из content/queue.json в Instagram
 * через официальный Instagram Graph API (graph.facebook.com).
 *
 * Токен — системного пользователя Business Manager (см. скилл instagram-api-token):
 * он не протухает и не зависит от личных настроек приватности аккаунта.
 *
 * Использование:
 *   IG_ACCESS_TOKEN=... node publish.js --check      — проверить токен (кто я)
 *   IG_ACCESS_TOKEN=... node publish.js --dry-run    — показать, что будет опубликовано
 *   IG_ACCESS_TOKEN=... node publish.js              — опубликовать все approved-посты
 *   IG_ACCESS_TOKEN=... node publish.js <id>         — опубликовать один пост
 *
 * Требования к посту в очереди:
 *   status: "approved"
 *   imageUrls: массив публичных https-ссылок на JPEG (заполняется при загрузке слайдов на CDN)
 *
 * Токен берётся ТОЛЬКО из переменной окружения IG_ACCESS_TOKEN — в файлы и чат его не вставлять.
 */

const fs = require('fs');
const path = require('path');

const QUEUE = path.join(__dirname, 'content', 'queue.json');
const API = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.IG_ACCESS_TOKEN;

// ID аккаунта Instagram, в который публикуем. Берётся из очереди, можно переопределить
// переменной окружения IG_USER_ID.
const queueRaw = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
const IG_USER_ID = process.env.IG_USER_ID || queueRaw.account_id;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const recentOnly = args.includes('--recent');
const onlyId = args.find(a => !a.startsWith('--'));

if (!TOKEN) {
  console.error('Нет токена: задайте переменную окружения IG_ACCESS_TOKEN.');
  process.exit(1);
}
if (!IG_USER_ID) {
  console.error('Не указан ID аккаунта Instagram: поле account_id в content/queue.json или переменная IG_USER_ID.');
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
    throw new Error(`${endpoint}: ${json.error.message} (code ${json.error.code}${json.error.error_subcode ? '/' + json.error.error_subcode : ''})`);
  }
  return json;
}

/** Контейнер обрабатывается на стороне Instagram — ждём готовности перед публикацией. */
async function waitReady(containerId, label, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const { status_code } = await api('GET', containerId, { fields: 'status_code' });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR') throw new Error(`${label}: контейнер вернул ERROR`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`${label}: контейнер не готов после ${Math.round(tries * 4 / 60)} мин ожидания`);
}

function fullCaption(post) {
  const tags = (post.hashtags || []).join(' ');
  return tags ? `${post.caption}\n\n${tags}` : post.caption;
}

async function publishPost(post) {
  const urls = post.imageUrls || [];
  const caption = fullCaption(post);

  let creationId;
  if (post.videoUrl) {
    // Reels: видео обрабатывается дольше картинок — ждём до 8 минут
    const { id } = await api('POST', `${IG_USER_ID}/media`, {
      media_type: 'REELS',
      video_url: post.videoUrl,
      caption,
      share_to_feed: 'true',
    });
    await waitReady(id, post.id, 120);
    creationId = id;
  } else if (urls.length === 0) {
    throw new Error(`${post.id}: нет imageUrls — сначала загрузите слайды на CDN`);
  } else if (urls.length === 1) {
    const { id } = await api('POST', `${IG_USER_ID}/media`, { image_url: urls[0], caption });
    await waitReady(id, post.id);
    creationId = id;
  } else {
    const children = [];
    for (const [i, u] of urls.entries()) {
      const { id } = await api('POST', `${IG_USER_ID}/media`, { image_url: u, is_carousel_item: 'true' });
      await waitReady(id, `${post.id} слайд ${i + 1}`);
      children.push(id);
    }
    const { id } = await api('POST', `${IG_USER_ID}/media`, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    });
    await waitReady(id, `${post.id} карусель`);
    creationId = id;
  }

  const { id: mediaId } = await api('POST', `${IG_USER_ID}/media_publish`, { creation_id: creationId });
  return mediaId;
}

/** Последние публикации со статистикой — чтобы понимать, что уже вышло и как зашло. */
async function showRecent(limit = 8) {
  const { data } = await api('GET', `${IG_USER_ID}/media`, {
    fields: 'id,caption,media_type,timestamp,permalink,like_count,comments_count',
    limit: String(limit),
  });
  for (const m of data) {
    const when = new Date(m.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const head = (m.caption || '(без подписи)').split('\n')[0].slice(0, 70);
    let extra = '';
    try {
      const ins = await api('GET', `${m.id}/insights`, { metric: 'reach,saved,shares' });
      extra = ' | ' + ins.data.map(i => `${i.name}=${i.values[0].value}`).join(' ');
    } catch { /* статистика доступна не для всех типов и не сразу */ }
    console.log(`${when} [${m.media_type}] ♥${m.like_count ?? '-'} 💬${m.comments_count ?? '-'}${extra}`);
    console.log(`   ${head}`);
    console.log(`   ${m.permalink}`);
  }
}

(async () => {
  const me = await api('GET', IG_USER_ID, { fields: 'username,followers_count,media_count' });
  console.log(`Токен действителен: @${me.username} — ${me.followers_count} подписчиков, ${me.media_count} публикаций`);
  if (recentOnly) { await showRecent(); return; }
  if (checkOnly) return;

  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const targets = queue.posts.filter(p =>
    onlyId ? p.id === onlyId : p.status === 'approved');

  if (targets.length === 0) {
    console.log(onlyId
      ? `Пост «${onlyId}» не найден в очереди.`
      : 'Нет постов со статусом approved — публиковать нечего.');
    return;
  }

  for (const post of targets) {
    const n = (post.imageUrls || []).length;
    console.log(`\n→ ${post.id} [${post.rubric}] ${post.videoUrl ? 'видео' : n + ' слайд(ов)'}`);
    if (post.format === 'Reels' && !post.videoUrl) {
      console.log('  Пропуск: у Reels нет videoUrl — соберите видео (node render-reels.js) или опубликуйте вручную.');
      continue;
    }
    if (dryRun) {
      console.log(`  (dry-run) Опубликовал бы ${post.videoUrl ? 'Reels' : n === 1 ? 'пост' : 'карусель'} с подписью ${fullCaption(post).length} симв.`);
      continue;
    }
    const mediaId = await publishPost(post);
    post.status = 'published';
    post.publishedMediaId = mediaId;
    post.publishedAt = new Date().toISOString();
    fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2));
    console.log(`  ✓ Опубликовано, media id: ${mediaId}`);
  }
})().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
