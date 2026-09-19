#!/usr/bin/env node
'use strict';
// Rebuild after package-exam-bank.cjs. Local files only; no remote resources or publication.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'outputs/exam-bank-2026-09-26');
const configFile = path.join(root, 'video-lab/exam-bank.json');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const jsonForHtml = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const dateLabel = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const exists = relative => fs.existsSync(path.resolve(output, relative));
const safeUrl = value => {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`Unsupported source URL: ${value}`);
  return url.href;
};
const sourceLabel = value => {
  const host = new URL(value).hostname.replace(/^www\./, '');
  return ({ 'gramota.ru': 'Грамота.ру', 'fipi.ru': 'ФИПИ', 'ruslang.ru': 'Институт русского языка РАН', 'orfo.ruslang.ru': 'Академос', 'bachvereniging.nl': 'Нидерландское баховское общество', 'opengoldbergvariations.org': 'Open Goldberg Variations' })[host] || host;
};

const style = `
:root{--paper:#f8f8f3;--card:#fff;--ink:#163a38;--muted:#66736b;--line:#e0e7df;--accent:#245e50;--soft:#edf3ec;--warm:#aa522f;--shadow:0 12px 35px rgba(24,49,35,.05)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}button,a,summary{-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer}a{color:var(--accent);text-underline-offset:3px}button:focus-visible,a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid #c77542;outline-offset:4px}button:disabled{cursor:default;opacity:.35}button:active:not(:disabled){transform:translateY(1px)}[hidden]{display:none!important}
.shell{max-width:1320px;margin:auto;padding:0 34px}.topline{display:flex;justify-content:space-between;gap:18px;align-items:center;padding-top:30px;font-size:12px;letter-spacing:.12em;text-transform:uppercase}.review{display:inline-flex;align-items:center;gap:7px;background:#fff3df;color:#82552c;border-radius:99px;padding:7px 12px;font-size:11px;letter-spacing:.06em}.review::before{content:"";width:6px;height:6px;background:#c88335;border-radius:50%}.hero{display:grid;grid-template-columns:1.35fr .65fr;gap:70px;align-items:end;padding:57px 0 38px}.eyebrow{font-size:13px;color:var(--muted);margin:0 0 17px}.hero h1{font-size:clamp(42px,5.8vw,78px);font-weight:650;line-height:1.04;letter-spacing:-.045em;margin:0;max-width:800px}.hero h1 em{font-family:Georgia,serif;font-weight:400;color:var(--warm)}.hero-copy{max-width:340px;padding-bottom:4px}.hero-copy p{margin:0 0 17px;color:var(--muted);font-size:16px}.totals{display:flex;gap:26px}.totals span{font-size:12px;color:var(--muted)}.totals strong{display:block;color:var(--ink);font-size:29px;font-weight:600;letter-spacing:-.04em}.introline{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:23px;font-size:13px;color:var(--muted)}.introline strong{color:var(--ink);font-weight:550}.build-note{background:#fff2df;color:#895b2d;padding:12px 16px;border-radius:12px;margin:0 0 20px;font-size:13px}.toolbar{position:sticky;top:0;background:rgba(248,248,243,.97);z-index:3;padding:13px 0 18px;display:flex;align-items:center;justify-content:space-between;gap:18px;backdrop-filter:blur(12px)}.filters{display:flex;flex-wrap:wrap;gap:7px}.filter{border:1px solid #dce5db;border-radius:99px;background:transparent;color:var(--ink);padding:9px 15px;font-size:13px;white-space:nowrap}.filter[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}.result-count{font-size:12px;color:var(--muted);white-space:nowrap}
.posts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;padding-bottom:50px}.post{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:19px;overflow:hidden;box-shadow:var(--shadow)}.post-head{padding:22px 24px 18px}.post-meta{display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:11px;color:var(--muted)}.post-meta .day{margin-left:auto;font-variant-numeric:tabular-nums}.tag{background:var(--soft);border-radius:5px;padding:3px 7px;color:var(--accent);font-weight:600;letter-spacing:.02em}.post h2{margin:0;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-.02em;min-height:58px}.media-band{background:#eef1e9;padding:18px;display:flex;justify-content:center}.media-stage{width:100%;max-width:350px;position:relative}.reel .media-stage{max-width:279px}.media-stage video{display:block;width:100%;height:auto;object-fit:contain;background:#1c2722;border-radius:10px}.reel video{aspect-ratio:9/16}.carousel video{aspect-ratio:4/5}.poster{display:block;width:100%;object-fit:cover;border-radius:10px}.reel .poster{aspect-ratio:9/16}.carousel .poster{aspect-ratio:4/5}.placeholder{position:relative;width:100%}.placeholder-label{position:absolute;bottom:16px;left:16px;right:16px;display:block;padding:9px 12px;border-radius:8px;background:rgba(20,41,32,.8);color:#fff;font-size:12px;backdrop-filter:blur(8px)}.carousel-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;border-radius:10px;gap:0}.carousel-track::-webkit-scrollbar{display:none}.slide{margin:0;min-width:100%;width:100%;scroll-snap-align:start;scroll-snap-stop:always}.slide figcaption{font-size:11px;line-height:1.4;color:var(--muted);padding:9px 2px 0;min-height:43px}.carousel-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.arrow{width:35px;height:35px;border:1px solid #cad8cd;border-radius:50%;background:rgba(255,255,255,.7);color:var(--ink);font-size:18px;line-height:1}.slide-counter{font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted)}.dots{display:flex;gap:6px}.dot{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:#bfcec1}.dot[aria-current=true]{background:var(--ink);box-shadow:0 0 0 3px rgba(36,94,80,.11)}.play-hint{margin:12px 0 0;font-size:11px;color:var(--muted);text-align:center}.post-body{padding:19px 24px 22px}.caption{font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.caption-toggle{margin:0}.caption-toggle>summary{font-size:13px;font-weight:550}.caption-content{padding-top:12px}.copy{border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 10px;color:var(--muted);font-size:11px;margin-top:13px}.music{margin:19px 0 0;padding:15px 16px;background:var(--soft);border-radius:11px}.music-label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);margin:0 0 7px}.music .credit{margin:0;font-size:13px;line-height:1.5;font-weight:550}.music .performer{margin:4px 0 0;font-size:12px;color:var(--muted)}.music .fact{margin:11px 0 0;font-size:13px;line-height:1.5}.music .reference{display:inline-block;font-size:10px;margin-top:8px;color:var(--muted)}details{margin-top:17px}summary{cursor:pointer;font-size:12px;color:var(--accent);list-style:none}summary::-webkit-details-marker{display:none}summary::before{content:"+";display:inline-block;width:18px;font-size:15px;font-weight:400}details[open]>summary::before{content:"−"}.sources{margin:11px 0 0;padding:0 0 0 18px;font-size:12px;line-height:1.7}.sources li+li{margin-top:5px}.sources a{overflow-wrap:anywhere}.story-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:13px}.story-grid.single{grid-template-columns:minmax(0,230px);justify-content:center}.story{margin:0;min-width:0}.story img{display:block;width:100%;height:auto;aspect-ratio:9/16;object-fit:contain;border-radius:7px;background:#eef1e9}.story figcaption{font-size:10px;color:var(--muted);margin-top:5px}.story-placeholder{aspect-ratio:9/16;display:grid;place-items:center;border:1px dashed #cad8cd;color:var(--muted);font-size:12px;border-radius:7px;background:var(--paper);text-align:center;padding:12px}.story-note{font-size:11px;color:var(--muted);margin:11px 0 0}.post-foot{display:flex;justify-content:space-between;gap:12px;font-size:10px;color:var(--muted);padding:12px 24px;border-top:1px solid var(--line);background:#fcfdfb}.post-foot a{color:var(--muted)}.empty{padding:50px;text-align:center;color:var(--muted)}footer{border-top:1px solid var(--line);padding:25px 0 40px;display:flex;justify-content:space-between;gap:25px;font-size:11px;color:var(--muted)}footer p{margin:0;max-width:630px}.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);padding:10px 16px;color:#fff;background:var(--ink);border-radius:99px;font-size:12px;z-index:5;box-shadow:var(--shadow)}
.day-stories{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:14px}.day-story{margin:0;min-width:0}.day-story video,.day-story .poster{display:block;width:100%;height:auto;aspect-ratio:9/16;object-fit:contain;background:#1c2722;border-radius:9px}.day-story figcaption{font-size:11px;color:var(--muted);margin-top:7px}.day-state{display:inline-block;margin:11px 0 0;padding:4px 8px;background:#fff3df;color:#82552c;border-radius:5px;font-size:10px}
@media(min-width:1100px){.carousel .media-band{min-height:550px;align-items:center}.reel .media-band{min-height:550px;align-items:center}}@media(max-width:760px){.shell{padding:0 18px}.topline{padding-top:20px;font-size:10px;letter-spacing:.07em}.review{font-size:9px;padding:6px 9px}.hero{display:block;padding:38px 0 26px}.hero h1{font-size:47px;max-width:540px}.hero-copy{max-width:none;margin-top:24px;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end}.hero-copy p{font-size:13px;max-width:260px;margin:0}.totals{gap:17px}.totals strong{font-size:25px}.totals span{font-size:10px}.introline{display:block;font-size:11px}.introline span{display:block;margin-top:5px}.toolbar{padding-top:10px;display:block}.filters{gap:6px}.filter{font-size:12px;padding:8px 12px}.result-count{margin:10px 2px 0}.posts{grid-template-columns:1fr;gap:19px}.post-head{padding:19px 20px 16px}.post h2{font-size:25px;min-height:0}.media-band{padding:16px}.reel .media-stage{max-width:280px}.carousel .media-stage{max-width:340px}.post-body{padding:19px 20px}.post-foot{padding:12px 20px}.caption{font-size:14px}.day-stories{grid-template-columns:minmax(0,290px);justify-content:center;gap:18px}footer{display:block}footer p+p{margin-top:13px}}@media(max-width:380px){.shell{padding:0 12px}.hero h1{font-size:40px}.hero-copy{display:block}.totals{margin-top:16px}.topline{align-items:flex-start}.review{max-width:155px}.filter{padding:8px 10px}.post h2{font-size:23px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
`;

const script = `
(() => {
  const cards = [...document.querySelectorAll('.post')];
  const videos = [...document.querySelectorAll('video')];
  const copyData = JSON.parse(document.getElementById('caption-data').textContent);
  const toast = document.querySelector('.toast');
  let toastTimer;
  function message(text) { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 2600); }
  document.addEventListener('play', event => {
    if (event.target.tagName !== 'VIDEO') return;
    for (const video of videos) if (video !== event.target) video.pause();
  }, true);
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const filter = button.dataset.filter;
    let visible = 0;
    cards.forEach(card => {
      card.hidden = filter !== 'all' && card.dataset.exam !== filter && card.dataset.format !== filter;
      if (!card.hidden) visible++;
      else card.querySelectorAll('video').forEach(video => video.pause());
    });
    document.querySelector('.result-count').textContent = 'Показано: ' + visible + ' из ' + cards.length;
    document.querySelector('.empty').hidden = visible !== 0;
  }));
  document.querySelectorAll('[data-carousel]').forEach(carousel => {
    const track = carousel.querySelector('.carousel-track');
    const slides = [...track.children];
    const prev = carousel.querySelector('[data-prev]');
    const next = carousel.querySelector('[data-next]');
    const dots = [...carousel.querySelectorAll('[data-slide]')];
    let active = 0, scheduled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function update() {
      scheduled = false;
      if (!track.clientWidth) return;
      const index = Math.min(slides.length - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
      if (index !== active) slides.forEach((slide, i) => { if (i !== index) slide.querySelectorAll('video').forEach(video => video.pause()); });
      active = index;
      prev.disabled = index === 0; next.disabled = index === slides.length - 1;
      carousel.querySelector('.slide-counter').textContent = (index + 1) + ' / ' + slides.length;
      dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    }
    function go(index) { track.scrollTo({ left: Math.max(0, Math.min(slides.length - 1, index)) * track.clientWidth, behavior: reduced ? 'auto' : 'smooth' }); }
    prev.addEventListener('click', () => go(active - 1));
    next.addEventListener('click', () => go(active + 1));
    dots.forEach((dot, index) => dot.addEventListener('click', () => go(index)));
    track.addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }, { passive: true });
    track.addEventListener('keydown', event => {
      if (event.target !== track) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); go(active + (event.key === 'ArrowRight' ? 1 : -1)); }
    });
    window.addEventListener('resize', () => { track.scrollTo({ left: active * track.clientWidth, behavior: 'auto' }); update(); });
    update();
  });
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const caption = copyData[button.dataset.copy];
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(caption);
      message('Подпись скопирована');
    } catch {
      const area = document.createElement('textarea'); area.value = caption; area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:0;top:0;opacity:0'; document.body.append(area); area.select();
      const copied = document.execCommand('copy'); area.remove();
      message(copied ? 'Подпись скопирована' : 'Выделите текст подписи и скопируйте вручную');
    }
  }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) videos.forEach(video => video.pause()); });
  document.querySelectorAll('details').forEach(section => section.addEventListener('toggle', () => {
    if (!section.open) section.querySelectorAll('video').forEach(video => video.pause());
  }));
})();
`;

function build() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check-assets')) throw new Error('Usage: node scripts/build-exam-gallery.cjs [--check-assets]');
  const input = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const posts = Array.isArray(input) ? input : input.posts;
  if (!Array.isArray(posts) || posts.length !== 14) throw new Error('Expected 14 exam posts.');
  if (new Set(posts.map(post => post.id)).size !== posts.length) throw new Error('Duplicate post IDs.');
  const standaloneManifestFile = path.join(output, 'standalone-stories/index.json');
  const standaloneManifest = fs.existsSync(standaloneManifestFile) ? JSON.parse(fs.readFileSync(standaloneManifestFile, 'utf8')) : null;
  if (standaloneManifest && (standaloneManifest.status !== 'pending' || standaloneManifest.publicationPerformed !== false || !Array.isArray(standaloneManifest.stories) || standaloneManifest.stories.length !== 14 || new Set(standaloneManifest.stories.map(story => story.sourcePostId)).size !== 14)) throw new Error('Standalone Stories manifest must contain 14 unpublished pending sets.');
  const expected = [];
  const captions = {};
  const rows = [];
  for (const [index, post] of posts.entries()) {
    if (!/^[a-zA-Z0-9_-]+$/.test(post.id) || !/^[a-zA-Z0-9_-]+$/.test(post.photoSlug)) throw new Error('Invalid post/photo ID.');
    if (post.status !== 'pending' || post.date) throw new Error(`${post.id}: gallery expects unscheduled pending drafts.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(post.proposedDate) || Number.isNaN(new Date(`${post.proposedDate}T12:00:00Z`).valueOf())) throw new Error(`${post.id}: invalid proposed date.`);
    const reel = post.format === 'Reels';
    if (!reel && !['carousel', 'Карусель'].includes(post.format)) throw new Error(`${post.id}: unexpected format.`);
    if (post.scenes.length !== (reel ? 5 : 4)) throw new Error(`${post.id}: incomplete scenes.`);
    const photo = `../../assets/photos/exam-v1/${post.photoSlug}.png`;
    const videos = reel ? [`content/reels/${post.id}.mp4`] : post.scenes.map((_, i) => `content/images/${post.id}-${i + 1}.mp4`);
    const covers = videos.map(file => file.replace(/\.mp4$/, reel ? '-frame.jpg' : '.jpg'));
    const stories = videos.map((_, i) => `content/reposts/${post.id}-${i + 1}.jpg`);
    const standaloneVideos = [1, 2].map(part => `standalone-stories/${post.id}-${part}.mp4`);
    const standaloneMeta = standaloneManifest?.stories.find(story => story.sourcePostId === post.id);
    if (standaloneManifest && (!standaloneMeta || standaloneMeta.status !== 'pending' || standaloneMeta.date || standaloneMeta.parts?.length !== 2 || standaloneMeta.parts.some((part, i) => part.index !== i + 1 || part.file !== `${post.id}-${i + 1}.mp4`))) throw new Error(`${post.id}: incomplete or scheduled standalone Stories manifest.`);
    const assets = [...videos, ...covers, ...stories, ...standaloneVideos];
    assets.forEach(file => expected.push({ postId: post.id, file, exists: exists(file) }));
    const ready = assets.every(exists);
    rows.push({ id: post.id, format: reel ? 'Reels' : 'Карусель', proposedDate: post.proposedDate, ready, videoFiles: videos, coverFiles: covers, storyFiles: stories, standaloneVideoFiles: standaloneVideos, standaloneStatus: 'pending', standalonePublicationDate: null });
    const media = (file, i) => exists(file)
      ? `<video controls playsinline preload="none" poster="${escape(exists(covers[i]) ? covers[i] : photo)}" aria-label="${escape(post.title)}${reel ? '' : ` — слайд ${i + 1}`}"><source src="${escape(file)}" type="video/mp4">Ваш браузер не воспроизводит видео. <a href="${escape(file)}">Открыть видео</a></video>`
      : `<div class="placeholder"><img class="poster" src="${escape(photo)}" alt="Иллюстрация к теме «${escape(post.title)}»" loading="lazy"><span class="placeholder-label">Видео собирается</span></div>`;
    const videoHtml = reel ? media(videos[0], 0) : `
      <div class="carousel-track" tabindex="0" aria-label="Слайды карусели: листайте или используйте стрелки">${videos.map((file, i) => `<figure class="slide">${media(file, i)}<figcaption>${i + 1}. ${escape(post.scenes[i].headline)}</figcaption></figure>`).join('')}</div>
      <div class="carousel-nav"><button class="arrow" data-prev aria-label="Предыдущий слайд" disabled>←</button><span class="slide-counter" aria-live="polite">1 / ${videos.length}</span><div class="dots">${videos.map((_, i) => `<button class="dot" data-slide="${i}" aria-label="Слайд ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div><button class="arrow" data-next aria-label="Следующий слайд">→</button></div>`;
    const track = post.music || {};
    if (!track.composer || !track.piece || !track.performer || !post.musicLearning?.fact) throw new Error(`${post.id}: missing music credit/fact.`);
    captions[post.id] = `${post.caption}\n\n♪ ${track.composer} — ${track.piece}\n${track.attribution || `Фортепиано — ${track.performer}.`}`;
    const cleanCaption = post.caption.replace(`О музыке. ${post.musicLearning.fact}\n\n`, '');
    const urls = [...new Set((post.sources || []).map(safeUrl))];
    const sources = urls.map((url, i) => `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(sourceLabel(url))}${urls.length > 1 ? ` · источник ${i + 1}` : ''}</a></li>`).join('');
    const musicSource = safeUrl(post.musicLearning.source);
    const standaloneHtml = standaloneVideos.map((file, i) => {
      const label = i === 0 ? 'Вопрос' : 'Разбор';
      const still = `standalone-stories/qa/${post.id}-scene-${i + 1}.jpg`;
      const seconds = standaloneMeta?.parts[i]?.duration;
      return `<figure class="day-story">${exists(file) ? `<video controls playsinline preload="none" poster="${escape(exists(still) ? still : photo)}" aria-label="Истории дня: ${escape(post.title)} — ${label.toLowerCase()}"><source src="${escape(file)}" type="video/mp4">Ваш браузер не воспроизводит видео. <a href="${escape(file)}">Открыть видео</a></video>` : `<div class="placeholder"><img class="poster" src="${escape(photo)}" alt="Иллюстрация к теме «${escape(post.title)}»" loading="lazy"><span class="placeholder-label">${label}: видео собирается</span></div>`}<figcaption>${i + 1}. ${label}${Number.isFinite(seconds) ? ` · ${seconds} с` : ''}</figcaption></figure>`;
    }).join('');
    post.galleryHtml = `
<article class="post ${reel ? 'reel' : 'carousel'}" id="${escape(post.id)}" data-exam="${escape(post.exam)}" data-format="${reel ? 'Reels' : 'carousel'}">
  <header class="post-head"><div class="post-meta"><span class="tag">${escape(post.exam)}</span><span>${reel ? 'Reels · 30 секунд' : 'Карусель · 4 слайда'}</span><span class="day">${String(index + 1).padStart(2, '0')} / 14</span></div><h2>${escape(post.title)}</h2></header>
  <div class="media-band"><div class="media-stage" ${reel ? '' : 'data-carousel'}>${videoHtml}<p class="play-hint">${reel ? 'Нажмите ▶, чтобы смотреть со звуком' : 'Листайте слайды. Звук — при нажатии ▶'}</p></div></div>
  <div class="post-body">
    <details class="caption-toggle"><summary>Подпись к публикации</summary><div class="caption-content"><p class="caption">${escape(cleanCaption)}</p><button class="copy" data-copy="${escape(post.id)}">Скопировать с музыкальным кредитом</button></div></details>
    <aside class="music" aria-label="Музыкальная справка"><p class="music-label">Что звучит</p><p class="credit">${escape(track.composer)}<br>${escape(track.piece)}</p><p class="performer">Фортепиано — ${escape(track.performer)}</p><p class="fact">${escape(post.musicLearning.fact)}</p><a class="reference" href="${escape(musicSource)}" target="_blank" rel="noopener noreferrer">Источник музыкальной справки</a></aside>
    <details><summary>${reel ? 'Stories · 1 кадр-анонс' : `Stories · все ${stories.length} слайда`}</summary><div class="story-grid${reel ? ' single' : ''}">${stories.map((file, i) => `<figure class="story">${exists(file) ? `<a href="${escape(file)}" target="_blank" rel="noopener"><img src="${escape(file)}" alt="${escape(post.title)} — Stories ${i + 1} из ${stories.length}" loading="lazy" width="1080" height="1920"></a>` : '<div class="story-placeholder">Кадр Stories собирается</div>'}<figcaption>${reel ? 'Анонс Reels' : `Слайд ${i + 1} из ${stories.length}`}</figcaption></figure>`).join('')}</div><p class="story-note">${reel ? 'Анонс сохраняет полный финальный кадр ролика.' : 'Все кадры показаны целиком и в исходном порядке.'} Нажмите на изображение, чтобы открыть крупнее.</p></details>
    <details class="standalone-details"><summary>Истории дня: вопрос и разбор</summary><span class="day-state">Черновик · день выпуска не назначен</span><div class="day-stories">${standaloneHtml}</div><p class="story-note">Два самостоятельных видео с музыкой. Сначала вопрос, затем полный разбор. Запуск со звуком — по нажатию ▶.</p></details>
    <details><summary>Источники разбора и музыки</summary><ul class="sources">${sources}<li><a href="${escape(safeUrl(track.rightsSource || track.source))}" target="_blank" rel="noopener noreferrer">Запись: Open Goldberg Variations</a> · ${escape(track.license)}</li></ul></details>
  </div>
  <div class="post-foot"><span>План: ${escape(dateLabel(post.proposedDate))} · на просмотре</span><a href="#${escape(post.id)}" aria-label="Ссылка на выпуск ${escape(post.title)}">№ ${index + 1}</a></div>
</article>`;
  }
  const missing = expected.filter(item => !item.exists);
  if (args.includes('--check-assets') && missing.length) throw new Error(`Не хватает ${missing.length} файлов:\n${missing.map(item => item.file).join('\n')}`);
  if (args.includes('--check-assets') && !standaloneManifest) throw new Error('Все медиа присутствуют, но ещё нет standalone-stories/index.json. Дождитесь завершения сборки самостоятельных Stories.');
  const reelCount = rows.filter(row => row.format === 'Reels').length;
  const readyCount = rows.filter(row => row.ready).length;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ЕГЭ и ОГЭ · ещё 14 дней</title><meta name="description" content="Новая серия: восемь Reels и шесть каруселей. Языковые разборы, музыка и короткие музыкальные справки."><style>${style}</style></head><body>
<div class="shell"><div class="topline"><span>Русский язык · ЕГЭ + ОГЭ</span><span class="review">Черновики на просмотре</span></div>
<header class="hero"><div><p class="eyebrow">26 сентября — 9 октября · план на 14 дней</p><h1>Ещё две недели<br><em>русского языка.</em></h1></div><div class="hero-copy"><p>Один выпуск — одна языковая задача. И ещё одна небольшая находка: кто написал музыку и что о ней интересно знать.</p><div class="totals"><span><strong>${reelCount}</strong>Reels</span><span><strong>${rows.length - reelCount}</strong>каруселей</span><span><strong>14</strong>разборов</span></div></div></header>
<div class="introline"><strong>7 выпусков для ЕГЭ · 7 для ОГЭ</strong><span>Даты предложены для просмотра. Публикация пока не назначена.</span></div>
${missing.length ? `<p class="build-note">Медиа ещё собираются. Полностью готовы файлы ${readyCount} из ${rows.length} выпусков.</p>` : ''}
<nav class="toolbar" aria-label="Фильтр выпусков"><div class="filters">${[['all', 'Все 14'], ['ЕГЭ', 'ЕГЭ'], ['ОГЭ', 'ОГЭ'], ['Reels', 'Reels'], ['carousel', 'Карусели']].map(([value, label], i) => `<button class="filter" data-filter="${value}" aria-pressed="${i === 0}">${label}</button>`).join('')}</div><div class="result-count" role="status" aria-live="polite">Показано: ${posts.length} из ${posts.length}</div></nav>
<main><div class="posts">${posts.map(post => post.galleryHtml).join('\n')}</div><p class="empty" hidden>По этому фильтру пока нет выпусков.</p></main>
<footer><p>Иллюстративные сцены сгенерированы для этой серии. Это не документальные фотографии преподавателя или учеников. Музыка: И. С. Бах, исполнение Кимико Ишизаки.</p><p>Все материалы — черновики для просмотра.<br>Предлагаемые даты не означают публикацию.</p></footer></div>
<div class="toast" role="status" aria-live="polite" hidden></div><script id="caption-data" type="application/json">${jsonForHtml(captions)}</script><script>${script}</script></body></html>`;
  new vm.Script(script); // Catch generated JavaScript syntax errors before writing the artifact.
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'index.html'), html);
  const report = { version: 2, config: 'video-lab/exam-bank.json', gallery: 'outputs/exam-bank-2026-09-26/index.html', posts: rows, counts: { posts: posts.length, reels: reelCount, carousels: rows.length - reelCount, feedVideos: rows.reduce((sum, row) => sum + row.videoFiles.length, 0), stories: rows.reduce((sum, row) => sum + row.storyFiles.length, 0), standaloneVideos: rows.reduce((sum, row) => sum + row.standaloneVideoFiles.length, 0), expectedAssets: expected.length, ready: readyCount, missingFiles: missing.length }, standaloneManifestAvailable: Boolean(standaloneManifest), missingFiles: missing.map(item => item.file), status: missing.length ? 'awaiting-media' : standaloneManifest ? 'all-local-assets-present' : 'awaiting-standalone-manifest', note: 'File presence and generated script syntax checked. Media quality is checked by the separate package/QA pipeline; this does not claim publication or visual browser verification.' };
  fs.writeFileSync(path.join(output, 'gallery-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ gallery: path.join(output, 'index.html'), ...report.counts, status: report.status }, null, 2));
}

try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
