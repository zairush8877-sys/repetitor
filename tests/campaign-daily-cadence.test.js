'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../campaign-feed');
const {deliver}=require('../feed-state');
const {fixture,at,post,mark,media}=require('./cadence-fixture.cjs');
const DAY='2026-11-04';
function voice(f) {return f.campaign.slots[2].postId;}
function finishVoice(f) {return mark(f,voice(f),at(DAY,'09:02'));}

test('37 explicit slots retain fifteen original voice dates and one confirmed historical classic',()=>{
  const f=fixture(),before=JSON.stringify(f);
  assert.equal(c.validate(f.campaign,f.posts),f.campaign);assert.equal(c.allSlots(f.campaign).length,37);
  assert.equal(f.campaign.slots.length,15);assert.equal(f.campaign.additionalSlots.length,22);
  assert.equal(JSON.stringify(f),before);assert.deepEqual(f.campaign.slots,f.primaryBefore);
  assert.equal(post(f,'classic-01-historical').publishedAt,'2026-11-03T15:35:08.000Z');
});

test('3 November at 23:30 cannot release a future slot or repeat historical classic01',()=>{
  const f=fixture(),now=at('2026-11-03','23:30');
  assert.equal(c.select(f.campaign,f.posts,now).post,null);
  assert.equal(c.select(f.campaign,f.posts,now,'classic-01-historical').post,null);
  assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'10:00'),'classic-01-historical'),/outside today's/);
  assert.equal(c.reconcile(f.campaign,f.posts,media(f),now).length,3,'read-only audit remains available at night');
});

test('voice day releases exactly voice09 plus classic10/14/19, one per execution',()=>{
  const f=fixture(),order=[];
  for(const [time,id]of[['09:00',voice(f)],['10:00','classic-02'],['14:00','classic-03'],['19:00','classic-04']]){
    const selected=c.select(f.campaign,f.posts,at(DAY,time));
    assert.equal(selected.post.id,id);assert.ok(!Array.isArray(selected.post));order.push(id);
    c.reconcile(f.campaign,f.posts,media(f),at(DAY,time),selected.post);
    mark(f,id,at(DAY,time));
    assert.equal(c.select(f.campaign,f.posts,new Date(at(DAY,time).getTime()+23*60000)).post,null);
  }
  assert.equal(order.length,4);assert.equal(c.select(f.campaign,f.posts,at(DAY,'21:00')).post,null);
  assert.deepEqual(f.campaign.slots,f.primaryBefore);
});

test('non-voice day releases three classics and never invents a fourth or a voice slot',()=>{
  const f=fixture();
  assert.equal(c.select(f.campaign,f.posts,at('2026-11-05','09:00')).post,null);
  for(const[time,id]of[['10:00','classic-05'],['14:00','classic-06'],['19:00','classic-07']]){
    assert.equal(c.select(f.campaign,f.posts,at('2026-11-05',time)).post.id,id);mark(f,id,at('2026-11-05',time));
  }
  assert.equal(c.select(f.campaign,f.posts,at('2026-11-05','21:59')).post,null);
});

test('late execution selects only the earliest due post; explicit later ID cannot skip it',()=>{
  const f=fixture();
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'19:23')).post.id,voice(f));
  assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'19:23'),'classic-04'),/earliest pending due/);
  finishVoice(f);assert.equal(c.select(f.campaign,f.posts,at(DAY,'19:23')).post.id,'classic-02');
});

test('each slot threshold is inclusive and the 08–22 window cannot be bypassed by explicit ID',()=>{
  const f=fixture();
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'08:59')).post,null);
  finishVoice(f);assert.equal(c.select(f.campaign,f.posts,new Date('2026-11-04T06:59:59Z')).post,null);
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'10:00')).post.id,'classic-02');
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'22:00'),'classic-02').post,null);
  assert.throws(()=>c.reconcile(f.campaign,f.posts,media(f),at(DAY,'22:00'),post(f,'classic-02')),/no longer eligible/);
});

test('a missed prior day never catches up, while the following original voice slot remains intact',()=>{
  const f=fixture();
  assert.equal(c.select(f.campaign,f.posts,at('2026-11-05','10:00')).post.id,'classic-05');
  assert.throws(()=>c.select(f.campaign,f.posts,at('2026-11-05','10:00'),'classic-02'),/outside today's/);
  assert.equal(c.select(f.campaign,f.posts,at('2026-11-06','09:00')).post.id,f.campaign.slots[3].postId);
});

test('empty future classic bank leaves old voice dates running and legacy approvals paused',()=>{
  const f=fixture();
  f.campaign.additionalSlots=f.campaign.additionalSlots.slice(0,7);
  const ids=new Set(c.allSlots(f.campaign).map(s=>s.postId));f.posts=f.posts.filter(p=>ids.has(p.id));
  f.posts.push({id:'legacy-approved',status:'approved',date:'2026-09-01',caption:'Never automatically consume this'});
  assert.equal(c.select(f.campaign,f.posts,at('2026-11-06','09:00')).post.id,f.campaign.slots[3].postId);
  assert.equal(c.select(f.campaign,f.posts,at('2026-11-07','19:00')).post,null);
  assert.throws(()=>c.select(f.campaign,f.posts,at('2026-11-07','19:00'),'legacy-approved'),/outside the explicit slots/);
});

test('IDs and exact instants stay unique while primary and three classics can share a date',()=>{
  let f=fixture();assert.doesNotThrow(()=>c.validate(f.campaign,f.posts));
  f.campaign.additionalSlots.push({...f.campaign.additionalSlots[1]});assert.throws(()=>c.validate(f.campaign,f.posts),/duplicate/i);
  f=fixture();const s=f.campaign.additionalSlots[2],p=post(f,s.postId);s.scheduledAt=p.scheduledAt=f.campaign.additionalSlots[1].scheduledAt;
  assert.throws(()=>c.validate(f.campaign,f.posts),/duplicate/i);
  f=fixture();const base=f.campaign.additionalSlots[1];f.campaign.additionalSlots.push({...base,postId:'classic-fourth'});f.posts.push({...post(f,base.postId),id:'classic-fourth',caption:'Unique fourth'});
  assert.throws(()=>c.validate(f.campaign,f.posts),/duplicate|limit/i);
});

test('cadence opt-in cannot alter voice09, authorised classic times, start day or two-day primary interval',()=>{
  const changes=[
    f=>{f.campaign.cadence.startsOn='2026-11-03';},
    f=>{f.campaign.cadence.classicTimes=['10:00','14:00','20:00'];},
    f=>{f.campaign.cadence.limit=4;},
    f=>{f.campaign.targetTime='10:00';},
    f=>{const s=f.campaign.slots[3],p=post(f,s.postId);s.date=p.date='2026-11-07';s.scheduledAt=p.scheduledAt=at(s.date,'09:00').toISOString();},
    f=>{const s=f.campaign.additionalSlots[1],p=post(f,s.postId);s.scheduledAt=p.scheduledAt=at(s.date,'11:00').toISOString();},
    f=>{const s=f.campaign.additionalSlots[1],p=post(f,s.postId);s.scheduledAt=p.scheduledAt='2026-11-04T07:00:01.000Z';},
  ];
  for(const change of changes){const f=fixture();change(f);assert.throws(()=>c.validate(f.campaign,f.posts));}
});

test('pre-start classic requires its confirmed receipt; no new historical approval is allowed',()=>{
  for(const change of[p=>{p.status='approved';},p=>{delete p.publishedMediaId;},p=>{p.publishedAt='2026-11-04T06:00:00Z';}]){
    const f=fixture();change(post(f,'classic-01-historical'));assert.throws(()=>c.validate(f.campaign,f.posts),/historical receipt/);
  }
});

test('a pending or unknown earliest slot cannot be bypassed by another classic',()=>{
  for(const change of[p=>{p.status='pending';},p=>{p.feedDelivery={phase:'unknown'};},p=>{p.feedDelivery={phase:'publishing'};},p=>{p.feedDelivery={phase:'needs_review'};}]){
    const f=fixture();finishVoice(f);change(post(f,'classic-02'));
    assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'14:00')),/approved|reconciliation/);
    assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'14:00'),'classic-03'),/earliest pending due/);
  }
});

test('partial same-day receipt stops the next post; confirmed receipt wins over stale delivery phase',()=>{
  let f=fixture();finishVoice(f);const p=post(f,'classic-02');p.publishedMediaId='partial';
  assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'14:00')),/partial.*receipt/);
  f=fixture();finishVoice(f);mark(f,'classic-02',at(DAY,'10:01'));post(f,'classic-02').feedDelivery.phase='unknown';
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'14:00')).post.id,'classic-03');
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'14:00'),'classic-02').post,null);
});

test('known voice and classic receipts allow the next authorised classic despite two posts today',()=>{
  const f=fixture();finishVoice(f);mark(f,'classic-02',at(DAY,'10:02'));
  const selected=c.select(f.campaign,f.posts,at(DAY,'14:00')).post;assert.equal(selected.id,'classic-03');
  assert.equal(c.reconcile(f.campaign,f.posts,media(f),at(DAY,'14:00'),selected).filter(x=>x.timestamp.startsWith(DAY)).length,2);
});

test('foreign/manual same-day posts stop queue selection or live reconciliation',()=>{
  let f=fixture();finishVoice(f);f.posts.push({id:'manual',status:'published',publishedMediaId:'manual-id',publishedAt:at(DAY,'09:30').toISOString()});
  assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'10:00')),/Unrecognised/);
  f=fixture();finishVoice(f);const target=post(f,'classic-02');
  assert.throws(()=>c.reconcile(f.campaign,f.posts,[...media(f),{id:'manual-id',caption:'Unrecognised manual post',timestamp:at(DAY,'09:30').toISOString()}],at(DAY,'10:00'),target),/Unrecognised/);
});

test('live duplicate caption, absent history, and missing saved same-day IDs fail closed',()=>{
  const f=fixture();finishVoice(f);const target=post(f,'classic-02'),now=at(DAY,'10:00');
  assert.throws(()=>c.reconcile(f.campaign,f.posts,null,now,target),/history unavailable/);
  assert.throws(()=>c.reconcile(f.campaign,f.posts,[],now,target),/omits a saved/);
  assert.throws(()=>c.reconcile(f.campaign,f.posts,[...media(f),{id:'unexpected',caption:target.caption,timestamp:now.toISOString()}],now,target),/already exists/);
});

test('duplicated live rows cannot inflate lane counts and receipts from wrong dates are not ignored',()=>{
  const f=fixture();finishVoice(f);const history=media(f);history.push(history.find(m=>m.timestamp.startsWith(DAY)));
  assert.doesNotThrow(()=>c.reconcile(f.campaign,f.posts,history,at(DAY,'10:00'),post(f,'classic-02')));
  history.push({...media(f)[0],timestamp:at(DAY,'09:30').toISOString()});
  assert.throws(()=>c.reconcile(f.campaign,f.posts,history,at(DAY,'10:00'),post(f,'classic-02')),/off-day/);
});

test('one failed publication is saved unknown; later execution performs no new create or publish',async()=>{
  const f=fixture();finishVoice(f);const p=c.select(f.campaign,f.posts,at(DAY,'10:00')).post,calls=[],saves=[];
  const options={userId:f.campaign.accountId,now:()=>at(DAY,'10:01'),waitReady:async()=> 'FINISHED',save:async()=>saves.push(p.feedDelivery.phase),api:async(method,endpoint)=>{
    calls.push(endpoint);if(endpoint.endsWith('/media_publish')){assert.equal(saves.at(-1),'publishing');throw new Error('Synthetic lost response');}return{id:'container'};
  }};
  await assert.rejects(deliver(p,options),e=>e.code==='FEED_OUTCOME_UNKNOWN');assert.equal(saves.at(-1),'unknown');
  assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'14:00')),/reconciliation/);
  await assert.rejects(deliver(p,options),e=>e.code==='FEED_OUTCOME_UNKNOWN');assert.equal(calls.length,2);
});

test('confirmed feed with incomplete same-day Stories pauses next slot and never resends feed',()=>{
  for(const state of [undefined,'pending','unknown','partial','failed','needs_review']){
    const f=fixture();finishVoice(f);const p=mark(f,'classic-02',at(DAY,'10:01'));
    if(state===undefined)delete p.storyRepost;else p.storyRepost={status:state,items:[{status:'failed'}]};
    assert.equal(c.select(f.campaign,f.posts,at(DAY,'14:00'),'classic-02').post,null);
    assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'14:00')),/full Stories repost needs reconciliation/);
    assert.equal(p.publishedMediaId,'receipt-classic-02');
    p.storyRepost={status:'published',items:[{status:'published',publishedMediaId:'confirmed-full-story'}]};
    assert.equal(c.select(f.campaign,f.posts,at(DAY,'14:00')).post.id,'classic-03');
  }
});

test('historical unknown Story outside today remains untouched and never catches up automatically',()=>{
  const f=fixture();const historical=post(f,'classic-01-historical');historical.storyRepost={status:'historical_unknown'};
  const before=JSON.stringify(historical);
  assert.equal(c.select(f.campaign,f.posts,at(DAY,'09:00')).post.id,voice(f));
  assert.equal(JSON.stringify(historical),before);
});

test('a published Story label without item receipts cannot unlock the next feed slot',()=>{
  for(const items of [[],[{status:'published'}]]){
    const f=fixture();finishVoice(f);const p=mark(f,'classic-02',at(DAY,'10:01'));p.storyRepost={status:'published',items};
    assert.throws(()=>c.select(f.campaign,f.posts,at(DAY,'14:00')),/full Stories repost needs reconciliation/);
  }
});
