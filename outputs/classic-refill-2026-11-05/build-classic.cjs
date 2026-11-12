#!/usr/bin/env node
'use strict';
// Isolated exports using the project's preserved early table renderer. No API calls.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const execFile = require('util').promisify(cp.execFile);
const ROOT = path.resolve(__dirname, '../..');
const OUT = __dirname;
const CONTENT = path.join(OUT, 'content');
const P = require('./runtime/prepared-media');
const { renderPost } = require('./runtime/render-reposts');
const { legacyPageHtml } = require('./runtime/legacy-table');
const A = require('./runtime/asset-resolver.cjs');
const FF = process.env.CLASSIC_FFMPEG || '/private/tmp/mama-reels-tools/ffmpeg';
const FP = process.env.CLASSIC_FFPROBE || '/private/tmp/mama-reels-tools/ffprobe';
const FPS = 30, INTRO = 1.2, STEP = 2.2, OUTRO = 3.2;
const raw = rel => `https://raw.githubusercontent.com/zairush8877-sys/repetitor/main/content/${rel}`;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function source() {
  const src = JSON.parse(fs.readFileSync(path.join(OUT, 'release.json'), 'utf8'));
  A.validatePosts(src.posts);
  return src;
}
function html(post, assets) {
  const p = {...post, background: assets.background, lightBg: true, plainBg: false, videoBg: undefined, outroSeconds: OUTRO};
  let result = legacyPageHtml(p, '');
  result = result.replace(/<div class="foot">[\s\S]*?<\/div>/, '').replace(/<div class="progress">[\s\S]*?<\/div>/, '');
  const neutral = !!p.heads || !!p.steps;
  return result.replace('</style>', `
    body{padding:300px 78px 260px;background-position:${assets.backgroundPosition}}
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
async function layout(page, post, assets) {
  const markup = html(post, assets);
  await page.setContent(markup);
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.evaluate(() => {
    const card = document.querySelector('.card'), rows = [...document.querySelectorAll('.row')], title = document.querySelector('.title');
    card.style.height = 'auto';
    const overflow = () => rows.some(r => [r, ...r.querySelectorAll('.bad,.good')].some(cell => cell.scrollWidth > cell.clientWidth + 1));
    let tries = 0;
    while ((card.getBoundingClientRect().bottom > 1640 || overflow()) && tries++ < 16) {
      const tooTall = card.getBoundingClientRect().bottom > 1640;
      rows.forEach(row => { row.style.fontSize = Math.max(40, parseFloat(getComputedStyle(row).fontSize) - 1) + 'px'; row.style.paddingTop = row.style.paddingBottom = Math.max(12, parseFloat(getComputedStyle(row).paddingTop) - 1) + 'px'; });
      if (tooTall && tries > 3) title.style.fontSize = Math.max(76, parseFloat(getComputedStyle(title).fontSize) - 2) + 'px';
    }
    if (card.getBoundingClientRect().bottom > 1640) throw new Error('Table exceeds Story-safe area');
    if (overflow()) throw new Error('Table cell overflows its own column');
    const text = document.body.innerText;
    if (/маирова|mairova|подготовка к|подготовка.*олимпиад/i.test(text) || document.querySelector('.foot')) throw new Error('Forbidden branding/footer in export');
    if (document.querySelector('.title').scrollWidth > document.querySelector('.title').clientWidth + 2) throw new Error('Title overflow');
    const top = card.getBoundingClientRect().top, padBottom = parseFloat(getComputedStyle(card).paddingBottom) || 0;
    window.__geom = {headBottom:document.querySelector('.head').getBoundingClientRect().bottom-top+padBottom,rows:rows.map(r=>r.getBoundingClientRect().bottom-top+padBottom)};
    return {cardTop:top,cardBottom:card.getBoundingClientRect().bottom,rowFont:parseFloat(getComputedStyle(rows[0]).fontSize),titleFont:parseFloat(getComputedStyle(title).fontSize),footerCount:document.querySelectorAll('.foot').length,cellOverflow:overflow(),text};
  });
  fs.mkdirSync(path.join(OUT, 'compositions'), {recursive:true});
  fs.writeFileSync(path.join(OUT, 'compositions', post.id + '.html'), markup);
  return measured;
}
function outputPaths(post) {
  return {video:path.join(CONTENT,'reels',post.id+'.mp4'),cover:path.join(CONTENT,'reels',post.id+'-frame.jpg'),receipt:path.join(OUT,'qa',post.id+'-render.json')};
}
function readReceipt(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null; }
function assertAssets(assets) {
  for (const a of [assets.photo, assets.track]) if (P.sha(fs.readFileSync(a.absolute)) !== a.sha256) throw new Error(`${a.id}: asset changed after preflight`);
}
async function render(browser, post, assets, key, preview) {
  const paths = outputPaths(post);
  assertAssets(assets);
  if (!preview && A.renderMatches(readReceipt(paths.receipt),key,paths.video,paths.cover)) {console.log('unchanged export: '+post.id);return;}
  const page = await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  const total = INTRO + post.rows.length * STEP + OUTRO;
  const temp = path.join(OUT,'.work',`${post.id}-${process.pid}`);
  try {
    const measured = await layout(page, post, assets);
    const seek = t => page.evaluate(([t,intro,step])=>window.seek(t,intro,step), [t,INTRO,STEP]);
    if (preview) {
      const frame=path.join(OUT,'qa',post.id+'-preview.jpg'); fs.mkdirSync(path.dirname(frame),{recursive:true});
      await seek(total-.1); await page.screenshot({path:frame,type:'jpeg',quality:96});
      write(path.join(OUT,'qa',post.id+'-layout.json'),{id:post.id,previewOnly:true,total,key,assets:assets.cache,measured,previewFile:path.relative(OUT,frame),previewSha256:P.sha(fs.readFileSync(frame))});
      return;
    }
    fs.mkdirSync(temp,{recursive:true});
    const video=path.join(temp,post.id+'.mp4'),frame=path.join(temp,post.id+'-frame.jpg');
    await seek(total-.1); await page.screenshot({path:frame,type:'jpeg',quality:96});
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
    assertAssets(assets);
    await execFile(FF,['-v','error','-y','-f','concat','-safe','0','-i',path.join(temp,'timeline.ffconcat'),'-ss',String(assets.musicOffsetSeconds),'-i',assets.track.absolute,'-map','0:v','-map','1:a','-t',String(total),'-vf',`fps=30,tpad=stop_mode=clone:stop_duration=${total}`,'-r','30','-af',`loudnorm=I=-18:TP=-2:LRA=8,afade=t=in:d=0.6,afade=t=out:st=${total-1.2}:d=1.2`,'-c:v','libx264','-threads','2','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',video],{maxBuffer:4*1024*1024});
    const info=JSON.parse((await execFile(FP,['-v','error','-show_streams','-show_format','-of','json',video],{maxBuffer:4*1024*1024})).stdout);
    const v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
    if(!v||v.width!==1080||v.height!==1920||v.r_frame_rate!=='30/1'||!a||Math.abs(Number(v.duration)-total)>.08)throw new Error('Invalid output dimensions/fps/duration/audio');
    await execFile(FF,['-v','error','-threads','2','-i',video,'-f','null','-'],{maxBuffer:4*1024*1024});
    fs.mkdirSync(path.dirname(paths.video),{recursive:true});
    fs.renameSync(video,paths.video);fs.renameSync(frame,paths.cover);
    write(paths.receipt,{id:post.id,key,total,assets:assets.cache,music:assets.music,measured,screenshotFrames:unique.length,sha256:P.sha(fs.readFileSync(paths.video)),coverSha256:P.sha(fs.readFileSync(paths.cover)),streams:info.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,duration:s.duration,sampleRate:s.sample_rate})),decoded:true});
    console.log('rendered '+post.id+' '+total.toFixed(1)+'s');
  } finally {await page.close();fs.rmSync(temp,{recursive:true,force:true});}
}
async function pack(posts, contexts, selected = posts) {
  // A shared queue must never expose changed unselected posts with old media.
  // Partial pack therefore also requires a current full render baseline.
  for(const p of posts){const c=contexts.get(p.id),f=outputPaths(p);assertAssets(c.assets);if(!A.renderMatches(readReceipt(f.receipt),c.key,f.video,f.cover))throw new Error(`${p.id}: missing or stale render receipt; render before packing`);}
  const partial=selected.length!==posts.length;
  const loadIndex=file=>partial&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,posts:{}};
  const prepared=loadIndex(path.join(CONTENT,'prepared/index.json')),manifest=loadIndex(path.join(CONTENT,'reposts/index.json'));
  const queue={account:'mairova_a_a',account_id:'17841456632615750',posts};
  for(const p of selected){
    const assets=contexts.get(p.id).assets;
    const media={background:assets.background,lightBg:true,generatedBg:false,videoUrl:raw(`reels/${p.id}.mp4`),coverUrl:raw(`reels/${p.id}-frame.jpg`),coverOffsetMs:Math.round((INTRO+p.rows.length*STEP+OUTRO-1)*1000),music:assets.music};
    const rendered={...p,...media}; manifest.posts[p.id]=await renderPost(rendered,{contentDir:CONTENT,outDir:path.join(CONTENT,'reposts')});
    const urls=[media.videoUrl,media.coverUrl];
    const files=urls.map(url=>{const relative=P.relativeUrl(url),bytes=fs.readFileSync(path.join(CONTENT,relative));return{relative,url,size:bytes.length,sha256:P.sha(bytes)};});
    prepared.posts[p.id]={version:1,draftKey:P.draftKey(p),builtAt:new Date().toISOString(),media,files};
  }
  for(const p of posts) P.validate(p,{contentDir:CONTENT,entry:prepared.posts[p.id],manifest});
  write(path.join(CONTENT,'queue.json'),queue);write(path.join(CONTENT,'prepared/index.json'),prepared);write(path.join(CONTENT,'reposts/index.json'),manifest);write(path.join(CONTENT,'stories.json'),{stories:[]});
  fs.writeFileSync(path.join(OUT,'index.html'),`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Анна · книжные Reels</title><style>body{background:#e9e2d5;color:#211d18;font:17px Georgia;margin:30px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}article{background:#fffaf0;padding:18px;border-radius:10px}video{width:100%;max-height:620px}h2{font-size:25px}p{line-height:1.5}a{color:#514027}</style><h1>Книжные Reels</h1><p>Новые выпуски: общая грамотность, ЕГЭ, ОГЭ и олимпиадные разминки. Без подписи автора и нижнего офера.</p><main>${posts.map(p=>`<article><h2>${esc(p.title).replace(/\n/g,' ')}</h2><video controls playsinline preload="metadata" poster="content/reels/${p.id}-frame.jpg" src="content/reels/${p.id}.mp4"></video><p>${esc(p.caption)}</p><p>${esc((p.hashtags||[]).join(' '))}</p><a href="content/reels/${p.id}.mp4">Видео</a> · <a href="content/reels/${p.id}-frame.jpg">Обложка</a></article>`).join('')}</main></html>`);
  console.log('Packaged '+selected.length+' Reels and full-video Stories; no publication calls');
}
function options(args) {
  const result={preview:false,packOnly:false,jobs:1,only:null};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--preview')result.preview=true;
    else if(a==='--pack-only')result.packOnly=true;
    else if(a==='--jobs'||a.startsWith('--jobs=')){const v=a==='--jobs'?args[++i]:a.slice(7);if(!/^[12]$/.test(v||''))throw new Error('--jobs must be 1 or 2');result.jobs=Number(v);}
    else if(a==='--id'||a.startsWith('--id=')){const v=a==='--id'?args[++i]:a.slice(5);if(!/^[a-zA-Z\d_-]+$/.test(v||''))throw new Error('Invalid --id');result.only=v;}
    else throw new Error('Unknown argument: '+a);
  }
  if(result.preview&&result.packOnly)throw new Error('--preview and --pack-only are exclusive');
  return result;
}
function codeFingerprint() {
  const files=[__filename,path.join(OUT,'runtime/asset-resolver.cjs'),path.join(OUT,'runtime/legacy-table.js'),path.join(ROOT,'fonts.js'),path.join(ROOT,'assets/fonts/index.json')];
  const index=JSON.parse(fs.readFileSync(files[files.length-1],'utf8'));
  for(const f of index.fonts.filter(f=>['IBM Plex Serif','IBM Plex Mono'].includes(f.family)))files.push(path.join(ROOT,'assets/fonts',f.file));
  return A.digest(files.map(f=>({file:path.relative(ROOT,f),sha256:P.sha(fs.readFileSync(f))})));
}
function preflight(posts) {
  const resolve=A.createResolver({root:OUT,projectRoot:ROOT,photos:JSON.parse(fs.readFileSync(path.join(OUT,'photos-rotation.json'),'utf8')).photos,tracks:JSON.parse(fs.readFileSync(path.join(OUT,'music-rotation.json'),'utf8')).tracks,ffprobe:FP});
  const code=codeFingerprint(),contexts=new Map();
  for(const p of posts){const total=INTRO+p.rows.length*STEP+OUTRO,assets=resolve(p,total);contexts.set(p.id,{assets,key:A.cacheKey(p,assets,code,{FPS,INTRO,STEP,OUTRO,total})});}
  A.verifyRotation([...contexts.values()].map(c=>c.assets));
  return contexts;
}
async function main(args=process.argv.slice(2)) {
  const opts=options(args),src=source(),posts=src.posts.map(p=>({...p}));
  for(const p of posts)if(p.storyRepostMode!=='full_video'||p.branding?.show_handle!==false||p.branding?.show_author_signature!==false||p.branding?.show_services_footer!==false)throw new Error(`${p.id}: release must explicitly preserve full_video and no-branding settings`);
  const selected=opts.only?posts.filter(p=>p.id===opts.only):posts;
  if(!selected.length)throw new Error('Post not found: '+opts.only);
  const contexts=preflight(posts);
  let browser;
  try{
    if(!opts.packOnly){const {chromium}=require('playwright');browser=await chromium.launch({executablePath:process.env.CLASSIC_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});await A.runPool(selected,opts.jobs,async p=>{const c=contexts.get(p.id);await render(browser,p,c.assets,c.key,opts.preview);});}
    if(!opts.preview&&(!opts.only||opts.packOnly))await pack(posts,contexts,selected);
  }finally{if(browser)await browser.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
module.exports={html,layout,render,pack,preflight,options,codeFingerprint,outputPaths,main};
