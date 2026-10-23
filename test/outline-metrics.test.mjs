import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Catalog,parseChapters} from '../src/catalog.mjs';
import {Controller} from '../src/controller.mjs';

const course={key:'1:2',courseId:'1',clazzId:'2',title:'人工智能',entryUrl:'https://mooc1.chaoxing.com/catalog-fixture'};
const leaf=(id,title,children='')=>`<li><div id="cur${id}" class="chapter_item"><div class="catalog_title"><div class="catalog_num">1.${id}</div><a class="clicktitle">${title}</a></div></div>${children}</li>`;
const group=(title,number,children)=>`<div class="chapter_unit"><div class="chapter_item"><div class="chapter_Thats_bnt"><span class="catalog_num">${number}</span><div class="catalog_name"><a class="clicktitle">${title}</a></div></div></div><div class="catalog_level" style="display:none"><ul>${children}</ul></div></div>`;
const html=group('绪论',1,leaf(1,'课程简介')+leaf(2,'课件资源'))+group('人工智能系统模型与方法论',2,leaf(3,'视频资源',`<ul>${leaf(4,'章节练习')}</ul>`));
const source=await fs.readFile(new URL('../webui/native-client.js',import.meta.url),'utf8');
function view(n){const window={};vm.runInNewContext(source,{window});return window.cxNative.snapshot(n);}
function fixture(){
  const calls=[],attachments={
    1:[{type:'video',jobid:'v1',objectId:'o1',playTime:20000,isPassed:false,property:{name:'前面未完成.mp4'}}],
    2:[{type:'document',jobid:'d1',property:{name:'已完成.pdf'}},{type:'document',property:{_jobid:'ref',name:'参考.docx'}}],
    3:[{type:'video',jobid:'v2',objectId:'o2',playTime:0,isPassed:true,property:{name:'后面已完成.mp4'}},{type:'video',objectId:'reference',property:{name:'参考视频.mp4'}}],
    4:[{type:'workid',jobid:'quiz',property:{name:'需本人答题'}}]
  };
  const http={text:async(url,options)=>{calls.push({url,method:options?.method||'GET'});assert.equal(options?.method||'GET','GET');const u=new URL(url);if(url===course.entryUrl)return {url,html};const id=u.searchParams.get('chapterId');assert.ok(attachments[id]);return {url,html:'<script>mArg='+JSON.stringify({defaults:{},control:true,attachments:attachments[id]})+';</script>'};},json:async(url,options)=>{calls.push({url,method:options?.method||'GET'});assert.equal(options?.method||'GET','GET');const id=new URL(url).pathname.split('/').at(-1);assert.ok(['o1','o2'].includes(id));return {status:'success',duration:id==='o1'?100:200};}};
  const c=new Controller('unused');c.verified=true;c.courses=[{...course,chapters:[]}];c.save=async()=>{};c.catalog=new Catalog(http);return {c,calls};
}

test('catalog keeps big chapter headings, nested lessons and duplicate resource names separate',()=>{
  const chapters=parseChapters(html,course.entryUrl,course);assert.equal(chapters.length,4);assert.equal(chapters.groups.length,2);
  assert.equal(chapters[0].path[0].title,'绪论');assert.equal(chapters[2].path[0].title,'人工智能系统模型与方法论');
  assert.deepEqual(chapters[3].path.map(n=>n.title),['人工智能系统模型与方法论','视频资源']);assert.equal(chapters[3].path[1].kind,'chapter');
  const c={...course,scanState:'ready',groups:chapters.groups,chapters};const snap=view({courses:[c],selected:[course.key],phase:'ready'});
  assert.equal(snap.courses[0].outline.length,2);assert.equal(snap.courses[0].outline[1].children[0].children[0].chapter.id,'4');
  assert.equal(snap.courses[0].outline[0].summary.taskTotal,0,'group headings are not task points');
});

test('scan-only fills completion, saved time and all categories before any run or progress submission',async()=>{
  const {c,calls}=fixture();c.scan([course.key]);await c.job;assert.equal(c.phase,'ready');
  const s=view(c.snapshot()),o=s.overall;assert.equal(o.taskTotal,4);assert.equal(o.taskPassed,2);assert.equal(o.taskPending,1);assert.equal(o.manualTasks,1);assert.equal(o.unverifiedTasks,0);assert.equal(o.resourceTotal,2);
  assert.equal(o.completionPercent,50);assert.equal(o.videoTotal,2);assert.equal(o.knownDurationSeconds,300);assert.equal(o.progressMediaSeconds,220);assert.equal(o.mediaPercent,73.3);assert.equal(o.mediaComplete,true);
  assert.equal(o.taskPassed+o.taskPending+o.manualTasks+o.failedTasks+o.unverifiedTasks,o.taskTotal);
  assert.equal(s.courses[0].outline[1].summary.taskPassed,1);assert.equal(s.courses[0].chapters[2].tasks[0].isPassed,true);
  assert.equal(calls.filter(r=>r.url.includes('/ananas/status/')).length,2);assert.ok(calls.every(r=>!new URL(r.url).pathname.includes('/job/')&&!r.url.includes('multimedia/log')));
});

test('refreshing checkpoints reads later passed tasks first instead of waiting for the run queue',async()=>{
  const {c,calls}=fixture();c.scan([course.key]);await c.job;
  for(const ch of c.courses[0].chapters)for(const t of ch.tasks){t.isPassed=false;t.needsRefresh=true;t.estimatedSeconds=999;}
  calls.length=0;c.scan([course.key]);await c.job;const o=view(c.snapshot()).overall;
  assert.equal(o.taskPassed,2);assert.equal(o.progressMediaSeconds,220);assert.equal(o.unverifiedTasks,0);assert.equal(c.scanProgress.reusedChapters,4);
  assert.equal(calls.filter(r=>r.url.includes('/ananas/status/')).length,0,'reuse immutable duration for same object, not stale completion');
  assert.equal(calls.filter(r=>new URL(r.url).searchParams.get('chapterId')==='3').length,1,'read a cached card only once');
});

test('live progress preserves passed later chapters and does not claim an estimated 100 percent as completion',async()=>{
  const {c}=fixture();c.scan([course.key]);await c.job;
  const t=c.courses[0].chapters[0].tasks[0];c.phase='running';c.busy=true;c.active={taskKey:t.key};t.status='running';t.estimatedSeconds=30;
  let o=view(c.snapshot()).overall;assert.equal(o.taskPassed,2);assert.equal(o.mediaPercent,76.7);assert.equal(o.hasLiveEstimate,true);
  t.estimatedSeconds=100;o=view(c.snapshot()).overall;assert.equal(o.mediaPercent,100);assert.equal(o.taskPassed,2);assert.equal(o.completionPercent,50);
  c.phase='stopped';t.status='stopped';o=view(c.snapshot()).overall;assert.equal(o.progressMediaSeconds,220,'stopped estimate must not override platform saved position');
  t.isPassed=true;t.status='completed';o=view(c.snapshot()).overall;assert.equal(o.taskPassed,3);assert.equal(o.completionPercent,75);
});

test('missing media metadata leaves known completion intact and exposes unknown durations',async()=>{
  const {c}=fixture();c.catalog.http.json=async()=>{throw Object.assign(new Error('temporary'),{code:'HTTP'});};c.scan([course.key]);await c.job;
  const o=view(c.snapshot()).overall;assert.equal(c.phase,'ready');assert.equal(o.taskPassed,2);assert.equal(o.unknownDurationVideos,2);assert.equal(o.knownDurationSeconds,0);assert.equal(o.mediaPercent,null);assert.equal(o.mediaComplete,false);
  assert.equal(c.courses[0].chapters[2].tasks[0].metadataError.code,'HTTP');
});

test('unverified cache and failed tasks have exclusive categories rather than inflating pending',()=>{
  const tasks=[{jobId:'1',type:'video',title:'cached',isPassed:true,needsRefresh:true,durationSeconds:10},{jobId:'2',type:'document',title:'failed',isPassed:false,status:'failed'},{jobId:'3',type:'workid',title:'quiz',isPassed:false,status:'manual'}];
  const o=view({courses:[{...course,scanState:'ready',chapters:[{id:'c',scanState:'ready',tasks}]}],selected:[course.key],phase:'ready'}).overall;
  assert.equal(o.taskPassed,0);assert.equal(o.taskPending,0);assert.equal(o.unverifiedTasks,1);assert.equal(o.failedTasks,1);assert.equal(o.manualTasks,1);assert.equal(o.taskTotal,3);
});
