// 验证：选中"阿里 Token Plan"时是否给出明确警告
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJSON(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}});}).on('error',rej);});}
(async () => {
  const edge = spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir='+os.tmpdir()+'/edge-cdp-ph-'+Date.now(),'about:blank'],{stdio:'ignore'});
  let targets=null;
  for(let i=0;i<40;i++){try{targets=await getJSON('/json/list');break;}catch{await sleep(400);}}
  const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  let id=0;const pending=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(m,p)=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const evaluate=async(e,a=false)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:process.argv[2]});await sleep(3000);

  const out={};
  // 所有预设选项文案
  out.options=await evaluate(`Array.from(document.getElementById('provider').options).map(o=>o.text).join(' | ')`);
  // 默认（阿里百炼通用）时的提示
  await evaluate(`document.getElementById('provider').value='dashscope';document.getElementById('provider').dispatchEvent(new Event('change'));'ok'`);
  await sleep(300);
  out.hintNormal=await evaluate(`document.getElementById('keyMeta').textContent.trim().slice(0,60)`);
  // 切到阿里 Token Plan 北京
  await evaluate(`document.getElementById('provider').value='ali-tp-cn';document.getElementById('provider').dispatchEvent(new Event('change'));'ok'`);
  await sleep(300);
  out.hintBlocked=await evaluate(`document.getElementById('keyMeta').textContent.trim()`);
  out.baseUrlFilled=await evaluate(`document.getElementById('baseUrl').value`);
  // 切到小米
  await evaluate(`document.getElementById('provider').value='mimo-tp-cn';document.getElementById('provider').dispatchEvent(new Event('change'));'ok'`);
  await sleep(300);
  out.hintMimo=await evaluate(`document.getElementById('keyMeta').textContent.trim().slice(0,60)`);
  out.mimoUrl=await evaluate(`document.getElementById('baseUrl').value`);
  console.log(JSON.stringify(out,null,2));
  ws.close();edge.kill();process.exit(0);
})();
