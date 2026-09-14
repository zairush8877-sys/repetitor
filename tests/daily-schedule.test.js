const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const { readyForDay } = require('../daily-selection');

test('an unbuilt older approval does not block a ready post; future, pending and published items are excluded without mutation', () => {
  const posts = [
    {id:'legacy',status:'approved',date:'2026-09-07',videoUrl:'https://example.test/old.mp4'},
    {id:'next',status:'approved',date:'2026-09-15'},
    {id:'draft',status:'pending',date:'2026-09-14'},
    {id:'manual',status:'approved',date:'2026-09-14',publishedMediaId:'receipt'},
    {id:'today',status:'approved',date:'2026-09-14'},
  ];
  const before = JSON.stringify(posts), checked = [];
  const result = readyForDay(posts,'2026-09-14',p=>{checked.push(p.id);if(p.id==='legacy')throw new Error('prepared media missing');});
  assert.deepEqual(result.ready.map(p=>p.id),['today']);
  assert.deepEqual(checked,['legacy','today']);
  assert.deepEqual(result.blocked,[{id:'legacy',reason:'prepared media missing'}]);
  assert.deepEqual(result.deferred,['next']);
  assert.equal(JSON.stringify(posts),before);
});

test('date-less drafts and already confirmed posts never reach media validation', () => {
  const posts=[{id:'no-date',status:'approved'},{id:'already',status:'approved',date:'2026-09-14',publishedAt:'2026-09-14T12:00:00Z'}];
  const result=readyForDay(posts,'2026-09-14',()=>assert.fail('Must not validate ineligible posts'));
  assert.equal(result.ready.length,0);assert.deepEqual(result.deferred,['no-date']);
});

for (const timezone of ['Europe/Moscow','UTC','America/Los_Angeles']) {
  test(`two planned weeks contain 14 consecutive dates including weekends in ${timezone}`,()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mama-daily-test-'));
    try{
      fs.writeFileSync(path.join(dir,'rubrics.json'),JSON.stringify({rubrics:[{id:'language',name:'Language fixture',weight:1,format:'Карусель',structure:[]}]}));
      fs.writeFileSync(path.join(dir,'topics.json'),JSON.stringify({topics:{language:Array.from({length:30},(_,i)=>'Fixture '+i)}}));
      fs.writeFileSync(path.join(dir,'pinned.json'),JSON.stringify({pinned:[{rubric:'Language fixture',topic:'Sunday fixture',date:'2026-09-20',format:'Карусель',why:'test'}]}));
      const result=spawnSync(process.execPath,[path.resolve(__dirname,'../factory.js'),'2','2026-09-15'],{encoding:'utf8',env:{...process.env,TZ:timezone,MEDIA_CONTENT_DIR:dir}});
      assert.equal(result.status,0,result.stderr);
      const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json')));
      assert.equal(plan.length,14);assert.equal(new Set(plan.map(p=>p.date)).size,14);
      for(let i=0;i<14;i++)assert.equal(plan[i].date,new Date(Date.UTC(2026,8,15+i)).toISOString().slice(0,10));
      assert.equal(plan[0].day,'вт');assert.equal(plan[5].day,'вс');assert.equal(plan[5].topic,'Sunday fixture');
      assert.match(fs.readFileSync(path.join(dir,'plan.md'),'utf8'),/15\.09 \| вт/);
    }finally{
      const prefix=path.resolve(os.tmpdir())+path.sep+'mama-daily-test-';
      if(!path.resolve(dir).startsWith(prefix))throw new Error('Unexpected fixture directory');
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
}
