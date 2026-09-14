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
 *   IG_ACCESS_TOKEN=... node publish.js --one        — одна публикация дня (ежедневный режим)
 *   IG_ACCESS_TOKEN=... node publish.js <id>         — опубликовать один пост
 *   node publish.js --repost-audit                  — локальная сверка репостов, без API
 *   node publish.js --repost <id> --dry-run          — состояние одного репоста, без API
 *   IG_ACCESS_TOKEN=... node publish.js --repost <id> — явный повтор подтверждённо незавершённого репоста
 *
 * Требования к посту в очереди:
 *   status: "approved"
 *   imageUrls: массив публичных https-ссылок на JPEG (заполняется при загрузке слайдов на CDN)
 *
 * Токен берётся ТОЛЬКО из переменной окружения IG_ACCESS_TOKEN — в файлы и чат его не вставлять.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const repost = require('./repost-state');

const CONTENT = path.resolve(process.env.MEDIA_CONTENT_DIR || path.join(__dirname, 'content'));
const QUEUE = path.join(CONTENT, 'queue.json');
const API = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.IG_ACCESS_TOKEN;

// ID аккаунта Instagram, в который публикуем. Берётся из очереди, можно переопределить
// переменной окружения IG_USER_ID.
const queueRaw = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
const IG_USER_ID = process.env.IG_USER_ID || queueRaw.account_id;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const recentArg = args.find(a => a === '--recent' || a.startsWith('--recent='));
const recentOnly = !!recentArg;
// Сколько публикаций разбирать: восьми мало, чтобы отличить закономерность от
// случайности — на такой выборке один удачный пост выглядит трендом.
const recentLimit = Math.min(50, Number((recentArg || '').split('=')[1]) || 8);
const audioCheck = args.includes('--audio-check');
const onlyOne = args.includes('--one');   // ежедневный режим: одна публикация за запуск
const onlyId = args.find(a => !a.startsWith('--'));
const repostOnly = args.includes('--repost');
const evidencePath = path.join(CONTENT, 'repost-evidence.json');
const historicalEvidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : {};

if (args.includes('--repost-audit')) {
  console.log(JSON.stringify(repost.audit(queueRaw, historicalEvidence), null, 2));
  process.exit(0);
}
if (repostOnly && !onlyId) {
  console.error('Для репоста укажите один конкретный ID. Массового повтора нет.');
  process.exit(1);
}
// Uses the sender's own media contract, before credentials, API calls or locks.
if (args.includes('--validate-prepared')) {
  try {
    const prepared = require('./prepared-media');
    const targets = onlyId ? queueRaw.posts.filter(p => p.id === onlyId) : queueRaw.posts.filter(p => ['pending', 'approved'].includes(p.status));
    if (onlyId && !targets.length) throw new Error(`Пост не найден: ${onlyId}`);
    console.log(JSON.stringify(targets.map(post => prepared.validate(post).summary), null, 2));
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
}

if (!TOKEN && !dryRun) {
  console.error('Нет токена: задайте переменную окружения IG_ACCESS_TOKEN.');
  process.exit(1);
}
if (!IG_USER_ID) {
  console.error('Не указан ID аккаунта Instagram: поле account_id в content/queue.json или переменная IG_USER_ID.');
  process.exit(1);
}

/**
 * Ссылки на файлы в очереди содержат имя репозитория, а его могут переименовать —
 * тогда все ссылки протухнут разом и публикация упадёт по расписанию, молча.
 * В GitHub Actions актуальное имя всегда лежит в GITHUB_REPOSITORY, поэтому
 * подменяем владельца и репозиторий в ссылке на текущие.
 */
function assetUrl(u) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return u;
  return u.replace(
    /^(https:\/\/raw\.githubusercontent\.com\/)[^/]+\/[^/]+\//,
    `$1${repo}/`);
}

// Раз в неделю лента отдаётся разбору задания ЕГЭ: это профильная тема аккаунта,
// и без брони дня она тонет среди более лёгких форматов, которых в банке больше.
const EGE_RUBRIC = 'Разбор задания';
const EGE_WEEKDAY = 1; // понедельник

/** Дата по Москве в виде ГГГГ-ММ-ДД — раннер живёт в UTC, а расписание московское. */
function moscowDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

/** День недели по Москве — раннер живёт в UTC, а расписание у нас московское. */
function moscowWeekday() {
  const s = new Date().toLocaleDateString('en-US', {
    timeZone: 'Europe/Moscow', weekday: 'short',
  });
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s);
}

/**
 * Публикацию можно выпустить и руками — тогда ежедневный запуск по расписанию
 * добавит к ней вторую, и обе выйдут в один вечер с разницей в полчаса. Режим
 * «одна публикация в день» должен считать все публикации дня, а не только свои.
 */
function publishedToday(posts) {
  const today = moscowDate();
  return posts.find(p => p.publishedAt && moscowDate(new Date(p.publishedAt)) === today);
}

/**
 * Одна публикация дня: в понедельник — разбор ЕГЭ, в остальные дни он
 * придерживается. Если про ЕГЭ ничего не осталось (или наоборот, остались
 * только они), выходит то, что есть, — пустой день хуже несвоевременного.
 *
 * Очередь хранится свежим сверху, поэтому брать первый попавшийся нельзя:
 * так банк расходуется задом наперёд и разборы ЕГЭ выходят от задания 6
 * к заданию 5. Порядок выпуска задаёт поле date — по нему и сортируем.
 */
function pickDaily(approved) {
  const byDate = [...approved].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const isEgeDay = moscowWeekday() === EGE_WEEKDAY;
  const ege = byDate.filter(p => p.rubric === EGE_RUBRIC);
  const rest = byDate.filter(p => p.rubric !== EGE_RUBRIC);

  if (isEgeDay && ege.length) return ege[0];
  if (!isEgeDay && rest.length) return rest[0];
  return byDate[0];
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
  // Правило автора: композитор указывается всегда. Поле music пишет рендер —
  // это именно та запись, что вшита в видео.
  const music = post.music && post.music.composer
    ? `♪ ${post.music.composer} — ${post.music.piece}`
    : '';
  const attribution = post.music?.attribution;
  const credits = [post.caption, music, attribution, tags].filter(Boolean);
  return [...new Set(credits)].join('\n\n');
}

/**
 * Публикация без подписи однажды уже случилась: Reels от 3 августа собрал
 * лучший охват в аккаунте и остался немым — ни объяснения, ни хештегов,
 * ни повода написать в директ. Пустая подпись — это брак, а не «пока так».
 * Проверка типа обязательна: на не-строке .trim() падал бы голым TypeError
 * без имени поста.
 */
function hasCaption(post) {
  return typeof post.caption === 'string' && post.caption.trim() !== '';
}

function requireCaption(post) {
  if (!hasCaption(post)) {
    throw new Error(`${post.id}: нет подписи — публиковать без неё нельзя`);
  }
}

function saveQueue(queue) {
  const tmp = `${QUEUE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
  fs.renameSync(tmp, QUEUE);
}

/** Use only prepared vertical files; preserve every carousel slide. */
async function repostToStory(post, queue) {
  const manifestPath = path.join(CONTENT, 'reposts', 'index.json');
  try {
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
    const state = await repost.deliver(post, {
      entry: manifest.posts?.[post.id], api, waitReady, userId: IG_USER_ID, assetUrl,
      save: () => saveQueue(queue), log: message => console.log(`  ${message}`),
      verifyAssets: async assets => {
        for (const a of assets) {
          if (path.basename(a.file) !== a.file) throw new Error('Некорректный путь репоста.');
          const file = path.join(CONTENT, 'reposts', a.file);
          const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
          if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== a.sha256) throw new Error('Локальный кадр репоста изменился: пересоберите манифест.');
          const { localSource } = require('./render-reposts');
          if (digest(fs.readFileSync(localSource(a.sourceUrl, CONTENT))) !== a.geometry?.sourceSha256) throw new Error('Исходный кадр изменился: пересоберите репост.');
          const response = await fetch(assetUrl(a.url), { signal: AbortSignal.timeout(20000) });
          if (!response.ok || !/image\/jpeg/i.test(response.headers.get('content-type') || '')) throw new Error('Готовый кадр Stories ещё недоступен по публичной ссылке.');
          if (digest(Buffer.from(await response.arrayBuffer())) !== a.sha256) throw new Error('На сервере другая версия кадра Stories: дождитесь обновления.');
        }
      },
    });
    console.log(`  Репост: ${state.status}. Подтверждено ${state.items.filter(i => i.publishedMediaId).length}/${state.items.length} кадров.`);
    if (state.status !== 'published') process.exitCode = 1;
    return state;
  } catch (e) {
    saveQueue(queue);
    process.exitCode = 1;
    console.log(`  ⚠ репост требует внимания: ${e.message}`);
  }
}

async function publishPost(post) {
  requireCaption(post);
  const urls = (post.imageUrls || []).map(assetUrl);
  const caption = fullCaption(post);

  let creationId;
  if (post.videoUrl) {
    // Reels: видео обрабатывается дольше картинок — ждём до 8 минут
    const { id } = await api('POST', `${IG_USER_ID}/media`, {
      media_type: 'REELS',
      video_url: assetUrl(post.videoUrl),
      caption,
      share_to_feed: 'true',
      // Обложка — финальный кадр с полной таблицей; без этого Instagram
      // выбирает кадр сам и в сетке остаётся пустой заголовок.
      ...(post.coverOffsetMs ? { thumb_offset: String(post.coverOffsetMs) } : {}),
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
    // Карусель со звуком (правило автора «везде фотки и музыка»): у слайда-видео
    // звуковая дорожка есть, у картинки — нет. Если рендер собрал ролики,
    // публикуем их; картинки остаются запасным путём.
    const slideVideos = (post.videoUrls || []).map(assetUrl);
    const items = slideVideos.length === urls.length ? slideVideos : urls;
    const asVideo = items === slideVideos;
    const children = [];
    for (const [i, u] of items.entries()) {
      const { id } = await api('POST', `${IG_USER_ID}/media`, {
        is_carousel_item: 'true',
        ...(asVideo ? { media_type: 'VIDEO', video_url: u } : { image_url: u }),
      });
      await waitReady(id, `${post.id} слайд ${i + 1}`, asVideo ? 60 : 30);
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
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
    limit: String(limit),
  });

  const rows = [];
  for (const m of data) {
    const when = new Date(m.timestamp);
    const head = (m.caption || '(без подписи)').split('\n')[0].slice(0, 60);
    const ins = {};
    try {
      const r = await api('GET', `${m.id}/insights`, { metric: 'reach,saved,shares' });
      for (const i of r.data) ins[i.name] = i.values[0].value;
    } catch { /* статистика доступна не для всех типов и не сразу */ }
    rows.push({
      when, head, permalink: m.permalink,
      kind: m.media_product_type || m.media_type,
      likes: m.like_count ?? 0, comments: m.comments_count ?? 0,
      reach: ins.reach ?? null, saved: ins.saved ?? 0, shares: ins.shares ?? 0,
    });
  }

  const fmt = d => d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const line = r => `${fmt(r.when)} ${String(r.kind).padEnd(9)} ♥${String(r.likes).padStart(3)} `
    + `💬${String(r.comments).padStart(2)} охват ${String(r.reach ?? '—').padStart(5)} `
    + `сохр ${String(r.saved).padStart(2)} реп ${String(r.shares).padStart(2)}  ${r.head}`;

  console.log(`\n=== ${rows.length} публикаций, по времени ===`);
  rows.forEach(r => console.log(line(r)));

  // Отдельные рейтинги: охват показывает, как раздал алгоритм, а лайки и
  // комментарии — что сделали люди. Это разные вопросы, и совпадают они не всегда.
  console.log('\n=== по лайкам ===');
  [...rows].sort((a, b) => b.likes - a.likes).slice(0, 10).forEach(r => console.log(line(r)));

  console.log('\n=== по комментариям ===');
  [...rows].sort((a, b) => b.comments - a.comments).slice(0, 10).forEach(r => console.log(line(r)));

  // Пересылки и сохранения — самый честный сигнал: лайк ставят из вежливости,
  // а переслать или сохранить можно только то, что пригодилось.
  console.log('\n=== по пересылкам ===');
  [...rows].sort((a, b) => b.shares - a.shares).slice(0, 10).forEach(r => console.log(line(r)));

  console.log('\n=== по сохранениям ===');
  [...rows].sort((a, b) => b.saved - a.saved).slice(0, 10).forEach(r => console.log(line(r)));

  const byKind = {};
  for (const r of rows) {
    const k = byKind[r.kind] || (byKind[r.kind] = { n: 0, likes: 0, comments: 0, reach: 0, reachN: 0, saved: 0, shares: 0 });
    k.n++; k.likes += r.likes; k.comments += r.comments; k.saved += r.saved; k.shares += r.shares;
    if (r.reach != null) { k.reach += r.reach; k.reachN++; }
  }
  console.log('\n=== в среднем по формату ===');
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`${k.padEnd(9)} n=${String(v.n).padStart(2)}  ♥${(v.likes / v.n).toFixed(1).padStart(5)}  `
      + `💬${(v.comments / v.n).toFixed(1).padStart(4)}  охват ${(v.reachN ? v.reach / v.reachN : 0).toFixed(0).padStart(5)}  `
      + `сохр ${(v.saved / v.n).toFixed(1)}  реп ${(v.shares / v.n).toFixed(1)}`);
  }
}

/**
 * Диагностика звука: скачиваем опубликованные ролики с серверов Instagram
 * (media_url) и меряем громкость дорожки. Файл в репозитории может быть
 * со звуком, а ролик в ленте — немым: Instagram глушит дорожку сам, если
 * его детектор принимает запись за защищённую. Здесь это видно по цифрам.
 */
async function showAudioCheck(limit = 6) {
  const os = require('os');
  const { spawnSync } = require('child_process');
  let ffmpeg = 'ffmpeg';
  try { ffmpeg = require('ffmpeg-static') || 'ffmpeg'; } catch { /* в CI есть системный */ }

  const { data } = await api('GET', `${IG_USER_ID}/media`, {
    fields: 'id,media_type,timestamp,permalink,media_url',
    limit: String(limit),
  });
  for (const m of data.filter(v => v.media_type === 'VIDEO')) {
    const when = new Date(m.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    let copyright = '';
    try {
      const info = await api('GET', m.id, { fields: 'copyright_check_information' });
      if (info.copyright_check_information) copyright = ` | копирайт: ${JSON.stringify(info.copyright_check_information)}`;
    } catch { /* поле отдаётся не для всех медиа */ }

    if (!m.media_url) {
      console.log(`${when} ${m.permalink}\n   media_url недоступен${copyright}`);
      continue;
    }
    const tmp = path.join(os.tmpdir(), `iga-${m.id}.mp4`);
    const res = await fetch(m.media_url);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const size = fs.statSync(tmp).size;
    const r = spawnSync(ffmpeg, ['-i', tmp, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const txt = (r.stderr || '') + (r.stdout || '');
    const hasVideo = /Stream #[^\n]*Video/.test(txt);
    const hasAudio = /Stream #[^\n]*Audio/.test(txt);
    const mean = (/mean_volume: ([-\d.]+) dB/.exec(txt) || [])[1];
    const max = (/max_volume: ([-\d.]+) dB/.exec(txt) || [])[1];
    // «Дорожки нет» имеет смысл, только если файл вообще скачался и читается:
    // CDN Instagram может ответить дата-центру страницей ошибки, и тогда
    // ffmpeg не найдёт ни звука, ни видео — это сбой проверки, а не ролика.
    const head = fs.readFileSync(tmp).subarray(0, 96);
    const peek = `${res.headers.get('content-type')}; начало: ${JSON.stringify(head.toString('latin1').replace(/[^\x20-\x7e]/g, '.'))}`;
    // Первые прогоны «диагностики» дали ложное «дорожки нет»: ffmpeg на
    // раннере отсутствовал, spawnSync тихо возвращал ENOENT, и пустой вывод
    // выглядел как файл без потоков. Ошибку запуска показываем явно.
    const verdict = r.error
      ? `FFMPEG НЕ ЗАПУСТИЛСЯ (${r.error.message}) — проверка не состоялась`
      : !hasVideo
      ? `ФАЙЛ НЕ ПРОЧИТАН (${res.status}, ${size} байт, ${peek}) — вывод о звуке делать нельзя`
      : !hasAudio ? 'ДОРОЖКИ НЕТ — Instagram убрал звук'
      : max !== undefined && Number(max) < -50 ? `дорожка есть, но ТИШИНА (max ${max} дБ)`
      : `звук на месте: mean ${mean} дБ, max ${max} дБ`;
    console.log(`${when} ${m.permalink}\n   ${verdict}${copyright}`);
    fs.rmSync(tmp, { force: true });
  }
}

let publicationLock;
(async () => {
  if (!dryRun) {
    const me = await api('GET', IG_USER_ID, { fields: 'username,followers_count,media_count' });
    console.log(`Токен действителен: @${me.username} — ${me.followers_count} подписчиков, ${me.media_count} публикаций`);
  }
  if (audioCheck) { await showAudioCheck(); return; }
  if (recentOnly) { await showRecent(recentLimit); return; }
  if (checkOnly) return;

  if (!dryRun) {
    // Prevent overlapping local writers. After a crash, inspect state before removing the lock.
    const lockPath = path.join(CONTENT, '.publish.lock');
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.closeSync(fd); publicationLock = lockPath;
  }
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  if (repostOnly) {
    const post = queue.posts.find(p => p.id === onlyId);
    if (!post) throw new Error(`Пост не найден: ${onlyId}`);
    if (dryRun) console.log(JSON.stringify(repost.audit({ posts: [post] }, historicalEvidence), null, 2));
    else await repostToStory(post, queue);
    return;
  }

  if (onlyOne && !onlyId) {
    const already = publishedToday(queue.posts);
    if (already) {
      console.log(`Сегодня уже вышла публикация «${already.id}» — вторая за день не нужна.`);
      return;
    }
  }

  const matched = queue.posts.filter(p =>
    onlyId ? p.id === onlyId : p.status === 'approved');

  // Пост без подписи не выходит сам и не останавливает остальных: раньше он
  // ронял весь прогон — день пропадал, а статусы уже вышедших постов не
  // записывались, и назавтра они уходили дублями. Ежедневный отбор просто
  // не видит такие посты; явный запуск по id остаётся громким — там ошибка.
  const approved = onlyId ? matched : matched.filter(hasCaption);
  const noCaption = matched.length - approved.length;
  if (noCaption) console.log(`Без подписи, к публикации не допущено: ${noCaption}. Добавьте caption в очередь.`);

  let dailyReady = approved;
  if (onlyOne && !onlyId) {
    const { ready, blocked, deferred } = require('./daily-selection').readyForDay(
      approved, moscowDate(), post => require('./prepared-media').validate(post));
    dailyReady = ready;
    for (const item of blocked) console.warn(`Не готов к ежедневному выпуску: ${item.reason}`);
    if (deferred.length) console.log(`Дата ещё не наступила или не задана: ${deferred.join(', ')}`);
    if (!ready.length && blocked.length) throw new Error('Нет готовой публикации на сегодня: нужны одобренный материал с датой и полная сборка. Старые материалы автоматически не пересобираются.');
  }
  // В ежедневном режиме берём одну публикацию — иначе весь банк уйдёт за один запуск.
  // При пустом банке список остаётся пустым: ниже об этом честно сообщается.
  const targets = onlyOne && !onlyId
    ? (dailyReady.length ? [pickDaily(dailyReady)] : [])
    : approved;

  if (targets.length === 0) {
    console.log(onlyId
      ? `Пост «${onlyId}» не найден в очереди.`
      : 'На сегодня нет одобренных публикаций с наступившей датой.');
    return;
  }
  if (onlyOne && !onlyId) {
    const ege = dailyReady.filter(p => p.rubric === EGE_RUBRIC).length;
    console.log(`На сегодня подготовлено и одобрено: ${dailyReady.length} (из них разборов ЕГЭ: ${ege}). Выбрана одна публикация.`);
  }

  for (const post of targets) {
    if (post.status === 'published' || post.publishedMediaId) {
      console.log(`Публикация ${post.id} уже подтверждена — повтор в ленту пропущен. Для незавершённой Stories используйте --repost ${post.id}.`);
      continue;
    }
    if (post.status !== 'approved') throw new Error(`${post.id}: материал не одобрен; сборка не даёт разрешения на выпуск.`);
    if (!post.date || post.date > moscowDate()) throw new Error(`${post.id}: дата выпуска ещё не наступила или не задана.`);
    const prepared = require('./prepared-media');
    const validated = prepared.validate(post);
    for (const field of prepared.MEDIA_FIELDS) delete post[field];
    Object.assign(post, validated.post);
    if (!dryRun) {
      // Check every public file before creating any feed or Stories container.
      for (const a of [...validated.entry.files, ...validated.repost.assets]) {
        const response = await fetch(assetUrl(a.url), { signal: AbortSignal.timeout(30000) });
        if (!response.ok || prepared.sha(Buffer.from(await response.arrayBuffer())) !== a.sha256) throw new Error(`${post.id}: публичный файл ещё не соответствует сборке: ${a.url}`);
      }
    }
    const n = (post.imageUrls || []).length;
    console.log(`\n→ ${post.id} [${post.rubric}] ${post.videoUrl ? 'видео' : n + ' слайд(ов)'}`);
    if (post.format === 'Reels' && !post.videoUrl) {
      console.log('  Пропуск: у Reels нет videoUrl — соберите видео (node render-reels.js) или опубликуйте вручную.');
      continue;
    }
    if (dryRun) {
      if (!hasCaption(post)) {
        console.log('  ✗ нет подписи — публикация была бы отклонена');
        continue;
      }
      if (!post.videoUrl && n === 0) {
        console.log('  ✗ нет imageUrls — публикация была бы отклонена');
        continue;
      }
      console.log(`  (dry-run) Подготовлены ${post.videoUrl ? 'Reels' : n === 1 ? 'пост' : 'карусель'} с подписью ${fullCaption(post).length} симв. и ${validated.repost.assets.length} кадров Stories. Файлы и метаданные проверены локально; сеть и публикация не запускались.`);
      continue;
    }
    const mediaId = await publishPost(post);
    post.status = 'published';
    post.publishedMediaId = mediaId;
    post.publishedAt = new Date().toISOString();
    repost.initialize(post, true);
    saveQueue(queue);
    console.log(`  ✓ Опубликовано, media id: ${mediaId}`);
    await repostToStory(post, queue);
  }
})().catch(e => { console.error('Ошибка:', e.message); process.exitCode = 1; })
  .finally(() => { if (publicationLock) fs.unlinkSync(publicationLock); });
