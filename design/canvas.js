#!/usr/bin/env node
/**
 * Холст «Правка»: визуальное выражение design/PHILOSOPHY.md.
 *
 *   node design/canvas.js
 *
 * Лист 1080×1920 — тот же формат, в котором живут Reels и сторис, поэтому
 * работа одновременно и самостоятельная вещь, и образец системы: палитра,
 * шрифтовая пара, сетка и толщина зачёркивания взяты отсюда в рендеры.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'pravka.png');
const FONTS = '/root/.claude/skills/canvas-design/canvas-fonts';
const W = 1080, H = 1920;

// Палитра философии: бумага, цвет ошибки, цвет нормы и почти невидимое поле.
const PAPER = '#efe9dd';
const PAPER_HI = '#f6f2e9';
const ERR = '#8a3a24';
const OK = '#2f5748';
const FIELD = '#c4b9a4';
const INK = '#211d18';

const font = (file, family, weight = 400, style = 'normal') => {
  const b64 = fs.readFileSync(path.join(FONTS, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};`
    + `src:url(data:font/ttf;base64,${b64}) format('truetype')}`;
};

// Девять правок: одна и та же помета, поставленная подряд, — накопление,
// из которого глаз начинает читать систему, а не отдельные слова.
const ROWS = [
  ['вклю́чит', 'включи́т'],
  ['зво́нит', 'звони́т'],
  ['ло́жит', 'кладёт'],
  ['ихний', 'их'],
  ['по прие́зду', 'по прие́зде'],
  ['туфля́', 'ту́фля'],
  ['све́рлит', 'сверли́т'],
  ['ба́рмен', 'ба́рмен'],
  ['красиве́е', 'краси́вее'],
];

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
${font('IBMPlexSerif-Regular.ttf', 'Plex', 400)}
${font('IBMPlexSerif-Bold.ttf', 'Plex', 700)}
${font('IBMPlexSerif-Italic.ttf', 'Plex', 400, 'italic')}
${font('IBMPlexMono-Regular.ttf', 'PlexMono', 400)}
${font('IBMPlexMono-Bold.ttf', 'PlexMono', 700)}

* { box-sizing: border-box; margin: 0; padding: 0 }
body {
  width: ${W}px; height: ${H}px; overflow: hidden; position: relative;
  background:
    radial-gradient(1200px 900px at 26% 14%, ${PAPER_HI} 0%, transparent 62%),
    radial-gradient(900px 1100px at 88% 88%, rgba(196,185,164,.30) 0%, transparent 60%),
    ${PAPER};
  color: ${INK};
  font-family: Plex, Georgia, serif;
}
/* Волокно бумаги: очень слабое, различимо только вблизи — как на листе,
   который держали в руках. */
body::before {
  content: ""; position: absolute; inset: 0; opacity: .5;
  background:
    repeating-linear-gradient(93deg, rgba(33,29,24,.030) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(2deg, rgba(33,29,24,.022) 0 1px, transparent 1px 7px);
}

/* Вертикаль поля — на 30% ширины, не по центру: смещение держит глаз. */
.field { position: absolute; left: 324px; top: 0; bottom: 0; width: 1px; background: ${FIELD} }
.field.second { left: 328px; opacity: .45 }

.marks {
  position: absolute; left: 96px; top: 640px; width: 200px;
  font-family: PlexMono, monospace; font-size: 21px; letter-spacing: .16em;
  color: rgba(33,29,24,.42); text-align: right;
}
.marks div { height: 108px; line-height: 108px }

header { position: absolute; left: 384px; top: 188px; right: 96px }
.disc {
  font-family: PlexMono, monospace; font-size: 22px; letter-spacing: .34em;
  text-transform: uppercase; color: ${ERR};
}
.rule { width: 84px; height: 2px; background: ${ERR}; margin: 26px 0 34px }
h1 {
  font-size: 118px; line-height: .96; font-weight: 700; letter-spacing: -.022em;
}
h1 em { font-style: italic; font-weight: 400; color: ${ERR} }
.sub {
  margin-top: 30px; font-family: PlexMono, monospace; font-size: 22px;
  letter-spacing: .2em; color: rgba(33,29,24,.5); text-transform: uppercase;
}

table { position: absolute; left: 384px; top: 640px; right: 96px; border-collapse: collapse }
td { height: 108px; vertical-align: middle; font-size: 46px }
.bad { position: relative; color: ${ERR}; width: 47%; white-space: nowrap }
/* Зачёркивание — единственная линия, которой позволено пересечь букву.
   Толщина подобрана под этот кегль: тоньше теряется, толще убивает слово. */
.bad span { position: relative; display: inline-block }
.bad span::after {
  content: ""; position: absolute; left: -6px; right: -6px; top: 54%;
  height: 3px; background: ${ERR};
}
.arrow {
  width: 6%; font-family: PlexMono, monospace; font-size: 26px;
  color: rgba(33,29,24,.38); text-align: center;
}
.good { color: ${OK}; font-weight: 700 }
tr + tr td { border-top: 1px solid rgba(33,29,24,.10) }

/* Единственное отклонение на всю композицию: слово, которое исправлять не в чем. */
.same .bad span::after { display: none }
.same .bad { color: rgba(33,29,24,.34) }
.same .arrow { color: rgba(33,29,24,.18) }
.same .good::after {
  content: "="; font-family: PlexMono, monospace; font-size: 22px;
  color: rgba(33,29,24,.3); margin-left: 18px; vertical-align: 6px;
}

footer {
  position: absolute; left: 96px; right: 96px; bottom: 108px;
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: PlexMono, monospace; font-size: 21px; letter-spacing: .2em;
  color: rgba(33,29,24,.42); text-transform: uppercase;
}
.seal { position: absolute; right: 96px; top: 188px; text-align: right }
.seal .n { font-size: 96px; font-weight: 700; color: rgba(33,29,24,.10); line-height: .9 }
</style></head><body>
  <div class="field"></div><div class="field second"></div>

  <div class="marks">
    ${ROWS.map((_, i) => `<div>${String(i + 1).padStart(2, '0')}</div>`).join('')}
  </div>

  <header>
    <div class="disc">Норма</div>
    <div class="rule"></div>
    <h1>Правка<br><em>как форма</em></h1>
    <div class="sub">девять наблюдений</div>
  </header>

  <table>
    ${ROWS.map(([bad, good]) => {
      const same = bad === good;
      return `<tr class="${same ? 'same' : ''}">
        <td class="bad"><span>${bad}</span></td>
        <td class="arrow">→</td>
        <td class="good">${good}</td>
      </tr>`;
    }).join('')}
  </table>

  <footer>
    <span>Бумага · охра · хвоя</span>
    <span>Plex Serif / Plex Mono</span>
  </footer>
</body></html>`;

(async () => {
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: OUT, type: 'png' });
  await browser.close();
  console.log(OUT);
})();
