import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Controller} from '../src/controller.mjs';
import {createApp} from './server.mjs';

// Production listens only on the fnOS Unix socket. Each authenticated NAS UID
// receives its own controller, CookieJar, encrypted session and progress files.
export function createFnosApp({directory,prefix='/app/chaoxing-study-native',controllerFactory}={}) {
  if(!directory)throw new Error('需要指定飞牛数据目录。');
  const sessions=new Map();let closing=false;
  async function session(uid,username){
    if(!sessions.has(uid)){
      const pending=(async()=>{const dir=path.join(directory,'users',uid);let controller;
        if(controllerFactory)controller=await controllerFactory(dir,uid);
        else{controller=new Controller(dir);await controller.load();}
        const user={uid,username:username||'',isolated:true};
        const csrfToken=randomBytes(32).toString('base64url'),snapshot=controller.snapshot.bind(controller);
        controller.snapshot=()=>({...snapshot(),csrfToken,gatewayUser:{...user}});
        const instance=await createApp({controller,frameAncestors:"'self'"});
        controller.login();return {...instance,csrfToken,user};
      })();sessions.set(uid,pending);pending.catch(()=>{if(sessions.get(uid)===pending)sessions.delete(uid);});
    }
    const instance=await sessions.get(uid);
    if(username)instance.user.username=username;
    return instance;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,error,code)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error,...(code?{code}:{})}));};
    try{
      if(closing)return send(503,'应用正在停止。');
      if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
      const uid=req.headers['x-trim-userid'];
      if(typeof uid!=='string'||!/^\d{1,10}$/.test(uid)||Number(uid)>4294967295)return send(401,'请从飞牛桌面登录后打开本应用。');
      if(req.headers['sec-fetch-site']==='cross-site')return send(403,'跨站请求已拦截，请从飞牛桌面的应用入口重新打开。','CROSS_SITE');
      if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return send(403,'页面来源无效，请重新打开应用。','ORIGIN');}
        if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)return send(403,'页面来源无效，请重新打开应用。','ORIGIN');}
      if(!['GET','HEAD','POST'].includes(req.method))return send(405,'该操作不受支持。');
      if(!req.url.startsWith('/')||req.url.startsWith('//'))return send(404,'入口不存在。');
      const url=new URL(req.url,'http://localhost');
      if(url.pathname===prefix){res.writeHead(308,{Location:prefix+'/'+url.search});res.end();return;}
      if(!url.pathname.startsWith(prefix+'/'))return send(404,'入口不存在。');
      // Identity comes only from the authenticated fnOS gateway, never a form,
      // query string or selected Chaoxing account. Username is display-only.
      let username=req.headers['x-trim-username'];
      if(typeof username==='string'){
        try{username=decodeURIComponent(username);}catch{}
        username=username.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80);
      }else username='';
      const instance=await session(uid,username);if(closing)return send(503,'应用正在停止。');
      // fnOS can rewrite Host to localhost or a socket upstream, with no forwarded
      // host. Keep the gateway UID boundary and validate a per-user page token
      // for mutations instead of comparing external Origin to that internal Host.
      if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,'需要 JSON 请求。');
        const token=req.headers['x-csrf-token'];
        if(typeof token!=='string'||!/^[-_a-zA-Z0-9]{43}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(instance.csrfToken)))return send(403,'页面验证已更新，请刷新应用页面后重试。','CSRF');
      }
      req.url=url.pathname.slice(prefix.length)+url.search;req.headers.host='localhost';delete req.headers.origin;
      instance.server.emit('request',req,res);
    }catch{if(!res.headersSent)send(503,'用户会话暂时无法打开，请查看应用日志或重新启动应用。');else res.end();}
  });
  return {server,sessions,async close(){if(closing)return;closing=true;const stopped=new Promise(resolve=>server.close(()=>resolve()));
    const values=await Promise.allSettled([...sessions.values()]);await Promise.all(values.filter(v=>v.status==='fulfilled').map(v=>v.value.close()));await stopped;}};
}

export async function prepareSocket(socketPath){
  try{const info=await fs.lstat(socketPath);if(!info.isSocket())throw new Error('Socket 路径已被其他文件占用。');}
  catch(e){if(e.code==='ENOENT')return;throw e;}
  await new Promise((resolve,reject)=>{const client=net.createConnection(socketPath);client.setTimeout(1000);
    client.once('connect',()=>{client.destroy();reject(new Error('应用 Socket 已由其他进程监听。'));});
    client.once('timeout',()=>{client.destroy();reject(new Error('无法确认旧 Socket 状态，未删除。'));});
    client.once('error',e=>{client.destroy();if(['ECONNREFUSED','ENOENT'].includes(e.code))resolve();else reject(e);});});
  await fs.unlink(socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  const socket=arg('--socket'),directory=arg('--data-dir');if(!socket||!directory)throw new Error('需要 --socket 和 --data-dir。');
  await prepareSocket(socket);const instance=createFnosApp({directory:path.resolve(directory)});
  await new Promise((resolve,reject)=>{instance.server.once('error',reject);instance.server.listen(socket,resolve);});
  console.log('飞牛原生服务已启动，通过飞牛桌面进入；首次由本人扫码。');
  let stopping=false;for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>process.exit(1),20000);deadline.unref();try{await instance.close();process.exit(0);}catch{process.exit(1);}});
}
