'use strict';
const SUFFIXES = ['01-nn-okno','02-tsya','03-udareniya','04-chto-zapyataya','05-po-priezde','06-ne-glagol','07-kommentariy-ege','08-deeprichastie','09-omonimy','10-odna-bukva','12-skuchayu','13-lyag','14-vetrenyy','15-kofe','16-oblegchit'];
function at(date,time) { return new Date(`${date}T${time}:00+03:00`); }
function day(offset) { return new Date(Date.parse('2026-11-04T00:00:00Z')+offset*86400000).toISOString().slice(0,10); }
function fixture() {
  const campaign={version:1,id:'anna-retouch-music-v3-20261031',status:'active',account:'mairova_a_a',accountId:'17841456632615750',timezone:'Europe/Moscow',targetTime:'09:00',schoolQuotaOverride:true,
    cadence:{startsOn:'2026-11-04',classicTimes:['10:00','14:00','19:00']},
    slots:SUFFIXES.map((suffix,i)=>{const scheduledAt=new Date(Date.parse('2026-10-31T06:00:00Z')+i*2*86400000).toISOString();return{postId:`anna-v3-20261031-${suffix}`,date:scheduledAt.slice(0,10),scheduledAt};}),
    additionalSlots:[{postId:'classic-01-historical',date:'2026-11-03',scheduledAt:'2026-11-03T06:00:00.000Z'},
      ...Array.from({length:21},(_,i)=>({postId:`classic-${String(i+2).padStart(2,'0')}`,date:day(Math.floor(i/3)),scheduledAt:at(day(Math.floor(i/3)),['10:00','14:00','19:00'][i%3]).toISOString()}))]};
  const posts=[...campaign.slots,...campaign.additionalSlots].map(s=>({id:s.postId,campaignId:campaign.id,date:s.date,scheduledAt:s.scheduledAt,status:'approved',format:'Reels',captionComplete:true,caption:`Synthetic unique approved caption ${s.postId}`,videoUrl:`https://example.invalid/content/reels/${s.postId}.mp4`,coverOffsetMs:11800}));
  const f={campaign,posts,primaryBefore:structuredClone(campaign.slots)};
  mark(f,campaign.slots[0].postId,'2026-10-31T06:00:02Z');mark(f,campaign.slots[1].postId,'2026-11-02T12:32:35Z');
  mark(f,'classic-01-historical','2026-11-03T15:35:08Z');
  return f;
}
function post(f,id) { return f.posts.find(p=>p.id===id); }
function mark(f,id,when) { const p=post(f,id);Object.assign(p,{status:'published',publishedMediaId:`receipt-${id}`,publishedAt:new Date(when).toISOString(),feedDelivery:{phase:'published',mediaId:`receipt-${id}`},storyRepost:{status:'published',items:[{status:'published',publishedMediaId:`story-${id}`}]}});return p; }
function media(f) { return f.posts.filter(p=>p.publishedMediaId).map(p=>({id:p.publishedMediaId,caption:p.caption,timestamp:p.publishedAt,permalink:`https://example.invalid/reel/${p.id}`})); }
module.exports={fixture,at,day,post,mark,media};
