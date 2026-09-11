// 端到端验证「浏览器直连云端 API」这条链路：
// 在页面里配置一个假的服务商地址 → 存 localStorage → 触发扫描 → 检查渲染结果
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const target = process.argv[2];
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + os.tmpdir() + '/edge-cdp-e2e', 'about:blank'], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await getJSON('/json/list'); break; } catch { await sleep(400); } }
  if (!targets) { console.error('CDP 未就绪'); edge.kill(); process.exit(1); }

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr, awaitP = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'EXC: ' + r.result.exceptionDetails.text;
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: target });
  await sleep(3500);

  const out = {};

  // 1. 写入云端配置（指向本机假 API）
  out.writeConfig = await evaluate(`
    (function(){
      localStorage.setItem('cloud', JSON.stringify({
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:4199/v1',
        model: 'mock-vl',
        apiKey: 'sk-test-12345'
      }));
      localStorage.setItem('engine', 'cloud');
      return 'set';
    })()
  `);

  // 2. 重新加载让配置生效
  await send('Page.reload');
  await sleep(3500);

  out.engineHintAfter = await evaluate(`document.getElementById('engineHint').textContent.trim()`);
  out.srvMetaAfter = await evaluate(`document.getElementById('srvMeta').textContent.trim()`);

  // 3. 触发一次真实扫描（注入一张 1x1 图，走完整 fetch → 渲染链路）
  out.scan = await evaluate(`
    (function(){
      const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      // 直接调用内部扫描入口：模拟 currentImage 已就绪
      currentImage = img;
      document.getElementById('btnScan').click();
      return 'clicked';
    })()
  `);

  await sleep(4000);

  out.status = await evaluate(`document.getElementById('status').textContent.trim()`);
  out.wordCards = await evaluate(`document.querySelectorAll('#words .card').length`);
  out.sentCards = await evaluate(`document.querySelectorAll('#sentences .card').length`);
  out.firstWord = await evaluate(`document.querySelector('#words .word') ? document.querySelector('#words .word').textContent : null`);
  out.firstMeaning = await evaluate(`document.querySelector('#words .mean') ? document.querySelector('#words .mean').textContent : null`);
  out.firstSentence = await evaluate(`document.querySelector('#sentences .sent') ? document.querySelector('#sentences .sent').textContent : null`);
  out.firstZh = await evaluate(`document.querySelector('#sentences .zh') ? document.querySelector('#sentences .zh').textContent : null`);
  out.translateBtn = await evaluate(`!!document.getElementById('btnTranslate')`);

  // 4. 确认服务端确实收到了 Authorization 头（证明 key 从浏览器直接发出）
  out.mockApiState = await new Promise((res) => {
    http.get({ host: '127.0.0.1', port: 4199, path: '/__state' }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
    }).on('error', (e) => res('ERR ' + e.message));
  });

  console.log(JSON.stringify(out, null, 2));
  ws.close();
  edge.kill();
  process.exit(0);
})();
