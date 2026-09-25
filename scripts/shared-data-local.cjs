'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const state=path.join(root,'.local','shared-data');
fs.mkdirSync(state,{recursive:true});
const pidFile=path.join(state,'pid');
if(process.argv[2]==='stop') {
 if(!fs.existsSync(pidFile))process.exit(0);
 const pid=Number(fs.readFileSync(pidFile,'utf8'));
 const cmd=fs.existsSync(`/proc/${pid}/cmdline`)?fs.readFileSync(`/proc/${pid}/cmdline`,'utf8'):'';
 if(cmd.includes(path.join(root,'adapter/server.cjs')))process.kill(pid,'SIGTERM');
 fs.unlinkSync(pidFile);process.exit(0);
}
if(fs.existsSync(pidFile)) {
 const pid=Number(fs.readFileSync(pidFile,'utf8'));
 try{process.kill(pid,0);console.log(`Already running: PID ${pid}`);process.exit(0);}catch{}
}
const log=fs.openSync(path.join(state,'server.log'),'a');
fs.cpSync(path.join(root,'frontend/src/resources'),path.join(root,'frontend/dist/mempool/browser/resources'),{recursive:true});
const child=spawn(process.execPath,[path.join(root,'adapter/server.cjs')],{cwd:root,detached:true,
 env:{...process.env,PORT:'4380',LTC_HOST:'127.0.0.1',LTC_SITE_ORIGIN:'http://127.0.0.1:4380',
  LTC_STATIC_ROOT:path.join(root,'frontend/dist/mempool/browser'),LTC_DATA_DIR:path.join(state,'data'),LTC_ROUTER_ORIGIN:'https://tx.taxi'},
 stdio:['ignore',log,log]});
fs.writeFileSync(pidFile,String(child.pid));child.unref();fs.closeSync(log);
console.log(`Started PID ${child.pid}: http://127.0.0.1:4380; log ${path.join(state,'server.log')}`);
