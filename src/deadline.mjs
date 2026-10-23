// Bounds a discovery unit, even when a test double or upstream ignores cancellation.
export async function withDeadline(ms,parent,operation) {
  parent?.throwIfAborted();
  const controller=new AbortController();let timer,abort;
  const failed=new Promise((_,reject)=>{
    abort=()=>{const reason=parent?.reason||new DOMException('Stopped','AbortError');controller.abort(reason);reject(reason);};
    parent?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{const error=Object.assign(new Error(`读取超时（${ms/1000} 秒），已记录该项并继续队列。`),{code:'SCAN_TIMEOUT'});controller.abort(error);reject(error);},ms);
  });
  try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),failed]);}
  finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
}
