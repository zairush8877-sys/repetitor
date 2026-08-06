#!/usr/bin/env node
/**
 * Скачивание классики для Reels и сторис с Викисклада.
 *
 *   node fetch-music.js            — добрать библиотеку до нужного размера
 *   node fetch-music.js --list     — показать, что уже скачано
 *   node fetch-music.js --prepare  — нарезать фрагменты и выбросить исходники
 *
 * Ноты классиков давно в общественном достоянии, а вот КОНКРЕТНАЯ ЗАПИСЬ — нет:
 * у исполнителя своя лицензия. Поэтому берём только «Public domain», CC0 и CC BY.
 * CC BY-SA не берём принципиально: она требует выпускать под той же лицензией
 * всё производное, то есть заразила бы собой готовое видео.
 *
 * На выходе content/music/<slug>.<ext> и content/music/index.json с лицензиями
 * и авторством — чтобы указать его в подписи, когда лицензия этого требует.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DIR = path.join(__dirname, 'content', 'music');
const INDEX = path.join(DIR, 'index.json');
const API = 'https://commons.wikimedia.org/w/api.php';

// Правило автора: музыка всегда бодрящая и эпичная — ноктюрны под таблицу
// усыпляли ленту. Берём хрестоматийные кульминации: их энергия совпадает
// с механикой ролика, где строки бьют одна за другой.
// Композитор и русское название пьесы едут с каждым файлом дальше —
// второе правило автора: композитор указывается всегда.
const QUERIES = [
  { q: 'filetype:audio Grieg In the Hall of the Mountain King', composer: 'Эдвард Григ', piece: '«В пещере горного короля»' },
  { q: 'filetype:audio Mussorgsky Night on Bald Mountain', composer: 'Модест Мусоргский', piece: '«Ночь на Лысой горе»' },
  { q: 'filetype:audio Mussorgsky Pictures Exhibition Great Gate', composer: 'Модест Мусоргский', piece: '«Богатырские ворота»' },
  { q: 'filetype:audio Rossini William Tell Overture', composer: 'Джоаккино Россини', piece: 'увертюра к «Вильгельму Теллю»' },
  { q: 'filetype:audio Beethoven Symphony No. 5 c minor Allegro', composer: 'Людвиг ван Бетховен', piece: 'Пятая симфония' },
  { q: 'filetype:audio Beethoven Symphony No. 7 finale', composer: 'Людвиг ван Бетховен', piece: 'Седьмая симфония, финал' },
  { q: 'filetype:audio Bizet Carmen Overture', composer: 'Жорж Бизе', piece: 'увертюра к «Кармен»' },
  { q: 'filetype:audio Wagner Ride of the Valkyries', composer: 'Рихард Вагнер', piece: '«Полёт валькирий»' },
  { q: 'filetype:audio Tchaikovsky 1812 Overture', composer: 'Пётр Чайковский', piece: 'увертюра «1812 год»' },
  { q: 'filetype:audio Brahms Hungarian Dance No. 5', composer: 'Иоганнес Брамс', piece: 'Венгерский танец № 5' },
  { q: 'filetype:audio Vivaldi Summer Presto storm', composer: 'Антонио Вивальди', piece: '«Гроза» из «Времён года»' },
  { q: 'filetype:audio Dvorak Symphony No. 9 New World', composer: 'Антонин Дворжак', piece: 'симфония «Из Нового Света»' },
  { q: 'filetype:audio Verdi Dies irae Requiem', composer: 'Джузеппе Верди', piece: '«Dies irae» из Реквиема' },
  { q: 'filetype:audio Mozart Symphony No. 40 g minor Molto allegro', composer: 'Вольфганг Амадей Моцарт', piece: 'Сороковая симфония' },
];

// «Public domain» бывает записан по-разному, поэтому сверяем по подстроке.
const ALLOWED = [/public domain/i, /^cc0/i, /^cc by (?!-sa)/i];
const BANNED = /sa/i; // CC BY-SA и всё, что с share-alike

function allowedLicense(name) {
  if (!name) return false;
  if (/cc by-sa/i.test(name)) return false;
  return ALLOWED.some(re => re.test(name));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Викисклад режет частые запросы — при отказе ждём и пробуем ещё дважды. */
async function api(params) {
  const q = new URLSearchParams({ format: 'json', ...params }).toString();
  for (let attempt = 0; ; attempt++) {
    const out = execFileSync('curl', ['-sS', '--max-time', '60',
      '-A', 'repetitor-content-bot/1.0 (zairush8877@gmail.com)',
      `${API}?${q}`], { encoding: 'utf8' });
    try {
      return JSON.parse(out);
    } catch {
      if (attempt >= 2) throw new Error(`API Викисклада не отвечает: ${out.slice(0, 80)}`);
      await sleep(15000 * (attempt + 1));
    }
  }
}

function slugify(title) {
  return title
    .replace(/^File:/, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

/** Голый html из полей Викисклада: в подпись он не годится. */
function plain(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ffmpeg пишет и длительность, и замеры громкости в stderr, а не в stdout,
 * поэтому execFileSync здесь не годится: он возвращает только stdout, и разбор
 * молча получает пустую строку.
 */
function probe(ffmpeg, args) {
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  return (r.stderr || '') + (r.stdout || '');
}

/** Средняя громкость куска — по ней ищем место, где вещь звучит, а не затихает. */
function meanVolume(ffmpeg, file, start, len) {
  const out = probe(ffmpeg, [
    '-hide_banner', '-ss', String(start), '-t', String(len), '-i', file,
    '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : -Infinity;
}

function duration(ffmpeg, file) {
  const out = probe(ffmpeg, ['-hide_banner', '-i', file, '-f', 'null', '-']);
  const m = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

/**
 * Исходники с Викисклада весят сотни мегабайт — держать их в репозитории нельзя,
 * а для ролика на двадцать секунд нужен один удачный кусок. Ищем самый громкий
 * фрагмент (вступления у классики обычно тихие и для короткого видео мертвы),
 * выравниваем громкость и складываем в mp3.
 */
function prepare(index) {
  const ffmpeg = require('ffmpeg-static');
  const EXCERPT = 40;   // с запасом на самый длинный ролик
  const kept = [];

  // CC BY требует подписи под каждым постом — для ежедневного потока это лишнее
  // обязательство, поэтому оставляем только общественное достояние и CC0.
  const free = index.tracks.filter(t => !t.attributionRequired);

  // По одной вещи от исполнения: восемь разных пьес звучат разнообразнее,
  // чем восемь частей одной сонаты.
  const seen = new Set();
  for (const t of free) {
    const key = t.title.replace(/[^\p{L}]+/gu, ' ').split(' ').slice(0, 3).join(' ').toLowerCase();
    if (seen.has(key)) continue;
    const src = path.join(DIR, t.file);
    if (!fs.existsSync(src)) continue;

    const total = duration(ffmpeg, src);
    if (total < EXCERPT + 5) continue;

    let best = { at: 0, vol: -Infinity };
    for (let at = 5; at + EXCERPT < total; at += Math.max(10, Math.floor(total / 12))) {
      const vol = meanVolume(ffmpeg, src, at, EXCERPT);
      if (vol > best.vol) best = { at, vol };
    }
    if (best.vol === -Infinity) continue;

    const out = path.join(DIR, t.file.replace(/\.[^.]+$/, '.mp3'));
    execFileSync(ffmpeg, [
      '-y', '-ss', String(best.at), '-t', String(EXCERPT), '-i', src,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:a', 'libmp3lame', '-b:a', '128k', out,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    seen.add(key);
    kept.push({ ...t, file: path.basename(out), excerptFrom: Math.round(best.at) });
    console.log(`${path.basename(out)}  ← ${Math.round(best.at)} сек, ${best.vol.toFixed(1)} dB`);
  }

  // Пустой результат означает, что нарезка сломалась, а не что музыка не нужна:
  // удалять в этом случае — значит терять уже скачанное из-за своей же ошибки.
  if (!kept.length) {
    console.log('Не нарезано ни одного фрагмента — исходники оставлены нетронутыми.');
    return index;
  }

  // Исходники больше не нужны: остаются только фрагменты.
  const keepNames = new Set(kept.map(t => t.file));
  for (const f of fs.readdirSync(DIR)) {
    if (f === 'index.json' || keepNames.has(f)) continue;
    fs.rmSync(path.join(DIR, f), { force: true });
  }
  return { tracks: kept };
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : { tracks: [] };

  if (process.argv.includes('--list')) {
    for (const t of index.tracks) console.log(`${t.license.padEnd(16)} ${t.file}  — ${t.title}`);
    console.log(`\nВсего: ${index.tracks.length}`);
    return;
  }

  if (process.argv.includes('--prepare')) {
    const next = prepare(index);
    fs.writeFileSync(INDEX, JSON.stringify(next, null, 2) + '\n');
    console.log(`\nОставлено фрагментов: ${next.tracks.length}`);
    return;
  }

  const have = new Set(index.tracks.map(t => t.title));
  const covered = new Set(index.tracks.map(t => t.piece).filter(Boolean));

  for (const { q: srsearch, composer, piece } of QUERIES) {
    if (covered.has(piece)) continue;
    await sleep(4000); // пауза между пьесами, чтобы не упереться в лимит частоты
    const found = await api({ action: 'query', list: 'search', srsearch, srnamespace: '6', srlimit: '10' });
    const titles = (found.query?.search || []).map(r => r.title).filter(t => !have.has(t));
    if (!titles.length) continue;

    const info = await api({
      action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|size',
      titles: titles.join('|'),
    });

    for (const page of Object.values(info.query?.pages || {})) {
      const ii = (page.imageinfo || [])[0];
      if (!ii) continue;
      const em = ii.extmetadata || {};
      const license = plain(em.LicenseShortName?.value) || '?';
      if (!allowedLicense(license)) continue;

      // Обрезки на пару секунд и получасовые концерты одинаково бесполезны.
      const mb = (ii.size || 0) / 1024 / 1024;
      if (mb < 0.5 || mb > 40) continue;

      const url = ii.url.split('?')[0];
      const ext = path.extname(decodeURIComponent(url)).toLowerCase() || '.ogg';
      const file = `${slugify(page.title)}${ext}`;
      const dest = path.join(DIR, file);

      try {
        execFileSync('curl', ['-sSL', '--max-time', '180', '-o', dest, url], { stdio: 'inherit' });
      } catch {
        console.log(`не скачалось: ${page.title}`);
        continue;
      }
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 100 * 1024) {
        fs.rmSync(dest, { force: true });
        continue;
      }

      index.tracks.push({
        file,
        title: page.title.replace(/^File:/, ''),
        composer,
        piece,
        license,
        author: plain(em.Artist?.value).slice(0, 120),
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        // CC BY требует указания автора в подписи, общественное достояние — нет.
        attributionRequired: /^cc by/i.test(license),
      });
      have.add(page.title);
      covered.add(piece);
      console.log(`${license.padEnd(16)} ${composer} — ${file}`);
      break; // одной записи пьесы достаточно
    }
  }

  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log(`\nВ библиотеке: ${index.tracks.length} записей.`);
})();
