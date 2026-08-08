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
const audioCheck = args.includes('--audio-check');
const onlyOne = args.includes('--one');   // ежедневный режим: одна публикация за запуск
const onlyId = args.find(a => !a.startsWith('--'));

if (!TOKEN) {
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
  return [post.caption, music, tags].filter(Boolean).join('\n\n');
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

(async () => {
  const me = await api('GET', IG_USER_ID, { fields: 'username,followers_count,media_count' });
  console.log(`Токен действителен: @${me.username} — ${me.followers_count} подписчиков, ${me.media_count} публикаций`);
  if (audioCheck) { await showAudioCheck(); return; }
  if (recentOnly) { await showRecent(); return; }
  if (checkOnly) return;

  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));

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

  // В ежедневном режиме берём одну публикацию — иначе весь банк уйдёт за один запуск.
  // При пустом банке список остаётся пустым: ниже об этом честно сообщается.
  const targets = onlyOne && !onlyId && approved.length
    ? [pickDaily(approved)]
    : approved;

  if (targets.length === 0) {
    console.log(onlyId
      ? `Пост «${onlyId}» не найден в очереди.`
      : 'Нет постов со статусом approved — публиковать нечего. Пополните банк.');
    return;
  }
  if (onlyOne && !onlyId) {
    const ege = approved.filter(p => p.rubric === EGE_RUBRIC).length;
    console.log(`В банке одобрено: ${approved.length} (из них разборов ЕГЭ: ${ege}). Сегодня выходит одна публикация.`);
  }

  for (const post of targets) {
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
