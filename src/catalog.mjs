import { load } from 'cheerio';
import { safeSite } from './http.mjs';
import { withDeadline } from './deadline.mjs';

export function problem(code, message) { return Object.assign(new Error(message), { code }); }
export function isSiteChallenge(page){return /antispiderShowVerify\.ac/.test(new URL(page.url).pathname)||/[【\[]9010[】\]].{0,30}操作异常/.test(load(page.html)('body').text());}
export function parseCard(html) {
  const marker = /\bmArg\s*=\s*(?=\{)/g.exec(html);
  if (!marker) return null;
  const begin = marker.index + marker[0].length;
  let depth=0, quoted=false, escaped=false;
  for(let i=begin;i<html.length;i++) {
    const c=html[i];
    if(quoted) { if(escaped)escaped=false; else if(c==='\\')escaped=true; else if(c==='"')quoted=false; }
    else if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0) {
      const data=JSON.parse(html.slice(begin,i+1));
      if(!Array.isArray(data.attachments)||!data.defaults)throw problem('FORMAT','任务卡片结构变化。');
      return data;
    }
  }
  throw problem('FORMAT','任务卡片配置不完整。');
}
export function checkPage(page) {
  if(isSiteChallenge(page))throw problem('VERIFY_SITE','超星返回 9010 图片验证，请本人输入验证码，通过后将从原位置继续。');
  if(new URL(page.url).hostname.startsWith('passport2.') || /id=["'](?:loginForm|quickCode)["']/.test(page.html)) throw problem('AUTH','登录会话失效，请重新扫码。');
  if(/<title>[^<]*(?:验证码|访问异常|安全验证)/.test(page.html))throw problem('VERIFY','平台要求本人验证，任务已暂停。');
  if(/enc校验失败/.test(page.html))throw problem('FORMAT','章节签名校验失败，需要重新读取当前课程入口。');
  if(load(page.html)('#chapterFaceState').length)throw problem('VERIFY','章节要求本人验证，任务已停止。');
  return page;
}
export function parseCourses(html, base) {
  const $=load(html), out=new Map();
  $('a[href]').each((_,n)=>{
    try {
      const href=safeSite($(n).attr('href'),base),u=new URL(href),q=u.searchParams;
      if(!/stucoursemiddle/.test(u.pathname))return;
      const courseId=q.get('courseid')||q.get('courseId'),clazzId=q.get('clazzid')||q.get('classId');
      if(!courseId||!clazzId)return;
      const box=$(n).closest('[id^="course_"], li.course, li[id^="c_"]');
      const title=($(n).attr('title')||box.find('h3').first().text()||$(n).text()).trim();
      if(title&&title!=='课程已结束')out.set(`${courseId}:${clazzId}`,{key:`${courseId}:${clazzId}`,courseId,clazzId,title,entryUrl:href,ended:/课程已结束/.test(box.text()),chapters:[],scanState:'unscanned'});
    }catch{}
  });
  return [...out.values()];
}
export function parseChapters(html,base,course) {
  const $=load(html),out=new Map(),elements=new Map(),context=new URL(base),groupNodes=new Map();
  const clean=v=>String(v||'').trim().replace(/\s+/g,' ');
  // Group headings have no study URL and must never enter the task scan queue.
  $('.chapter_unit').each((i,n)=>{
    const header=$(n).children('.chapter_item').children('.chapter_Thats_bnt').first();
    const title=clean(header.find('.catalog_name, .posCatalog_name, .clicktitle').first().text());
    if(title)groupNodes.set(n,{key:`${course.key}:group:${i}`,kind:'group',title,number:clean(header.find('.catalog_num').first().text())});
  });
  for(const key of ['cpi','enc','ut']) {
    const v=$(`#${key},input[name="${key}"]`).first().val()||html.match(new RegExp(`\\b${key}\\s*[:=]\\s*["']([^"']+)["']`))?.[1];
    if(v)context.searchParams.set(key,v);
  }
  $('[id^="cur"], [onclick], a[href*="studentstudy"]').each((_,n)=>{
    const el=$(n),onclick=el.attr('onclick')||'';
    let id=/^cur(\d+)$/.exec(el.attr('id')||'')?.[1],url;
    const href=el.attr('href');
    if(href?.includes('studentstudy')){try{url=safeSite(href,base);const q=new URL(url).searchParams;id=q.get('chapterId')||q.get('knowledgeId')||id;}catch{}}
    if(!id&&/getTeacherAjax|toStudentStudy|toStudy/.test(onclick))id=[...onclick.matchAll(/['"](\d+)['"]/g)][2]?.[1];
    if(!id||out.has(id))return;
    const titleNode=el.find('.posCatalog_name, .clicktitle').first();
    const title=(titleNode.attr('title')||el.attr('title')||titleNode.text()||el.text()).trim().replace(/\s+/g,' ');
    if(!url){const u=new URL('/mycourse/studentstudy','https://mooc1.chaoxing.com');for(const key of ['cpi','enc','ut'])if(context.searchParams.has(key))u.searchParams.set(key,context.searchParams.get(key));u.searchParams.set('chapterId',id);u.searchParams.set('courseId',course.courseId);u.searchParams.set('clazzid',course.clazzId);u.searchParams.set('mooc2','1');url=u.href;}
    if(title){out.set(id,{id,key:`${course.key}:${id}`,title,number:clean(el.find('.catalog_num').first().text()),url,tasks:[],scanState:'unscanned'});elements.set(n,id);}
  });
  function ancestors(n){
    const path=[],seen=new Set();
    for(const parent of $(n).parents().get().reverse()){
      let node=groupNodes.get(parent);
      if(!node&&parent.tagName==='li'){
        const item=$(parent).children().get().find(v=>elements.has(v)&&v!==n),chapter=item&&out.get(elements.get(item));
        if(chapter)node={key:chapter.key,id:chapter.id,kind:'chapter',title:chapter.title,number:chapter.number};
      }
      if(node&&!seen.has(node.key)){seen.add(node.key);path.push({...node});}
    }
    return path;
  }
  for(const [n,id] of elements)out.get(id).path=ancestors(n);
  const groups=[...groupNodes].map(([n,g])=>({...g,path:ancestors(n)}));
  // Keep the existing array API for the scanner, with separate directory-only
  // metadata that Controller persists on the course, not as fake task chapters.
  const chapters=[...out.values()];Object.defineProperty(chapters,'groups',{value:groups});return chapters;
}
export function emptyCourse(html,course) {
  const $=load(html),text=$('.chapter_body .nodata, .fanyaChapterWhite .nodata').text().replace(/\s+/g,'');
  const courseId=$('#courseId,#courseid').first().val(),clazzId=$('#clazzId,#clazzid').first().val();
  const identity=String(courseId)===String(course.courseId)&&String(clazzId)===String(course.clazzId);
  const onlyGroups=$('.chapter_body .chapter_td').length>0&&$('.chapter_body .chapter_item').length>0&&!$('[id^="cur"], [onclick*="toOld"], a[href*="studentstudy"]').length;
  return identity&&(/暂无章节内容|尚未发布章节|暂无章节/.test(text)||onlyGroups);
}
export function pageLinks(page) {
  const $=load(page.html),out=[];
  $('iframe[src]').each((_,n)=>{try{out.push(safeSite($(n).attr('src'),page.url));}catch{}});
  $('[data-url], [dataurl], [url]').each((_,n)=>{const value=$(n).attr('data-url')||$(n).attr('dataurl')||$(n).attr('url');if(value&&!value.includes('${'))try{out.push(safeSite(value,page.url));}catch{}});
  for(const m of page.html.matchAll(/['"]([^'"\n]*\/visit\/interaction[^'"\n]*)['"]/g))try{out.push(safeSite(m[1],page.url));}catch{}
  for(const m of page.html.matchAll(/(?:location(?:\.href)?\s*=|location\.(?:replace|assign)\s*\()\s*['"]([^'"\n]+)['"]/g))try{out.push(safeSite(m[1],page.url));}catch{}
  return [...new Set(out)];
}
export function taskPassed(a,config) {
  return a.isPassed===true || (a.type==='document'&&config?.control===true&&Boolean(a.jobid)&&!a.job);
}
export function taskFrom(a,course,chapter,cardUrl,index,config) {
  const jobId=String(a.jobid||''),resourceId=String(a.property?._jobid||''),objectId=String(a.objectId||a.property?.objectid||'');
  const saved=a.playTime==null?null:Number(a.playTime)/1000;
  const passed=taskPassed(a,config);
  return {key:`${course.key}:${chapter.id}:${new URL(cardUrl).searchParams.get('num')||0}:${jobId||resourceId||objectId||index}`,jobId,objectId,index,type:a.type||'unknown',title:a.property?.name||a.type||'任务',isPassed:passed,serverSeconds:Number.isFinite(saved)?saved:null,durationSeconds:Number(a.attDuration)>0?Number(a.attDuration):null,status:!jobId?'resource':passed?'completed':['video','document'].includes(a.type)?'pending':'manual',verifiedAt:new Date().toISOString(),needsRefresh:false,cardUrl,attachment:a};
}
export class Catalog {
  constructor(http,{courseTimeoutMs=8000,chapterTimeoutMs=15000}={}){this.http=http;this.courseTimeoutMs=courseTimeoutMs;this.chapterTimeoutMs=chapterTimeoutMs;this.challenge=null;http.onChallenge=p=>this.challenge=p;}
  async page(url,signal,referer){const p=await this.http.text(url,{signal,referer});if(isSiteChallenge(p))this.challenge={...p,requestUrl:url};return checkPage(p);}
  async courses(signal) {
    const queue=['https://i.chaoxing.com/base'],seen=new Set();let recognized=false;
    const all=new Map();
    while(queue.length&&seen.size<12){const url=queue.shift();if(seen.has(url))continue;seen.add(url);let p=await this.page(url,signal);
      if(p.html.includes('/mooc2-ans/visit/courselistdata')) {
        const $=load(p.html),form={courseType:'1',courseFolderId:'0',query:'',pageHeader:$('#stuPageHeader').val()||'',single:$('#single').val()||'',superstarClass:$('#superstarClass').val()||'',isFirefly:$('#isFirefly').val()||'0',fid:$('#filterFid').val()||'',from:$('#from').val()||''};
        p=checkPage(await this.http.text(new URL('/mooc2-ans/visit/courselistdata',p.url).href,{signal,referer:p.url,method:'POST',body:new URLSearchParams(form),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}}));
      }
      recognized ||= /id=["']courseList["']/.test(p.html);
      for(const c of parseCourses(p.html,p.url))all.set(c.key,c);
      for(const link of pageLinks(p))if(/\/visit\/interaction$|\/space\/index$|^\/base$/.test(new URL(link).pathname)&&!seen.has(link))queue.push(link);
    }
    if(!recognized&&!all.size)throw problem('FORMAT','会话已连接，但尚未识别课程列表入口。');
    return [...all.values()];
  }
  async course(course,signal) {
    return withDeadline(this.courseTimeoutMs,signal,bounded=>this.discoverCourse(course,bounded));
  }
  async discoverCourse(course,signal) {
    const queue=[course.entryUrl],seen=new Set();
    while(queue.length&&seen.size<8){const url=queue.shift();if(seen.has(url))continue;seen.add(url);const p=await this.page(url,signal);const chapters=parseChapters(p.html,p.url,course);if(chapters.length)return chapters;
      if(emptyCourse(p.html,course))return chapters;
      const $=load(p.html),href=$('a[data-url*="studentcourse"]').first().attr('data-url');
      if(href){const next=new URL(safeSite(href,p.url));for(const k of ['courseid','clazzid','cpi','t','enc']){const value=$(`#${k}`).first().val();if(value)next.searchParams.set(k==='enc'?'stuenc':k,value);}next.searchParams.set('ut','s');queue.push(next.href);}
      queue.push(...pageLinks(p).filter(u=>/studentcourse|studentstudy/.test(new URL(u).pathname)&&new URL(u).search&&!seen.has(u)));
    }
    throw problem('FORMAT',`未识别《${course.title}》章节；没有将空列表当作扫描成功。`);
  }
  async chapter(course,chapter,signal) {
    return withDeadline(this.chapterTimeoutMs,signal,bounded=>this.discoverChapter(course,chapter,bounded));
  }
  async discoverChapter(course,chapter,signal) {
    if(chapter.fromCheckpoint&&chapter.tasks.length&&chapter.tasks.every(t=>t.cardUrl)){
      return this.readTasks(course,chapter,chapter.tasks.map(t=>t.cardUrl),signal);
    }
    let page=await this.page(chapter.url,signal);
    if(page.html.includes('/mycourse/studentstudyAjax')) {
      const q=new URL(page.url).searchParams,u=new URL('/mooc-ans/mycourse/studentstudyAjax',page.url);
      u.search=new URLSearchParams({courseId:course.courseId,clazzid:course.clazzId,chapterId:chapter.id,cpi:q.get('cpi')||'',verificationcode:'',mooc2:'1',toComputer:'false',microTopicId:'0',editorPreview:'0',isPreviewVideo:'false',videoWidth:'0',videoHeight:'0',targetVideoJobId:'',cardIndex:'0'}).toString();
      page=await this.page(u.href,signal,page.url);
    }
    const $=load(page.html);
    let urls=pageLinks(page).filter(u=>/knowledge\/cards/.test(u));
    if(parseCard(page.html))urls=[page.url];
    if(!urls.length){const u=new URL('/mooc-ans/knowledge/cards',page.url);const q=new URL(page.url).searchParams;u.search=new URLSearchParams({clazzid:course.clazzId,courseid:course.courseId,knowledgeid:chapter.id,cpi:q.get('cpi')||'',num:'0',ut:q.get('ut')||'s',v:'20160407-1'}).toString();urls=[u.href];}
    const count=Math.max(1,Number($('#cardcount').val())||0,$('.card_tabs_list li, #prev_tab .prev_ul li').length);
    if(urls.length===1)for(let i=1;i<count;i++){const u=new URL(urls[0]);u.searchParams.set('num',i);urls.push(u.href);}
    return this.readTasks(course,chapter,urls,signal);
  }
  async readTasks(course,chapter,urls,signal){
    const tasks=[];
    for(const url of [...new Set(urls)]){
      const card=await this.card(url,signal);
      for(const [i,a] of card.config.attachments.entries()){
        const task=taskFrom(a,course,chapter,url,i,card.config),old=chapter.tasks?.find(t=>t.key===task.key&&t.objectId===task.objectId);
        // Media duration is stable for the same object; completion and saved
        // position always come from the newly fetched card, never the cache.
        if(!task.durationSeconds&&old?.durationSeconds>0)task.durationSeconds=old.durationSeconds;
        if(task.type==='video'&&task.jobId&&!task.durationSeconds){
          try{
            if(!task.objectId)throw problem('MEDIA','视频对象标识缺失。');
            const status=new URL('/ananas/status/'+encodeURIComponent(task.objectId),card.url);
            const cookies=await this.http.jar?.getCookies(card.url)||[],fid=cookies.find(c=>c.key==='fid')?.value||'';
            status.search=new URLSearchParams({k:fid,flag:'normal',ro:'0'}).toString();
            const media=await this.http.json(status.href,{signal,referer:card.url,retryRead:true});
            if(media.status!=='success'||!(Number(media.duration)>0))throw problem('MEDIA','平台未返回有效的视频时长。');
            task.durationSeconds=Number(media.duration);
          }catch(e){
            if(signal?.aborted||['AUTH','AUTH_VERIFY','VERIFY_SITE','SESSION'].includes(e.code))throw e;
            task.metadataError={code:e.code||'MEDIA',message:'视频时长暂未读取，未计为零；可重新扫描获取。'};
          }
        }
        tasks.push(task);
      }
    }
    return tasks;
  }
  async card(url,signal) {const page=await this.page(url,signal);let config=parseCard(page.html);if(!config){const $=load(page.html);const empty=!$('.ans-cc').html()?.trim()||$('.ans-cc .nullpage').text().includes('暂无内容');if(/isChapterCards\s*=\s*true/.test(page.html)&&/mArg\s*=\s*""/.test(page.html)&&$('.ans-cc').length===1&&empty)config={defaults:{},attachments:[]};else throw problem('FORMAT','未找到任务配置，可能需要验证或课程结构已变化。');}return {config,url:page.url,html:page.html};}
  async refresh(task,signal) {const card=await this.card(task.cardUrl,signal);const attachment=card.config.attachments.find(a=>String(a.jobid||a.property?._jobid||'')===task.jobId);if(!attachment)throw problem('FORMAT','目标任务已不存在于服务端卡片。');return {...card,attachment};}
}
