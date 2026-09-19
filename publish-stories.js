#!/usr/bin/env node
/**
 * Ежедневная публикация сторис из content/stories.json в Instagram.
 *
 *   node publish-stories.js --dry-run                     — локальный план, без токена
 *   IG_ACCESS_TOKEN=... node publish-stories.js             — опубликовать следующую
 *   IG_ACCESS_TOKEN=... node publish-stories.js <id>        — опубликовать конкретную
 *
 * Берётся первая approved Stories, дата которой наступила (если она назначена).
 * За день выходит один комплект: два видео, вопрос и ответ. Черновики не выходят.
 *
 * Токен — только из переменной окружения IG_ACCESS_TOKEN, в файлы его не класть.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { selectStory } = require('./stories-selection');
const STORY_MEDIA = require('./stories-prepared');

const BANK = path.join(__dirname, 'content', 'stories.json');
const QUEUE = path.join(__dirname, 'content', 'queue.json');
const API = 'https://graph.facebook.com/v23.0';
const TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID || JSON.parse(fs.readFileSync(QUEUE, 'utf8')).account_id;

// Имя репозитория можно переименовать, и тогда ссылки протухнут разом.
// В GitHub Actions актуальное имя всегда в GITHUB_REPOSITORY — берём оттуда.
const REPO = process.env.GITHUB_REPOSITORY || 'zairush8877-sys/repetitor';
const rawBase = revision => `https://raw.githubusercontent.com/${REPO}/${revision}/content/stories`;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyId = args.find(a => !a.startsWith('--'));

// A runner's disk is disposable. Persist intent remotely before media_publish,
// so a lost response/runner or a later push failure cannot enable a fresh send.
function checkpointBank() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Реальный выпуск Stories разрешён только через GitHub Actions с сохранением состояния в main. Локально используйте --dry-run.');
  }
  const git = args => execFileSync('git', args, {
    cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 55000,
  });
  try {
    const file = 'content/stories.json';
    git(['add', '--', file]);
    if (!git(['diff', '--cached', '--name-only', '--', file]).trim()) return;
    // Commit only the bank: preparation reports and other staged changes wait
    // for the workflow's final persistence step.
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
      'commit', '-m', 'Контрольная точка отправки Stories', '--', file]);
    // No force, rebase or automatic retry here. A conflict stops publication.
    git(['push', 'origin', 'HEAD:refs/heads/main']);
  } catch {
    // Do not echo git stderr: a transport error may contain credential material.
    throw new Error('Не удалось сохранить контрольную точку Stories в main. Отправка остановлена; перед повтором сверить удалённое состояние.');
  }
}

function mediaRevision(story) {
  const files = [...STORY_MEDIA.mediaPaths(story.id), STORY_MEDIA.manifestRelative(story.id)];
  const git = args => execFileSync('git', args, {
    cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 55000,
  });
  try {
    git(['ls-files', '--error-unmatch', '--', ...files]);
    if (git(['status', '--porcelain', '--', ...files]).trim()) throw new Error('Uncommitted media');
    const revision = git(['rev-parse', 'HEAD']).trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid revision');
    return revision;
  } catch {
    throw new Error('Видео и manifest Stories должны быть сохранены в GitHub. Локальные или изменённые файлы не допускаются к выпуску.');
  }
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
 * Каждый кадр — отдельное видео с музыкой; публикуются вопрос и ответ.
 * Видео обрабатывается дольше картинки, отсюда запас по числу проверок.
 */
async function publishFrame(url, label, story, index, persist) {
  const parts = story.delivery?.parts || [];
  story.delivery = { ...story.delivery, parts };
  let publishAttempted = false;
  try {
    const { id } = await api('POST', `${IG_USER_ID}/media`, {
      media_type: 'STORIES',
      video_url: url,
    });
    if (!id) throw new Error(`${label}: API не вернул ID контейнера`);
    await waitReady(id, label, 60);
    parts[index] = { state: 'publishing', containerId: id, attemptedAt: new Date().toISOString() };
    persist(); // Persist before the irreversible API call; ambiguous results must not retry.
    publishAttempted = true;
    const { id: mediaId } = await api('POST', `${IG_USER_ID}/media_publish`, { creation_id: id });
    if (!mediaId) throw new Error(`${label}: API не вернул ID публикации`);
    parts[index] = { ...parts[index], state: 'published', mediaId };
    story.publishedMediaIds ||= [];
    story.publishedMediaIds[index] = mediaId;
    persist();
    return mediaId;
  } catch (e) {
    if (publishAttempted) {
      parts[index] = { ...parts[index], state: 'unknown', error: e.message };
      persist();
    }
    throw e;
  }
}

/** Both complete videos must be reachable before the first part is sent. */
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
  const { story, detail } = selectStory(bank, { onlyId });
  const persist = () => {
    fs.writeFileSync(`${BANK}.tmp`, JSON.stringify(bank, null, 2) + '\n');
    fs.renameSync(`${BANK}.tmp`, BANK);
    checkpointBank();
  };

  if (!story) {
    console.log(detail);
    return;
  }

  // Сторис выходит двумя видео — вопрос и ответ: тап по видео не листает
  // кадры внутри него, а перекидывает на следующую сторис, поэтому в едином
  // ролике ответ терялся у всех, кто тапнул.
  let urls = [1, 2].map(n => `${rawBase('main')}/${story.id}-${n}.mp4`);
  for (const n of [1, 2]) {
    if (!fs.existsSync(path.join(__dirname, 'content/stories', `${story.id}-${n}.mp4`))) {
      throw new Error(`Не готово видео ${story.id}-${n}.mp4. Сначала рендер и проверка.`);
    }
  }
  const prepared = STORY_MEDIA.validate(story);
  if (!prepared.ok) throw new Error(`Сборка Stories не соответствует тексту: ${prepared.errors.join(' ')}`);

  if (dryRun) {
    console.log(`(dry-run, без API) ${detail}`);
    urls.forEach(u => console.log('  ' + u));
    return;
  }
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Реальный выпуск Stories разрешён только через GitHub Actions с сохранением состояния в main. Локально используйте --dry-run.');
  }
  if (!TOKEN) throw new Error('Нет токена: задайте переменную окружения IG_ACCESS_TOKEN.');
  // Pin the verified, committed assets; a mutable main URL could serve an old
  // cached render or a newer revision than the files checked by this runner.
  const revision = mediaRevision(story);
  urls = [1, 2].map(n => `${rawBase(revision)}/${story.id}-${n}.mp4`);
  const me = await api('GET', IG_USER_ID, { fields: 'username' });
  console.log(`@${me.username} — сторис ${story.id} [${story.type}]`);
  for (const url of urls) if (!await hasVideo(url)) throw new Error(`Видео недоступно в GitHub: ${url}`);

  // Части публикуются с сохранением прогресса: если ответ упал после
  // вышедшего вопроса, повторный запуск не дублирует вопрос в сторис.
  const ids = story.publishedMediaIds || [];
  for (const [i, u] of urls.entries()) {
    if (ids[i]) { console.log(`  – видео ${i + 1} уже выходило: ${ids[i]}`); continue; }
    ids[i] = await publishFrame(u, `${story.id} часть ${i + 1}`, story, i, persist);
    story.publishedMediaIds = ids;
    persist();
    console.log(`  ✓ видео ${i + 1}: ${ids[i]}`);
  }

  story.status = 'published';
  story.publishedAt = new Date().toISOString();
  persist();
  console.log(`Готово. Одобрено осталось: ${bank.stories.filter(item => item.status === 'approved').length}.`);
})().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
