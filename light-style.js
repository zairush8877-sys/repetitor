// Светлая редакционная подача: фото целиком, текст на отдельной бумаге.
// Исходный текст слайда не переписывается. Фотографии выбираются только из
// проверенного каталога assets/photos/index.json с источниками и лицензиями.
const fs = require('fs');
const path = require('path');
const FONTS = require('./fonts');
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = value => esc(value).replace(/\n/g, '<br>');
/**
 * Снимок для нижнего окна кадра: закреплённый полем photoFile или из ротации.
 *
 * Ротация берёт хеш от id, про соседей по дате она не знает. Пока активных
 * снимков было два, это значило один и тот же блокнот во всех роликах подряд;
 * даже с восемью снимками в пачке на неделю повторы рядом неизбежны. Поэтому
 * у поста есть photoFile — ровно как musicFile у трека. Имя поля не из списка
 * MEDIA_FIELDS намеренно: такое поле входит в ключ черновика, и смена снимка
 * честно помечает сборку устаревшей.
 */
function photo(id, index = 0, pinned) {
  const file = path.join(__dirname, 'assets/photos/index.json');
  if (!fs.existsSync(file)) return null;
  const all = JSON.parse(fs.readFileSync(file)).photos;
  if (pinned) {
    const want = pinned.includes('/') ? pinned : `assets/photos/${pinned}`;
    const found = all.find(p => p.file === want);
    if (!found) throw new Error(`photoFile: снимка ${pinned} нет в assets/photos/index.json`);
    if (found.active === false) throw new Error(`photoFile: снимок ${pinned} выключен в каталоге`);
    if (!fs.existsSync(path.join(__dirname, found.file))) throw new Error(`photoFile: файла ${found.file} нет на диске`);
    return found;
  }
  const list = all.filter(p => p.active !== false && fs.existsSync(path.join(__dirname, p.file)));
  let hash = 0;
  for (const ch of `${id}:${index}`) hash = (31 * hash + ch.codePointAt(0)) >>> 0;
  return list.length ? list[hash % list.length] : null;
}
function photoHtml(p, className = 'photo') {
  if (!p) return '';
  const data = fs.readFileSync(path.join(__dirname, p.file)).toString('base64');
  return `<figure class="${className}"><img src="data:image/jpeg;base64,${data}" alt="${esc(p.alt)}"></figure>`;
}
function slideHtml(slide, index, total, handle, id, width = 1080, height = 1350) {
  const p = photo(id, index);
  let body;
  const heading = value => `<h1>${text(value)}</h1>`;
  if (slide.layout === 'table') {
    body = `${heading(slide.text)}<table>${(slide.rows || []).map(([left, right]) => `<tr><td class="${slide.plain ? '' : 'wrong'}">${text(left)}</td><td class="arrow">→</td><td class="right">${text(right)}</td></tr>`).join('')}</table>`;
  } else if (slide.layout === 'pair' || slide.layout === 'then') {
    const historical = slide.layout === 'then';
    const [left, right, why] = historical ? slide.then : slide.pair;
    body = `${slide.word ? heading(slide.word) : ''}<div class="meanings"><div>${historical ? '<small>Было</small>' : ''}<p class="value ${historical ? '' : 'wrong'}">${text(left)}</p></div><div>${historical ? '<small>Сейчас</small>' : ''}<p class="value right">${text(right)}</p></div></div><p class="why">${text(why)}</p>`;
  } else if (slide.layout === 'photo') {
    body = `${heading(slide.title || slide.word)}${slide.sub ? `<p class="sub">${text(slide.sub)}</p>` : ''}${slide.text ? `<p class="why">${text(slide.text)}</p>` : ''}`;
  } else {
    body = `${slide.mark === 'wrong' ? '<span class="marker wrong">✕</span>' : slide.mark === 'right' ? '<span class="marker right">✓</span>' : ''}<p class="lead">${text(slide.text)}</p>`;
  }
  const table = slide.layout === 'table';
  const dense = table || JSON.stringify(slide).length > 600;
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
  ${FONTS.fontFaceCss()}
  *{box-sizing:border-box;margin:0} :root{--scale:1}
  body{width:${width}px;height:${height}px;background:#fcfbf7;color:#253b36;font-family:${FONTS.body()};padding:64px 72px;display:flex;flex-direction:column;gap:30px;overflow:hidden}
  header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d6e1d7;padding-bottom:24px;font:26px ${FONTS.head()};color:#526d60}
  .kicker{font:600 27px ${FONTS.head()};color:#53715f;letter-spacing:.035em;margin-bottom:24px}
  .content{flex:1;min-height:0;display:flex;align-items:center}.content-inner{width:100%}
  h1{font:700 calc(70px * var(--scale))/1.13 ${FONTS.serif()};margin-bottom:26px;overflow-wrap:anywhere}
  .lead{font:600 calc(64px * var(--scale))/1.22 ${FONTS.head()};white-space:normal}
  .sub{font:600 calc(34px * var(--scale))/1.35 ${FONTS.head()};margin-top:18px}
  .meanings{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin:20px 0 26px}
  .value{font-size:calc(43px * var(--scale));line-height:1.25;font-weight:700;overflow-wrap:anywhere}
  small{display:block;font-size:calc(25px * var(--scale));text-transform:uppercase;color:#65756c;margin-bottom:10px}
  .why{font-size:calc(35px * var(--scale));line-height:1.42}.right{color:#326e58}.wrong{color:#a24e3b;text-decoration:line-through;text-decoration-thickness:2px}.marker{font-size:65px}
  table{width:100%;border-collapse:collapse;font-size:calc(${(slide.rows || []).length > 8 ? 32 : 38}px * var(--scale));line-height:1.28}td{padding:12px 0;border-bottom:1px solid #dce5dc;overflow-wrap:anywhere;width:44%}td.arrow{width:12%;text-align:center;color:#7d8f80}td.right{font-weight:700}
  .photo{height:${dense ? 260 : 370}px;flex-shrink:0;background:#eef2eb;border-radius:12px;overflow:hidden;display:flex;justify-content:center}.photo img{display:block;width:100%;height:100%;object-fit:contain}
  footer{display:flex;justify-content:space-between;font:24px ${FONTS.head()};color:#526a60}
  </style><body><header><span>русский язык · с Анной</span><span>${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></header>
  <section class="content"><div class="content-inner"><div class="kicker">${text(slide.kicker || (slide.layout === 'photo' ? '' : slide.sub) || '')}</div>${body}</div></section>
  ${photoHtml(p)}<footer><span>@${esc(handle)}</span><span>язык в повседневной жизни</span></footer></body></html>`;
}
async function fitContent(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => { await Promise.all([...document.images].map(i => i.decode())); });
  return page.evaluate(() => {
    const outer = document.querySelector('.content');
    const inner = document.querySelector('.content-inner');
    if (!outer || !inner) return { scale: 1 };
    let scale = 1;
    while ((inner.scrollHeight > outer.clientHeight + 1 || inner.scrollWidth > outer.clientWidth + 1) && scale > .70) {
      scale = Math.round((scale - .02) * 100) / 100;
      document.documentElement.style.setProperty('--scale', scale);
    }
    if (inner.scrollHeight > outer.clientHeight + 2 || inner.scrollWidth > outer.clientWidth + 2) throw new Error('Текст не помещается: нужен отдельный слайд, а не обрезка.');
    return { scale, width: inner.scrollWidth, height: inner.scrollHeight };
  });
}
function musicMeta(track) {
  if (!track) return undefined;
  const { composer, piece, license, source, licenseUrl, attribution, attributionRequired } = track;
  return { composer, piece, license, source, licenseUrl, attribution, attributionRequired };
}
async function fitReelContent(page) {
  await fitContent(page);
  return page.evaluate(() => {
    const card = document.querySelector('.card');
    const photo = document.querySelector('.photo');
    const title = document.querySelector('.title');
    const rows = [...document.querySelectorAll('.row')];
    card.style.height = 'auto';
    let tries = 0;
    while (card.getBoundingClientRect().bottom > photo.getBoundingClientRect().top - 80 && tries++ < 18) {
      for (const row of rows) {
        const css = getComputedStyle(row);
        row.style.fontSize = Math.max(28, parseFloat(css.fontSize) - 1) + 'px';
        row.style.paddingTop = row.style.paddingBottom = Math.max(8, parseFloat(css.paddingTop) - 1) + 'px';
      }
      if (tries > 6) title.style.setProperty('font-size', Math.max(52, parseFloat(getComputedStyle(title).fontSize) - 2) + 'px', 'important');
    }
    if (card.getBoundingClientRect().bottom > photo.getBoundingClientRect().top - 70) throw new Error('Таблица Reels не помещается целиком: сократите материал или разделите ролик.');
    return { adjusted: tries, rowFont: getComputedStyle(rows[0]).fontSize };
  });
}
function browserOptions() {
  if (fs.existsSync('/opt/pw-browsers/chromium')) return { executablePath: '/opt/pw-browsers/chromium' };
  // На Windows используем установленный Edge; CI продолжает использовать Chromium.
  if (process.platform === 'win32' && fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')) return { channel: 'msedge', headless: true };
  return {};
}
module.exports = { photo, photoHtml, slideHtml, fitContent, fitReelContent, musicMeta, browserOptions };
