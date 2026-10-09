import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const archive=resolve(process.argv[2]),repo=resolve(process.argv[3]),output=process.argv[4];
const {ReviewService}=await import(pathToFileURL(join(archive,'src/domain.js')));
const {createServer}=await import(pathToFileURL(join(archive,'src/server.js')));
const pieces=['script','video','cover','caption'];
const report={reviewed_sha:'7cf5c6343987f501f45f760984dbc2e126adb06e',passed:false,combinations:[],equivalent_order_pairs:0,error_checks:0,http:[]};
function fixture(required,Class=ReviewService){
  let ids=0,ms=Date.parse('2026-10-09T12:00:00.000Z');
  const service=new Class({id:()=>String(++ids),clock:()=>new Date(ms)});
  const campaign=service.createCampaign({requiredPieces:[...required]});
  const delivery=service.createDelivery({campaignId:campaign.id});
  const book=Object.fromEntries(pieces.map(p=>[p,[]])),approved=new Set();
  let granted=false;
  const f={service,campaign,delivery,required:[...required],book,
    now:()=>new Date(ms).toISOString(),
    setTime:s=>{ms=Date.parse(s)},
    step:fn=>{ms+=1000;return fn()},
    get:()=>service.getDelivery(delivery.id)
  };
  f.check=()=>{
    const d=f.get();
    const expected=[];
    for(const p of required){
      const v=book[p].at(-1);
      if(!v)expected.push({piece:p,reason:'required_piece_missing'});
      else if(!approved.has(v.id))expected.push({piece:p,reason:'required_version_unapproved',versionId:v.id});
    }
    assert.deepEqual(d.blockers,expected);
    assert.equal(d.canApprove,expected.length===0);
    assert.equal(d.status,granted&&expected.length===0?'approved':'production');
    assert.deepEqual(d.requiredPieces,required);
    for(const p of pieces){
      assert.equal(d.currentVersionIds[p],book[p].at(-1)?.id??null);
      assert.deepEqual(d.pieces[p].map(v=>v.number),book[p].map(v=>v.number));
      for(const v of d.pieces[p])assert.equal(v.approvedAt!==null,approved.has(v.id));
    }
    return d;
  };
  f.add=(p,tag='v1',duration=60)=>{
    const before=f.check();
    const v=f.step(()=>service.addVersion(delivery.id,p,{
      asset:{type:p==='video'?'file':'text',value:p+'-'+tag},
      ...(p==='video'?{durationSeconds:duration}:{})
    }));
    book[p].push(v);
    assert.equal(v.approvedAt,null);
    assert.equal(v.createdAt,f.now());
    const after=f.check();
    assert.deepEqual(after.history.slice(0,before.history.length),before.history);
    const expected=['version_submitted'];
    if(before.status==='approved'&&required.includes(p))expected.push('delivery_approval_invalidated');
    assert.deepEqual(after.history.slice(before.history.length).map(e=>e.type),expected);
    assert.ok(after.history.slice(before.history.length).every(e=>e.at===f.now()));
    return v;
  };
  f.approve=(p,v)=>{
    const before=f.check();
    const version=f.step(()=>service.approveVersion(delivery.id,p,v.id));
    approved.add(v.id);
    assert.equal(version.approvedAt,f.now());
    const after=f.check(),expected=['version_approved'];
    if(before.status==='production'&&after.status==='approved')expected.push('delivery_approval_restored');
    assert.deepEqual(after.history.slice(0,before.history.length),before.history);
    assert.deepEqual(after.history.slice(before.history.length).map(e=>e.type),expected);
    assert.ok(after.history.slice(before.history.length).every(e=>e.at===f.now()));
    return version;
  };
  f.grant=()=>{
    const before=f.check();
    f.setTime('2026-10-09T13:00:00.000Z');
    const d=f.step(()=>service.approveDelivery(delivery.id));
    granted=true;
    f.check();
    assert.equal(d.approvedAt,f.now());
    assert.deepEqual(d.history.slice(before.history.length).map(e=>e.type),['delivery_approved']);
    return d;
  };
  f.reject=(fn,code,status=400)=>{
    const before=f.get();
    assert.throws(()=>f.step(fn),e=>e.code===code&&e.status===status);
    assert.deepEqual(f.get(),before);
    report.error_checks++;
  };
  return f;
}
const semantic=d=>({
  requiredPieces:d.requiredPieces,status:d.status,canApprove:d.canApprove,
  blockers:d.blockers,approvedAt:d.approvedAt,lastApprovedAt:d.lastApprovedAt,
  pieces:Object.fromEntries(pieces.map(p=>[p,d.pieces[p].map(v=>({
    number:v.number,asset:v.asset,durationSeconds:v.durationSeconds,approved:v.approvedAt!==null,comments:v.comments
  }))]))
});

// Contraprova: executa o domínio publicado em memória, sem tocar no fonte.
const previousSource=execFileSync('git',['show','b8f0fdc123556fe4c94d0c6791e8394d0ff96154:src/domain.js'],{cwd:repo,encoding:'utf8'});
const {ReviewService:Old}=await import('data:text/javascript;base64,'+Buffer.from(previousSource).toString('base64'));
function oldDecision(before){
  let serial=0;
  const s=new Old({id:()=>String(++serial),clock:()=>new Date('2026-10-09T12:00:00Z')});
  const c=s.createCampaign({requiredPieces:['video']});
  const d=s.createDelivery({campaignId:c.id});
  const optional=()=>s.addVersion(d.id,'script',{asset:{type:'text',value:'script-v1'}});
  if(before)optional();
  const video=s.addVersion(d.id,'video',{asset:{type:'file',value:'video-v1'},durationSeconds:60});
  s.approveVersion(d.id,'video',video.id);s.approveDelivery(d.id);
  if(!before)optional();
  const state=s.getDelivery(d.id);
  return {status:state.status,canApprove:state.canApprove,blockers:state.blockers.map(x=>({piece:x.piece,reason:x.reason}))};
}
report.old_negative_control={before:oldDecision(true),after:oldDecision(false)};
assert.equal(report.old_negative_control.before.status,'approved');
assert.equal(report.old_negative_control.after.status,'production');
assert.deepEqual(report.old_negative_control.after.blockers,[{piece:'script',reason:'replacement_unapproved'}]);

for(let mask=1;mask<16;mask++){
  const selected=pieces.filter((_,i)=>mask&(1<<i));
  const required=mask%2?[...selected].reverse():selected;
  const optional=pieces.filter(p=>!required.includes(p));
  const pair=[];
  for(const before of [true,false]){
    const f=fixture(required),initialVersions={};
    f.reject(()=>f.service.approveDelivery(f.delivery.id),'approval_blocked',409);
    if(before)for(const p of optional)f.add(p);
    for(const p of required)initialVersions[p]=f.add(p);
    for(const p of [...required].reverse())f.approve(p,initialVersions[p]);
    assert.equal(f.check().status,'production');
    assert.equal(f.check().canApprove,true);
    const granted=f.grant();
    if(!before)for(const p of optional)f.add(p);
    for(const p of optional)f.add(p,'v2');
    const optionalState=f.check();
    assert.equal(optionalState.status,'approved');
    assert.equal(optionalState.approvedAt,granted.approvedAt);
    assert.equal(optionalState.lastApprovedAt,granted.lastApprovedAt);
    assert.equal(optionalState.history.filter(e=>e.type==='delivery_approval_invalidated').length,0);
    assert.equal(optionalState.history.filter(e=>e.type==='delivery_approval_restored').length,0);
    pair.push(semantic(optionalState));
    for(const p of optional){
      f.approve(p,f.book[p].at(-1));
      assert.equal(f.get().approvedAt,granted.approvedAt);
      assert.equal(f.get().history.filter(e=>e.type==='delivery_approval_restored').length,0);
    }

    const intermediate={};
    for(const p of required)intermediate[p]=f.add(p,'v2');
    const first=required[0];
    f.add(first,'v3');
    const suspended=f.check();
    assert.equal(suspended.status,'production');
    assert.equal(suspended.approvedAt,null);
    assert.equal(suspended.lastApprovedAt,granted.approvedAt);
    const blockedBefore=suspended.blockers;
    for(const p of optional){
      const v=f.add(p,'v3');
      assert.deepEqual(f.check().blockers,blockedBefore);
      f.approve(p,v);
      assert.deepEqual(f.check().blockers,blockedBefore);
      assert.equal(f.get().lastApprovedAt,granted.approvedAt);
    }
    f.reject(()=>f.service.approveVersion(f.delivery.id,first,intermediate[first].id),'stale_version',409);
    f.reject(()=>f.service.approveVersion(f.delivery.id,first,initialVersions[first].id),'stale_version',409);
    f.reject(()=>f.service.approveDelivery(f.delivery.id),'approval_blocked',409);
    for(const p of [...required].reverse())f.approve(p,f.book[p].at(-1));
    const restored=f.check();
    assert.equal(restored.status,'approved');
    assert.equal(restored.approvedAt,f.now());
    assert.equal(restored.history.filter(e=>e.type==='delivery_approval_invalidated').length,1);
    assert.equal(restored.history.filter(e=>e.type==='delivery_approval_restored').length,1);
    const invalidation=restored.history.find(e=>e.type==='delivery_approval_invalidated');
    assert.equal(invalidation.at,intermediate[first].createdAt);
    assert.deepEqual(restored.history.slice(-2).map(e=>e.type),['version_approved','delivery_approval_restored']);
    const unchanged=f.get();
    f.step(()=>f.service.approveDelivery(f.delivery.id));
    f.step(()=>f.service.approveVersion(f.delivery.id,first,f.book[first].at(-1).id));
    assert.deepEqual(f.get(),unchanged);
    report.combinations.push({mask,requiredPieces:required,optionalBefore:before,all_phases_passed:true,approvedAt:granted.approvedAt,restoredAt:restored.approvedAt,invalidations:1,restorations:1});
  }
  assert.deepEqual(pair[0],pair[1]);
  report.equivalent_order_pairs++;
}

// Vídeo opcional, duração por versão, cópias defensivas e isolamento real.
const f=fixture(['script']);
const script=f.add('script');f.approve('script',script);const granted=f.grant();
const oldVideo=f.add('video','long',80);
const firstComment=f.step(()=>f.service.addComment(f.delivery.id,'video',oldVideo.id,{second:79.5,body:'Âncora antiga'}));
const currentVideo=f.add('video','short',12);
f.reject(()=>f.service.approveVersion(f.delivery.id,'video',oldVideo.id),'stale_version',409);
f.reject(()=>f.service.addComment(f.delivery.id,'video',currentVideo.id,{second:79.5,body:'Fora da atual'}),'invalid_second');
for(const second of [0,12])f.step(()=>f.service.addComment(f.delivery.id,'video',currentVideo.id,{second,body:'Borda atual'}));
const oldLate=f.step(()=>f.service.addComment(f.delivery.id,'video',oldVideo.id,{second:80,body:'Borda antiga'}));
assert.deepEqual(f.service.getVersion(f.delivery.id,'video',oldVideo.id).comments,[firstComment,oldLate]);
assert.equal(f.service.getVersion(f.delivery.id,'video',currentVideo.id).comments.length,2);
assert.equal(f.get().status,'approved');
assert.equal(f.get().approvedAt,granted.approvedAt);
const firstSnapshot=f.get();
const campaign2=f.service.createCampaign({requiredPieces:['cover']});
const d2=f.service.createDelivery({campaignId:campaign2.id});
const v2=f.service.addVersion(d2.id,'cover',{asset:{type:'file',value:'second-cover'}});
f.service.approveVersion(d2.id,'cover',v2.id);f.service.approveDelivery(d2.id);
const secondSnapshot=f.service.getDelivery(d2.id);
for(const command of [
  ()=>f.service.approveVersion(d2.id,'video',oldVideo.id),
  ()=>f.service.addComment(d2.id,'video',oldVideo.id,{second:1,body:'Outra entrega'})
]){
  assert.throws(command,e=>e.code==='version_not_found'&&e.status===404);
  assert.deepEqual(f.get(),firstSnapshot);
  assert.deepEqual(f.service.getDelivery(d2.id),secondSnapshot);
  report.error_checks++;
}
const external=f.get();external.requiredPieces.push('video');external.pieces.video[0].comments.length=0;external.history.length=0;
assert.deepEqual(f.get(),firstSnapshot);
f.reject(()=>f.service.addVersion(f.delivery.id,'video',{asset:{type:'file',value:'invalid'},durationSeconds:0}),'invalid_duration');
report.comments_isolation={optional_video_did_not_block:true,old_comments:2,new_comments:2,version_duration_bounds_preserved:true,cross_delivery_rejections_unchanged:true,returned_copies_cannot_mutate_state:true};

// Transporte real: contraprova antes/depois e suspensão por obrigatória.
let httpClock=Date.parse('2026-10-09T14:00:00Z'),hid=0;
const httpService=new ReviewService({id:()=>String(++hid),clock:()=>new Date(httpClock)});
const server=createServer(httpService);server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,tracked=[];
async function call(name,path,body,status,method=body===undefined?'GET':'POST',code){
  httpClock+=1000;
  const before=tracked.map(id=>httpService.getDelivery(id));
  const res=await fetch(base+path,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const data=await res.json();assert.equal(res.status,status,name);
  if(code)assert.equal(data.error.code,code,name);
  if(status>=400)assert.deepEqual(tracked.map(id=>httpService.getDelivery(id)),before);
  report.http.push({name,path,body,status:res.status,data});
  return data;
}
try{
  const c=await call('campaign','/campaigns',{requiredPieces:['video']},201);
  const statePair=[],deliveryIds=[],videoIds=[];
  for(const before of [true,false]){
    const d=await call('delivery '+before,'/deliveries',{campaignId:c.id},201);tracked.push(d.id);deliveryIds.push(d.id);
    const path='/deliveries/'+d.id;
    const optional=()=>call('optional '+before,path+'/pieces/script/versions',{asset:{type:'text',value:'script-v1'}},201);
    if(before)await optional();
    const video=await call('video '+before,path+'/pieces/video/versions',{asset:{type:'file',value:'video-v1'},durationSeconds:60},201);videoIds.push(video.id);
    await call('approve video '+before,path+'/pieces/video/versions/'+video.id+'/approve',undefined,200,'POST');
    await call('approve delivery '+before,path+'/approve',undefined,200,'POST');
    if(!before)await optional();
    const state=await call('state '+before,path,undefined,200);
    assert.equal(state.status,'approved');assert.deepEqual(state.blockers,[]);
    assert.equal(state.history.filter(e=>e.type==='delivery_approval_invalidated').length,0);
    statePair.push({...semantic(state),approvedAt:undefined,lastApprovedAt:undefined});
  }
  assert.deepEqual(statePair[0],statePair[1]);
  const path='/deliveries/'+deliveryIds[1],originalTime=httpService.getDelivery(deliveryIds[1]).approvedAt;
  await call('replace optional',path+'/pieces/script/versions',{asset:{type:'text',value:'script-v2'}},201);
  assert.equal(httpService.getDelivery(deliveryIds[1]).approvedAt,originalTime);
  const replacement=await call('replace required',path+'/pieces/video/versions',{asset:{type:'file',value:'video-v2'},durationSeconds:20},201);
  const optional3=await call('optional while suspended',path+'/pieces/script/versions',{asset:{type:'text',value:'script-v3'}},201);
  await call('approve optional while suspended',path+'/pieces/script/versions/'+optional3.id+'/approve',undefined,200,'POST');
  assert.equal(httpService.getDelivery(deliveryIds[1]).status,'production');
  await call('blocked required',path+'/approve',undefined,409,'POST','approval_blocked');
  const current=await call('new required during suspension',path+'/pieces/video/versions',{asset:{type:'file',value:'video-v3'},durationSeconds:10},201);
  await call('stale required',path+'/pieces/video/versions/'+replacement.id+'/approve',undefined,409,'POST','stale_version');
  await call('comment old',path+'/pieces/video/versions/'+videoIds[1]+'/comments',{second:45,body:'Fica na v1'},201);
  await call('comment out of new duration',path+'/pieces/video/versions/'+current.id+'/comments',{second:45,body:'Inválido na v3'},400,'POST','invalid_second');
  await call('cross delivery version',path+'/pieces/video/versions/'+videoIds[0]+'/approve',undefined,404,'POST','version_not_found');
  await call('restore required',path+'/pieces/video/versions/'+current.id+'/approve',undefined,200,'POST');
  const restored=await call('restored state',path,undefined,200);
  assert.equal(restored.status,'approved');assert.deepEqual(restored.blockers,[]);
  assert.equal(restored.history.filter(e=>e.type==='delivery_approval_invalidated').length,1);
  assert.equal(restored.history.filter(e=>e.type==='delivery_approval_restored').length,1);
  assert.equal(restored.pieces.video[0].comments.length,1);
  assert.deepEqual(restored.pieces.video.at(-1).comments,[]);
  const idempotent=await call('idempotent approval',path+'/approve',undefined,200,'POST');
  assert.deepEqual(idempotent,restored);
  assert.equal(httpService.getDelivery(deliveryIds[0]).status,'approved');
  report.http_summary={requests:report.http.length,equivalent_order_pair:true,rejections_unchanged:true,optional_before_after_and_suspension:true,required_invalidation_restoration:true,comments_anchored:true};
}finally{
  const closed=once(server,'close');server.close();server.closeAllConnections();await closed;
}
report.passed=true;
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,combinations:undefined,http:undefined,combination_runs:report.combinations.length},null,2));
