import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Controller } from '../src/controller.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export async function createApp({directory=path.resolve(here,'../.runtime'),controller,frameAncestors="'none'"}={}) {
  const app=controller||new Controller(directory);if(!controller)await app.load();
  const peers=new Set(),flow=new WeakMap();
  function push(peer,chunk){const state=flow.get(peer);if(!state||peer.destroyed)return;if(state.blocked){state.pending=chunk;return;}state.blocked=!peer.write(chunk);}
  const listener=s=>{const chunk=`data: ${JSON.stringify(s)}\n\n`;for(const peer of peers)push(peer,chunk);};app.on('snapshot',listener);
  const heartbeat=setInterval(()=>{for(const p of peers)if(!flow.get(p)?.blocked)p.write(': keepalive\n\n');},15000);heartbeat.unref();
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||''))return send(403,{error:'本地访问入口不匹配。'});
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'拒绝跨站请求。'});
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(req.method==='GET'&&url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});flow.set(res,{blocked:false,pending:null});peers.add(res);res.on('drain',()=>{const state=flow.get(res);state.blocked=false;if(state.pending){const chunk=state.pending;state.pending=null;push(res,chunk);}});push(res,`data: ${JSON.stringify(app.snapshot())}\n\n`);res.on('close',()=>peers.delete(res));return;}
      if(req.method==='GET'&&url.pathname==='/api/status')return send(200,app.snapshot());
      if(req.method==='GET'&&url.pathname==='/api/qr')return send(200,app.auth.capture());
      if(req.method==='GET'&&url.pathname==='/api/verification')return send(200,await app.verificationView(url.searchParams.get('refresh')==='1'));
      if(req.method==='POST'&&url.pathname.startsWith('/api/')){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要 JSON 请求。'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)throw new Error('请求过大');}const body=JSON.parse(raw||'{}');let value;
        if(url.pathname==='/api/login')value=app.login();
        else if(url.pathname==='/api/verification')value=app.verify(body.code);
        else if(url.pathname==='/api/scan')value=app.scan(body.keys,{resume:body.resume??true});
        else if(url.pathname==='/api/run')value=app.run(body.keys,body.rate??2,body.taskKeys,body.maxTasks,body.studyMode??body.mode??'all');
        else if(url.pathname==='/api/select'){if(app.busy)throw Object.assign(new Error('已有操作正在执行。'),{code:'BUSY'});app.select(body.keys);await app.save();app.publish();value={ok:true};}
        else if(url.pathname==='/api/pause')value=app.pause();
        else if(url.pathname==='/api/resume')value=app.resume();
        else if(url.pathname==='/api/stop')value=app.stop();
        else return send(404,{error:'接口不存在。'});
        return send(value?.accepted?202:200,value||{ok:true});
      }
      const assets={'/':['index.html','text/html; charset=utf-8'],'/icon-64.png':['icon-64.png','image/png'],'/icon-256.png':['icon-256.png','image/png'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/native-client.js':['native-client.js','text/javascript; charset=utf-8'],'/login.js':['login.js','text/javascript; charset=utf-8'],'/verification.js':['verification.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};const asset=assets[url.pathname];
      if(req.method!=='GET'||!asset)return send(404,{error:'页面不存在。'});
      res.setHeader('Content-Security-Policy',`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors ${frameAncestors}; base-uri 'none'`);res.writeHead(200,{'Content-Type':asset[1]});res.end(await fs.readFile(path.join(here,asset[0])));
    }catch(e){if(!res.headersSent)send(400,{code:e.code||'ERROR',error:e.code?e.message:'请求处理失败。'});else res.end();}
  });
  return {server,app,close:async()=>{clearInterval(heartbeat);app.off('snapshot',listener);for(const p of peers)p.end();await app.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const portIndex=process.argv.indexOf('--port'),port=portIndex<0?3001:Number(process.argv[portIndex+1]);
  const dataIndex=process.argv.indexOf('--data-dir'),directory=dataIndex<0?undefined:path.resolve(process.argv[dataIndex+1]);
  const instance=await createApp({directory});await new Promise((resolve,reject)=>{instance.server.once('error',reject);instance.server.listen(port,'127.0.0.1',resolve);});
  console.log(`超星无浏览器试验版：http://127.0.0.1:${port}/`);
  instance.app.login();
  for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{await instance.close();process.exit(0);});
}
