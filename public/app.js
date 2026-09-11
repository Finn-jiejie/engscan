'use strict';

/* engscan 前端
 * 双引擎：
 *   - 本地 OCR：走同源 Node 服务的 /api/local-scan（免费、快，但需要电脑开着）
 *   - 云端 VLM：浏览器直连服务商接口（手机可用，只存本地配置；CORS 已验证放行）
 * 自动模式下：能连上本地服务就用本地，否则用云端。
 */

const $ = (id) => document.getElementById(id);

const els = {
  file: $('file'),
  empty: $('empty'),
  preview: $('preview'),
  photo: $('photo'),
  result: $('result'),
  words: $('words'),
  sentences: $('sentences'),
  blockWords: $('blockWords'),
  blockSent: $('blockSent'),
  status: $('status'),
  settings: $('settings'),
  rate: $('rate'),
  rateVal: $('rateVal'),
  accent: $('accent'),
  engine: $('engine'),
  showZh: $('showZh'),
  srvMeta: $('srvMeta'),
  keyMeta: $('keyMeta'),
  provider: $('provider'),
  baseUrl: $('baseUrl'),
  model: $('model'),
  apiKey: $('apiKey'),
  engineHint: $('engineHint'),
  nowPlaying: $('nowPlaying'),
  btnInstall: $('btnInstall'),
};

/* ================= 工具 ================= */

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function setStatus(text, isErr) {
  els.status.textContent = text || '';
  els.status.className = 'status' + (isErr ? ' err' : '');
}

const ERROR_TEXT = {
  NO_KEY: '还没填云端 API Key，点右上角「设置」填一下',
  NO_ENGINE: '没有可用的识别引擎：开电脑用本地 OCR，或在设置里填云端 Key',
  OCR_UNAVAILABLE: '本地 OCR 引擎不可用，请重启服务查看日志',
  OCR_FAILED: '本地识别失败',
  BAD_IMAGE: '图片格式不支持',
  IMAGE_TOO_LARGE: '图片过大',
  UPSTREAM_TIMEOUT: '请求超时（模型排队或网络慢），稍后再试',
  UPSTREAM_BAD_JSON: '上游返回异常',
  PARSE_FAILED: '模型输出无法解析，换张更清晰的照片试试',
  BAD_REQUEST: '请求格式错误',
  NETWORK: '网络不通：检查手机网络，或该接口被网络环境拦截',
  UNAUTHORIZED: 'API Key 无效或已过期（401）',
  NOT_FOUND: '接口地址或模型名不对（404），检查设置里的地址与模型',
  RATE_LIMIT: '额度不足或请求过频（429）',
};

function errText(code) {
  if (!code) return '未知错误';
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (code.indexOf('UPSTREAM_') === 0) return '上游接口 ' + code.replace('UPSTREAM_', '');
  return code;
}

/* ================= 本地配置 ================= */

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, String(v));
    } catch {
      /* 隐私模式下静默失败 */
    }
  },
};

const prefs = {
  rate: parseFloat(store.get('rate', '0.85')) || 0.85,
  accent: store.get('accent', 'en-US') || 'en-US',
  engine: store.get('engine', 'auto') || 'auto',
  showZh: store.get('showZh', '1') === '1',
};

const cloud = {
  load() {
    try {
      const raw = store.get('cloud', '');
      if (!raw) return { provider: 'dashscope', baseUrl: '', model: '', apiKey: '' };
      const o = JSON.parse(raw);
      return {
        provider: o.provider || 'custom',
        baseUrl: o.baseUrl || '',
        model: o.model || '',
        apiKey: o.apiKey || '',
      };
    } catch {
      return { provider: 'custom', baseUrl: '', model: '', apiKey: '' };
    }
  },
  save(o) {
    store.set('cloud', JSON.stringify(o));
  },
};

const PROVIDERS = [
  { id: 'dashscope', name: '阿里百炼 · 通用', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-flash' },
  { id: 'ali-tp-cn', name: '阿里 Token Plan · 北京', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-flash' },
  { id: 'ali-tp-sg', name: '阿里 Token Plan · 新加坡', baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-flash' },
  { id: 'mimo', name: '小米 MiMo · 官方', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  { id: 'mimo-tp-cn', name: '小米 Token Plan · 国内', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  { id: 'mimo-tp-sg', name: '小米 Token Plan · 新加坡', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

function applyProvider(id, { keepFields } = {}) {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) return;
  if (!keepFields) {
    if (p.baseUrl) els.baseUrl.value = p.baseUrl;
    if (p.model) els.model.value = p.model;
  }
  els.provider.value = id;
}

/* ================= 环境探测 ================= */

let env = {
  probed: false,
  localServer: false,
  ocrReady: false,
  localStorage: '',
  serverKey: false,
  serverMock: false,
};

async function probeServer() {
  try {
    const r = await fetch('./api/config', { cache: 'no-store' });
    if (!r.ok) throw new Error('no server');
    const c = await r.json();
    env.localServer = true;
    env.ocrReady = Boolean(c.ocrReady);
    env.serverKey = Boolean(c.hasKey);
    env.serverMock = Boolean(c.mock);
    env.localNote = c.ocrReady ? '本地 OCR 就绪' : '本地 OCR 未就绪' + (c.ocrError ? '：' + c.ocrError : '');
  } catch {
    env.localServer = false;
    env.ocrReady = false;
  }
  env.probed = true;
}

function cloudReady() {
  const c = cloud.load();
  return Boolean(c.baseUrl && c.model && c.apiKey);
}

/** 实际要用的引擎 */
function activeEngine() {
  const want = prefs.engine;
  const canLocal = env.ocrReady;
  const canCloud = cloudReady();
  if (want === 'local') return canLocal ? 'local' : canCloud ? 'cloud' : 'none';
  if (want === 'cloud') return canCloud ? 'cloud' : canLocal ? 'local' : 'none';
  if (canLocal) return 'local';
  if (canCloud) return 'cloud';
  return 'none';
}

function renderStatusPanels() {
  const canLocal = env.ocrReady;
  const canCloud = cloudReady();
  const c = cloud.load();
  const eng = activeEngine();

  const localLine = env.localServer
    ? `<span class="dot ${canLocal ? '' : 'bad'}"></span>本地服务 <b>已连接</b>（${escapeHTML(env.localNote || '')}）`
    : `<span class="dot bad"></span>本地服务 <b>未连接</b>（当前是网页版，只能用云端）`;

  const cloudLine = canCloud
    ? `<span class="dot"></span>云端 API <b>已配置</b>（${escapeHTML(c.model)}）`
    : `<span class="dot bad"></span>云端 API <b>未配置</b>（手机用需要填 Key）`;

  const nowLine =
    eng === 'local'
      ? '当前使用：<b>本地 OCR</b>（免费）'
      : eng === 'cloud'
        ? '当前使用：<b>云端识别</b>'
        : '<b class="warn">当前没有可用引擎</b>：开电脑跑本地服务，或在下面填云端 Key';

  els.srvMeta.innerHTML = localLine + '<br>' + cloudLine + '<br>' + nowLine;

  if (eng === 'local') els.engineHint.innerHTML = '当前引擎：<b>本地 OCR</b>（免费 · 需电脑开着）';
  else if (eng === 'cloud') els.engineHint.innerHTML = '当前引擎：<b>云端 ' + escapeHTML(c.model) + '</b>';
  else els.engineHint.innerHTML = '点右上角「设置」配置云端 Key，或开着电脑用本地 OCR。';
}

/* ================= 设置界面 ================= */

els.rate.value = prefs.rate;
els.rateVal.textContent = prefs.rate.toFixed(2) + 'x';
els.accent.value = prefs.accent;
els.engine.value = prefs.engine;
els.showZh.checked = prefs.showZh;

els.rate.addEventListener('input', () => {
  prefs.rate = parseFloat(els.rate.value);
  els.rateVal.textContent = prefs.rate.toFixed(2) + 'x';
  store.set('rate', prefs.rate);
});

els.accent.addEventListener('change', () => {
  prefs.accent = els.accent.value;
  store.set('accent', prefs.accent);
});

els.engine.addEventListener('change', () => {
  prefs.engine = els.engine.value;
  store.set('engine', prefs.engine);
  renderStatusPanels();
});

els.showZh.addEventListener('change', () => {
  prefs.showZh = els.showZh.checked;
  store.set('showZh', prefs.showZh ? '1' : '0');
  refreshTranslationDisplay();
});

$('btnSettings').addEventListener('click', () => els.settings.classList.toggle('hidden'));

// 服务商下拉
PROVIDERS.forEach((p) => {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = p.name;
  els.provider.appendChild(o);
});

(function initCloudForm() {
  const c = cloud.load();
  els.provider.value = c.provider;
  els.baseUrl.value = c.baseUrl;
  els.model.value = c.model;
  els.apiKey.value = c.apiKey;
  if (c.apiKey) els.keyMeta.textContent = 'Key 已保存在本机浏览器（只显示状态，不回显内容）。';
})();

els.provider.addEventListener('change', () => {
  if (els.provider.value !== 'custom') applyProvider(els.provider.value);
});

[els.baseUrl, els.model].forEach((el) =>
  el.addEventListener('input', () => {
    // 手动改过地址或模型，就切成自定义，避免下次被预设覆盖
    const cur = PROVIDERS.find((p) => p.id === els.provider.value);
    if (cur && (cur.baseUrl !== els.baseUrl.value || cur.model !== els.model.value)) {
      els.provider.value = 'custom';
    }
  })
);

function saveCloud(quiet) {
  cloud.save({
    provider: els.provider.value,
    baseUrl: els.baseUrl.value.trim(),
    model: els.model.value.trim(),
    apiKey: els.apiKey.value.trim(),
  });
  renderStatusPanels();
  if (!quiet) {
    const c = cloud.load();
    els.keyMeta.textContent = c.apiKey
      ? '已保存到本机浏览器。手机端要在手机上再填一次（配置不跨设备同步）。'
      : '已保存。还没填 Key，云端识别不可用。';
  }
}

$('btnSaveKey').addEventListener('click', () => saveCloud(false));

// 填完自动保存，免得用户忘了点
[els.baseUrl, els.model, els.apiKey].forEach((el) => el.addEventListener('blur', () => saveCloud(true)));

$('btnTestKey').addEventListener('click', async () => {
  saveCloud(true);
  const c = cloud.load();
  if (!c.baseUrl || !c.model || !c.apiKey) {
    els.keyMeta.textContent = '地址、模型、Key 三项都要填才能测试。';
    return;
  }
  const btn = $('btnTestKey');
  btn.disabled = true;
  btn.textContent = '测试中…';
  els.keyMeta.textContent = '正在连 ' + c.baseUrl + ' …';
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(
      c.baseUrl.replace(/\/+$/, '') + '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
        body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'hi' }] }),
      },
      20000
    );
    const raw = await r.text();
    if (!r.ok) {
      els.keyMeta.textContent = '失败：' + errText(r.status === 401 ? 'UNAUTHORIZED' : r.status === 404 ? 'NOT_FOUND' : r.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_' + r.status) + '｜' + raw.slice(0, 160);
    } else {
      els.keyMeta.textContent = `连通正常（${((Date.now() - t0) / 1000).toFixed(1)}s）。注意：该模型必须支持图片输入才能做拍照识别。`;
    }
  } catch (e) {
    els.keyMeta.textContent = '失败：' + (e.name === 'AbortError' ? '超时' : errText('NETWORK')) + '｜' + String(e.message || '').slice(0, 120);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
});

/* ================= 图像采集 ================= */

let currentImage = null;
let currentData = null;

$('btnShoot').addEventListener('click', () => els.file.click());
$('btnRetake').addEventListener('click', () => els.file.click());

els.file.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await compress(file, 1500);
    currentImage = dataUrl;
    els.photo.src = dataUrl;
    els.empty.classList.add('hidden');
    els.settings.classList.add('hidden');
    els.preview.classList.remove('hidden');
    els.result.classList.add('hidden');
    setStatus('确认书页清晰后点「开始识别」。');
  } catch (err) {
    setStatus('图片处理失败：' + err.message, true);
  }
  els.file.value = '';
});

function compress(file, maxSide) {
  return new Promise((resolve, reject) => {
    const draw = (bmp) => {
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };

    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: 'from-image' }).then(draw).catch(fallback);
    } else {
      fallback();
    }

    function fallback() {
      const img = new Image();
      img.onload = () => draw(img);
      img.onerror = () => reject(new Error('无法读取图片'));
      img.src = URL.createObjectURL(file);
    }
  });
}

/* ================= 识别 ================= */

const VLM_PROMPT = `You are an English learning assistant. Look at the photo of a printed English textbook page.

Extract:
1. "sentences": the complete English example sentences (完整例句), each as one clean string. Fix hyphenation at line breaks, remove page numbers and headers/footers. Max 12.
2. "words": the key vocabulary words (重点单词) shown on the page. For each, give "word" (the base/dictionary form), "phonetic" (IPA in slashes, best effort), "meaning" (brief Chinese 释义).
3. For each sentence also give "zh": a natural, concise Chinese translation (中文翻译).

Reply with JSON only, no markdown fences, no extra text:
{"sentences":[{"text":"...","zh":"..."}],"words":[{"word":"...","phonetic":"...","meaning":"..."}]}

If the image contains no readable English, reply exactly: {"sentences":[],"words":[]}`;

function fetchWithTimeout(url, opts, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(timer));
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
      /* next */
    }
  }
  return null;
}

function normalize(data) {
  const sentences = Array.isArray(data && data.sentences) ? data.sentences : [];
  const words = Array.isArray(data && data.words) ? data.words : [];
  return {
    sentences: sentences
      .map((s) => (typeof s === 'string' ? { text: s } : s))
      .filter((s) => s && typeof s.text === 'string' && s.text.trim())
      .map((s) => ({
        text: s.text.replace(/\s+/g, ' ').trim(),
        zh: typeof s.zh === 'string' ? s.zh.trim() : '',
      }))
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

async function scanLocal(image) {
  const r = await fetchWithTimeout(
    './api/local-scan',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    },
    120000
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errText(data.error) + (data.detail ? '｜' + String(data.detail).slice(0, 160) : ''));
  return data;
}

async function scanCloud(image) {
  const c = cloud.load();
  if (!c.baseUrl || !c.model || !c.apiKey) throw new Error(errText('NO_KEY'));

  let r;
  try {
    r = await fetchWithTimeout(
      c.baseUrl.replace(/\/+$/, '') + '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
        body: JSON.stringify({
          model: c.model,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: image } },
                { type: 'text', text: VLM_PROMPT },
              ],
            },
          ],
        }),
      },
      90000
    );
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(errText('UPSTREAM_TIMEOUT'));
    throw new Error(errText('NETWORK') + '｜' + String(e.message || '').slice(0, 120));
  }

  const raw = await r.text();
  if (!r.ok) {
    const code = r.status === 401 ? 'UNAUTHORIZED' : r.status === 404 ? 'NOT_FOUND' : r.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_' + r.status;
    throw new Error(errText(code) + '｜' + raw.slice(0, 200));
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(errText('UPSTREAM_BAD_JSON'));
  }
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((x) => (x && x.text) || '').join('') : '';
  const parsed = extractJSON(text);
  if (!parsed) throw new Error(errText('PARSE_FAILED'));
  return { ...normalize(parsed), mode: 'cloud' };
}

$('btnScan').addEventListener('click', async () => {
  if (!currentImage) return;
  const eng = activeEngine();
  if (eng === 'none') {
    setStatus(errText('NO_ENGINE'), true);
    els.settings.classList.remove('hidden');
    return;
  }

  const btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = '识别中…';
  setStatus(eng === 'local' ? '本地识别中，通常 2–5 秒。' : '云端识别中，通常 5–20 秒。');

  const t0 = Date.now();
  try {
    const data = eng === 'local' ? await scanLocal(currentImage) : await scanCloud(currentImage);
    currentData = data;
    render(data);
    const n = (data.words || []).length + (data.sentences || []).length;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const tag = eng === 'local' ? '本地 OCR' : '云端 ' + cloud.load().model;
    setStatus(
      n === 0
        ? '没有识别到英文内容，换个光线好点的角度再拍一张。'
        : `识别完成（${tag} ${secs}s）：${(data.words || []).length} 个单词、${(data.sentences || []).length} 个例句。点文字可编辑，点圆形按钮朗读。`
    );
  } catch (err) {
    setStatus('识别失败：' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '开始识别';
  }
});

/* ================= 例句翻译（本地 OCR 后的补充能力） ================= */

async function translateSentences() {
  if (!currentData || !currentData.sentences.length) return;
  if (!cloudReady()) {
    setStatus('要翻译例句，先在设置里填云端 API Key。', true);
    return;
  }
  const btn = $('btnTranslate');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '翻译中…';
  }
  setStatus('正在翻译例句…');

  const c = cloud.load();
  const list = currentData.sentences.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
  const prompt = `把下面编号的英文句子逐条翻译成自然、简洁的中文，只输出译文，每行一条，保持原编号，不要额外说明：\n${list}`;

  try {
    const r = await fetchWithTimeout(
      c.baseUrl.replace(/\/+$/, '') + '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
        body: JSON.stringify({ model: c.model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
      },
      60000
    );
    const raw = await r.text();
    if (!r.ok) throw new Error(errText(r.status === 401 ? 'UNAUTHORIZED' : r.status === 404 ? 'NOT_FOUND' : r.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_' + r.status));
    const json = JSON.parse(raw);
    const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((x) => (x && x.text) || '').join('') : '';
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
      .filter(Boolean);
    currentData.sentences.forEach((s, i) => {
      if (lines[i]) s.zh = lines[i];
    });
    render(currentData);
    setStatus(`已翻译 ${Math.min(lines.length, currentData.sentences.length)} 条例句。`);
  } catch (e) {
    setStatus('翻译失败：' + (e.name === 'AbortError' ? '超时' : e.message), true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '翻译例句';
    }
  }
}

function refreshTranslationDisplay() {
  if (currentData) render(currentData);
}

/* ================= 渲染 ================= */

function render(data) {
  const words = data.words || [];
  const sentences = data.sentences || [];

  els.words.innerHTML = '';
  const phoneticOf = (w) => w.phoneticDict || w.phonetic || '';
  words.forEach((w, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = Math.min(i, 10) * 0.05 + 's';
    card.innerHTML =
      `<div class="body">` +
      `<div><span class="word" contenteditable="plaintext-only" data-k="word">${escapeHTML(w.word)}</span>` +
      (phoneticOf(w)
        ? `<span class="ph">${escapeHTML(phoneticOf(w))}${w.phoneticDict ? '' : '?'}</span>`
        : '') +
      `</div>` +
      `<div class="mean" contenteditable="plaintext-only" data-k="meaning">${escapeHTML(w.meaning || '（点此补充释义）')}</div>` +
      `</div>` +
      `<button class="save" data-save="${escapeHTML(w.word)}" title="收藏到生词本">＋</button>` +
      `<button class="play" title="朗读">▸</button>`;

    const target = card.querySelector('.word');
    card.querySelector('.play').addEventListener('click', () => speak(target.textContent.trim()));

    const saveBtn = card.querySelector('.save');
    Vocab.has(w.word.toLowerCase())
      .then((saved) => saveBtn.classList.toggle('saved', saved))
      .catch(() => {});
    saveBtn.addEventListener('click', async () => {
      try {
        const added = await Vocab.toggle({
          word: w.word.toLowerCase(),
          phonetic: phoneticOf(w),
          meaning: w.meaning || '',
        });
        saveBtn.classList.toggle('saved', added);
        setStatus(added ? `已收藏「${w.word}」到生词本。` : `已从生词本移除「${w.word}」。`);
        document.dispatchEvent(new CustomEvent('vocab-changed'));
      } catch {
        setStatus('生词本不可用（IndexedDB 被禁用？）', true);
      }
    });

    bindEdit(card, w);
    els.words.appendChild(card);
  });

  // 例句区标题栏（翻译按钮）
  const head = els.blockSent.querySelector('h2');
  const oldTools = els.blockSent.querySelector('.tools');
  if (oldTools) oldTools.remove();
  const hasZh = sentences.some((s) => s.zh);
  if (sentences.length && !hasZh && cloudReady()) {
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.innerHTML = '<button class="icon-btn" id="btnTranslate">翻译例句</button>';
    head.appendChild(tools);
    $('btnTranslate').addEventListener('click', translateSentences);
  }

  els.sentences.innerHTML = '';
  sentences.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = Math.min(i, 10) * 0.05 + 's';
    const zhOn = prefs.showZh && s.zh;
    card.innerHTML =
      `<div class="body"><span class="sent" contenteditable="plaintext-only" data-k="text">${escapeHTML(s.text)}</span>` +
      (zhOn ? `<div class="zh">${escapeHTML(s.zh)}</div>` : '') +
      `</div>` +
      `<button class="play" title="朗读">▸</button>`;

    const target = card.querySelector('.sent');
    card.querySelector('.play').addEventListener('click', () => speak(target.textContent.trim()));
    bindEdit(card, s);
    els.sentences.appendChild(card);
  });

  els.blockWords.style.display = words.length ? '' : 'none';
  els.blockSent.style.display = sentences.length ? '' : 'none';
  els.result.classList.remove('hidden');
}

function bindEdit(card, obj) {
  card.querySelectorAll('[contenteditable]').forEach((node) => {
    node.addEventListener('blur', () => {
      const key = node.dataset.k;
      const val = node.textContent.trim();
      if (key && val) obj[key] = val;
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        node.blur();
      }
    });
  });
}

/* ================= 朗读 ================= */

let voices = [];

function pickVoice() {
  if (!voices.length) return null;
  const want = prefs.accent;
  const exact = voices.find((v) => v.lang && v.lang.replace('_', '-') === want);
  if (exact) return exact;
  const prefix = want.slice(0, 2);
  return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix)) || null;
}

function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return;
  voices = speechSynthesis.getVoices() || [];
}

if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

function speak(text) {
  if (!text) return;
  if (typeof speechSynthesis === 'undefined') {
    setStatus('当前浏览器不支持朗读，请用 Chrome / Edge / Safari。', true);
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : prefs.accent;
  u.rate = prefs.rate;
  u.onstart = () => {
    els.nowPlaying.textContent = text.length > 28 ? text.slice(0, 28) + '…' : text;
  };
  u.onend = () => {
    els.nowPlaying.textContent = '就绪';
  };
  u.onerror = () => {
    els.nowPlaying.textContent = '朗读失败';
  };
  speechSynthesis.speak(u);
}

window.speak = speak;

$('btnStop').addEventListener('click', () => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  els.nowPlaying.textContent = '已停止';
});

/* ================= PWA ================= */

if ('serviceWorker' in navigator) {
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (secure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.btnInstall.classList.remove('hidden');
});

els.btnInstall.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.btnInstall.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  els.btnInstall.classList.add('hidden');
});

/* ================= 启动 ================= */

probeServer().then(() => {
  renderStatusPanels();
  // 没引擎时直接把设置打开，别让用户猜
  if (activeEngine() === 'none') {
    els.settings.classList.remove('hidden');
  }
});
