#!/usr/bin/env node
'use strict';

// Перенос одобренных экзаменационных комплектов из изолированных черновиков
// в рабочий банк Stories. Черновики лежат отдельно намеренно: их manifest
// прямо говорит, что не даёт допуска в live банк. Допуск даёт только автор,
// и этот скрипт выполняет её решение, а не подменяет его.
//
//   node scripts/stories-approve-exam.cjs --dry-run   — показать, что будет
//   node scripts/stories-approve-exam.cjs             — перенести
//
// Дата выпуска не назначается: ежедневный выпуск берёт первый одобренный
// комплект по порядку, а proposedDate остаётся подсказкой об очерёдности.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PREPARED = require('../stories-prepared');

const ROOT = path.join(__dirname, '..');
const DRAFTS = path.join(ROOT, 'content', 'stories-drafts', 'exam-bank.json');
const BANK = path.join(ROOT, 'content', 'stories.json');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function main(dryRun) {
  const drafts = JSON.parse(fs.readFileSync(DRAFTS, 'utf8'));
  const list = drafts.stories || drafts;
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
  const have = new Set(bank.stories.map(s => s.id));
  const added = [];

  for (const d of list) {
    if (d.status !== 'pending' || d.editorialStatus !== 'ready-for-review') {
      throw new Error(`${d.id}: ожидался pending/ready-for-review, а не ${d.status}/${d.editorialStatus}`);
    }
    const id = d.preparedMedia?.storyId;
    if (!id) throw new Error(`${d.id}: в preparedMedia нет storyId`);
    if (have.has(id)) { console.log(`${id}: уже в банке, пропуск`); continue; }
    if (!d.preparedMedia.ready || d.preparedMedia.errors?.length) {
      throw new Error(`${id}: сборка помечена неготовой`);
    }

    // Байты сверяются до копирования: manifest черновика обещает конкретные
    // файлы, и расхождение означает, что видео пересобрали после проверки.
    const copies = [];
    for (const part of d.preparedMedia.parts) {
      const src = path.join(ROOT, part.file);
      const data = fs.readFileSync(src);
      if (data.length !== part.bytes || sha(data) !== part.sha256) {
        throw new Error(`${id}: часть ${part.index} отличается от проверенной сборки`);
      }
      copies.push({ dst: path.join(ROOT, 'content', 'stories', `${id}-${part.index}.mp4`), data });
    }

    const story = {
      id,
      type: 'exam',
      status: 'approved',
      rubric: d.rubric,
      question: d.question,
      explanation: d.explanation,
      sources: d.sources,
      caption: d.caption,
      music: d.music,
      musicLearning: d.musicLearning,
      sourcePostId: d.sourcePostId,
      proposedDate: d.proposedDate,
      approvedFromDraft: d.id,
    };

    if (!dryRun) {
      for (const c of copies) fs.writeFileSync(c.dst, c.data);
      bank.stories.push(story);
      PREPARED.writeManifest(story, { root: ROOT, music: d.music?.file || null, photo: null });
      const check = PREPARED.validate(story, { root: ROOT });
      if (!check.ok) throw new Error(`${id}: сборка не прошла проверку — ${check.errors.join(' ')}`);
    }
    added.push(id);
  }

  if (!dryRun && added.length) {
    fs.writeFileSync(`${BANK}.tmp`, `${JSON.stringify(bank, null, 2)}\n`);
    fs.renameSync(`${BANK}.tmp`, BANK);
  }
  console.log(dryRun ? `Будет перенесено: ${added.length}` : `Перенесено и одобрено: ${added.length}`);
  for (const id of added) console.log('  ' + id);
}

main(process.argv.includes('--dry-run'));
