'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./asset-resolver.cjs');
const B = require('../build-classic.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classic-rotation-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  for(const kind of ['photos','music'])fs.mkdirSync(path.join(root,'assets',kind),{recursive:true});
  const make=(id,kind,bytes)=>{const file=`assets/${kind}/${id}.${kind==='photos'?'jpg':'mp3'}`;fs.writeFileSync(path.join(root,file),bytes);return{id,file,sha256:A.sha(bytes)};};
  const photos=[make('p1','photos','photo1'),make('p2','photos','photo2')];
  const tracks=['m1','m2'].map(id=>({...make(id,'music',id),durationSeconds:35,composer:'Composer '+id,piece:'Piece '+id,license:'CC0 1.0',source:'https://example.org/'+id,attribution:'Recording '+id,attributionRequired:'false',sourceExcerptStartSeconds:3}));
  const create=(override={})=>A.createResolver({root,projectRoot:path.dirname(root),photos,tracks,audioProbe:()=>35,...override});
  const post=(id='test-1',select={})=>({id,format:'Reels',visualStyle:'classic-table',status:'approved',title:'Тест',kicker:'ТЕСТ',rows:[['ошибка','норма']],scheduledAt:'2026-11-04T07:00:00.000Z',assetSelection:{photoId:'p1',musicId:'m1',musicOffsetSeconds:2,backgroundPosition:'72% center',...select}});
  return{root,photos,tracks,create,post};
}
test('one resolver provides selected photo, source credits, exact file/SHA/offset/crop',t=>{
  const f=fixture(t),p=f.post(),a=f.create()(p,13.2);
  assert.equal(a.background,path.basename(f.root)+'/assets/photos/p1.jpg');
  assert.equal(a.track.absolute,path.join(f.root,'assets/music/m1.mp3'));
  assert.equal(a.music.piece,'Piece m1');assert.equal(a.music.attributionRequired,false);
  assert.equal(a.music.offsetSeconds,2);assert.equal(a.music.originalExcerptStartSeconds,5);
  assert.equal(a.music.excerptDurationSeconds,13.2);assert.equal(a.backgroundPosition,'72% center');
  assert.equal(a.cache.musicSha256,f.tracks[0].sha256);assert.equal(a.cache.photoSha256,f.photos[0].sha256);
});
test('unknown selection, implicit offset, malformed crop and stale SHA are rejected',t=>{
  const f=fixture(t);
  for(const select of [{photoId:'absent'},{musicId:'absent'},{musicOffsetSeconds:undefined},{musicOffsetSeconds:-1},{musicOffsetSeconds:'2'},{backgroundPosition:'72% center; color:red'},{backgroundPosition:'100.1% center'},{backgroundPosition:'center'}])assert.throws(()=>f.create()(f.post('x',select),13.2));
  const p=f.post();p.assetSelection.extra='index fallback';assert.throws(()=>f.create()(p,13.2),/assetSelection/);
  delete f.photos[0].sha256;assert.throws(()=>f.create()(f.post(),13.2),/sha256/);
  f.photos[0].sha256='f'.repeat(64);assert.throws(()=>f.create()(f.post(),13.2),/SHA mismatch/);
});
test('paths cannot traverse, point outside assets, escape through symlinks, or identify a directory',t=>{
  const f=fixture(t);
  for(const file of ['../x','/tmp/x','assets/photos/../music/m1.mp3','assets\\photos\\p1.jpg','other/p1.jpg']){
    assert.throws(()=>A.localAsset(f.root,{...f.photos[0],file},'photos'),/path/);
  }
  const outside=path.join(path.dirname(f.root),path.basename(f.root)+'-outside');fs.writeFileSync(outside,'outside');t.after(()=>fs.rmSync(outside,{force:true}));
  fs.symlinkSync(outside,path.join(f.root,'assets/photos/link.jpg'));
  assert.throws(()=>A.localAsset(f.root,{id:'link',file:'assets/photos/link.jpg',sha256:A.sha('outside')},'photos'),/escapes/);
  assert.throws(()=>A.localAsset(f.root,{id:'dir',file:'assets/photos',sha256:'a'.repeat(64)},'photos'),/path/);
});
test('catalog uniqueness, disabled assets and music credit requirements are enforced',t=>{
  const f=fixture(t);assert.throws(()=>f.create({photos:[f.photos[0],f.photos[0]]}),/duplicate/);
  f.photos[0].active=false;assert.throws(()=>f.create()(f.post(),13.2),/inactive/);delete f.photos[0].active;
  delete f.tracks[0].composer;assert.throws(()=>f.create()(f.post(),13.2),/composer/);
});
test('both catalog and actual audio must cover the selected offset plus full Reel',t=>{
  const f=fixture(t);
  assert.throws(()=>f.create()(f.post('x',{musicOffsetSeconds:30}),13.2),/shorter/);
  assert.throws(()=>f.create({audioProbe:()=>10})(f.post(),13.2),/shorter/);
  assert.throws(()=>f.create({audioProbe:()=>NaN})(f.post(),13.2),/measured/);
  assert.throws(()=>f.create({audioProbe:()=>36})(f.post(),13.2),/stale catalog/);
  f.tracks[0].durationSeconds=15;assert.throws(()=>f.create()(f.post(),13.2),/shorter/);
});
test('cache changes for every selected byte, file, ID, offset, crop, timing or renderer revision',t=>{
  const f=fixture(t),post=f.post(),resolved=f.create()(post,13.2),timing={INTRO:1.2,STEP:2.2,OUTRO:3.2};
  const key=A.cacheKey(post,resolved,'code-v1',timing);
  assert.equal(key,A.cacheKey({...post,caption:'New caption',status:'pending'},resolved,'code-v1',timing));
  assert.equal(key,A.cacheKey(post,{...resolved,cache:Object.fromEntries(Object.entries(resolved.cache).reverse())},'code-v1',timing));
  for(const field of Object.keys(resolved.cache)){
    const changed={...resolved,cache:{...resolved.cache,[field]:field==='musicOffsetSeconds'?3:'changed-'+resolved.cache[field]}};
    assert.notEqual(key,A.cacheKey(post,changed,'code-v1',timing),field);
  }
  assert.notEqual(key,A.cacheKey({...post,rows:[['other','pair']]},resolved,'code-v1',timing));
  assert.notEqual(key,A.cacheKey(post,resolved,'code-v2',timing));
  assert.notEqual(key,A.cacheKey(post,resolved,'code-v1',{...timing,STEP:2.3}));
});
test('chronological slots, unique IDs, unpublished classic scope and both-asset adjacency are enforced',t=>{
  const f=fixture(t),a=f.post(),b={...f.post('test-2',{photoId:'p2',musicId:'m2'}),scheduledAt:'2026-11-04T11:00:00.000Z'};
  A.validatePosts([a,b]);const resolve=f.create();A.verifyRotation([resolve(a,13.2),resolve(b,13.2)]);
  assert.throws(()=>A.validatePosts([b,a]),/chronological/);assert.throws(()=>A.validatePosts([a,a]),/duplicate/);
  for(const fields of [{status:'published'},{publishedMediaId:'123'},{feedDelivery:{status:'unknown'}},{visualStyle:'voice'},{format:'Carousel'}])assert.throws(()=>A.validatePosts([{...a,...fields}]),/unpublished/);
  for(const selection of [{photoId:'p1',musicId:'m2'},{photoId:'p2',musicId:'m1'}])assert.throws(()=>A.verifyRotation([resolve(a,13.2),resolve(f.post('x',selection),13.2)]),/Adjacent/);
  const ra=resolve(a,13.2),rb=resolve(b,13.2);rb.photo.sha256=ra.photo.sha256;assert.throws(()=>A.verifyRotation([ra,rb]),/Adjacent/);
});
test('render receipts require current video and cover bytes, not just the old key',t=>{
  const f=fixture(t),video=path.join(f.root,'v.mp4'),cover=path.join(f.root,'c.jpg');fs.writeFileSync(video,'video');fs.writeFileSync(cover,'cover');
  const receipt={key:'k',decoded:true,sha256:A.sha('video'),coverSha256:A.sha('cover')};assert.equal(A.renderMatches(receipt,'k',video,cover),true);
  assert.equal(A.renderMatches(receipt,'new-assets',video,cover),false);assert.equal(A.renderMatches({...receipt,decoded:false},'k',video,cover),false);
  fs.writeFileSync(cover,'revised cover');assert.equal(A.renderMatches(receipt,'k',video,cover),false);
});
test('jobs=2 handles each unique item once and awaits in-flight work before propagating failure',async()=>{
  let running=0,max=0;const seen=[];
  await A.runPool([1,2,3,4],2,async item=>{running++;max=Math.max(max,running);seen.push(item);await new Promise(r=>setTimeout(r,5));running--;});
  assert.equal(max,2);assert.deepEqual(seen,[1,2,3,4]);
  let finished=false;const scheduled=[];
  await assert.rejects(A.runPool([1,2,3,4],2,async item=>{scheduled.push(item);if(item===1)throw new Error('stop');await new Promise(r=>setTimeout(r,5));finished=true;}),/stop/);
  assert.deepEqual(scheduled,[1,2]);assert.equal(finished,true);
  let finishSecond=false;
  await assert.rejects(A.runPool([1,2,3],2,async item=>{if(item===1){await new Promise(r=>setTimeout(r,2));throw new Error('late stop');}await new Promise(r=>setTimeout(r,10));finishSecond=true;}),/late stop/);
  assert.equal(finishSecond,true);await assert.rejects(A.runPool([1],3,async()=>{}),/jobs/);
});
test('CLI accepts preview/id/pack-only/jobs and rejects unknown flags or conflicting modes',()=>{
  assert.deepEqual(B.options(['--preview','--id=x','--jobs=2']),{preview:true,packOnly:false,jobs:2,only:'x'});
  assert.deepEqual(B.options(['--pack-only','--id','x','--jobs','1']),{preview:false,packOnly:true,jobs:1,only:'x'});
  for(const args of [['--jobs=3'],['--jobs'],['--id=../x'],['--unknown'],['--preview','--pack-only']])assert.throws(()=>B.options(args));
});
test('preview uses the resolved photo/crop and leaves real cover/video/render receipt untouched',async t=>{
  const f=fixture(t),post=f.post('__rotation-preview-test-'+process.pid),assets=f.create()(post,6.6),out=path.resolve(__dirname,'..');
  const files=B.outputPaths(post),preview=path.join(out,'qa',post.id+'-preview.jpg'),layout=path.join(out,'qa',post.id+'-layout.json'),composition=path.join(out,'compositions',post.id+'.html');
  for(const file of [files.video,files.cover,files.receipt]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'existing '+path.basename(file));}
  const before=[files.video,files.cover,files.receipt].map(file=>fs.readFileSync(file));
  t.after(()=>{for(const file of [files.video,files.cover,files.receipt,preview,layout,composition])fs.rmSync(file,{force:true});});
  // HTML uses ROOT-relative real files; no browser or FFmpeg is started in this test.
  const existing=path.join(out,'assets/photos/library-warm.jpg');
  assets.background=path.relative(path.resolve(out,'../..'),existing).split(path.sep).join('/');
  let markup='',closed=false;
  const measured={cardTop:650,cardBottom:1500,rowFont:52,footerCount:0,cellOverflow:false};
  const page={setContent:async html=>{markup=html;},evaluate:async fn=>String(fn).includes('const card =')?measured:undefined,screenshot:async opts=>fs.writeFileSync(opts.path,'preview bytes'),close:async()=>{closed=true;}};
  await B.render({newPage:async()=>page},post,assets,'test-key',true);
  assert.equal(closed,true);assert.match(markup,/background-position:72% center/);assert.doesNotMatch(markup,/<div class="foot">/);
  assert.equal(JSON.parse(fs.readFileSync(layout)).previewOnly,true);assert.equal(JSON.parse(fs.readFileSync(layout)).assets.musicId,'m1');
  assert.equal(JSON.parse(fs.readFileSync(layout)).previewSha256,A.sha(fs.readFileSync(preview)));
  assert.equal(fs.readFileSync(preview,'utf8'),'preview bytes');
  [files.video,files.cover,files.receipt].forEach((file,i)=>assert.deepEqual(fs.readFileSync(file),before[i]));
});
test('pack-only refuses stale assets before writing an index or Story',async t=>{
  const f=fixture(t),post=f.post('__rotation-pack-test-'+process.pid),assets=f.create()(post,6.6);
  await assert.rejects(B.pack([post],new Map([[post.id,{assets,key:'new-key'}]])),/missing or stale render receipt/);
});
test('partial pack also blocks a changed unselected slot before touching shared indexes',async t=>{
  const f=fixture(t),a=f.post('__rotation-partial-a-'+process.pid),b={...f.post('__rotation-partial-b-'+process.pid),scheduledAt:'2026-11-04T11:00:00.000Z'},assets=f.create()(a,6.6);
  const af=B.outputPaths(a);for(const [file,bytes] of [[af.video,'video'],[af.cover,'cover']]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
  fs.mkdirSync(path.dirname(af.receipt),{recursive:true});fs.writeFileSync(af.receipt,JSON.stringify({key:'current',decoded:true,sha256:A.sha('video'),coverSha256:A.sha('cover')}));
  t.after(()=>{for(const file of Object.values(af))fs.rmSync(file,{force:true});});
  const queueFile=path.resolve(__dirname,'../content/queue.json'),before=fs.existsSync(queueFile)?fs.readFileSync(queueFile):null;
  await assert.rejects(B.pack([a,b],new Map([[a.id,{assets,key:'current'}],[b.id,{assets,key:'changed-unselected'}]]),[a]),new RegExp(b.id+': missing or stale'));
  assert.deepEqual(fs.existsSync(queueFile)?fs.readFileSync(queueFile):null,before);
});
