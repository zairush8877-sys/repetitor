#!/usr/bin/env node
// Лёгкая музыка с проверенной лицензией записи. Источники проверены 11.09.2026.
// --list: каталог; --prepare: обработать уже загруженные оригиналы;
// без флагов: скачать три указанные записи и приготовить спокойные фрагменты.
// Старые эпичные треки и оригиналы сохраняются, но исключаются из новой ротации.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const DIR = path.join(__dirname, 'content/music');
const INDEX = path.join(DIR, 'index.json');
const CHECKED = '2026-10-26';
// Пять записей снизу добавлены 26.10.2026 по правилу автора «меняй музыку
// почти постоянно»: трёх активных треков на 2–3 публикации в день не хватает,
// соседние ролики начинают звучать одинаково. Отобраны по машинному каталогу
// incompetech (pieces.json): настроение Bright/Calming, 72–120 ударов в минуту,
// живые инструменты. Лицензия у всего каталога одна — CC BY 4.0.
const PICKS = [
  { slug: 'easy-lemon', title: 'Easy Lemon', bpm: 82, isrc: 'USUAN1200076', mood: 'light-calm' },
  { slug: 'carefree', title: 'Carefree', bpm: 96, isrc: 'USUAN1400037', mood: 'light-cheerful' },
  { slug: 'daily-beetle', title: 'Daily Beetle', bpm: 100, isrc: 'USUAN1500025', mood: 'light-bouncy' },
  { slug: 'almost-bliss', title: 'Almost Bliss', bpm: 90, isrc: 'USUAN1900015', mood: 'light-calm' },
  { slug: 'crinoline-dreams', title: 'Crinoline Dreams', bpm: 120, isrc: 'USUAN1700073', mood: 'light-bright' },
  { slug: 'onion-capers', title: 'Onion Capers', bpm: 105, isrc: 'USUAN1800023', mood: 'light-bouncy' },
  { slug: 'study-and-relax', title: 'Study And Relax', bpm: 72, isrc: 'USUAN1900030', mood: 'light-calm' },
  { slug: 'almost-new', title: 'Almost New', bpm: 80, isrc: 'USUAN1800008', mood: 'light-calm' },
];
async function main() {
  fs.mkdirSync(path.join(DIR, 'originals'), { recursive: true });
  const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : { tracks: [] };
  if (process.argv.includes('--list')) {
    for (const t of index.tracks) console.log(`${t.active === false ? 'архив' : 'активен'}: ${t.composer} — ${t.piece} (${t.license})`);
    return;
  }
  // Раньше здесь гасился весь каталог, а дальше включались только PICKS: так
  // в сентябре отключали эпичную классику. Теперь флаги сохраняются — иначе
  // новый прогон погасил бы треки, включённые вручную позже (Бах, 26.10.2026).
  const next = index.tracks.map(t => ({ ...t }));
  const ffmpeg = require('ffmpeg-static');
  let prepared = 0;
  for (const p of PICKS) {
    const source = path.join(DIR, 'originals', `${p.slug}.mp3`);
    const download = `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(p.title)}.mp3`;
    if (!fs.existsSync(source) && !process.argv.includes('--prepare')) {
      const response = await fetch(download, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${p.title}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100000 || /text\/html/.test(response.headers.get('content-type') || '')) throw new Error(`${p.title}: скачан не аудиофайл`);
      fs.writeFileSync(source, bytes);
    }
    if (!fs.existsSync(source)) continue;
    const file = `light-${p.slug}.mp3`;
    // Готовый фрагмент не пересобираем: перекодирование меняет байты файла
    // без всякой пользы, а он уже вшит в собранные ролики. --force переcоберёт.
    if (fs.existsSync(path.join(DIR, file)) && !process.argv.includes('--force')) {
      console.log(`Пропуск: ${p.title} — фрагмент уже готов.`);
      prepared++;
      continue;
    }
    execFileSync(ffmpeg, ['-y', '-i', source, '-t', '40', '-af', 'loudnorm=I=-22:TP=-3:LRA=7,afade=t=in:d=0.6,afade=t=out:st=38.8:d=1.2', '-c:a', 'libmp3lame', '-b:a', '160k', path.join(DIR, file)], { stdio: ['ignore', 'ignore', 'pipe'] });
    const metadata = {
      file, title: p.title, piece: p.title, composer: 'Kevin MacLeod', author: 'Kevin MacLeod',
      license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      source: `https://incompetech.com/music/royalty-free/index.html?isrc=${p.isrc}`,
      download, attributionRequired: true,
      attribution: `${p.title} — Kevin MacLeod (incompetech.com). CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/. Фрагмент обрезан и сведён с видео.`,
      bpm: p.bpm, mood: p.mood, checkedAt: CHECKED, excerptFrom: 0, duration: 40,
      active: true, trendVerified: false,
    };
    const at = next.findIndex(t => t.file === file);
    if (at >= 0) next[at] = metadata; else next.push(metadata);
    prepared++;
    console.log(`Готово: ${p.title}, 40 секунд, CC BY 4.0 (не подтверждённый тренд)`);
  }
  if (!prepared) throw new Error('Нет подготовленных записей; существующий каталог не изменён.');
  fs.writeFileSync(INDEX, JSON.stringify({ ...index, checkedAt: CHECKED, tracks: next }, null, 2) + '\n');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { PICKS };
