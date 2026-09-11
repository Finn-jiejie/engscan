'use strict';

/**
 * engscan — 纸质书英语拍照点读
 * 零依赖后端：静态托管 + /api/scan 转发到多模态大模型
 * 密钥只存在于服务端 .env，前端永远拿不到。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    // 只认 KEY=VALUE；自动跳过 `setx FOO "bar"` 这类带命令前缀的行
    const m = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/.exec(t);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadEnv();

const CFG = {
  baseUrl: (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
  apiKey: (process.env.QWEN_API_KEY || '').trim(),
  model: (process.env.QWEN_MODEL || 'qwen3.6-flash').trim(),
  port: Number(process.env.PORT || 4173),
  mock: process.env.MOCK === '1',
  timeoutMs: Number(process.env.TIMEOUT_MS || 90000),
  openBrowser: process.env.OPEN_BROWSER === '1',
};

/* ---------- 本地 OCR（PP-OCRv4，无需任何 key） ---------- */

let ocrEngine = null;
let ocrError = null;

async function initOCR() {
  try {
    // @gutenye/ocr-node 是 ESM 包，这里动态引入以兼容 CJS 主程序
    const mod = await import('@gutenye/ocr-node');
    const Ocr = mod.default || mod.Ocr;
    ocrEngine = await Ocr.create();
    console.log('本地 OCR（PP-OCRv4）就绪');
  } catch (e) {
    ocrError = e.message;
    console.error('OCR 引擎加载失败（/api/local-scan 将不可用）:', e.message);
  }
}

/* 结构化：OCR 行 → 例句 / 单词 / 其他（页眉页码等） */
const WORD_RE = /^([A-Za-z][A-Za-z'\-]{0,24})\s*(\/[^/]{1,40}\/)?\s*((?:adj|adv|n|v|vt|vi|prep|conj|pron|art|num|int|abbr|aux|modal)\.)\s*(.*)$/;

// OCR 常丢音标左斜杠（实测："surprise sa'pra1z/ n.惊讶"），补上再匹配
function repairMissingSlash(t) {
  return t.replace(
    /^([A-Za-z][A-Za-z'\-]{0,24}\s+)(?=[^/\s][^/]*\/\s*(?:adj|adv|n|v|vt|vi|prep|conj|pron)\.)/,
    '$1/'
  );
}

function structureLines(lines) {
  const sentences = [];
  const words = [];
  const others = [];
  let buf = '';

  const flush = () => {
    if (buf) {
      sentences.push({ text: buf.trim() });
      buf = '';
    }
  };

  const tryWord = (t, score) => {
    const m = WORD_RE.exec(t);
    if (!m) return false;
    flush();
    words.push({
      word: m[1].toLowerCase(),
      phonetic: (m[2] || '').trim(),
      meaning: `${m[3]} ${m[4]}`.trim(),
      score: typeof score === 'number' ? score : undefined,
    });
    return true;
  };

  for (const l of lines) {
    const t = String((l && l.text) || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;

    if (tryWord(t, l.score) || tryWord(repairMissingSlash(t), l.score)) continue;

    const wordCount = t.split(' ').length;
    const looksSentence = /[a-zA-Z]/.test(t) && (wordCount >= 5 || (buf !== '' && wordCount >= 1));
    if (looksSentence) {
      // 例句被 OCR 按视觉行切开：合并中的句子无条件吃掉后续短行，直到出现句尾标点
      buf = buf ? `${buf} ${t}` : t;
      if (/[.!?]["')\]]?$/.test(t)) flush();
      continue;
    }

    flush();
    others.push(t);
  }
  flush();

  // 二次拼配：OCR 行错位会把一条单词记录拆成相邻两行（如「realize /ri:alaiz/」+「v.意识到」），
  // 通用策略：相邻 1–2 行拼接后能命中单词结构就合并，拼不中的自然留在 others
  for (let i = 0; i < others.length - 1; i++) {
    for (let j = i + 1; j <= Math.min(i + 2, others.length - 1); j++) {
      if (tryWord(`${others[i]} ${others[j]}`)) {
        others.splice(j, 1);
        others.splice(i, 1);
        i--;
        break;
      }
    }
  }

  return { sentences, words, others };
}

/* 音标兜底：OCR 读不准 IPA（实测 0/6），可达时从免费词典取标准音标 */
let dictUnavailable = false;

async function enrichPhonetics(words) {
  if (dictUnavailable || !words.length) return;
  const tasks = words.map(async (w) => {
    const resp = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.word)}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!resp.ok) return;
    const j = await resp.json();
    const entry = Array.isArray(j) && j[0];
    if (!entry) return;
    const phon = entry.phonetic || ((entry.phonetics || []).find((p) => p && p.text) || {}).text;
    if (phon) w.phoneticDict = phon;
  });
  const results = await Promise.allSettled(tasks);
  // 全部因网络失败（非 404）时熔断，本进程内不再尝试，避免每次扫描都白等超时
  if (results.length && results.every((r) => r.status === 'rejected')) {
    dictUnavailable = true;
    console.log('词典音标源不可达，音标将使用 OCR 原文（已标注 ?）');
  }
}

const VLM_PROMPT = `You are an English learning assistant. Look at the photo of a printed English textbook page.

Extract:
1. "sentences": the complete English example sentences (完整例句), each as one clean string. Fix hyphenation at line breaks, remove page numbers and headers/footers. Max 12.
2. "words": the key vocabulary words (重点单词) shown on the page. For each, give "word" (the base/dictionary form), "phonetic" (IPA in slashes, best effort), "meaning" (brief Chinese 释义).

Reply with JSON only, no markdown fences, no extra text:
{"sentences":[{"text":"..."}],"words":[{"word":"...","phonetic":"...","meaning":"..."}]}

If the image contains no readable English, reply exactly: {"sentences":[],"words":[]}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 从模型输出里抠出 JSON，容忍 markdown 代码块与前后废话 */
function extractJSON(text) {
  if (typeof text !== 'string') return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced && fenced[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalize(data) {
  const sentences = Array.isArray(data && data.sentences) ? data.sentences : [];
  const words = Array.isArray(data && data.words) ? data.words : [];
  return {
    sentences: sentences
      .map((s) => (typeof s === 'string' ? s : s && s.text))
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => ({ text: t.replace(/\s+/g, ' ').trim() }))
      .slice(0, 20),
    words: words
      .map((w) => (typeof w === 'string' ? { word: w } : w))
      .filter((w) => w && typeof w.word === 'string' && w.word.trim())
      .map((w) => ({
        word: w.word.replace(/\s+/g, ' ').trim(),
        phonetic: typeof w.phonetic === 'string' ? w.phonetic.trim() : '',
        meaning: typeof w.meaning === 'string' ? w.meaning.trim() : '',
      }))
      .slice(0, 40),
  };
}

const MOCK_DATA = {
  sentences: [
    { text: 'She made a remarkable recovery after the operation.' },
    { text: 'It is worth considering the long-term impact of this decision.' },
  ],
  words: [
    { word: 'remarkable', phonetic: '/rɪˈmɑːkəbl/', meaning: 'adj. 非凡的；引人注目的' },
    { word: 'recovery', phonetic: '/rɪˈkʌvəri/', meaning: 'n. 恢复；痊愈' },
    { word: 'consider', phonetic: '/kənˈsɪdə(r)/', meaning: 'v. 考虑；认为' },
  ],
};

async function callVLM(imageDataUrl) {
  const url = `${CFG.baseUrl}/chat/completions`;
  const payload = {
    model: CFG.model,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: VLM_PROMPT },
        ],
      },
    ],
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CFG.timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CFG.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const raw = await resp.text();
    if (!resp.ok) {
      const err = new Error(`UPSTREAM_${resp.status}`);
      err.detail = raw.slice(0, 800);
      throw err;
    }
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error('UPSTREAM_BAD_JSON');
    }
    const content =
      json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.map((c) => (c && c.text) || '').join('')
      : '';
    const parsed = extractJSON(text);
    if (!parsed) {
      const err = new Error('PARSE_FAILED');
      err.detail = text.slice(0, 500);
      throw err;
    }
    return normalize(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJSON(res, 200, {
      hasKey: Boolean(CFG.apiKey),
      ocrReady: Boolean(ocrEngine),
      ocrError: ocrError || undefined,
      model: CFG.model,
      baseUrl: CFG.baseUrl,
      mock: CFG.mock,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/local-scan') {
    if (!ocrEngine) {
      return sendJSON(res, 503, { error: 'OCR_UNAVAILABLE', detail: ocrError || '引擎未就绪' });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJSON(res, 400, { error: e.message === 'PAYLOAD_TOO_LARGE' ? 'IMAGE_TOO_LARGE' : 'BAD_REQUEST' });
    }
    const image = typeof body.image === 'string' ? body.image : '';
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image);
    if (!m) return sendJSON(res, 400, { error: 'BAD_IMAGE' });

    try {
      const buf = Buffer.from(m[2], 'base64');
      const t0 = Date.now();
      const lines = await ocrEngine.detect(buf);
      const ocrMs = Date.now() - t0;

      const { sentences, words, others } = structureLines(lines);

      // 音标兜底走词典（异步并发，失败静默）
      await enrichPhonetics(words);

      return sendJSON(res, 200, {
        mode: 'local-ocr',
        ocrMs,
        sentences,
        words,
        others,
        raw: lines.map((l) => ({ text: l.text, score: l.score })),
      });
    } catch (e) {
      console.error('[local-scan] failed:', e.message);
      return sendJSON(res, 500, { error: 'OCR_FAILED', detail: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/scan') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJSON(res, 400, { error: e.message === 'PAYLOAD_TOO_LARGE' ? 'IMAGE_TOO_LARGE' : 'BAD_REQUEST' });
    }
    const image = typeof body.image === 'string' ? body.image : '';
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return sendJSON(res, 400, { error: 'BAD_IMAGE' });
    }

    if (CFG.mock || !CFG.apiKey) {
      return sendJSON(res, 200, { ...MOCK_DATA, mock: true, reason: CFG.mock ? 'MOCK_MODE' : 'NO_KEY' });
    }

    try {
      const result = await callVLM(image);
      return sendJSON(res, 200, { ...result, mock: false });
    } catch (e) {
      const code = e.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : e.message || 'UNKNOWN';
      console.error('[scan] failed:', code, e.detail || '');
      return sendJSON(res, 502, { error: code, detail: e.detail || '' });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);

  res.writeHead(405).end('Method Not Allowed');
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/** 双击启动时自动打开默认浏览器（Windows: start / macOS: open / Linux: xdg-open） */
function openBrowser(url) {
  const { spawn } = require('child_process');
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* 打不开就算了，用户自己点链接 */
  }
}

function banner(port) {
  console.log('\n  ┌────────────────────────────────────────┐');
  console.log('  │   拍照点读 · engscan 正在运行          │');
  console.log('  └────────────────────────────────────────┘\n');
  console.log(`  本机打开:  http://localhost:${port}`);
  const ips = lanAddresses();
  if (ips.length) {
    console.log('\n  手机打开（连同一个 WiFi）:');
    for (const ip of ips) console.log(`             http://${ip}:${port}`);
    console.log('\n  提示: 手机浏览器里「添加到主屏幕」，就像装了个 App。');
  }
  console.log(`\n  识别引擎:  本地 OCR ${ocrEngine ? '就绪' : '未就绪'}`);
  console.log(`  云端备用:  ${CFG.apiKey ? '已配置 ' + CFG.model : '未配置（手机网页版需在页面里填 Key）'}`);
  console.log('\n  关闭这个窗口即停止服务。\n');
}

initOCR();

/* 端口被占用时自动往后顺延，避免双击启动报错卡住 */
let tries = 0;
const MAX_TRIES = 10;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && tries < MAX_TRIES) {
    tries++;
    const next = CFG.port + tries;
    console.log(`端口 ${CFG.port + tries - 1} 已被占用，改用 ${next} …`);
    server.listen(next, '0.0.0.0');
    return;
  }
  console.error('启动失败：', err.message);
  process.exit(1);
});

server.on('listening', () => {
  const port = server.address().port;
  banner(port);
  if (CFG.openBrowser) openBrowser(`http://localhost:${port}`);
});

server.listen(CFG.port, '0.0.0.0');
