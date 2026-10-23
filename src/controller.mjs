import { PlatformHttp } from './http.mjs';
import { QrAuth } from './auth.mjs';
import { Catalog, problem,taskPassed } from './catalog.mjs';
import { Protocol } from './protocol.mjs';
import { Runner } from './runner.mjs';
import { State } from './state.mjs';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import {Challenge} from './challenge.mjs';

export function publicTask(t){const {attachment,cardUrl,...out}=t;return out;}
export function publicCourse(c){const {entryUrl,...out}=c;return {...out,chapters:c.chapters.map(ch=>{const {url,...v}=ch;return {...v,tasks:ch.tasks.map(publicTask)};})};}
export function errorInfo(e){
  if(/^AUTH(?:_|$)/.test(e.code||''))return {code:e.code,message:e.message};
  if(e.name==='TimeoutError')return {code:'TIMEOUT',message:'请求超时，请检查网络后重试。'};
  if(/^(AUTH|VERIFY|VERIFY_SITE|FORMAT|LIMIT|MEDIA|NOT_PASSED|UNSUPPORTED|QR|SCAN_TIMEOUT|HTTP|PERSISTENCE|LOCKED)$/.test(e.code||''))return {code:e.code,message:e.message};
  return {code:'NETWORK',message:'网络连接或页面读取失败，请重新扫描该项。'};
}
export class Controller extends EventEmitter {
  constructor(directory){super();this.store=new State(directory);this.http=new PlatformHttp({directory});this.auth=new QrAuth(this.http);this.catalog=new Catalog(this.http);this.protocol=new Protocol(this.http,this.catalog);this.runner=new Runner(this.protocol);this.phase='idle';this.error=null;this.busy=false;this.courses=[];this.selected=[];this.logs=[];this.active=null;this.verified=false;this.scanProgress=null;this.studyMode='all';}
  async load(){await this.store.load();await this.http.load();this.courses=this.store.data.courses;this.selected=this.store.data.selected||[];this.logs=this.store.data.logs||[];for(const c of this.courses){c.scanState='stale';for(const ch of c.chapters){if(ch.scanState==='scanning')ch.scanState='unscanned';for(const t of ch.tasks){t.needsRefresh=true;t.status=t.isPassed?'completed':'stale';}}}}
  snapshot(){const courses=this.courses.map(publicCourse);return {version:'0.2.8',mode:'http-only',phase:this.phase,busy:this.busy,verifiedSession:this.verified,error:this.error,selected:this.selected,active:this.active,courses,logs:this.logs,scan:this.scanProgress,studyMode:this.studyMode,qr:this.auth.capture().available,requiresVerification:Boolean(this.catalog.challenge),verification:{id:this.verificationWait?.id||null,waiting:Boolean(this.verificationWait),submitting:Boolean(this.verificationWait?.submitting),resumePhase:this.verificationWait?.resumePhase||null},summary:{tasks:courses.flatMap(c=>c.chapters.flatMap(ch=>ch.tasks)).filter(t=>t.jobId).length,completed:courses.flatMap(c=>c.chapters.flatMap(ch=>ch.tasks)).filter(t=>t.jobId&&t.isPassed).length}};}
  publish(){this.emit('snapshot',this.snapshot());}
  log(message){this.logs.push({at:new Date().toISOString(),message});if(this.logs.length>300)this.logs.shift();this.publish();}
  async save(){this.store.data={schemaVersion:1,courses:this.courses.map(publicCourse),selected:this.selected,logs:this.logs};await this.store.save();}
  settleTasks(){
    // No task may remain live after its owning operation has exited. This also
    // repairs orphaned statuses left by older versions before saving a snapshot.
    for(const c of this.courses)for(const ch of c.chapters)for(const t of ch.tasks){
      if(['running','paused'].includes(t.status))t.status=t.isPassed?'completed':this.phase==='stopped'?'stopped':this.phase==='failed'?'failed':'unconfirmed';
    }
  }
  async awaitVerification(signal,resumePhase,error){
    signal.throwIfAborted();
    const gate={...Promise.withResolvers(),id:this.verificationSequence=(this.verificationSequence||0)+1,resumePhase,submitting:false};
    const abort=()=>gate.reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});this.verificationWait=gate;
    this.phase='awaiting_verification';this.error=errorInfo(error);
    this.log('平台要求本人输入验证码，已保留当前位置；验证通过后自动继续。');
    try{await Promise.all([gate.promise,this.save()]);signal.throwIfAborted();this.phase=resumePhase;this.error=null;}
    finally{signal.removeEventListener('abort',abort);if(this.verificationWait===gate)this.verificationWait=null;this.publish();}
  }
  async recoverVerification(signal,phase,fn){
    while(true){signal.throwIfAborted();try{const value=await fn();signal.throwIfAborted();return value;}catch(e){
      if(e.code!=='VERIFY_SITE'||!this.catalog.challenge)throw e;
      await this.awaitVerification(signal,this.phase==='paused'?'paused':phase,e);
    }}
  }
  operation(phase,fn){if(this.busy)throw problem('BUSY','已有操作正在执行。');this.abort=new AbortController();this.busy=true;this.phase=phase;this.error=null;this.publish();this.job=(async()=>{try{await fn(this.abort.signal);this.abort.signal.throwIfAborted();this.phase='ready';}catch(e){if(this.abort.signal.aborted){this.phase='stopped';for(const c of this.courses){if(c.scanState==='scanning')c.scanState=c.chapters.length?'partial':'unscanned';for(const ch of c.chapters)if(ch.scanState==='scanning')ch.scanState='unscanned';}this.log('任务已停止。');}else{this.phase='failed';this.error=errorInfo(e);if(e.code==='AUTH')this.verified=false;this.log(this.error.message);}}finally{this.settleTasks();this.active=null;this.busy=false;try{await this.save();}catch{this.phase='failed';this.error={code:'PERSISTENCE',message:'本机状态保存失败，请检查磁盘空间与目录权限。'};}this.publish();}})();return {accepted:true};}
  login(){return this.operation('login',async signal=>{const check=async()=>{try{return await this.catalog.courses(signal);}catch(e){if(e.code==='AUTH')return null;throw e;}};const courses=await this.auth.wait(check,signal,600000,(type,data)=>this.log(data.message));const previous=new Map(this.courses.map(c=>[c.key,c]));this.courses=courses.map(c=>{const old=previous.get(c.key);return old?{...old,...c,chapters:old.chapters,scanState:'stale'}:c;});this.selected=this.selected.filter(k=>courses.some(c=>c.key===k));this.verified=true;await this.http.save();this.log(`登录有效，读取到 ${courses.length} 门课程；已保留本机扫描断点。`);});}
  select(keys){if(!Array.isArray(keys)||keys.some(k=>!this.courses.some(c=>c.key===k)))throw problem('SELECT','请选择列表中的课程。');this.selected=[...new Set(keys)];}
  scan(keys,{resume=true}={}){
    if(typeof resume!=='boolean')throw problem('SELECT','续扫选项必须为布尔值。');
    if(!this.verified)throw problem('AUTH','请先连接并验证会话。');
    if(this.catalog.challenge)throw problem('VERIFY_SITE','请先完成人工平台验证，再重新扫描。');
    if(this.busy)throw problem('BUSY','已有操作正在执行。');
    this.select(keys);if(!keys.length)throw problem('SELECT','请先选择课程。');
    return this.operation('scanning',signal=>this.scanCourses(keys,{resume},signal));
  }
  async scanCourses(keys,{resume=true},signal){
      const selected=this.courses.filter(c=>keys.includes(c.key));let warnings=0;
      const fatal=e=>signal.aborted||e.name==='AbortError'||['AUTH','AUTH_VERIFY','VERIFY_SITE','SESSION'].includes(e.code);
      this.scanProgress={coursesDone:0,coursesTotal:selected.length,completedChapters:0,totalChapters:0,failedChapters:0,reusedChapters:0,startedAt:new Date().toISOString()};
      for(const c of selected){
        const checkpoint=new Map((resume?c.chapters:[]).filter(ch=>ch.scanState==='ready').map(ch=>[ch.id,ch]));
        const started=Date.now();c.scanState='scanning';c.error=null;c.empty=false;this.active={course:c.title};this.publish();
        try{const fresh=await this.recoverVerification(signal,'scanning',()=>this.catalog.course(c,signal));c.groups=fresh.groups||[];c.chapters=fresh.map(ch=>{const old=checkpoint.get(ch.id);return old?{...old,...ch,tasks:old.tasks.map(t=>({...t,needsRefresh:true})),scanState:'ready',fromCheckpoint:true}:ch;});}
        catch(e){if(fatal(e))throw e;c.chapters=[];c.scanState='failed';c.error=errorInfo(e);c.scanDurationMs=Date.now()-started;warnings++;this.scanProgress.coursesDone++;this.log(`《${c.title}》目录读取失败（${c.error.code}），已继续下一门课程。`);await this.save();continue;}
        this.scanProgress.totalChapters+=c.chapters.length;
        if(!c.chapters.length){c.empty=true;c.scanState='ready';c.scanDurationMs=Date.now()-started;this.scanProgress.coursesDone++;this.log(`《${c.title}》暂无已发布章节（0 章节），已跳过。`);await this.save();continue;}
        for(const ch of c.chapters){
          if(ch.fromCheckpoint)this.scanProgress.reusedChapters++;
          const began=Date.now();ch.scanState='scanning';ch.error=null;ch.empty=false;this.active={course:c.title,chapter:ch.title};this.publish();
          try{ch.tasks=await this.recoverVerification(signal,'scanning',()=>this.catalog.chapter(c,ch,signal));ch.empty=ch.tasks.length===0;ch.scanState='ready';if(ch.empty)this.log(`《${c.title}》「${ch.title}」为空章节，已跳过。`);}
          catch(e){if(fatal(e)){ch.scanState=signal.aborted?'unscanned':'blocked';ch.error=signal.aborted?null:errorInfo(e);c.scanState='partial';throw e;}ch.tasks=[];ch.error=errorInfo(e);ch.scanState=['VERIFY','LIMIT','LOCKED'].includes(e.code)?'blocked':'failed';warnings++;this.scanProgress.failedChapters++;this.log(`《${c.title}》「${ch.title}」未读取（${ch.error.code}），已继续下一节；未标记为完成。`);}
          ch.scanDurationMs=Date.now()-began;this.scanProgress.completedChapters++;this.scanProgress.lastProgressAt=new Date().toISOString();await this.save();this.publish();
        }
        c.scanState=c.chapters.every(ch=>ch.scanState==='ready')?'ready':'partial';c.scanDurationMs=Date.now()-started;this.scanProgress.coursesDone++;this.log(`《${c.title}》扫描结束：${c.chapters.filter(ch=>ch.scanState==='ready').length}/${c.chapters.length} 节已读取。`);
      }
      this.log(`扫描队列结束，复用 ${this.scanProgress.reusedChapters} 节目录断点并重新核对任务状态，${warnings} 项需要重试或本人处理；统计已覆盖全部成功读取的小节。`);
  }
  verify(code){
    if(!this.challengeHandler)this.challengeHandler=new Challenge(this.http,this.catalog);
    const gate=this.verificationWait;
    if(!gate)return this.operation('verifying',async signal=>{await this.challengeHandler.submit(code,signal);this.log('本人验证码已通过，平台访问已恢复。');});
    if(gate.submitting)throw problem('BUSY','正在核对验证码，请等待平台响应。');
    if(typeof code!=='string'||!/^[0-9a-zA-Z]{4}$/.test(code))throw problem('VERIFY_SITE','请输入本人识别的 4 位验证码。');
    const signal=this.abort.signal;signal.throwIfAborted();gate.submitting=true;this.phase='verifying';this.error=null;this.publish();
    this.verificationJob=(async()=>{try{
      await this.challengeHandler.submit(code,signal);signal.throwIfAborted();
      if(this.verificationWait!==gate)return;
      this.log('本人验证码已通过，正在从原位置自动继续。');gate.resolve();
    }catch(e){
      if(signal.aborted||/^AUTH(?:_|$)/.test(e.code||'')){gate.reject(e);}
      else if(this.verificationWait===gate){this.phase='awaiting_verification';this.error=errorInfo(e);this.log(this.error.message);}
    }finally{gate.submitting=false;this.publish();}})();
    return {accepted:true};
  }
  async verificationView(refresh=false){if(!this.challengeHandler)this.challengeHandler=new Challenge(this.http,this.catalog);return this.challengeHandler.view(undefined,refresh);}
  run(keys,rate=2,taskKeys,maxTasks,mode='all'){
    if(this.catalog.challenge)throw problem('VERIFY_SITE','请先完成人工平台验证，再执行任务。');
    if(this.busy)throw problem('BUSY','已有操作正在执行。');
    if(!this.verified)throw problem('AUTH','请先连接并验证会话。');
    this.select(keys);
    if(![1,1.25,1.5,2].includes(rate))throw problem('RATE','倍速仅支持 1、1.25、1.5、2。');
    if(maxTasks!==undefined&&(!Number.isInteger(maxTasks)||maxTasks<1))throw problem('LIMIT','任务上限必须是正整数。');
    if(!['all','video','document'].includes(mode))throw problem('SELECT','学习范围必须为全部、仅视频或仅课件。');
    const list=this.courses.filter(c=>keys.includes(c.key));
    if(!list.length)throw problem('SELECT','请先选择课程。');
    const needsScan=list.some(c=>c.scanState!=='ready');
    const available=list.flatMap(c=>c.chapters.flatMap(ch=>ch.tasks)).map(t=>t.key);
    if(taskKeys!==undefined&&(!Array.isArray(taskKeys)||!taskKeys.length||(!needsScan&&taskKeys.some(k=>!available.includes(k)))))throw problem('SELECT','指定课时不属于所选课程。');
    return this.operation(needsScan?'scanning':'running',async signal=>{
      this.studyMode=mode;
      if(needsScan){this.log('开始学习：先自动扫描并核对所选课程，扫描结束后自动执行。');await this.scanCourses(keys,{resume:true},signal);}
      signal.throwIfAborted();
      if(taskKeys?.some(k=>!list.flatMap(c=>c.chapters.flatMap(ch=>ch.tasks)).some(t=>t.key===k)))throw problem('SELECT','指定课时不属于当前所选课程。');
      this.phase='running';this.publish();
      this.runner.resume();
      let processed=0;
      queueLoop:for(const c of list)for(const ch of c.chapters)for(const t of ch.tasks){
        if(!['ready','partial'].includes(c.scanState)||['failed','blocked','stale','scanning','unscanned'].includes(ch.scanState))continue;
        if(taskKeys&&!taskKeys.includes(t.key))continue;
        if(mode!=='all'&&t.type!==mode)continue;
        while(this.runner.paused)await delay(250,undefined,{signal});
        signal.throwIfAborted();
        if(!t.jobId)continue;
        const handled=await this.recoverVerification(signal,'running',async()=>{
        // Public checkpoints omit signed URLs. Reacquire only the requested chapter
        // before checking or running a restored task; cached completion is not proof.
        if(!t.cardUrl&&ch.url){const fresh=await this.catalog.chapter(c,ch,signal);for(const old of ch.tasks){const found=fresh.find(x=>x.key===old.key);if(found)Object.assign(old,found);}if(!t.cardUrl)throw problem('FORMAT','断点中的任务已不在当前章节，请重新扫描全部章节。');}
        if(!t.jobId){t.status='resource';t.needsRefresh=false;this.publish();return false;}
        const current=await this.catalog.refresh(t,signal);
        if(current.config?.control===true&&!current.attachment.jobid){t.jobId='';t.isPassed=false;t.status='resource';t.needsRefresh=false;this.log(`参考资料无需任务打卡：${t.title}`);return false;}
        t.needsRefresh=false;
        t.isPassed=taskPassed(current.attachment,current.config);
        if(t.isPassed){t.status='completed';this.publish();return false;}
        if(maxTasks!==undefined&&processed>=maxTasks)return 'limit';
        this.active={course:c.title,chapter:ch.title,task:t.title,courseKey:c.key,chapterId:ch.id,taskKey:t.key};
        if(t.type==='video'){
          this.log(`处理视频：${t.title}；界面区分估算位置与服务端确认。`);
          await this.runner.video(t,{signal,rate,update:()=>this.publish()});
        }else if(t.type==='document')await this.document(t,current,signal);
        else{t.status='manual';this.log(`暂不支持的任务类型 ${t.type}：${t.title}`);}
        return ['video','document'].includes(t.type);
        });
        if(handled==='limit')break queueLoop;
        if(handled)processed++;
        await this.save();
      }
      this.log('所选课程队列处理结束；完成数以服务端确认结果为准。');
    });
  }
  async document(task,ctx,signal){if(!this.protocol.document){task.status='manual';this.log(`文档协议尚未完成验证：${task.title}`);return;}await this.protocol.document(task,ctx,signal);this.publish();}
  pause(){if(this.phase!=='running')throw problem('STATE','当前没有运行中的学习任务。');this.runner.pause();this.phase='paused';this.publish();}
  resume(){if(this.phase!=='paused')throw problem('STATE','当前没有暂停中的学习任务。');this.runner.resume();this.phase='running';this.publish();}
  stop(){if(this.busy)this.phase='stopping';this.abort?.abort();this.auth.view=null;this.publish();}
  async close(){this.stop();await this.job;await this.verificationJob;await this.save();}
}
