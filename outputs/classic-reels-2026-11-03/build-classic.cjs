#!/usr/bin/env node
'use strict';
// Isolated exports using the project's preserved early table renderer. No API calls.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUT = __dirname;
const CONTENT = path.join(OUT, 'content');
const P = require('./remote-snapshot/prepared-media');
const { renderPost } = require('./remote-snapshot/render-reposts');
const { legacyPageHtml } = require(path.join(ROOT, 'render-reels'));
const FF = process.env.CLASSIC_FFMPEG || '/private/tmp/mama-reels-tools/ffmpeg';
const FP = process.env.CLASSIC_FFPROBE || '/private/tmp/mama-reels-tools/ffprobe';
const FPS = 30, INTRO = 1.2, STEP = 2.2, OUTRO = 3.2;
const raw = rel => `https://raw.githubusercontent.com/zairush8877-sys/repetitor/main/content/${rel}`;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function source() {
  const file = path.join(OUT, fs.existsSync(path.join(OUT, 'release.json')) ? 'release.json' : 'editorial/copy-drafts.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function html(post, index) {
  const background = `outputs/classic-reels-2026-11-03/assets/${index % 2 ? 'library-bookshelves.jpg' : 'library-warm.jpg'}`;
  const p = {...post, background, lightBg: true, videoBg: undefined, outroSeconds: OUTRO};
  let result = legacyPageHtml(p, '');
  result = result.replace(/<div class="foot">[\s\S]*?<\/div>/, '').replace(/<div class="progress">[\s\S]*?<\/div>/, '');
  const neutral = !!p.heads || !!p.steps;
  return result.replace('</style>', `
    body{padding:300px 78px 260px;background-position:72% center}
    body::before{background:linear-gradient(180deg,rgba(24,18,12,.08),transparent 50%,rgba(24,18,12,.18))}
    .kicker{font-size:29px;letter-spacing:.13em;margin-bottom:34px;line-height:1.5}
    .title{font-size:94px;line-height:1.16;margin-bottom:44px}
    .plate{background:rgba(247,241,229,.96);box-shadow:0 2px 8px #0001}
    .card{background:rgba(255,253,247,.97);padding:28px 32px 22px;border-radius:18px;flex-shrink:0}
    .row{font-size:52px;line-height:1.25;padding:20px 0;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .row .bad,.row .good{overflow-wrap:normal;min-width:0}
    .head{font-size:23px;letter-spacing:.05em;gap:24px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    ${neutral ? '.bad,.head .h-bad{color:#211d18!important}.head i{display:none}' : ''}
    .progress,.foot{display:none}
    </style>`);
}
async function layout(page, post, index) {
  const markup = html(post, index);
  await page.setContent(markup);
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.evaluate(() => {
    const card = document.querySelector('.card'), rows = [...document.querySelectorAll('.row')], title = document.querySelector('.title');
    card.style.height = 'auto';
    let tries = 0;
    while ((card.getBoundingClientRect().bottom > 1640 || rows.some(r => r.scrollWidth > r.clientWidth + 1)) && tries++ < 12) {
      rows.forEach(row => { row.style.fontSize = Math.max(40, parseFloat(getComputedStyle(row).fontSize) - 1) + 'px'; row.style.paddingTop = row.style.paddingBottom = Math.max(12, parseFloat(getComputedStyle(row).paddingTop) - 1) + 'px'; });
      if (tries > 3) title.style.fontSize = Math.max(76, parseFloat(getComputedStyle(title).fontSize) - 2) + 'px';
    }
    if (card.getBoundingClientRect().bottom > 1640) throw new Error('Table exceeds Story-safe area');
    const text = document.body.innerText;
    if (/маирова|mairova|подготовка к|подготовка.*олимпиад/i.test(text) || document.querySelector('.foot')) throw new Error('Forbidden branding/footer in export');
    if (document.querySelector('.title').scrollWidth > document.querySelector('.title').clientWidth + 2) throw new Error('Title overflow');
    const top = card.getBoundingClientRect().top, padBottom = parseFloat(getComputedStyle(card).paddingBottom) || 0;
    window.__geom = {headBottom:document.querySelector('.head').getBoundingClientRect().bottom-top+padBottom,rows:rows.map(r=>r.getBoundingClientRect().bottom-top+padBottom)};
    return {cardTop:top,cardBottom:card.getBoundingClientRect().bottom,rowFont:parseFloat(getComputedStyle(rows[0]).fontSize),titleFont:parseFloat(getComputedStyle(title).fontSize),footerCount:document.querySelectorAll('.foot').length,text};
  });
  fs.mkdirSync(path.join(OUT, 'compositions'), {recursive:true});
  fs.writeFileSync(path.join(OUT, 'compositions', post.id + '.html'), markup);
  return measured;
}
async function render(browser, post, index, preview) {
  const page = await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  const total = INTRO + post.rows.length * STEP + OUTRO;
  try {
    const measured = await layout(page, post, index);
    const seek = t => page.evaluate(([t,intro,step])=>window.seek(t,intro,step), [t,INTRO,STEP]);
    const frame = path.join(CONTENT, 'reels', post.id + '-frame.jpg');
    fs.mkdirSync(path.dirname(frame), {recursive:true});
    await seek(total-.1); await page.screenshot({path:frame,type:'jpeg',quality:96});
    const key = P.sha(JSON.stringify({title:post.title,kicker:post.kicker,rows:post.rows,heads:post.heads,steps:post.steps,index,script:P.sha(fs.readFileSync(__filename))}));
    const receipt = path.join(OUT,'qa',post.id+'-render.json');
    if (preview) { write(receipt,{id:post.id,previewOnly:true,total,measured}); return; }
    const video = path.join(CONTENT,'reels',post.id+'.mp4');
    if (fs.existsSync(receipt) && fs.existsSync(video)) {
      const old=JSON.parse(fs.readFileSync(receipt)); if(old.key===key&&old.sha256===P.sha(fs.readFileSync(video))){console.log('unchanged export: '+post.id);return;}
    }
    const temp = path.join(OUT,'.work',post.id); fs.mkdirSync(temp,{recursive:true});
    const times=[0];
    for(let n=27;n<36;n++) times.push(n/FPS);
    for(let row=0;row<post.rows.length;row++) for(let n=0;n<28;n++) times.push(INTRO+row*STEP+n/FPS);
    const unique=[...new Set(times.map(t=>Math.round(t*FPS)/FPS))].sort((a,b)=>a-b);
    const timeline=['ffconcat version 1.0'];
    for(let i=0;i<unique.length;i++){
      await seek(unique[i]); const name='f'+String(i).padStart(4,'0')+'.jpg';
      await page.screenshot({path:path.join(temp,name),type:'jpeg',quality:94});
      const hold=(unique[i+1]??total)-unique[i];
      timeline.push(`file '${name}'`,'option framerate 30',`duration ${hold.toFixed(9)}`);
    }
    timeline.push(`file 'f${String(unique.length-1).padStart(4,'0')}.jpg'`,'option framerate 30');
    fs.writeFileSync(path.join(temp,'timeline.ffconcat'),timeline.join('\n')+'\n');
    cp.execFileSync(FF,['-v','error','-y','-f','concat','-safe','0','-i',path.join(temp,'timeline.ffconcat'),'-ss',String(index*.7),'-i',path.join(OUT,'assets/bach-var1.mp3'),'-map','0:v','-map','1:a','-t',String(total),'-vf',`fps=30,tpad=stop_mode=clone:stop_duration=${total}`,'-r','30','-af',`loudnorm=I=-18:TP=-2:LRA=8,afade=t=in:d=0.6,afade=t=out:st=${total-1.2}:d=1.2`,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',video],{stdio:['ignore','ignore','inherit']});
    const info=JSON.parse(cp.execFileSync(FP,['-v','error','-show_streams','-show_format','-of','json',video],{encoding:'utf8'}));
    const v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
    if(v.width!==1080||v.height!==1920||v.r_frame_rate!=='30/1'||!a||Math.abs(Number(v.duration)-total)>.08)throw new Error('Invalid output dimensions/fps/duration/audio');
    cp.execFileSync(FF,['-v','error','-i',video,'-f','null','-'],{stdio:['ignore','ignore','pipe']});
    write(receipt,{id:post.id,key,total,measured,screenshotFrames:unique.length,sha256:P.sha(fs.readFileSync(video)),streams:info.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,duration:s.duration,sampleRate:s.sample_rate})),decoded:true});
    fs.rmSync(temp,{recursive:true,force:true}); console.log('rendered '+post.id+' '+total.toFixed(1)+'s');
  } finally {await page.close();}
}
async function pack(posts) {
  const music=JSON.parse(fs.readFileSync(path.join(OUT,'assets/music-license.json')));
  const prepared={version:1,posts:{}},manifest={version:1,posts:{}};
  const queue={account:'mairova_a_a',account_id:'17841456632615750',posts};
  for(const p of posts){
    const i=posts.indexOf(p);
    const media={background:`outputs/classic-reels-2026-11-03/assets/${i%2?'library-bookshelves.jpg':'library-warm.jpg'}`,lightBg:true,generatedBg:false,videoUrl:raw(`reels/${p.id}.mp4`),coverUrl:raw(`reels/${p.id}-frame.jpg`),coverOffsetMs:Math.round((INTRO+p.rows.length*STEP+OUTRO-1)*1000),music};
    const rendered={...p,...media}; manifest.posts[p.id]=await renderPost(rendered,{contentDir:CONTENT,outDir:path.join(CONTENT,'reposts')});
    const urls=[media.videoUrl,media.coverUrl];
    const files=urls.map(url=>{const relative=P.relativeUrl(url),bytes=fs.readFileSync(path.join(CONTENT,relative));return{relative,url,size:bytes.length,sha256:P.sha(bytes)};});
    prepared.posts[p.id]={version:1,draftKey:P.draftKey(p),builtAt:new Date().toISOString(),media,files};
  }
  write(path.join(CONTENT,'queue.json'),queue);write(path.join(CONTENT,'prepared/index.json'),prepared);write(path.join(CONTENT,'reposts/index.json'),manifest);write(path.join(CONTENT,'stories.json'),{stories:[]});
  for(const p of posts) P.validate(p,{contentDir:CONTENT,entry:prepared.posts[p.id],manifest});
  fs.writeFileSync(path.join(OUT,'index.html'),`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Анна · книжные Reels</title><style>body{background:#e9e2d5;color:#211d18;font:17px Georgia;margin:30px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}article{background:#fffaf0;padding:18px;border-radius:10px}video{width:100%;max-height:620px}h2{font-size:25px}p{line-height:1.5}a{color:#514027}</style><h1>Книжные Reels</h1><p>Семь новых выпусков: общая грамотность, ЕГЭ, ОГЭ и олимпиадные разминки. Без подписи автора и нижнего офера.</p><main>${posts.map(p=>`<article><h2>${esc(p.title).replace(/\n/g,' ')}</h2><video controls playsinline preload="metadata" poster="content/reels/${p.id}-frame.jpg" src="content/reels/${p.id}.mp4"></video><p>${esc(p.caption)}</p><p>${esc((p.hashtags||[]).join(' '))}</p><a href="content/reels/${p.id}.mp4">Видео</a> · <a href="content/reels/${p.id}-frame.jpg">Обложка</a></article>`).join('')}</main></html>`);
  console.log('Packaged '+posts.length+' Reels and full-video Stories; no publication calls');
}
(async()=>{
  const src=source(), preview=process.argv.includes('--preview'),packOnly=process.argv.includes('--pack-only');
  const only=process.argv.find(a=>a.startsWith('--id='))?.slice(5);
  const posts=src.posts.map(p=>({...p,status:['approved','pending'].includes(p.status)?p.status:'pending',storyRepostMode:'full_video',branding:{show_handle:false,show_author_signature:false,show_services_footer:false}}));
  let browser;
  try{
    if(!packOnly){browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});for(let i=0;i<posts.length;i++)if(!only||posts[i].id===only)await render(browser,posts[i],i,preview);}
    if(!preview&&!only)await pack(posts);
  }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
