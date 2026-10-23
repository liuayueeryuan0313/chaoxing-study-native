import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {reportUrl} from '../src/protocol.mjs';
import {Runner} from '../src/runner.mjs';
import {Controller} from '../src/controller.mjs';
import {problem} from '../src/catalog.mjs';

const url='https://mooc1.chaoxing.com/mooc-ans/knowledge/cards';
function context(attachment={},duration=2491){return {url,cardUrl:url,
  config:{defaults:{clazzId:'class',userid:'user',reportUrl:'https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/u',reportTimeInterval:60}},
  attachment:{jobid:'job',objectId:'object',property:{name:'现代人文艺术.mp4'},...attachment},media:{duration,dtoken:'test-token'}};}

test('observed 0..2491 full video passes range validation with the same full-video digest',()=>{
  const result=new URL(reportUrl({...context({begins:0,ends:2491,attDuration:2491}),seconds:0,event:'play',now:1}));
  assert.equal(result.searchParams.get('clipTime'),'0_2491');
  assert.equal(result.searchParams.get('duration'),'2491');
  const digest=crypto.createHash('md5').update('[class][user][job][object][0][d_yHJ!$pdA~5][2491000][0_2491]').digest('hex');
  assert.equal(result.searchParams.get('enc'),digest);
});

test('numeric strings, omitted values and zero end sentinels represent full videos',()=>{
  for(const a of [{},{begins:0,ends:0},{begins:'0',ends:'0'},{begins:'0',ends:'2491'},
    {begins:null,ends:null},{begins:'',ends:''},{ends:2491}]){
    assert.equal(new URL(reportUrl({...context(a),seconds:1})).searchParams.get('clipTime'),'0_2491');
  }
});

test('real nonzero starts and shortened end ranges are still rejected',()=>{
  for(const a of [{begins:1,ends:2491},{begins:0,ends:2490},{begins:'1',ends:'10'},{begins:1}]){
    assert.throws(()=>reportUrl({...context(a),seconds:0}),{code:'UNSUPPORTED'});
  }
});

test('malformed or out-of-bounds ranges cannot submit reports',()=>{
  for(const a of [{begins:-1},{ends:-1},{ends:2492},{begins:2492},{begins:5,ends:4},
    {begins:5,ends:5},{begins:'oops'},{ends:Infinity},{ends:true},{ends:[]},{ends:{}}]){
    assert.throws(()=>reportUrl({...context(a),seconds:0}),{code:'MEDIA'});
  }
});

function fakeRunner({failEvent,setupError,range={begins:0,ends:2491},passed=true}={}){
  let now=0,ended=false;const reports=[],ac=new AbortController();
  const protocol={video:async()=>{if(setupError)throw setupError;return context(range);},
    report:async(ctx,seconds,event)=>{const value=new URL(reportUrl({...ctx,seconds,event}));reports.push({seconds,event,value});
      if(event===failEvent)throw problem('HTTP','测试请求失败');ended=event==='ended';return {isPassed:passed&&ended};},
    catalog:{refresh:async()=>({attachment:{isPassed:passed&&ended,playTime:2491000}})}};
  const runner=new Runner(protocol,{tickMs:60000,now:()=>now,sleep:async()=>{now+=60000;}});
  return {runner,protocol,reports,ac,task:{key:'v',type:'video',jobId:'job',isPassed:false,status:'pending',needsRefresh:false}};
}

test('observed full-range task runs from start to server-confirmed completion using virtual time',async()=>{
  const x=fakeRunner();await x.runner.video(x.task,{signal:x.ac.signal});
  assert.equal(x.task.status,'completed');assert.equal(x.task.isPassed,true);
  assert.equal(x.reports[0].event,'play');assert.equal(x.reports.at(-1).event,'ended');
  assert.equal(x.reports.at(-1).seconds,2491);
});

for(const event of ['play','playing','ended'])test(`a failed ${event} request clears running and publishes failure`,async()=>{
  const x=fakeRunner({failEvent:event}),states=[];
  await assert.rejects(x.runner.video(x.task,{signal:x.ac.signal,update:t=>states.push(t.status)}),{code:'HTTP'});
  assert.equal(x.task.status,'failed');assert.equal(x.task.isPassed,false);assert.equal(states.at(-1),'failed');
});

test('setup failure clears an old running task even before any report',async()=>{
  const x=fakeRunner({setupError:problem('MEDIA','无媒体状态')});x.task.status='running';
  await assert.rejects(x.runner.video(x.task),{code:'MEDIA'});assert.equal(x.task.status,'failed');assert.equal(x.reports.length,0);
});

test('a genuine clip failure is visible and sends no report',async()=>{
  const x=fakeRunner({range:{begins:1,ends:2491}});
  await assert.rejects(x.runner.video(x.task),{code:'UNSUPPORTED'});assert.equal(x.task.status,'failed');assert.equal(x.reports.length,0);
});

test('unconfirmed end stays unconfirmed rather than becoming failed or completed',async()=>{
  const x=fakeRunner({passed:false});await assert.rejects(x.runner.video(x.task),{code:'NOT_PASSED'});
  assert.equal(x.task.status,'unconfirmed');assert.equal(x.task.isPassed,false);
});

test('stop during setup marks stopped without issuing a pause against missing metadata',async()=>{
  const x=fakeRunner();x.protocol.video=async()=>{x.ac.abort();x.ac.signal.throwIfAborted();};
  await assert.rejects(x.runner.video(x.task,{signal:x.ac.signal}),{name:'AbortError'});
  assert.equal(x.task.status,'stopped');assert.equal(x.reports.length,0);
});

function controller(){const c=new Controller('unused');c.verified=true;
  c.courses=[{key:'c',title:'课程',scanState:'ready',chapters:[{id:'ch',title:'章节',scanState:'ready',tasks:[{key:'t',title:'视频',type:'video',jobId:'j',isPassed:false,status:'pending',needsRefresh:false}]}]}];
  const saved=[];c.save=async()=>{saved.push(structuredClone(c.snapshot()));};c.catalog.refresh=async()=>({attachment:{isPassed:false}});
  return {c,task:c.courses[0].chapters[0].tasks[0],saved};}

test('controller finalization saves failed state and clears the active queue',async()=>{
  const {c,task,saved}=controller();c.runner.video=async t=>{t.status='running';throw problem('HTTP','请求失败');};
  c.run(['c']);await c.job;assert.equal(c.phase,'failed');assert.equal(c.busy,false);assert.equal(c.active,null);
  assert.equal(task.status,'failed');assert.equal(saved.at(-1).courses[0].chapters[0].tasks[0].status,'failed');
});

test('controller stop cleans paused task status before saving',async()=>{
  const {c,task}=controller();c.runner.video=async(t,{signal})=>{t.status='paused';c.stop();signal.throwIfAborted();};
  c.run(['c']);await c.job;assert.equal(c.phase,'stopped');assert.equal(task.status,'stopped');assert.equal(c.busy,false);
});

test('completed and unconfirmed states survive final cleanup, and retry rechecks the server',async()=>{
  const {c,task}=controller();let calls=0;c.runner.video=async t=>{calls++;t.status='running';throw problem('HTTP','失败');};
  c.run(['c']);await c.job;assert.equal(task.status,'failed');
  c.catalog.refresh=async()=>({attachment:{isPassed:true}});c.run(['c']);await c.job;
  assert.equal(calls,1);assert.equal(task.status,'completed');assert.equal(task.isPassed,true);assert.equal(c.phase,'ready');
  task.status='unconfirmed';task.isPassed=false;c.settleTasks();assert.equal(task.status,'unconfirmed');
});

test('UI rejects orphaned legacy running and paused statuses without a live queue',async()=>{
  const window={};vm.runInNewContext(await fs.readFile(new URL('../webui/native-client.js',import.meta.url),'utf8'),{window});
  const {c,task}=controller();c.select(['c']);
  for(const status of ['running','paused'])for(const phase of ['ready','failed','stopped']){
    task.status=status;c.phase=phase;c.busy=false;
    const view=window.cxNative.snapshot(c.snapshot());
    assert.equal(view.courses[0].chapters[0].tasks[0].status,'needs_verification');
    assert.equal(view.overall.unverifiedTasks,1);assert.equal(view.overall.hasLiveEstimate,false);
  }
  task.status='running';task.estimatedSeconds=12;c.phase='running';c.busy=true;
  assert.equal(window.cxNative.snapshot(c.snapshot()).courses[0].chapters[0].tasks[0].status,'playing');
});
