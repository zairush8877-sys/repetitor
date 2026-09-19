'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { selectStory, moscowDate, validDate } = require('../stories-selection');
const { prepare, carousel, importExam } = require('../scripts/stories-pipeline.cjs');
const STORY_MEDIA = require('../stories-prepared');

const today = '2026-09-20';
const choose = (stories, extra = {}) => selectStory({ stories }, { today, ...extra });
function fixture(t, stories) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-pipeline-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'content/stories'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content/stories.json'), JSON.stringify({ stories }));
  return root;
}
function published(id = 'st-1', date = '2026-09-19') {
  return { id, type: 'vopros', q: 'Вопрос?', a: 'Первый', b: 'Второй', right: 'b', why: 'Проверяем объяснение.', source: 'Тестовый источник', status: 'published', publishedAt: `${date}T07:00:00Z`, publishedMediaIds: [`${id}-q`, `${id}-a`] };
}
test('only approved due stories qualify; an explicit ID grants no approval', () => {
  const stories = [{ id: 'draft', status: 'pending' }, { id: 'future', status: 'approved', date: '2026-09-21' }, { id: 'ready', status: 'approved' }];
  assert.equal(choose(stories).story.id, 'ready');
  assert.equal(choose(stories, { onlyId: 'draft' }).story, null);
  assert.equal(choose(stories, { onlyId: 'future' }).story, null);
  assert.equal(choose([published()], { onlyId: 'st-1' }).story, null);
});
test('one complete set per Moscow day, including UTC date rollover', () => {
  const story = { ...published(), publishedAt: '2026-09-19T21:01:00Z' };
  assert.equal(moscowDate(story.publishedAt), today);
  assert.equal(choose([story, { id: 'ready', status: 'approved' }]).reason, 'already-published-today');
});
test('unknown delivery blocks repeats and other sets; sparse part arrays are valid', () => {
  const uncertain = { id: 'partial', status: 'approved', delivery: { parts: [null, { state: 'unknown' }] } };
  assert.equal(choose([uncertain, { id: 'ready', status: 'approved' }]).reason, 'unknown-delivery');
});
test('confirmed first part resumes its own set before any other set', () => {
  const stories = [{ id: 'other', status: 'approved' }, { id: 'partial', status: 'approved', publishedMediaIds: ['q-id'] }];
  assert.equal(choose(stories).story.id, 'partial');
  assert.equal(choose(stories, { onlyId: 'other' }).reason, 'partial-delivery');
});
test('invalid IDs, duplicate IDs, malformed calendar dates fail closed', () => {
  assert.throws(() => choose([{ id: '../escape', status: 'approved' }]));
  assert.throws(() => choose([{ id: 'a' }, { id: 'a' }]));
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-13-01'), false);
  assert.equal(choose([{ id: 'invalid-date', status: 'approved', date: '2026-02-30' }]).story, null);
});
test('archive records both IDs and exact text without changing the live bank', t => {
  const root = fixture(t, [published(), { ...published('incomplete'), publishedMediaIds: ['only-one'] }]);
  const file = path.join(root, 'content/stories.json');
  const before = fs.readFileSync(file);
  const report = prepare({ root, today });
  assert.equal(report.archived, 1);
  assert.equal(report.publicationAttempted, false);
  assert.deepEqual(fs.readFileSync(file), before);
  const archive = JSON.parse(fs.readFileSync(path.join(root, 'content/stories-archive/index.json')));
  assert.deepEqual(archive.items[0].content.why, published().why);
  assert.equal(archive.items[0].media.length, 4);
  const archiveBefore = fs.readFileSync(path.join(root, 'content/stories-archive/index.json'));
  prepare({ root, today });
  assert.deepEqual(fs.readFileSync(path.join(root, 'content/stories-archive/index.json')), archiveBefore);
});
test('changed archived content never silently replaces the snapshot', t => {
  const root = fixture(t, [published()]);
  prepare({ root, today });
  fs.writeFileSync(path.join(root, 'content/stories.json'), JSON.stringify({ stories: [{ ...published(), why: 'Другой текст' }] }));
  assert.throws(() => prepare({ root, today }), /Архив отличается/);
});
test('preparation requires both video parts, not JPG fallback', t => {
  const root = fixture(t, [{ id: 'ready', status: 'approved' }]);
  fs.writeFileSync(path.join(root, 'content/stories/ready-1.mp4'), 'fixture');
  assert.equal(prepare({ root, today }).status, 'needs-render');
  fs.writeFileSync(path.join(root, 'content/stories/ready-2.mp4'), 'fixture');
  assert.equal(prepare({ root, today }).status, 'needs-render');
  STORY_MEDIA.writeManifest({ id: 'ready', status: 'approved' }, { root });
  const report = prepare({ root, today });
  assert.equal(report.status, 'selected');
  assert.ok(report.media.filter(item => item.available).every(item => item.sha256));
});
test('render manifest binds the text, sources and two bytestrings; approval alone does not change it', t => {
  const story = { id: 'ready', status: 'pending', type: 'vopros', q: 'Вопрос?', a: 'А', b: 'Б', right: 'a', why: 'Разбор', sources: ['source-one'] };
  const root = fixture(t, [story]);
  for (const part of [1, 2]) fs.writeFileSync(path.join(root, `content/stories/ready-${part}.mp4`), `rendered fixture ${part}`);
  assert.equal(STORY_MEDIA.validate(story, { root }).ok, false);
  STORY_MEDIA.writeManifest(story, { root });
  assert.equal(STORY_MEDIA.validate({ ...story, status: 'approved', date: today }, { root }).ok, true);
  assert.equal(STORY_MEDIA.validate({ ...story, right: 'b' }, { root }).ok, false);
  assert.equal(STORY_MEDIA.validate({ ...story, sources: ['source-two'] }, { root }).ok, false);
  fs.writeFileSync(path.join(root, 'content/stories/ready-2.mp4'), 'altered file');
  assert.equal(STORY_MEDIA.validate(story, { root }).ok, false);
  assert.throws(() => STORY_MEDIA.writeManifest({ ...story, status: 'published' }, { root }), /опубликованной/);
});
test('preparation rejects a changed answer instead of blessing unchanged old video files', t => {
  const story = { id: 'ready', status: 'approved', right: 'a', why: 'Первый ответ' };
  const root = fixture(t, [story]);
  for (const part of [1, 2]) fs.writeFileSync(path.join(root, `content/stories/ready-${part}.mp4`), `rendered fixture ${part}`);
  STORY_MEDIA.writeManifest(story, { root });
  assert.equal(prepare({ root, today }).status, 'selected');
  fs.writeFileSync(path.join(root, 'content/stories.json'), JSON.stringify({ stories: [{ ...story, right: 'b' }] }));
  assert.equal(prepare({ root, today }).status, 'needs-render');
});
test('carousel preserves ordered question/answer pairs and sources, without date or queue entry', t => {
  const root = fixture(t, [published('one', '2026-09-18'), published('two', '2026-09-19')]);
  prepare({ root, today });
  const result = carousel({ root, from: '2026-09-18', through: '2026-09-19', id: 'review' });
  const draft = JSON.parse(fs.readFileSync(result.file));
  assert.equal(draft.slides.length, 4);
  assert.deepEqual(draft.slides.map(slide => [slide.sourceStoryId, slide.sourcePart]), [['one', 1], ['one', 2], ['two', 1], ['two', 2]]);
  assert.equal(draft.status, 'pending');
  assert.equal(draft.publicationDate, null);
  assert.equal(draft.sources.length, 2);
  assert.equal(fs.existsSync(path.join(root, 'content/queue.json')), false);
});
test('carousel requires an explicit bounded period; no automatic day', t => {
  const root = fixture(t, Array.from({ length: 6 }, (_, index) => published(`st-${index}`, '2026-09-19')));
  prepare({ root, today });
  assert.throws(() => carousel({ root, id: 'no-date' }), /период/);
  assert.throws(() => carousel({ root, from: '2026-09-19', through: '2026-09-19', id: 'too-long' }), /не более 5/);
});
function examSource(root) {
  const posts = [{ id: 'exam-one', exam: 'ЕГЭ', format: 'Reels', proposedDate: '2026-09-26', status: 'pending', sources: ['https://example.test/source'], caption: 'Исходная подпись', scenes: [{ headline: 'Вопрос', body: 'Условие' }, { headline: 'Ответ', body: 'Полный ответ' }, { headline: 'Проверка', body: 'Не терять последний кадр' }] }];
  for (const post of posts) for (const scene of post.scenes) scene.seconds = 6;
  fs.mkdirSync(path.join(root, 'video-lab'));
  fs.writeFileSync(path.join(root, 'video-lab/exam-bank.json'), JSON.stringify(posts));
  return posts;
}
test('exam import keeps every scene in isolated pending drafts; proposal is not publication date', t => {
  const root = fixture(t, []);
  examSource(root);
  const result = importExam({ root });
  const bank = JSON.parse(fs.readFileSync(result.file));
  assert.equal(bank.stories[0].status, 'pending');
  assert.equal(bank.stories[0].date, undefined);
  assert.equal(bank.stories[0].proposedDate, '2026-09-26');
  assert.equal(bank.stories[0].explanation.length, 2);
  assert.equal(bank.stories[0].sourceMedia.ready, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'content/stories.json'))).stories.length, 0);
  assert.equal(prepare({ root, today }).isolatedDraftsAvailable, 1);
});
test('exam reimport is idempotent and preserves pending editorial edits', t => {
  const root = fixture(t, []);
  examSource(root);
  const result = importExam({ root });
  const bank = JSON.parse(fs.readFileSync(result.file));
  bank.stories[0].question.headline = 'Редактор исправил заголовок';
  fs.writeFileSync(result.file, JSON.stringify(bank));
  importExam({ root });
  assert.equal(JSON.parse(fs.readFileSync(result.file)).stories[0].question.headline, 'Редактор исправил заголовок');
});
test('exam import rejects duplicates or changed source, without partial writes', t => {
  const root = fixture(t, []);
  const posts = examSource(root);
  const result = importExam({ root });
  const before = fs.readFileSync(result.file);
  fs.writeFileSync(path.join(root, 'video-lab/exam-bank.json'), JSON.stringify([...posts, ...posts]));
  assert.throws(() => importExam({ root }), /Повторный/);
  assert.deepEqual(fs.readFileSync(result.file), before);
  posts[0].scenes[1].body = 'Изменённый источник';
  fs.writeFileSync(path.join(root, 'video-lab/exam-bank.json'), JSON.stringify(posts));
  assert.throws(() => importExam({ root }), /исходный текст изменился/);
  assert.deepEqual(fs.readFileSync(result.file), before);
});
test('music-learning source correction cannot silently reuse an old exam draft', t => {
  const root = fixture(t, []), posts = examSource(root);
  posts[0].musicLearning = { fact: 'Проверенный факт', source: 'old-source' };
  fs.writeFileSync(path.join(root, 'video-lab/exam-bank.json'), JSON.stringify(posts));
  const result = importExam({ root }), before = fs.readFileSync(result.file);
  posts[0].musicLearning.source = 'corrected-source';
  fs.writeFileSync(path.join(root, 'video-lab/exam-bank.json'), JSON.stringify(posts));
  assert.throws(() => importExam({ root }), /исходный текст изменился/);
  assert.deepEqual(fs.readFileSync(result.file), before);
});
test('legacy exam hashes migrate only when every derived editorial field is untouched', t => {
  const crypto = require('node:crypto');
  const root = fixture(t, []), [post] = examSource(root);
  const result = importExam({ root });
  const legacy = JSON.parse(fs.readFileSync(result.file));
  const oldHash = crypto.createHash('sha256').update(JSON.stringify({ scenes: post.scenes, sources: post.sources, caption: post.caption, music: post.music })).digest('hex');
  legacy.stories[0].sourceContentSha256 = oldHash;
  delete legacy.stories[0].sourceHashVersion;
  fs.writeFileSync(result.file, JSON.stringify(legacy));
  importExam({ root });
  assert.equal(JSON.parse(fs.readFileSync(result.file)).stories[0].sourceHashVersion, 2);
  legacy.stories[0].question.headline = 'Редакторская правка';
  fs.writeFileSync(result.file, JSON.stringify(legacy));
  const before = fs.readFileSync(result.file);
  assert.throws(() => importExam({ root }), /черновик отредактирован/);
  assert.deepEqual(fs.readFileSync(result.file), before);
});

function standaloneFixture(root, post) {
  const crypto = require('node:crypto');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const directory = path.join(root, 'outputs/exam-bank-2026-09-26/standalone-stories');
  fs.mkdirSync(path.join(directory, 'qa'), { recursive: true });
  const parts = [1, 2].map(index => {
    const data = Buffer.from(`standalone video fixture ${index}`), file = `${post.id}-${index}.mp4`;
    fs.writeFileSync(path.join(directory, file), data);
    return { index, role: index === 1 ? 'question' : 'answer', file, bytes: data.length, sha256: hash(data),
      width: 1080, height: 1920, fps: 30, duration: index === 1 ? 6 : 6 * (post.scenes.length - 1),
      sceneIndices: index === 1 ? [1] : post.scenes.slice(1).map((_, i) => i + 2), audioCodec: 'aac', geometry: { cropped: false } };
  });
  const index = { version: 1, status: 'pending', publicationPerformed: false, stories: [{
    id: `${post.id}-standalone`, sourcePostId: post.id, status: 'pending',
    configSha256: hash(fs.readFileSync(path.join(root, 'video-lab/exam-bank.json'))), parts,
  }] };
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(directory, 'qa/verification.json'), JSON.stringify({ allSourcesAndOutputsSHA256Match: true, audioMeasured: true,
    checks: parts.map(part => ({ file: part.file, sha256: part.sha256, audioLUFS: -20, audioTruePeakDBTP: -6 })) }));
  return { directory, index };
}
test('verified standalone MP4s become ready for review while drafts and live bank remain unapproved', t => {
  const root = fixture(t, []), [post] = examSource(root);
  standaloneFixture(root, post);
  const bankBefore = fs.readFileSync(path.join(root, 'content/stories.json'));
  const result = importExam({ root });
  const draft = JSON.parse(fs.readFileSync(result.file)).stories[0];
  assert.equal(result.standaloneReadyForReview, 1);
  assert.equal(draft.editorialStatus, 'ready-for-review');
  assert.equal(draft.status, 'pending');
  assert.equal(draft.date, undefined);
  assert.deepEqual(draft.preparedMedia.parts.map(part => part.role), ['question', 'answer']);
  assert.ok(draft.preparedMedia.manifest.sha256 && draft.preparedMedia.verification.sha256);
  const before = fs.readFileSync(result.file);
  importExam({ root });
  assert.deepEqual(fs.readFileSync(result.file), before);
  const report = prepare({ root, today });
  assert.equal(report.isolatedDraftsReadyForReview, 1);
  assert.equal(report.nextDraftToAdapt, null);
  assert.ok(report.nextDraftForReview);
  assert.deepEqual(fs.readFileSync(path.join(root, 'content/stories.json')), bankBefore);
});
test('standalone media corruption, missing answer and stale QA remove review readiness', t => {
  const root = fixture(t, []), [post] = examSource(root);
  const { directory } = standaloneFixture(root, post);
  const result = importExam({ root });
  fs.writeFileSync(path.join(directory, `${post.id}-2.mp4`), 'changed bytes');
  assert.equal(importExam({ root }).standaloneReadyForReview, 0);
  fs.rmSync(path.join(directory, `${post.id}-2.mp4`));
  assert.equal(importExam({ root }).standaloneReadyForReview, 0);
  standaloneFixture(root, post);
  fs.rmSync(path.join(directory, 'qa/verification.json'));
  assert.equal(importExam({ root }).standaloneReadyForReview, 0);
  assert.equal(JSON.parse(fs.readFileSync(result.file)).stories[0].editorialStatus, 'needs-media-verification');
});
test('standalone import preserves editorial edits and does not call mismatched media ready', t => {
  const root = fixture(t, []), [post] = examSource(root);
  standaloneFixture(root, post);
  const result = importExam({ root });
  const bank = JSON.parse(fs.readFileSync(result.file));
  bank.stories[0].explanation[0].body = 'Редакторская правка ответа';
  fs.writeFileSync(result.file, JSON.stringify(bank));
  assert.equal(importExam({ root }).standaloneReadyForReview, 0);
  const draft = JSON.parse(fs.readFileSync(result.file)).stories[0];
  assert.equal(draft.explanation[0].body, 'Редакторская правка ответа');
  assert.match(draft.preparedMedia.errors.join(' '), /Редакторские правки/);
});
test('standalone import requires the exact config revision and all answer scenes', t => {
  const root = fixture(t, []), [post] = examSource(root);
  const { directory, index } = standaloneFixture(root, post);
  index.stories[0].parts[1].sceneIndices = [2];
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index));
  assert.equal(importExam({ root }).standaloneReadyForReview, 0);
  standaloneFixture(root, post);
  fs.appendFileSync(path.join(root, 'video-lab/exam-bank.json'), '\n');
  assert.equal(importExam({ root }).standaloneReadyForReview, 0);
});

async function runPublisher(story, { dryRun = false, failPublish = false, failCheckpoint = false, failAfterPublish = false, actions = true, mediaValid = true, dirtyMedia = false } = {}) {
  const root = path.resolve(__dirname, '..');
  const bankPath = path.join(root, 'content/stories.json');
  const queuePath = path.join(root, 'content/queue.json');
  const files = new Map([[bankPath, JSON.stringify({ stories: [story] })], [queuePath, JSON.stringify({ account_id: 'account-fixture' })]]);
  const calls = [];
  const events = [], errors = [], remoteSnapshots = [];
  let count = 0;
  const git = (_binary, args) => {
    events.push({ kind: 'git', args });
    if (args[0] === 'rev-parse') return '1'.repeat(40);
    if (args[0] === 'status') return dirtyMedia ? ' M content/stories/ready-1.mp4' : '';
    if (args[0] === 'diff') return 'content/stories.json\n';
    if (args[0] === 'push') {
      if (failCheckpoint || (failAfterPublish && count)) throw new Error('simulated transport error secret-test-value');
      remoteSnapshots.push(JSON.parse(files.get(bankPath)).stories[0]);
    }
    return '';
  };
  const context = {
    require: name => name === 'fs' ? {
      readFileSync: file => files.get(file), existsSync: () => true,
      writeFileSync: (file, value) => files.set(file, value),
      renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    } : name === './stories-selection' ? require('../stories-selection')
      : name === './stories-prepared' ? { ...STORY_MEDIA, validate: () => ({ ok: mediaValid, errors: mediaValid ? [] : ['stale manifest'] }) }
      : name === 'child_process' ? { execFileSync: git } : require(name),
    __dirname: root, URL, URLSearchParams,
    process: { argv: ['node', 'publish-stories.js', ...(dryRun ? ['--dry-run'] : [])], env: dryRun ? {} : { IG_ACCESS_TOKEN: 'test-fixture', ...(actions ? { GITHUB_ACTIONS: 'true' } : {}) }, exit: () => {} },
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    setTimeout,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' });
      if (options.method === 'HEAD') return { ok: true };
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/media_publish')) {
        events.push({ kind: 'media_publish', durableIntent: remoteSnapshots.at(-1)?.delivery?.parts?.some(part => part?.state === 'publishing') });
        if (failPublish) throw new Error('response lost after publication request');
        return { json: async () => ({ id: `media-${++count}` }) };
      }
      if (pathname.endsWith('/media')) return { json: async () => ({ id: 'container' }) };
      if (pathname.endsWith('/container')) return { json: async () => ({ status_code: 'FINISHED' }) };
      return { json: async () => ({ username: 'mairova_a_a' }) };
    },
  };
  await vm.runInNewContext(fs.readFileSync(path.join(root, 'publish-stories.js'), 'utf8'), context);
  return { story: JSON.parse(files.get(bankPath)).stories[0], calls, events, errors, remoteSnapshots, remoteStory: remoteSnapshots.at(-1) || story };
}
test('publisher dry-run performs zero API calls and no status writes', async () => {
  const original = { id: 'ready', type: 'vopros', status: 'approved' };
  const result = await runPublisher(original, { dryRun: true });
  assert.equal(result.calls.length, 0);
  assert.deepEqual(result.story, original);
});
test('publisher saves both IDs after success, resumes only missing confirmed part', async () => {
  const result = await runPublisher({ id: 'ready', type: 'vopros', status: 'approved', publishedMediaIds: ['existing-q'] });
  assert.equal(result.story.status, 'published');
  assert.deepEqual(result.story.publishedMediaIds, ['existing-q', 'media-1']);
  assert.equal(result.calls.filter(call => call.url.endsWith('/media_publish')).length, 1);
  assert.ok(result.events.filter(event => event.kind === 'media_publish').every(event => event.durableIntent));
  assert.equal(result.remoteStory.status, 'published');
  assert.ok(result.calls.filter(call => call.method === 'HEAD').every(call => call.url.includes(`/${'1'.repeat(40)}/`)));
});
test('a fresh two-part publication checkpoints each intent and the final complete set', async () => {
  const result = await runPublisher({ id: 'ready', status: 'approved' });
  assert.deepEqual(result.remoteStory.publishedMediaIds, ['media-1', 'media-2']);
  assert.equal(result.remoteStory.status, 'published');
  const attempts = result.events.filter(event => event.kind === 'media_publish');
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(event => event.durableIntent));
  assert.ok(result.remoteSnapshots.some(story => story.delivery.parts[1]?.state === 'publishing' && story.publishedMediaIds[0] === 'media-1'));
});
test('failed durable intent checkpoint prevents the irreversible API call', async () => {
  const result = await runPublisher({ id: 'ready', status: 'approved' }, { failCheckpoint: true });
  assert.equal(result.calls.filter(call => call.url.endsWith('/media_publish')).length, 0);
  assert.equal(result.remoteSnapshots.length, 0);
  assert.equal(result.story.delivery.parts[0].state, 'publishing');
  assert.ok(result.errors.every(error => !error.includes('secret-test-value')));
});
test('failed post-publication checkpoint leaves a durable intent that blocks a fresh runner', async () => {
  const result = await runPublisher({ id: 'ready', status: 'approved' }, { failAfterPublish: true });
  assert.equal(result.calls.filter(call => call.url.endsWith('/media_publish')).length, 1);
  assert.equal(result.remoteStory.delivery.parts[0].state, 'publishing');
  const retry = await runPublisher(result.remoteStory);
  assert.equal(retry.calls.length, 0);
});
test('local live runs, uncommitted media, and invalid manifests fail before any API call', async () => {
  for (const options of [{ actions: false }, { mediaValid: false }, { dirtyMedia: true }]) {
    const result = await runPublisher({ id: 'ready', status: 'approved' }, options);
    assert.equal(result.calls.length, 0);
    assert.ok(result.errors.length);
  }
});
test('ambiguous publication result persists unknown and is never auto-retried', async () => {
  const result = await runPublisher({ id: 'ready', type: 'vopros', status: 'approved' }, { failPublish: true });
  assert.equal(result.story.delivery.parts[0].state, 'unknown');
  assert.equal(result.remoteStory.delivery.parts[0].state, 'unknown');
  assert.equal(result.story.status, 'approved');
  assert.equal(result.calls.filter(call => call.url.endsWith('/media_publish')).length, 1);
  const retry = await runPublisher(result.story);
  assert.equal(retry.calls.length, 0);
});
