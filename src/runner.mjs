import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { problem } from './catalog.mjs';

// A local clock is an estimate. Only a fresh card response can mark a task complete.
export class Runner {
  constructor(protocol,{tickMs=1000,now=()=>performance.now(),sleep=delay}={}){this.protocol=protocol;this.tickMs=tickMs;this.now=now;this.sleep=sleep;this.paused=false;}
  pause(){this.paused=true;}
  resume(){this.paused=false;}
  async video(task,{signal,rate=2,update=()=>{}}={}) {
    let ctx,seconds=0,duration=0;
    try {
    ctx=await this.protocol.video(task,signal);
    if(ctx.passed){task.isPassed=true;task.status='completed';update(task);return;}
    const a=ctx.attachment,d=ctx.config.defaults;duration=Number(ctx.media.duration);
    const saved=a.playTime==null?0:Number(a.playTime)/1000;
    seconds=Math.max(0,Math.min(duration,Number.isFinite(saved)?saved:0));
    // Unpassed end offsets can result from earlier seeks, and are not proof of completion.
    if(seconds>=duration)seconds=0;
    const speed=String(a.property?.doublespeed??d.doublespeed)==='0'?1:rate;
    const interval=Number(d.reportTimeInterval)>0?Number(d.reportTimeInterval)*1000:60000;
    task.durationSeconds=duration;task.status='running';task.rate=speed;task.serverSeconds=saved;
    let last=this.now(),lastReport=last,wasPaused=false;
    await this.protocol.report(ctx,Math.floor(seconds),'play',signal);
    last=this.now();lastReport=last;
    while(seconds<duration) {
      await this.sleep(this.tickMs,undefined,{signal});
      const now=this.now(),elapsed=Math.min(now-last,this.tickMs*2);last=now;
      if(this.paused){if(!wasPaused){await this.protocol.report(ctx,Math.floor(seconds),'pause',signal);task.status='paused';wasPaused=true;update(task);}continue;}
      if(wasPaused){await this.protocol.report(ctx,Math.floor(seconds),'play',signal);last=this.now();lastReport=last;wasPaused=false;task.status='running';}
      else seconds=Math.min(duration,seconds+elapsed/1000*speed);
      task.estimatedSeconds=seconds;update(task);
      if(now-lastReport>=interval||seconds>=duration){const result=await this.protocol.report(ctx,Math.floor(seconds),seconds>=duration?'ended':'playing',signal);lastReport=this.now();task.reportedSeconds=Math.floor(seconds);update(task);
        if(result.isPassed||seconds>=duration){const current=await this.protocol.catalog.refresh(task,signal);task.isPassed=current.attachment.isPassed===true;task.serverSeconds=current.attachment.playTime==null?null:Number(current.attachment.playTime)/1000;if(task.isPassed){task.status='completed';update(task);return;}}
      }
    }
    task.status='unconfirmed';update(task);throw problem('NOT_PASSED','时间线上报结束，服务端尚未确认完成；已停止，避免重复空刷。');
    } catch(e) {
      if(signal?.aborted){task.status='stopped';if(ctx?.media&&seconds<duration)try{await this.protocol.report(ctx,Math.floor(seconds),'pause',AbortSignal.timeout(10000));task.reportedSeconds=Math.floor(seconds);}catch{}}
      else if(e.code!=='NOT_PASSED'||task.status!=='unconfirmed')task.status='failed';
      update(task);
      throw e;
    }
  }
}
