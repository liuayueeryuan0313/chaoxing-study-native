import crypto from 'node:crypto';
import { safeSite } from './http.mjs';
import { problem,taskPassed } from './catalog.mjs';

// Missing/zero ends are platform sentinels; an explicit full-duration end is
// also a whole video. Do not silently submit full-video reports for real clips.
export function wholeVideoRange(attachment,duration){
  const read=value=>{
    if(value==null||value==='')return 0;
    if(!['number','string'].includes(typeof value))throw problem('MEDIA','视频起止参数无效。');
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)throw problem('MEDIA','视频起止参数无效。');
    return n;
  };
  const begins=read(attachment.begins),ends=read(attachment.ends);
  if(!Number.isFinite(duration)||duration<=0||begins>duration||ends>duration||(ends>0&&ends<=begins))throw problem('MEDIA','视频起止范围与总时长不一致。');
  if(begins!==0||(ends!==0&&ends!==duration))throw problem('UNSUPPORTED','真正截取的片段视频尚未适配，请在平台中学习该任务。');
  return `0_${duration}`;
}

export function reportUrl({config,attachment:a,media,cardUrl,seconds,event='playing',now=Date.now()}) {
  const d=config.defaults, duration=Number(media.duration),objectId=a.objectId||a.property?.objectid;
  if(!Number.isFinite(duration)||duration<=0||!Number.isInteger(seconds)||seconds<0||seconds>duration)throw problem('MEDIA','视频时长或上报位置无效。');
  if(!a.jobid||!objectId||!d.userid||!d.clazzId||!media.dtoken||!d.reportUrl)throw problem('FORMAT','视频上报参数不完整。');
  const clipTime=wholeVideoRange(a,duration);
  if(Number(d.isFiled)===1||Number(d.state)===1)throw problem('ARCHIVED','课程已归档或停用。');
  const codes={playing:0,pause:2,play:3,ended:4};if(!(event in codes))throw problem('EVENT','不支持的播放事件。');
  const enc=crypto.createHash('md5').update([d.clazzId,d.userid,a.jobid,objectId,seconds*1000,'d_yHJ!$pdA~5',duration*1000,clipTime].map(v=>`[${v}]`).join('')).digest('hex');
  const url=new URL(safeSite(String(d.reportUrl).replace(/\/$/,'')+'/'+encodeURIComponent(media.dtoken),cardUrl));
  const parts=String(a.otherInfo||'').split('&');
  url.search=new URLSearchParams({clazzId:String(d.clazzId),playingTime:String(seconds),duration:String(duration),clipTime,objectId,otherInfo:parts.shift(),jobid:String(a.jobid),userid:String(d.userid),isdrag:String(codes[event]),view:'pc',enc,rt:String(a.property?.rt||0.9),videoFaceCaptureEnc:a.videoFaceCaptureEnc||'',dtype:'Video',_t:String(now),attDuration:String(a.attDuration??0),attDurationEnc:a.attDurationEnc||'',courseEngineInfo:String(d.isEngineNode==='1')}).toString();
  for(const [k,v] of new URLSearchParams(parts.join('&')))if(!url.searchParams.has(k))url.searchParams.set(k,v);
  return url.href;
}
export function checkReport(body) {
  if(body?.videoTimeLimit===true||body?.hasJobLimit===true)throw problem('LIMIT','平台返回学习时长或任务限制，已停止。');
  if(typeof body?.isPassed!=='boolean')throw problem('FORMAT','上报响应不是已识别的学习状态。');
  return body;
}
export class Protocol {
  constructor(http,catalog){this.http=http;this.catalog=catalog;}
  async video(task,signal) {
    const ctx=await this.catalog.refresh(task,signal),a=ctx.attachment;
    if(a.isPassed===true)return {...ctx,passed:true};
    const objectId=a.objectId||a.property?.objectid;
    const status=new URL('/ananas/status/'+encodeURIComponent(objectId),ctx.url);
    const cookies=await this.http.jar.getCookies(ctx.url),fid=cookies.find(c=>c.key==='fid')?.value||'';
    status.search=new URLSearchParams({k:fid,flag:'normal',ro:'0'}).toString();
    const media=await this.http.json(status.href,{signal,referer:ctx.url,retryRead:true});
    if(media.status!=='success'||!media.dtoken||!(Number(media.duration)>0))throw problem('MEDIA','媒体状态未返回时长与任务令牌。');
    return {...ctx,media,cardUrl:ctx.url};
  }
  async report(ctx,seconds,event,signal){const url=reportUrl({...ctx,seconds,event});const result=checkReport(await this.http.json(url,{signal,referer:ctx.url}));await this.http.save();return result;}
  async document(task,ctx,signal){
    const a=ctx.attachment,d=ctx.config.defaults;
    if(Number(d.isFiled)===1||Number(d.state)===1)throw problem('ARCHIVED','课程已归档或停用。');
    if(!a.jobid||!a.jtoken||!d.knowledgeid||!d.courseid||!d.clazzId)throw problem('FORMAT','文档任务未提供完整的服务端任务令牌。');
    const url=new URL('/mooc-ans/job/document',ctx.url);
    url.search=new URLSearchParams({jobid:a.jobid,knowledgeid:String(d.knowledgeid),courseid:String(d.courseid),clazzid:String(d.clazzId),jtoken:a.jtoken,checkMicroTopic:'true',microTopicId:String(a.microTopicId??''),courseEngineInfo:String(d.isEngineNode==='1')}).toString();
    const result=await this.http.json(url.href,{signal,referer:ctx.url});
    if(result.status!==true)throw problem('NOT_PASSED','文档任务请求未被平台接受。');
    const refreshed=await this.catalog.refresh(task,signal);
    task.isPassed=taskPassed(refreshed.attachment,refreshed.config);
    task.status=task.isPassed?'completed':'unconfirmed';
    if(!task.isPassed)throw problem('NOT_PASSED','文档请求已返回，服务端任务卡片仍未确认完成。');
  }
}
