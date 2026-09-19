#!/usr/bin/env node
'use strict';

// Local preparation only. This file has no Instagram or network calls.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { moscowDate, validDate, selectStory, ID } = require('../stories-selection');
const STORY_MEDIA = require('../stories-prepared');
const { contentSnapshot } = STORY_MEDIA;

const ROOT = path.resolve(__dirname, '..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const digest = object => sha(JSON.stringify(object));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

function paths(root) {
  return {
    bank: path.join(root, 'content/stories.json'),
    archive: path.join(root, 'content/stories-archive/index.json'),
    days: path.join(root, 'content/stories-prepared/days'),
  };
}

function mediaFor(story, root) {
  return [1, 2].flatMap(part => ['jpg', 'mp4'].map(extension => {
    const file = `content/stories/${story.id}-${part}.${extension}`;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) return { part, file, available: false };
    const buffer = fs.readFileSync(absolute);
    return { part, file, available: true, bytes: buffer.length, sha256: sha(buffer) };
  }));
}

function archivePublished(bank, root) {
  const file = paths(root).archive;
  const archive = fs.existsSync(file) ? json(file) : {
    schemaVersion: 1, platform: 'Instagram', account: '@mairova_a_a',
    note: 'IDs are publication evidence from the saved bank, not a fresh API check. Media hashes describe locally available files; historical music/photo metadata is not inferred from current rotation.',
    items: [],
  };
  const conflicts = [];
  for (const story of bank.stories) {
    if (story.status !== 'published' || !story.publishedAt || story.publishedMediaIds?.filter(Boolean).length !== 2) continue;
    const content = contentSnapshot(story);
    const contentSha256 = digest(content);
    const evidence = { publishedAt: story.publishedAt, publishedMediaIds: story.publishedMediaIds };
    const existing = archive.items.find(item => item.storyId === story.id);
    if (existing) {
      if (existing.contentSha256 !== contentSha256 || digest(existing.evidence) !== digest(evidence)) conflicts.push(story.id);
      continue; // Never rewrite a historical snapshot silently.
    }
    archive.items.push({
      storyId: story.id, date: moscowDate(story.publishedAt), content, contentSha256, evidence,
      media: mediaFor(story, root), editorialStatus: 'requires-source-recheck-before-reuse',
    });
  }
  if (conflicts.length) throw new Error(`Архив отличается от банка: ${conflicts.join(', ')}. Снимок сохранён; нужна сверка.`);
  archive.items.sort((a, b) => a.date.localeCompare(b.date) || a.storyId.localeCompare(b.storyId));
  writeJson(file, archive);
  return archive;
}

function prepare({ root = ROOT, today = moscowDate(), onlyId } = {}) {
  const p = paths(root);
  const bank = json(p.bank);
  const selection = selectStory(bank, { today, onlyId });
  const archive = archivePublished(bank, root);
  const media = selection.story ? mediaFor(selection.story, root) : [];
  const missing = media.filter(item => item.file.endsWith('.mp4') && !item.available).map(item => item.file);
  const prepared = selection.story ? STORY_MEDIA.validate(selection.story, { root }) : null;
  const draftsFile = path.join(root, 'content/stories-drafts/exam-bank.json');
  const drafts = fs.existsSync(draftsFile) ? json(draftsFile).stories.filter(story => story.status === 'pending') : [];
  const reviewDrafts = drafts.filter(story => story.preparedMedia?.ready && story.editorialStatus === 'ready-for-review');
  const toAdapt = drafts.find(story => !story.preparedMedia?.ready);
  const report = {
    schemaVersion: 1, date: today, platform: 'Instagram', account: '@mairova_a_a',
    kind: 'standalone-stories', selectedStoryId: selection.story?.id || null,
    status: prepared && !prepared.ok ? 'needs-render' : selection.reason,
    detail: prepared && !prepared.ok ? `Выбран одобренный текст, но сборка не подтверждена: ${prepared.errors.join(' ')}` : selection.detail,
    approvedRemaining: bank.stories.filter(story => story.status === 'approved' && !story.publishedAt).length,
    draftRemaining: bank.stories.filter(story => !['approved', 'published', 'rejected'].includes(story.status)).length,
    archived: archive.items.length, publicationAttempted: false,
    isolatedDraftsAvailable: drafts.length,
    isolatedDraftsReadyForReview: reviewDrafts.length,
    nextDraftForReview: reviewDrafts.length ? { id: reviewDrafts[0].id, sourcePostId: reviewDrafts[0].sourcePostId, note: 'Два отдельных видео готовы к просмотру; выпуск ещё не одобрен.' } : null,
    nextDraftToAdapt: toAdapt ? { id: toAdapt.id, sourcePostId: toAdapt.sourcePostId, proposedDate: toAdapt.proposedDate, note: 'Нужна редакционная адаптация или сверка медиа; день самостоятельного выпуска не назначен.' } : null,
    ...(selection.story ? { content: contentSnapshot(selection.story), media, missing, preparationErrors: prepared.errors } : {}),
    carousel: { publicationDate: null, state: 'not-scheduled', command: 'node scripts/stories-pipeline.cjs carousel --from YYYY-MM-DD --through YYYY-MM-DD --id chosen-name' },
  };
  if (selection.reason === 'no-approved-story' && reviewDrafts.length) report.detail = `Нет одобренных самостоятельных Stories. Готово к просмотру ${reviewDrafts.length} комплектов из отдельного банка; выпуск пока не согласован.`;
  writeJson(path.join(p.days, `${today}.json`), report);
  return report;
}

function slidePair(item) {
  const story = item.content;
  const first = story.type === 'vopros'
    ? { kicker: 'Вопрос', title: story.q, text: `А. ${story.a}\nБ. ${story.b}` }
    : { kicker: story.top, title: story.big, text: '' };
  const answer = story.type === 'vopros' ? story[story.right] : story.big;
  return [
    { ...first, sourceStoryId: story.id, sourcePart: 1 },
    { kicker: 'Разбор', title: answer, text: story.why, sourceStoryId: story.id, sourcePart: 2 },
  ];
}

function carousel({ root = ROOT, from, through, id }) {
  if (!validDate(from) || !validDate(through) || from > through) throw new Error('Укажите период --from YYYY-MM-DD --through YYYY-MM-DD.');
  if (!ID.test(id || '')) throw new Error('Нужен безопасный уникальный --id черновика.');
  const archive = json(paths(root).archive);
  const items = archive.items.filter(item => item.date >= from && item.date <= through);
  if (!items.length) throw new Error('В выбранном периоде нет архивных комплектов с двумя подтверждёнными IDs.');
  // At most ten cards in this production path; never split a question/answer pair.
  if (items.length > 5) throw new Error('Выберите не более 5 комплектов: карусель этого конвейера содержит до 10 слайдов.');
  const out = path.join(root, 'outputs/stories-carousel', id);
  const manifest = {
    schemaVersion: 1, id, platform: 'Instagram', account: '@mairova_a_a',
    status: 'pending', publicationDate: null, editorialStatus: 'needs-source-and-copy-review',
    period: { from, through }, sourceStoryIds: items.map(item => item.storyId),
    sourceContentHashes: items.map(item => ({ id: item.storyId, sha256: item.contentSha256 })),
    format: 'Карусель', title: `Из ежедневных историй: ${items.length} языковых разборов`,
    slides: items.flatMap(slidePair),
    sources: items.map(item => ({ storyId: item.storyId, source: item.content.source || item.content.sources || null })),
    requiredBeforeRelease: ['Повторная проверка языковых источников и редактура', 'Новые макеты 1080×1350 с читаемым полным текстом', 'Музыка, композитор, исполнитель и музыкальная справка', 'Полный Stories-репост всех слайдов', 'Отдельное одобрение и дата публикации'],
    note: 'A content draft only; no feed queue entry, approval, render or publication is created. Old images are references, not cropped into carousel slides.',
  };
  const file = path.join(out, 'draft.json');
  if (fs.existsSync(file) && digest(json(file)) !== digest(manifest)) throw new Error('Черновик с таким ID уже существует и отличается. Выберите новый ID.');
  writeJson(file, manifest);
  fs.mkdirSync(out, { recursive: true });
  const markdown = `# ${manifest.title}\n\nЧерновик. День выпуска не назначен. Источники нуждаются в повторной проверке.\n\nПериод: ${from} — ${through}.\n\n` + manifest.slides.map((slide, index) => `## ${index + 1}. ${slide.kicker}\n\n${slide.title}\n\n${slide.text}\n\nИсточник материала: ${slide.sourceStoryId}, часть ${slide.sourcePart}.`).join('\n\n') + '\n';
  fs.writeFileSync(path.join(out, 'draft.md'), markdown);
  return { file, stories: items.length, slides: manifest.slides.length, status: 'pending', date: null };
}

function standaloneBundle(root, configFile) {
  const directory = 'outputs/exam-bank-2026-09-26/standalone-stories';
  const manifest = `${directory}/index.json`, verification = `${directory}/qa/verification.json`;
  if (!fs.existsSync(path.join(root, manifest))) return null;
  const index = json(path.join(root, manifest));
  if (!Array.isArray(index.stories) || new Set(index.stories.map(story => story.sourcePostId)).size !== index.stories.length) throw new Error('Некорректный или повторный sourcePostId в manifest самостоятельных Stories.');
  const qa = fs.existsSync(path.join(root, verification)) ? json(path.join(root, verification)) : null;
  return { directory, index, qa, configSha256: sha(fs.readFileSync(configFile)),
    manifest: { file: manifest, sha256: sha(fs.readFileSync(path.join(root, manifest))) },
    verification: qa ? { file: verification, sha256: sha(fs.readFileSync(path.join(root, verification))) } : null };
}

function standaloneMedia(post, bundle, root) {
  if (!bundle) return null;
  const record = bundle.index.stories.find(story => story.sourcePostId === post.id);
  if (!record) return null;
  const errors = [], parts = [];
  if (bundle.index.version !== 1 || bundle.index.status !== 'pending' || bundle.index.publicationPerformed !== false || record.status !== 'pending' || record.date) errors.push('Manifest должен описывать изолированную неопубликованную сборку.');
  if (record.configSha256 !== bundle.configSha256) errors.push('Исходный exam-bank.json изменился после сборки видео.');
  if (!bundle.qa?.allSourcesAndOutputsSHA256Match || !bundle.qa?.audioMeasured || !Array.isArray(bundle.qa?.checks)) errors.push('Нет полного отчёта проверки хешей и звука.');
  if (!Array.isArray(record.parts) || record.parts.length !== 2) errors.push('Нужны отдельные вопрос и полный ответ.');
  else for (const [index, part] of record.parts.entries()) {
    const name = `${post.id}-${index + 1}.mp4`;
    const scenes = index ? post.scenes.slice(1) : post.scenes.slice(0, 1);
    const sceneIndices = index ? post.scenes.slice(1).map((_, i) => i + 2) : [1];
    const duration = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    if (part.file !== name || part.index !== index + 1 || part.role !== (index ? 'answer' : 'question')) { errors.push(`Неверный путь или роль части ${index + 1}.`); continue; }
    if (digest(part.sceneIndices ?? null) !== digest(sceneIndices) || !Number.isFinite(duration) || !Number.isFinite(part.duration) || Math.abs(part.duration - duration) > 0.15) errors.push(`Часть ${index + 1} не покрывает нужные сцены целиком.`);
    if (part.width !== 1080 || part.height !== 1920 || part.fps !== 30 || !part.audioCodec || part.geometry?.cropped !== false) errors.push(`Неподходящая геометрия или нет аудио в части ${index + 1}.`);
    const file = `${bundle.directory}/${name}`;
    try {
      const data = fs.readFileSync(path.join(root, file));
      if (!data.length || data.length !== part.bytes || sha(data) !== part.sha256) errors.push(`Байты части ${index + 1} не совпадают с manifest.`);
    } catch { errors.push(`Файл части ${index + 1} отсутствует.`); }
    const checked = Array.isArray(bundle.qa?.checks) ? bundle.qa.checks.find(item => item.file === name && item.sha256 === part.sha256) : null;
    if (!checked || !Number.isFinite(checked.audioLUFS) || !Number.isFinite(checked.audioTruePeakDBTP) || checked.audioLUFS <= -35 || checked.audioLUFS >= -10 || checked.audioTruePeakDBTP >= 0) errors.push(`Нет подходящей аудиопроверки части ${index + 1}.`);
    parts.push({ index: part.index, role: part.role, file, sha256: part.sha256, bytes: part.bytes,
      width: part.width, height: part.height, duration: part.duration, sceneIndices: part.sceneIndices,
      geometry: part.geometry, audioCodec: part.audioCodec });
  }
  return { kind: 'standalone-question-answer', storyId: record.id, manifest: bundle.manifest,
    verification: bundle.verification, configSha256: record.configSha256,
    parts, ready: errors.length === 0, errors,
    note: 'Изолированная сборка для просмотра. Этот manifest не даёт допуска в live банк и не заменяет одобрение выпуска.' };
}

function importExam({ root = ROOT } = {}) {
  const source = path.join(root, 'video-lab/exam-bank.json');
  const data = json(source);
  const posts = Array.isArray(data) ? data : data.posts;
  if (!Array.isArray(posts) || !posts.length) throw new Error('В exam-bank.json нет выпусков.');
  const bundle = standaloneBundle(root, source);
  const file = path.join(root, 'content/stories-drafts/exam-bank.json');
  const previous = fs.existsSync(file) ? json(file) : { schemaVersion: 1, stories: [] };
  if (new Set(previous.stories.map(story => story.sourcePostId)).size !== previous.stories.length) throw new Error('В существующем draft банке повторяются sourcePostId.');
  const seen = new Set();
  const stories = posts.map(post => {
    if (!ID.test(post.id || '') || seen.has(post.id)) throw new Error(`Повторный или некорректный sourcePostId: ${post.id}`);
    seen.add(post.id);
    if (!Array.isArray(post.scenes) || post.scenes.length < 2 || post.scenes.some(scene => !scene.headline || !scene.body)) {
      throw new Error(`${post.id}: нужны вопрос/тема и все сцены объяснения.`);
    }
    const existing = previous.stories.find(item => item.sourcePostId === post.id);
    if (existing && existing.status !== 'pending') throw new Error(`${post.id}: импорт не перезаписывает материал после редакционного допуска.`);
    const legacySource = { scenes: post.scenes, sources: post.sources, caption: post.caption, music: post.music };
    const contentHash = digest({ ...legacySource, musicLearning: post.musicLearning, exam: post.exam, format: post.format, proposedDate: post.proposedDate || post.date || null });
    const first = post.scenes[0];
    const carousel = post.format === 'carousel' || post.format === 'Карусель';
    const referenceFiles = Array.from({ length: carousel ? post.scenes.length : 1 }, (_, index) =>
      `outputs/exam-bank-2026-09-26/content/reposts/${post.id}-${index + 1}.jpg`);
    const draft = {
      id: `draft-story-${post.id}`, status: 'pending', type: 'exam-draft',
      sourcePostId: post.id, proposedDate: post.proposedDate || post.date || null,
      sourceContentSha256: contentHash, sourceHashVersion: 2, rubric: post.exam,
      question: { headline: first.headline, body: first.body },
      explanation: post.scenes.slice(1).map(scene => ({ headline: scene.headline, body: scene.body })),
      sources: post.sources || [], caption: post.caption,
      music: post.music || null, musicLearning: post.musicLearning || null,
      sourceMedia: {
        role: 'reference-to-feed-reposts', kind: carousel ? 'all-carousel-slides' : 'reel-announcement',
        files: referenceFiles,
        ready: referenceFiles.every(relative => fs.existsSync(path.join(root, relative))),
        note: carousel ? 'Полные слайды исходного выпуска; самостоятельный Stories-комплект ещё не собран.' : 'Анонс Reels не содержит всего объяснения; для самостоятельных Stories нужны отдельные кадры из question/explanation.',
      },
      editorialStatus: 'needs-story-adaptation-and-approval',
      requiredBeforeRelease: ['Адаптировать весь разбор к Stories без сокращения смысла', 'Проверить два видео, читаемость, звук и музыкальную справку', 'Одобрить самостоятельный комплект; только затем переносить в live банк'],
    };
    if (existing && existing.sourceContentSha256 !== contentHash) {
      const untouchedFields = ['question', 'explanation', 'sources', 'caption', 'music', 'musicLearning', 'rubric', 'proposedDate'];
      const untouchedLegacy = !existing.sourceHashVersion && existing.sourceContentSha256 === digest(legacySource)
        && untouchedFields.every(key => digest(existing[key] ?? null) === digest(draft[key] ?? null));
      if (!untouchedLegacy) throw new Error(`${post.id}: исходный текст изменился или прежний черновик отредактирован. Сначала сверить существующий черновик вручную.`);
    }
    const result = existing ? { ...existing, sourceContentSha256: contentHash, sourceHashVersion: 2, sourceMedia: { ...existing.sourceMedia, ready: draft.sourceMedia.ready } } : draft;
    const prepared = standaloneMedia(post, bundle, root);
    if (prepared) {
      const fields = ['question', 'explanation', 'sources', 'caption', 'music', 'musicLearning'];
      if (fields.some(key => digest(result[key] ?? null) !== digest(draft[key] ?? null))) {
        prepared.ready = false;
        prepared.errors.push('Редакторские правки черновика отличаются от исходного текста готового видео.');
      }
      result.preparedMedia = prepared;
      result.editorialStatus = prepared.ready ? 'ready-for-review' : 'needs-media-verification';
      result.sourceMedia.note = 'Справочные JPG выпуска из ленты; отдельные видео вопроса и ответа указаны в preparedMedia.';
      result.requiredBeforeRelease = prepared.ready
        ? ['Просмотреть готовые вопрос, полный ответ и музыкальную справку', 'Одобрить самостоятельный комплект; только затем назначать выпуск и переносить в live банк']
        : ['Сверить ошибки preparedMedia и при необходимости пересобрать соответствующие видео', 'Одобрить самостоятельный комплект; только затем назначать выпуск и переносить в live банк'];
    } else if (result.preparedMedia) {
      result.preparedMedia = { ...result.preparedMedia, ready: false, errors: ['Manifest самостоятельных Stories больше не найден.'] };
      result.editorialStatus = 'needs-media-verification';
    }
    return result;
  });
  if (previous.stories.some(story => !seen.has(story.sourcePostId))) throw new Error('Импорт удалил бы прежние черновики. Автоматическое удаление запрещено.');
  const draft = {
    schemaVersion: 1, platform: 'Instagram', account: '@mairova_a_a',
    kind: 'isolated-standalone-stories-drafts', source: 'video-lab/exam-bank.json',
    note: 'Все pending, без даты публикации. proposedDate относится к предложенному дню исходного выпуска. Этот файл не читает publish-stories.js.',
    stories,
  };
  writeJson(file, draft);
  return { file, count: stories.length, status: 'pending', publicationDates: 0, referencedMediaReady: stories.filter(story => story.sourceMedia.ready).length,
    standaloneReadyForReview: stories.filter(story => story.preparedMedia?.ready && story.editorialStatus === 'ready-for-review').length };
}

function main() {
  const args = process.argv.slice(2);
  const command = args.shift() || 'prepare';
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--date', '--id', '--from', '--through'].includes(key) || !args.length) throw new Error(`Неизвестный или неполный аргумент: ${key}`);
    options[key.slice(2)] = args.shift();
  }
  if (command === 'prepare') {
    const report = prepare({ today: options.date || moscowDate(), onlyId: options.id });
    console.log(`${report.date}: ${report.detail} Архив: ${report.archived}.`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `story_id=${report.status === 'selected' ? report.selectedStoryId : ''}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Самостоятельные Stories\n\n${report.date}: ${report.detail}\n\nАрхив: ${report.archived}; одобрено осталось: ${report.approvedRemaining}; черновиков в live банке: ${report.draftRemaining}; отдельных заготовок: ${report.isolatedDraftsAvailable}; готово к просмотру: ${report.isolatedDraftsReadyForReview}. Карусель не назначена.\n`);
  } else if (command === 'carousel') console.log(JSON.stringify(carousel({ from: options.from, through: options.through, id: options.id }), null, 2));
  else if (command === 'import-exam') console.log(JSON.stringify(importExam(), null, 2));
  else throw new Error(`Неизвестная команда: ${command}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare, carousel, archivePublished, mediaFor, contentSnapshot, importExam };
