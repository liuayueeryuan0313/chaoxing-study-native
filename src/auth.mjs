import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';
import { safeSite } from './http.mjs';
export class QrAuth {
  constructor(http){this.http=http;this.qr=null;this.view=null;}
  async create(signal){
    const page=await this.http.text('https://passport2.chaoxing.com/login',{signal});const $=load(page.html);
    const uuid=$('#uuid').val(),enc=$('#enc').val(),src=$('#quickCode').attr('src');
    if(!uuid||!enc||!src)throw Object.assign(new Error('登录页未提供可识别的扫码参数。'),{code:'QR'});
    this.qr={uuid,enc,doubleFactorLogin:$('#doubleFactorLogin').val()||'0',forbidotherlogin:$('#forbidotherlogin').val()||'0',createdAt:Date.now(),polls:0};
    const image=await this.http.request(safeSite(src,page.url),{signal,referer:page.url});
    const type=image.response.headers.get('content-type')?.split(';')[0];
    if(!['image/png','image/jpeg','image/gif'].includes(type))throw Object.assign(new Error('二维码接口没有返回图片。'),{code:'QR'});
    const bytes=Buffer.from(await image.response.arrayBuffer());
    this.view={available:true,id:'native-qr',kind:'qr',width:180,height:180,image:`data:${type};base64,${bytes.toString('base64')}`};
    return this.view;
  }
  async poll(signal){
    if(!this.qr||this.qr.polls>=49){await this.create(signal);return {state:'refreshed'};}
    this.qr.polls++;
    const {uuid,enc,doubleFactorLogin,forbidotherlogin}=this.qr;
    const result=await this.http.form('https://passport2.chaoxing.com/getauthstatus/v2',{uuid,enc,doubleFactorLogin,forbidotherlogin},{signal,referer:'https://passport2.chaoxing.com/login'});
    if(result.status){
      if(result.containTwoFactorLogin)throw Object.assign(new Error('平台要求本人二次验证，当前任务已停止；不会绕过验证。'),{code:'AUTH_VERIFY'});
      await this.http.text('https://i.chaoxing.com/base',{signal});await this.http.save();this.view=null;return {state:'confirmed'};
    }
    if(result.type===6||result.type===7){await this.create(signal);return {state:'refreshed'};}
    return {state:result.type===4?'confirm_on_phone':'waiting'};
  }
  async wait(check,signal,timeoutMs=600000,emit=()=>{}){
    const ready=await check();if(ready)return ready;
    await this.create(signal);emit('login',{message:'请在学习通 App 扫描二维码并确认。运行器未启动浏览器。'});
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){await delay(3000,undefined,{signal});const result=await this.poll(signal);if(result.state==='confirmed'){const verified=await check();if(!verified)throw Object.assign(new Error('扫码已确认，但受保护课程页面仍不可访问。'),{code:'AUTH'});return verified;}if(result.state==='confirm_on_phone')emit('login-confirm',{message:'已扫码，请在手机上确认。'});}
    this.view=null;throw Object.assign(new Error('扫码等待超时。'),{code:'AUTH_TIMEOUT'});
  }
  capture(){return this.view||{available:false};}
}
