import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Controller} from '../src/controller.mjs';
import {createFnosApp} from '../webui/fnos.mjs';

const prefix='/app/chaoxing-study-native',site='https://mooc1.chaoxing.com/';
const course=()=>({key:'shared-course',title:'同一门课程',scanState:'ready',chapters:[{id:'same-chapter',title:'同一节',scanState:'ready',tasks:[{key:'same-task',jobId:'same-job',title:'同一视频',type:'video',isPassed:false,serverSeconds:9,durationSeconds:60,status:'pending'}]}]});
function memoryController(){const c=new Controller('unused');c.save=async()=>{};c.login=()=>{c.phase='ready';c.verified=true;c.publish();};c.courses=[course()];return c;}
async function gateway(factory=async()=>memoryController(),directory='unused'){
  const app=createFnosApp({directory,controllerFactory:factory});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const get=(uid,route='status',options={})=>fetch(base+prefix+'/api/'+route,{...options,headers:{'X-Trim-Userid':uid,...options.headers}});
  const status=async uid=>(await get(uid)).json();
  const post=async(uid,route,body={})=>{const {csrfToken}=await status(uid);return get(uid,route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)});};
  return {app,get,status,post};
}

test('NAS identity is gateway-only, display-safe and stable across a username change',async()=>{
  const x=await gateway();try{
    let a=await (await x.get('1000','status?uid=1001&username=other',{headers:{'X-Trim-Username':encodeURIComponent('室友甲')}})).json();
    assert.deepEqual(a.gatewayUser,{uid:'1000',username:'室友甲',isolated:true});
    const instance=await x.app.sessions.get('1000');
    a=await (await x.get('1000','status',{headers:{'X-Trim-Username':encodeURIComponent('<img src=x onerror=alert(1)>\n')}})).json();
    assert.equal(a.gatewayUser.username,'<img src=x onerror=alert(1)>');
    assert.equal(await x.app.sessions.get('1000'),instance);
    const b=await x.status('1001');assert.equal(b.gatewayUser.uid,'1001');assert.equal(b.gatewayUser.username,'');assert.notEqual(a.csrfToken,b.csrfToken);
    assert.equal(x.app.sessions.size,2);
  }finally{await x.app.close();}
});

test('two users see only their own QR, platform verification and course selection',async()=>{
  const x=await gateway(async(dir,uid)=>{const c=memoryController();c.auth.capture=()=>({available:true,imageBase64:'mock-qr-'+uid});c.verificationView=async()=>({required:true,imageBase64:'mock-verify-'+uid});return c;});
  try{
    for(const uid of ['1000','1001']){assert.equal((await (await x.get(uid,'qr')).json()).imageBase64,'mock-qr-'+uid);assert.equal((await (await x.get(uid,'verification')).json()).imageBase64,'mock-verify-'+uid);}
    assert.equal((await x.post('1000','select',{keys:['shared-course'],uid:'1001'})).status,200);
    assert.deepEqual((await x.status('1000')).selected,['shared-course']);assert.deepEqual((await x.status('1001')).selected,[]);
    const a=(await x.app.sessions.get('1000')).app,b=(await x.app.sessions.get('1001')).app;
    a.catalog.challenge={url:'https://mooc1.chaoxing.com/blocked'};a.log('甲的私有日志');a.publish();
    assert.equal((await x.status('1000')).requiresVerification,true);const bs=await x.status('1001');assert.equal(bs.requiresVerification,false);assert.equal(JSON.stringify(bs).includes('甲的私有日志'),false);
    assert.notEqual(a.http.jar,b.http.jar);assert.notEqual(a.auth,b.auth);assert.notEqual(a.runner,b.runner);
  }finally{await x.app.close();}
});

test('concurrent identical tasks have independent pause resume stop and completion',async()=>{
  const pending=new Map();const x=await gateway(async(dir,uid)=>{
    const c=memoryController();c.catalog.refresh=async()=>({attachment:{isPassed:false}});
    c.runner.video=async(t,{signal,update})=>{t.status='running';update();const gate=Promise.withResolvers();pending.set(uid,gate);
      const abort=()=>gate.reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      try{await gate.promise;signal.throwIfAborted();t.isPassed=true;t.serverSeconds=60;t.status='completed';update();}
      catch(e){t.status='stopped';throw e;}finally{signal.removeEventListener('abort',abort);}
    };return c;
  });
  try{
    for(const uid of ['1000','1001'])assert.equal((await x.post(uid,'run',{keys:['shared-course'],mode:uid==='1000'?'video':'all'})).status,202);
    assert.equal(pending.size,2);assert.equal((await x.status('1000')).phase,'running');assert.equal((await x.status('1001')).phase,'running');
    assert.equal((await x.post('1000','run',{keys:['shared-course']})).status,400,'another tab of the same UID shares the queue');
    await x.post('1000','pause');assert.equal((await x.status('1000')).phase,'paused');assert.equal((await x.status('1001')).phase,'running');
    assert.equal((await x.app.sessions.get('1001')).app.runner.paused,false);
    await x.post('1000','resume');assert.equal((await x.status('1000')).phase,'running');
    await x.post('1000','stop');await (await x.app.sessions.get('1000')).app.job;
    assert.equal((await x.status('1000')).phase,'stopped');assert.equal((await x.status('1001')).phase,'running');
    pending.get('1001').resolve();await (await x.app.sessions.get('1001')).app.job;
    const a=await x.status('1000'),b=await x.status('1001');
    assert.equal(a.courses[0].chapters[0].tasks[0].isPassed,false);assert.equal(a.courses[0].chapters[0].tasks[0].serverSeconds,9);
    assert.equal(b.courses[0].chapters[0].tasks[0].isPassed,true);assert.equal(b.courses[0].chapters[0].tasks[0].serverSeconds,60);
    assert.equal(a.studyMode,'video');assert.equal(b.studyMode,'all');assert.equal(b.phase,'ready');assert.equal(b.logs.some(l=>l.message==='任务已停止。'),false);
  }finally{await x.app.close();}
});

test('restart restores each UID encrypted session and checkpoint without copying the owner to new users',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cx-multiuser-'));let x;
  const factory=async(dir)=>{const c=new Controller(dir);await c.load();c.auth.wait=async()=>[{key:'shared-course',title:'同一门课程',chapters:[],scanState:'unscanned'}];return c;};
  try{
    for(const uid of ['1000','1001']){
      const c=new Controller(path.join(directory,'users',uid));await c.load();c.courses=[course()];c.selected=uid==='1000'?['shared-course']:[];
      const t=c.courses[0].chapters[0].tasks[0];t.isPassed=uid==='1001';t.serverSeconds=uid==='1001'?60:17;c.log('private-'+uid);
      await c.http.jar.setCookie(`account=mock-${uid}; Domain=chaoxing.com; Secure; Path=/`,site);await c.http.save();await c.save();
    }
    for(let restart=0;restart<2;restart++){
      x=await gateway(factory,directory);
      for(const uid of ['1000','1001']){
        await x.status(uid);const {app:c}=await x.app.sessions.get(uid);await c.job;
        const s=await x.status(uid),t=s.courses[0].chapters[0].tasks[0];
        assert.equal(t.serverSeconds,uid==='1001'?60:17);assert.equal(t.isPassed,uid==='1001');assert.equal(t.needsRefresh,true,'cached progress must still be verified by platform');
        assert.deepEqual(s.selected,uid==='1000'?['shared-course']:[]);assert.equal(s.logs.some(l=>l.message==='private-'+uid),true);assert.equal(s.logs.some(l=>l.message==='private-'+(uid==='1000'?'1001':'1000')),false);
        assert.equal(await c.http.jar.getCookieString(site),`account=mock-${uid}`);assert.equal(JSON.stringify(s).includes('account=mock-'),false);
      }
      await x.status('1002');const newcomer=(await x.app.sessions.get('1002')).app;await newcomer.job;
      assert.equal(newcomer.courses[0].chapters.length,0);assert.equal(await newcomer.http.jar.getCookieString(site),'');assert.deepEqual(newcomer.selected,[]);
      await x.app.close();x=null;
    }
    const a=await fs.readFile(path.join(directory,'users/1000/session.key')),b=await fs.readFile(path.join(directory,'users/1001/session.key'));assert.notDeepEqual(a,b);
    for(const uid of ['1000','1001']){
      const bytes=await fs.readFile(path.join(directory,'users',uid,'session.enc'));assert.equal(bytes.includes(Buffer.from('mock-')),false);
      const json=await fs.readFile(path.join(directory,'users',uid,'progress.json'),'utf8');assert.equal(json.includes('csrfToken'),false);assert.equal(json.includes('gatewayUser'),false);
    }
  }finally{if(x)await x.app.close();await fs.rm(directory,{recursive:true,force:true});}
});
