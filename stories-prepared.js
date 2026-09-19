'use strict';

// Written only by a completed renderer, never by daily selection/preparation.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ID } = require('./stories-selection');
const ROOT = __dirname;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function contentSnapshot(story) {
  const fields = ['id', 'type', 'q', 'a', 'b', 'right', 'top', 'big', 'why', 'source', 'sources', 'school', 'rubric', 'music', 'photo', 'caption', 'musicLearning'];
  return Object.fromEntries(fields.filter(key => story[key] !== undefined).map(key => [key, story[key]]));
}
const contentHash = story => sha(JSON.stringify(contentSnapshot(story)));
function manifestRelative(id) {
  if (!ID.test(id || '')) throw new Error('Некорректный ID Stories для manifest.');
  return `content/stories-prepared/manifests/${id}.json`;
}
function mediaPaths(id) {
  manifestRelative(id);
  return [1, 2].map(part => `content/stories/${id}-${part}.mp4`);
}
function invalidate(story, { root = ROOT } = {}) {
  fs.rmSync(path.join(root, manifestRelative(story.id)), { force: true });
}
function writeManifest(story, { root = ROOT, music = null, photo = null } = {}) {
  if (story.status === 'published') throw new Error('Сборка не создаёт новый manifest для уже опубликованной Stories.');
  const assets = mediaPaths(story.id).map((file, index) => {
    const data = fs.readFileSync(path.join(root, file));
    if (!data.length) throw new Error(`Пустой файл Stories: ${file}`);
    return { part: index + 1, file, bytes: data.length, sha256: sha(data) };
  });
  const manifest = {
    schemaVersion: 1, storyId: story.id, contentSha256: contentHash(story),
    renderedAt: new Date().toISOString(), assets, renderSources: { music, photo },
  };
  const file = path.join(root, manifestRelative(story.id));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  return manifest;
}
function validate(story, { root = ROOT } = {}) {
  const errors = [];
  let manifest;
  try {
    const file = path.join(root, manifestRelative(story.id));
    if (!fs.existsSync(file)) return { ok: false, errors: ['Нет manifest завершённого рендера Stories. Нужна сборка двух видео.'] };
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.storyId !== story.id) errors.push('Manifest относится к другой Stories или версии контракта.');
    if (manifest.contentSha256 !== contentHash(story)) errors.push('Текст или источники Stories изменились после рендера.');
    const expected = mediaPaths(story.id);
    if (!Array.isArray(manifest.assets) || manifest.assets.length !== 2) errors.push('В manifest должны быть ровно две части видео.');
    else for (const [index, relative] of expected.entries()) {
      const asset = manifest.assets[index];
      if (asset?.part !== index + 1 || asset.file !== relative) { errors.push(`Неверный путь или порядок части ${index + 1}.`); continue; }
      const data = fs.readFileSync(path.join(root, relative));
      if (!data.length || data.length !== asset.bytes || sha(data) !== asset.sha256) errors.push(`Видео ${index + 1} отличается от завершённой сборки.`);
    }
  } catch {
    errors.push('Manifest или оба видео Stories недоступны/повреждены.');
  }
  return { ok: errors.length === 0, errors, manifest };
}

module.exports = { contentSnapshot, contentHash, manifestRelative, mediaPaths, invalidate, writeManifest, validate };
