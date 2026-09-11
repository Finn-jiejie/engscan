const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const TARGET = 'file:///' + process.argv[2].replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function getJSON(p) { return new Promise((res, rej) => { http.get({host:'127.0.0.1',port:PORT,path:p}, r => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}}); }).on('error',rej); }); }
(async () => {
  const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir='+os.tmpdir()+'/edge-cdp-file','about:blank'], {stdio:'ignore'});
  let targets=null;
  for (let i=0;i<40;i++){ try{targets=await getJSON('/json/list');break;}catch{await sleep(400);} }
  if(!targets){console.error('CDP 未就绪');edge.kill();process.exit(1);}
  const ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params)=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  const evaluate=async(expr,awaitP=false)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:awaitP,returnByValue:true}); return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:TARGET}); await sleep(4500);
  console.log(JSON.stringify({
    title: await evaluate('document.title'),
    engineHint: await evaluate(`document.getElementById('engineHint').textContent.trim()`),
    srvMeta: await evaluate(`document.getElementById('srvMeta').textContent.trim()`),
    providerOptions: await evaluate(`document.getElementById('provider').options.length`),
    vocabLoaded: await evaluate('typeof Vocab !== "undefined"'),
    appLoaded: await evaluate('typeof activeEngine === "function"'),
    localStorageOK: await evaluate('(function(){try{localStorage.setItem("t","1");return localStorage.getItem("t")==="1"}catch(e){return "ERR:"+e.name}})()'),
    indexedDBOK: await evaluate('typeof indexedDB !== "undefined"'),
    settingsAutoOpen: await evaluate(`!document.getElementById('settings').classList.contains('hidden')`),
  }, null, 2));
  ws.close(); edge.kill(); process.exit(0);
})();
