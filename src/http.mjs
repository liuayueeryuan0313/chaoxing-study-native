import { CookieJar } from 'tough-cookie';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export function safeSite(input, base) {
  const url = new URL(input, base);
  if (url.protocol === 'http:' && /(^|\.)chaoxing\.com$/.test(url.hostname)) url.protocol = 'https:';
  if (url.protocol !== 'https:' || !/(^|\.)chaoxing\.com$/.test(url.hostname)) throw Object.assign(new Error('拒绝非平台 HTTPS 地址。'), {code:'ORIGIN'});
  return url.href;
}
export class PlatformHttp {
  constructor({directory,timeoutMs=90000,fetchImpl=fetch,requestGapMs=500}={}) {
    this.directory=directory;this.timeoutMs=timeoutMs;this.fetchImpl=fetchImpl;this.jar=new CookieJar();this.queue=Promise.resolve();this.requestGapMs=requestGapMs;this.nextRequestAt=0;this.pacing=Promise.resolve();
  }
  async pace(signal){const previous=this.pacing;let release;this.pacing=new Promise(r=>release=r);try{await previous;signal.throwIfAborted();const wait=Math.max(0,this.nextRequestAt-Date.now());if(wait)await delay(wait,undefined,{signal});this.nextRequestAt=Date.now()+this.requestGapMs;}finally{release();}}
  async load() {
    if(!this.directory)return;
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    try { this.key=await fs.readFile(path.join(this.directory,'session.key')); }
    catch(e){if(e.code!=='ENOENT')throw e;this.key=crypto.randomBytes(32);await fs.writeFile(path.join(this.directory,'session.key'),this.key,{mode:0o600,flag:'wx'});}
    try {const packed=await fs.readFile(path.join(this.directory,'session.enc'));const decipher=crypto.createDecipheriv('aes-256-gcm',this.key,packed.subarray(0,12));decipher.setAuthTag(packed.subarray(12,28));const plain=Buffer.concat([decipher.update(packed.subarray(28)),decipher.final()]);this.jar=CookieJar.fromJSON(JSON.parse(plain.toString()));}
    catch(e){if(e.code!=='ENOENT')throw Object.assign(new Error('本机会话文件无法解密；原文件已保留。'),{code:'SESSION'});}
  }
  async save() {
    if(!this.directory)return;
    const plain=JSON.stringify(this.jar.serializeSync());
    const job=this.queue.then(async()=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);const tmp=path.join(this.directory,'session.enc.tmp');await fs.writeFile(tmp,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});await fs.rename(tmp,path.join(this.directory,'session.enc'));});this.queue=job.catch(()=>{});await job;
  }
  async request(input,{method='GET',body,referer,signal,headers={},allowRedirect=true,retryRead=false,...rest}={}) {
    let url=safeSite(input),previous=referer;
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    for(let hop=0;hop<12;hop++){
      const cookie=await this.jar.getCookieString(url);
      let response;
      for(let attempt=0;attempt<(retryRead?3:1);attempt++){
        try{await this.pace(combined);response=await this.fetchImpl(url,{...rest,method,body,redirect:'manual',signal:combined,
          headers:{'User-Agent':'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36','Accept-Language':'zh-CN,zh;q=0.9',...(previous?{Referer:previous}:{}),...(cookie?{Cookie:cookie}:{}),...headers}});break;}
        catch(e){if(combined.aborted||!retryRead||attempt===2)throw e;await delay(750*(attempt+1),undefined,{signal:combined});}
      }
      for(const value of response.headers.getSetCookie())await this.jar.setCookie(value,url,{ignoreError:true});
      if([301,302,303,307,308].includes(response.status)&&response.headers.get('location')&&allowRedirect){
        const next=safeSite(response.headers.get('location'),url);await response.body?.cancel();previous=url;url=next;
        if(response.status===303||([301,302].includes(response.status)&&method==='POST')){method='GET';body=undefined;}
        continue;
      }
      if(!response.ok){await response.body?.cancel();throw Object.assign(new Error(`平台请求返回 HTTP ${response.status}。`),{code:response.status===401?'AUTH':response.status===403?'LIMIT':'HTTP'});}
      return {response,url};
    }
    throw Object.assign(new Error('平台跳转次数过多。'),{code:'REDIRECT'});
  }
  async text(url,options){const r=await this.request(url,{retryRead:true,...options});return {url:r.url,html:await r.response.text()};}
  async json(url,options){const r=await this.request(url,options),raw=await r.response.text();
    if(/antispiderShowVerify\.ac/.test(new URL(r.url).pathname)||/[【\[]9010[】\]].{0,30}操作异常/.test(raw)){
      this.onChallenge?.({url:r.url,html:raw,requestUrl:safeSite(url)});
      throw Object.assign(new Error('超星返回 9010 图片验证，请本人输入验证码，通过后将从原位置继续。'),{code:'VERIFY_SITE'});
    }
    return JSON.parse(raw);
  }
  async form(url,values,options={}){return this.json(url,{...options,method:'POST',body:new URLSearchParams(values),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',...options.headers}});}
}
