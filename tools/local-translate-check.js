// 验证：本地 OCR 模式 + 已配置云端 → 应出现「翻译例句」按钮；生词本应可用
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJSON(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}});}).on('error',rej);});}
(async () => {
  const edge = spawn(EDGE,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir='+os.tmpdir()+'/edge-cdp-lt','about:blank'],{stdio:'ignore'});
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
  // 配置：本地引擎 + 云端也配上（用于翻译）
  await evaluate(`localStorage.setItem('cloud',JSON.stringify({provider:'custom',baseUrl:'http://127.0.0.1:4199/v1',model:'mock-vl',apiKey:'sk-test-12345'}));localStorage.setItem('engine','local');'ok'`);
  await send('Page.reload');await sleep(3000);
  const out={};
  out.engine=evaluate(`document.getElementById('engineHint').textContent.trim()`);
  out.engine=await out.engine;
  // 用真实书页跑本地 OCR
  const fs=require('fs');
  const img=fs.readFileSync('../p0-test/page-clean.png').toString('base64');
  await evaluate(`currentImage='data:image/png;base64,${img}';document.getElementById('btnScan').click();'go'`);
  await sleep(14000);
  out.status=await evaluate(`document.getElementById('status').textContent.trim()`);
  out.words=await evaluate(`document.querySelectorAll('#words .card').length`);
  out.sents=await evaluate(`document.querySelectorAll('#sentences .card').length`);
  out.translateBtn=await evaluate(`!!document.getElementById('btnTranslate')`);
  // 生词本：收藏第一个词
  out.saveBtn=await evaluate(`!!document.querySelector('#words .save')`);
  await evaluate(`document.querySelector('#words .save').click();'clicked'`);
  await sleep(1200);
  out.savedClass=await evaluate(`document.querySelector('#words .save').classList.contains('saved')`);
  out.badge=await evaluate(`(function(){const b=document.getElementById('vocabBadge');return b.hidden?'hidden':b.textContent})()`);
  console.log(JSON.stringify(out,null,2));
  ws.close();edge.kill();process.exit(0);
})();
