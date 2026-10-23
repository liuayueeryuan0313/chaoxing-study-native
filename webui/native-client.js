// Adapts the existing control-console view model to the browserless HTTP engine.
(() => {
  let csrfToken;
  const acceptToken=n=>{csrfToken=typeof n.csrfToken==='string'?n.csrfToken:null;};
  const percent=(n,d)=>d>0?Math.round(1000*n/d)/10:null;
  function summarize(tasks,complete){
    const jobs=tasks.filter(t=>t.jobId),videos=jobs.filter(t=>t.type==='video');
    const known=videos.filter(t=>t.durationSeconds>0),duration=known.reduce((a,t)=>a+t.durationSeconds,0);
    const position=known.reduce((a,t)=>a+(t.isPassed?t.durationSeconds:Math.max(0,Math.min(t.observedSeconds??t.serverSeconds??0,t.durationSeconds))),0);
    const taskPassed=jobs.filter(t=>t.isPassed).length,videoPassed=videos.filter(t=>t.isPassed).length;
    const unverifiedTasks=jobs.filter(t=>!t.verified).length,remaining=jobs.filter(t=>t.verified&&!t.isPassed);
    const manualTasks=remaining.filter(t=>t.status==='manual').length,failedTasks=remaining.filter(t=>t.status==='failed').length;
    const unknownDurationVideos=videos.length-known.length,unknownPositionVideos=videos.filter(t=>!t.isPassed&&t.observedSeconds==null&&t.serverSeconds==null).length;
    return {taskTotal:jobs.length,taskPassed,taskPending:remaining.length-manualTasks-failedTasks,taskRemaining:jobs.length-taskPassed,unverifiedTasks,resourceTotal:tasks.length-jobs.length,
      videoTotal:videos.length,videoPassed,videoPending:videos.length-videoPassed,manualTasks,failedTasks,
      inventoryComplete:complete,mediaComplete:complete&&!unknownDurationVideos&&!unknownPositionVideos&&!videos.some(t=>!t.verified),unknownDurationVideos,unknownPositionVideos,
      completionPercent:percent(taskPassed,jobs.length),mediaPercent:percent(position,duration),
      hasLiveEstimate:videos.some(t=>t.observedSeconds!=null),progressMediaSeconds:Math.round(position),knownDurationSeconds:duration};
  }
  function outline(course){
    const roots=[],nodes=new Map();
    function add(info,parent){
      const key=info.key;let node=nodes.get(key);
      if(!node){node={...info,children:[]};nodes.set(key,node);(parent?parent.children:roots).push(node);}
      return node;
    }
    for(const group of course.groups||[]){let parent;for(const ancestor of group.path||[])parent=add(ancestor,parent);add(group,parent);}
    for(const ch of course.chapters){let parent;for(const ancestor of ch.path||[])parent=add(ancestor,parent);const key=ch.key||`${course.key}:${ch.id}`;const node=add({key,kind:'chapter',title:ch.title,number:ch.number},parent);node.chapter=ch;}
    function collect(node){const tasks=[...(node.chapter?.tasks||[]),...node.children.flatMap(collect)];node.summary=summarize(tasks,course.scanState==='ready');return tasks;}
    roots.forEach(collect);return roots;
  }
  function snapshot(n){
    acceptToken(n);
    const courses=n.courses.map(c=>({...c,chapters:c.chapters.map(ch=>({...ch,tasks:ch.tasks.map(t=>{
      const orphaned=['running','paused'].includes(t.status)&&(!n.busy||!['running','paused','stopping','awaiting_verification','verifying'].includes(n.phase));
      const stale=c.scanState==='stale'||t.needsRefresh||orphaned||(t.status==='manual'&&['video','document'].includes(t.type)),passed=t.isPassed&&!stale;
      const manual=Boolean(t.jobId)&&!t.isPassed&&!['video','document'].includes(t.type);
      const live=['running','paused'].includes(t.status)&&['running','paused','stopping'].includes(n.phase)&&!stale;
      const observedSeconds=live?t.estimatedSeconds:undefined;
      return {...t,isPassed:passed,verified:!stale,observedSeconds,
        status:!t.jobId?'resource':stale?'needs_verification':manual?'manual':({completed:'passed',running:'playing',stopped:'pending',unconfirmed:'needs_verification',resource:'resource'})[t.status]||t.status,
        progressPercent:passed?100:t.durationSeconds?percent(Math.max(0,Math.min(observedSeconds??t.serverSeconds??0,t.durationSeconds)),t.durationSeconds):null};
    })}))}));
    for(const c of courses){for(const ch of c.chapters)ch.summary=summarize(ch.tasks,ch.scanState==='ready');c.summary=summarize(c.chapters.flatMap(ch=>ch.tasks),c.scanState==='ready');c.outline=outline(c);}
    const selected=courses.filter(c=>n.selected.includes(c.key));let active=null;
    if(n.active?.taskKey)active={taskKey:n.active.taskKey};
    else if(n.active){for(const c of courses)for(const ch of c.chapters){const t=ch.tasks.find(t=>t.title===n.active.task&&c.title===n.active.course&&ch.title===n.active.chapter);if(t)active={taskKey:t.key};}}
    return {gatewayUser:n.gatewayUser,phase:n.phase==='login'?'logging_in':n.phase,qrReady:n.qr,requiresVerification:n.requiresVerification,verification:n.verification,busy:n.busy,scan:n.scan,discovery:n.active,studyMode:n.studyMode,courses,selectedCourseKeys:n.selected,lastError:n.error,active,
      controls:{canInitialize:!n.busy,canScan:!n.busy&&n.verifiedSession&&!n.requiresVerification,canStart:!n.busy&&n.verifiedSession&&!n.requiresVerification&&selected.length>0,canPause:n.phase==='running',canResume:n.phase==='paused',canStop:n.busy},
      overall:summarize(selected.flatMap(c=>c.chapters.flatMap(ch=>ch.tasks)),selected.length>0&&selected.every(c=>c.scanState==='ready'))};
  }
  async function request(endpoint,body,method='POST'){
    const aliases={initialize:'login',start:'run',selectCourses:'select'};
    const payload=body?{...body,keys:body.courseKeys??body.keys}:{};
    if(method==='POST'&&csrfToken===undefined){const state=await fetch('./api/status',{cache:'no-store'});if(!state.ok)throw new Error('无法校验当前页面，请刷新后重试。');acceptToken(await state.json());}
    const headers=method==='POST'?{'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})}:{};
    const res=await fetch('./api/'+(aliases[endpoint]||endpoint),{method,headers,body:method==='POST'?JSON.stringify(payload):undefined});
    const data=await res.json();if(!res.ok)throw new Error(data.error?.message||data.error||'请求失败');
    return endpoint==='status'?{snapshot:snapshot(data),mode:'real'}:data;
  }
  window.cxNative={snapshot,request};
})();
