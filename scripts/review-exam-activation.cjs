#!/usr/bin/env node
'use strict';

// Review only: writes proposed JSON and a copy plan under outputs. No live writes,
// rendering, network calls, or publication. Apply the reviewed plan separately.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const P = require('../prepared-media');
const { readyForDay } = require('../daily-selection');
const root = path.resolve(__dirname, '..');
const source = 'outputs/exam-bank-2026-09-26/content';
const output = 'outputs/exam-activation-review-2026-09-20';
if (process.argv.length !== 2) throw new Error('Review only; no arguments or --apply are accepted.');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const hash = relative => P.sha(fs.readFileSync(path.join(root, relative)));
const paths = ['queue.json', 'prepared/index.json', 'reposts/index.json'];
const watched = [...paths.map(p => `content/${p}`), ...paths.map(p => `${source}/${p}`), 'content/stories.json'];
const baseline = Object.fromEntries(watched.map(p => [p, hash(p)]));
const [liveQueue, livePrepared, liveReposts] = paths.map(p => read(`content/${p}`));
const [bank, prepared, reposts] = paths.map(p => read(`${source}/${p}`));
assert.equal(bank.posts.length, 14, 'Expected exactly fourteen new posts');
assert.equal(new Set(bank.posts.map(p => p.id)).size, 14, 'Duplicate new ID');
assert.equal(bank.posts.filter(p => p.format === 'Reels').length, 8);
assert.equal(bank.posts.filter(p => p.format === 'Карусель').length, 6);
const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10));
assert.deepEqual(bank.posts.map(p => p.proposedDate), dates, 'Unexpected date order');
const mergedQueue = structuredClone(liveQueue);
const mergedPrepared = structuredClone(livePrepared);
const mergedReposts = structuredClone(liveReposts);
const copies = new Map();
const summaries = [];
function addCopy(relative, expectedSha) {
  assert.match(relative, /^(?:images|reels|reposts)\/[a-zA-Z0-9_-]+\.(?:mp4|jpg)$/);
  const from = `${source}/${relative}`, to = `content/${relative}`;
  const bytes = fs.readFileSync(path.join(root, from));
  assert.equal(P.sha(bytes), expectedSha, `${from}: source hash mismatch`);
  if (fs.existsSync(path.join(root, to))) assert.equal(hash(to), expectedSha, `${to}: existing different file`);
  const gitBlobSha1 = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const copy = { from, to, relative, bytes: bytes.length, sha256: expectedSha, gitBlobSha1 };
  if (copies.has(to)) assert.deepEqual(copies.get(to), copy, 'Conflicting copy destination');
  copies.set(to, copy);
}
for (const draft of bank.posts) {
  assert.equal(draft.status, 'pending');
  assert.equal(draft.date, undefined);
  assert.ok(draft.id.startsWith(`${draft.proposedDate}-`));
  assert.ok(!Object.keys(draft).some(k => /published|delivery|creationId|storyRepost/i.test(k)), 'Unexpected delivery state');
  assert.ok(!liveQueue.posts.some(p => p.id === draft.id), `ID already live: ${draft.id}`);
  assert.ok(!livePrepared.posts[draft.id] && !liveReposts.posts[draft.id], `Manifest ID already live: ${draft.id}`);
  assert.ok(!liveQueue.posts.some(p => ['approved', 'published'].includes(p.status) && p.date === draft.proposedDate), `Date occupied: ${draft.proposedDate}`);
  const original = P.validate(draft, { contentDir: path.join(root, source), entry: prepared.posts[draft.id], manifest: reposts });
  const post = { ...structuredClone(draft), status: 'approved', date: draft.proposedDate };
  const entry = { ...structuredClone(original.entry), draftKey: P.draftKey(post) };
  const repost = structuredClone(original.repost);
  assert.equal(repost.assets.length, post.format === 'Reels' ? 1 : 4, 'Incomplete Stories repost');
  mergedQueue.posts.push(post);
  mergedPrepared.posts[post.id] = entry;
  mergedReposts.posts[post.id] = repost;
  for (const file of entry.files) addCopy(file.relative, file.sha256);
  for (const asset of repost.assets) addCopy(`reposts/${asset.file}`, asset.sha256);
}
assert.equal(copies.size, 96, 'Expected 64 feed files and 32 Stories frames');
// Check the proposed contract in a separate content tree. Hard links save disk;
// no renderer or writer ever opens these media files, and the tree is removed.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-activation-review-'));
try {
  for (const copy of copies.values()) {
    const destination = path.join(stage, copy.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try { fs.linkSync(path.join(root, copy.from), destination); }
    catch (error) { if (error.code !== 'EXDEV') throw error; fs.copyFileSync(path.join(root, copy.from), destination); }
  }
  for (const post of mergedQueue.posts.slice(liveQueue.posts.length)) {
    summaries.push({ ...P.validate(post, { contentDir: stage, entry: mergedPrepared.posts[post.id], manifest: mergedReposts }).summary, date: post.date });
  }
  assert.equal(summaries.reduce((n, s) => n + s.storyFrames, 0), 32);
  const approved = mergedQueue.posts.filter(p => p.status === 'approved');
  const schedule = approved.map(p => ({ ...p }));
  for (const date of dates) {
    for (const p of schedule) if (p.date < date) p.status = 'published';
    const selection = readyForDay(schedule, date, post => {
      P.validate(post, { contentDir: stage, entry: mergedPrepared.posts[post.id], manifest: mergedReposts });
    });
    assert.deepEqual(selection.ready.map(p => p.id), bank.posts.filter(p => p.proposedDate === date).map(p => p.id));
    assert.equal(selection.blocked.length, 0);
  }
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
assert.deepEqual(mergedQueue.posts.slice(0, liveQueue.posts.length), liveQueue.posts, 'Existing queue entries changed');
for (const [id, entry] of Object.entries(livePrepared.posts)) assert.deepEqual(mergedPrepared.posts[id], entry);
for (const [id, entry] of Object.entries(liveReposts.posts)) assert.deepEqual(mergedReposts.posts[id], entry);
for (const [file, expected] of Object.entries(baseline)) assert.equal(hash(file), expected, `${file}: changed during review`);
// Refuse output symlinks that could redirect review writes into the live tree.
const destination = path.join(root, output);
for (const part of [path.join(root, 'outputs'), destination]) {
  if (fs.existsSync(part)) assert.ok(!fs.lstatSync(part).isSymbolicLink(), `Symlink output refused: ${part}`);
}
function write(relative, data) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assert.ok(fs.realpathSync(path.dirname(target)).startsWith(fs.realpathSync(destination) + path.sep));
  if (fs.existsSync(target)) assert.ok(!fs.lstatSync(target).isSymbolicLink(), `Symlink target refused: ${target}`);
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
}
for (const [i, metadata] of [mergedQueue, mergedPrepared, mergedReposts].entries()) write(`content/${paths[i]}`, metadata);
const result = {
  schemaVersion: 1, mode: 'review-only', generatedAt: new Date().toISOString(),
  source, baseline, validatedInTemporaryContentTree: true, liveFilesUnchanged: true,
  publicationsAttempted: false, dates: { first: dates[0], last: dates.at(-1) },
  posts: summaries, copies: [...copies.values()],
  totalBytes: [...copies.values()].reduce((n, c) => n + c.bytes, 0),
  stagedMetadata: paths.map(p => ({ from: `${output}/content/${p}`, to: `content/${p}`, sha256: hash(`${output}/content/${p}`) })),
  applicationOrder: ['Check baseline hashes; stop on any change.', 'Copy all 96 media files and verify sha256; preserve outputs URLs.', 'Replace prepared and repost indexes atomically, then queue last; preserve existing entries.', 'Validate the 14 new IDs and run check-content before committing metadata and all content copies together.'],
  storiesNote: '32 feed-repost JPG frames; separate 28 standalone Stories MP4 are not activated by this plan.',
};
write('review/plan.json', result);
console.log(JSON.stringify({ mode: result.mode, plan: `${output}/review/plan.json`, posts: summaries.length, files: copies.size, bytes: result.totalBytes, storyFrames: 32, liveFilesUnchanged: true }, null, 2));
