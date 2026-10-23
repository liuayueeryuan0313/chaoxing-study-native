import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Controller} from '../src/controller.mjs';
import {problem} from '../src/catalog.mjs';

function until(c,predicate){if(predicate())return Promise.resolve();return new Promise((resolve,reject)=>{const clean=()=>{clearTimeout(timer);c.off('snapshot',check);};const check=()=>{if(predicate()){clean();resolve();}};const timer=setTimeout(()=>{clean();reject(new Error('state timeout: '+c.phase));},1500);c.on('snapshot',check);check();});}
function make(t){const c=new Controller('unused');c.save=async()=>{};c.verified=true;c.courses=[{key:'a',title:'A',scanState:'unscanned',chapters:[]},{key:'b',title:'B',scanState:'unscanned',chapters:[]}];const visits=[],played=[],submitted=[];let catalogs=0;
 c.catalog.course=async()=>{catalogs++;return ['1','2','3'].map(id=>({id,title:id,scanState:'unscanned',tasks:[]}));};
 c.catalog.chapter=async(_,ch)=>{visits.push(ch.id);return [{key:'t'+ch.id,jobId:'j'+ch.id,type:'document',title:ch.id,isPassed:ch.id==='1',cardUrl:'https://mooc1.chaoxing.com/cards',status:ch.id==='1'?'completed':'pending',needsRefresh:false}];};
 c.catalog.refresh=async task=>({attachment:{isPassed:task.isPassed}});
 c.protocol.document=async task=>{played.push(task.key);task.isPassed=true;task.status='completed';};
 c.challengeHandler={submit:async(code,signal)=>{submitted.push(code);signal.throwIfAborted();if(code!=='Good')throw problem('VERIFY_SITE','验证码未通过');c.catalog.challenge=null;}};
 t.after(()=>c.close());return {c,visits,played,submitted,get catalogs(){return catalogs;}};
}
function blockAt(x,id){const original=x.c.catalog.chapter.bind(x.c.catalog);let triggered=false;x.c.catalog.chapter=async(co,ch,signal)=>{if(ch.id===id&&!triggered){triggered=true;x.visits.push(ch.id);x.c.catalog.challenge={requestUrl:'https://mooc1.chaoxing.com/cards'};throw problem('VERIFY_SITE','请输入验证码');}return original(co,ch,signal);};}

test('manual scan waits without further requests, then continues only the interrupted chapter',async t=>{
 const x=make(t);blockAt(x,'2');x.c.scan(['a']);await until(x.c,()=>x.c.phase==='awaiting_verification');const job=x.c.job;
 assert.equal(x.c.busy,true);assert.deepEqual(x.visits,['1','2']);assert.equal(x.c.scanProgress.completedChapters,1);
 assert.equal(x.c.verify('Good').accepted,true);assert.equal(x.c.job,job);await job;
 assert.deepEqual(x.visits,['1','2','2','3']);assert.equal(x.catalogs,1);assert.equal(x.c.scanProgress.completedChapters,3);assert.equal(x.c.phase,'ready');assert.equal(x.c.busy,false);assert.deepEqual(x.played,[]);
});

test('wrong human code stays waiting, accepts a new human attempt, and never retries automatically',async t=>{
 const x=make(t);blockAt(x,'2');x.c.scan(['a']);await until(x.c,()=>x.c.phase==='awaiting_verification');
 assert.throws(()=>x.c.verify('bad'),{code:'VERIFY_SITE'});assert.deepEqual(x.submitted,[]);
 x.c.verify('Bad1');await x.c.verificationJob;assert.equal(x.c.phase,'awaiting_verification');assert.equal(x.c.busy,true);assert.equal(x.c.snapshot().verification.submitting,false);assert.deepEqual(x.submitted,['Bad1']);assert.deepEqual(x.visits,['1','2']);
 x.c.verify('Good');await x.c.job;assert.deepEqual(x.submitted,['Bad1','Good']);assert.equal(x.c.phase,'ready');
});

test('stop while a submitted code is in flight cancels continuation, even if the response arrives late',async t=>{
 const x=make(t);blockAt(x,'2');const gate=Promise.withResolvers();x.c.challengeHandler.submit=async()=>{await gate.promise;x.c.catalog.challenge=null;};
 x.c.run(['a'],1.5,undefined,1,'document');await until(x.c,()=>x.c.phase==='awaiting_verification');x.c.verify('Good');
 assert.throws(()=>x.c.verify('Good'),{code:'BUSY'});x.c.stop();await x.c.job;assert.equal(x.c.phase,'stopped');assert.equal(x.c.snapshot().verification.waiting,false);
 gate.resolve();await x.c.verificationJob;assert.equal(x.c.phase,'stopped');assert.deepEqual(x.played,[]);assert.deepEqual(x.visits,['1','2']);
});

test('a single start scans only selected courses then preserves mode limit and completed-task skipping',async t=>{
 const x=make(t);assert.equal(x.c.run(['a'],1.5,undefined,1,'document').accepted,true);await x.c.job;
 assert.equal(x.catalogs,1);assert.deepEqual(x.visits,['1','2','3']);assert.deepEqual(x.played,['t2']);assert.equal(x.c.studyMode,'document');assert.equal(x.c.courses[1].scanState,'unscanned');assert.equal(x.c.phase,'ready');
 x.c.run(['a'],1.5,undefined,1,'document');await x.c.job;assert.equal(x.catalogs,1,'ready catalog need not be scanned again');assert.deepEqual(x.played,['t2','t3']);
});

test('a single start survives two scan challenges and automatically enters learning afterward',async t=>{
 const x=make(t),base=x.c.catalog.chapter.bind(x.c.catalog),blocked=new Set();x.c.catalog.chapter=async(co,ch,s)=>{if(['2','3'].includes(ch.id)&&!blocked.has(ch.id)){blocked.add(ch.id);x.visits.push(ch.id);x.c.catalog.challenge={};throw problem('VERIFY_SITE','本人验证');}return base(co,ch,s);};
 x.c.run(['a'],2,undefined,1,'document');const job=x.c.job;
 await until(x.c,()=>x.c.phase==='awaiting_verification');x.c.verify('Good');await x.c.verificationJob;
 await until(x.c,()=>x.c.phase==='awaiting_verification'&&x.c.active?.chapter==='3');x.c.verify('Good');await job;
 assert.deepEqual(x.visits,['1','2','2','3','3']);assert.equal(x.catalogs,1);assert.deepEqual(x.played,['t2']);assert.equal(x.c.phase,'ready');
});

test('a learning-stage challenge retries the current task without repeating prior completed tasks',async t=>{
 const x=make(t);let blocked=false;const refresh=x.c.catalog.refresh;x.c.catalog.refresh=async task=>{if(task.key==='t3'&&!blocked){blocked=true;x.c.catalog.challenge={};throw problem('VERIFY_SITE','本人验证');}return refresh(task);};
 x.c.run(['a']);await until(x.c,()=>x.c.phase==='awaiting_verification');assert.deepEqual(x.played,['t2']);assert.equal(x.c.snapshot().verification.resumePhase,'running');
 x.c.verify('Good');await x.c.job;assert.deepEqual(x.played,['t2','t3']);assert.equal(x.c.phase,'ready');
});

test('waiting for verification in one user does not stop or resume the other user',async t=>{
 const a=make(t),b=make(t);blockAt(a,'2');a.c.run(['a']);await until(a.c,()=>a.c.phase==='awaiting_verification');
 b.c.run(['a']);await b.c.job;assert.equal(b.c.phase,'ready');assert.deepEqual(b.played,['t2','t3']);assert.equal(a.c.phase,'awaiting_verification');
 a.c.verify('Good');await a.c.job;assert.deepEqual(a.played,['t2','t3']);assert.deepEqual(b.played,['t2','t3']);assert.equal(b.submitted.length,0);
});

test('start is available for selected unscanned or stale courses but remains disabled while busy',async()=>{
 const source=await fs.readFile(new URL('../webui/native-client.js',import.meta.url),'utf8'),window={};vm.runInNewContext(source,{window});
 for(const scanState of ['unscanned','stale']){const n={courses:[{key:'a',scanState,chapters:[]}],selected:['a'],verifiedSession:true,phase:'ready',busy:false};assert.equal(window.cxNative.snapshot(n).controls.canStart,true);assert.equal(window.cxNative.snapshot({...n,busy:true}).controls.canStart,false);}
});
