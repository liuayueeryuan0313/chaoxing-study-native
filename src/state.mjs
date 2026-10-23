import fs from 'node:fs/promises';
import path from 'node:path';
export class State {
  constructor(directory){this.directory=directory;this.data={schemaVersion:1,courses:[],selected:[],logs:[]};this.queue=Promise.resolve();}
  async load(){await fs.mkdir(this.directory,{recursive:true,mode:0o700});try{this.data=JSON.parse(await fs.readFile(path.join(this.directory,'progress.json'),'utf8'));if(this.data.schemaVersion!==1||!Array.isArray(this.data.courses))throw new Error('状态结构错误');}catch(e){if(e.code!=='ENOENT')throw e;}}
  async save(){const content=JSON.stringify(this.data);const job=this.queue.then(async()=>{const file=path.join(this.directory,'progress.json');await fs.writeFile(file+'.tmp',content,{mode:0o600});await fs.rename(file+'.tmp',file);});this.queue=job.catch(()=>{});await job;}
}
