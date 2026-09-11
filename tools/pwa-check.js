// 通过 CDP 直接驱动 Edge，验证 PWA 真实能力（SW 注册 / manifest / 引擎探测）
const { spawn } = require('child_process');
const http = require('http');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:4173/';
const PORT = 9333;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + require('os').tmpdir() + '/edge-cdp-engscan',
    'about:blank',
  ], { stdio: 'ignore' });

  // 等 CDP 就绪
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await getJSON('/json/list'); break; } catch { await sleep(400); }
  }
  if (!targets) { console.error('CDP 未就绪'); edge.kill(); process.exit(1); }

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });

  await new Promise((r) => ws.addEventListener('open', r));

  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  const evaluate = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(4000);

  const out = {};

  out.title = await evaluate('document.title');

  // 1. Service Worker 注册
  out.swRegistered = await evaluate(
    `navigator.serviceWorker.getRegistration().then(r => r ? { scope: r.scope, active: !!(r.active||r.installing||r.waiting) } : null)`,
    true
  );

  // 2. manifest
  out.manifest = await evaluate(
    `fetch('./manifest.webmanifest').then(r=>r.json()).then(m=>({name:m.name, display:m.display, icons:m.icons.length, start:m.start_url})).catch(e=>'ERR:'+e.message)`,
    true
  );

  // 3. 引擎探测
  out.engineHint = await evaluate(`document.getElementById('engineHint').textContent.trim()`);
  out.srvMeta = await evaluate(`document.getElementById('srvMeta').textContent.trim()`);
  out.providerOptions = await evaluate(`document.getElementById('provider').options.length`);

  // 4. 图标可达
  out.iconStatus = await evaluate(
    `Promise.all(['./icon-192.png','./icon-512.png','./apple-touch-icon.png'].map(u=>fetch(u).then(r=>u+':'+r.status))).then(a=>a.join(' | '))`,
    true
  );

  // 5. 本地 OCR 通道连通（发一张极小图，看是否返回结构而非崩溃）
  if (URL_UNDER_TEST.includes('4173')) {
    out.localScanReachable = await evaluate(
      `fetch('./api/local-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='})}).then(r=>r.json()).then(j=>json=>j).then(j=>j.mode?('OK mode='+j.mode):('ERR '+(j.error||'?'))).catch(e=>'FETCH_ERR:'+e.message)`,
      true
    );
  }

  console.log(JSON.stringify(out, null, 2));

  ws.close();
  edge.kill();
  process.exit(0);
})();
