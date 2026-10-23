import {load} from 'cheerio';
import crypto from 'node:crypto';
import {safeSite} from './http.mjs';
import {problem,isSiteChallenge} from './catalog.mjs';
export class Challenge {
  constructor(http,catalog){this.http=http;this.catalog=catalog;this.image=null;this.context=null;}
  async view(signal,refresh=false){
    const context=this.catalog.challenge;
    if(!context)return {available:false};
    if(this.context===context&&this.image&&!refresh)return this.image;
    const $=load(context.html),form=$('form[action]').first();
    const action=safeSite(form.attr('action'),context.url);
    const onclick=$('#ccc').attr('onclick')||'';
    const source=$('#ccc').attr('src')||onclick.match(/this\.src\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if(!source||new URL(action).pathname!=='/html/processVerify.ac')throw problem('VERIFY_SITE','平台验证页面结构变化，当前无法在控制台展示。');
    const url=new URL(safeSite(source,context.url));url.searchParams.set('t',crypto.randomInt(2147483647));
    const {response}=await this.http.request(url.href,{signal,referer:context.url});const type=response.headers.get('content-type')?.split(';')[0];
    if(!['image/png','image/jpeg','image/gif'].includes(type))throw problem('VERIFY_SITE','验证码图片接口没有返回图片。');
    const bytes=Buffer.from(await response.arrayBuffer());this.context=context;this.image={available:true,image:`data:${type};base64,${bytes.toString('base64')}`};
    return this.image;
  }
  async submit(code,signal){
    if(!/^[0-9a-zA-Z]{4}$/.test(code))throw problem('VERIFY_SITE','请输入本人识别的 4 位验证码。');
    const context=this.catalog.challenge;if(!context)throw problem('VERIFY_SITE','当前没有待处理的平台验证。');
    const $=load(context.html),form=$('form[action]').first(),url=new URL(safeSite(form.attr('action'),context.url));
    if(url.pathname!=='/html/processVerify.ac')throw problem('VERIFY_SITE','未识别的平台验证提交地址。');
    form.find('input[type="hidden"][name]').each((_,n)=>url.searchParams.set($(n).attr('name'),$(n).val()||''));url.searchParams.set('ucode',code);
    // Only the value typed by the person is submitted, once. No OCR or guessing.
    const result=await this.http.text(url.href,{signal,referer:context.url,retryRead:false});this.image=null;this.context=null;
    if(isSiteChallenge(result)){this.catalog.challenge={...result,requestUrl:context.requestUrl};throw problem('VERIFY_SITE','验证码未通过，请刷新图片后由本人重新输入。');}
    await this.catalog.page(context.requestUrl,signal);this.catalog.challenge=null;await this.http.save();
  }
}
