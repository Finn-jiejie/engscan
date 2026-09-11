// 假的 OpenAI 兼容接口，用来端到端验证「浏览器直连云端」这条链路
// 只在本机跑，返回固定的结构化 JSON，不发任何真实请求
const http = require('http');

const PORT = 4199;
let lastAuth = null;
let lastModel = null;

const REPLY = {
  sentences: [
    { text: 'She made a remarkable recovery after the operation.', zh: '手术后她恢复得非常好。' },
    { text: 'It is worth considering the long-term impact of this decision.', zh: '这个决定的长期影响值得考虑。' },
  ],
  words: [
    { word: 'remarkable', phonetic: '/rɪˈmɑːkəbl/', meaning: 'adj. 非凡的；引人注目的' },
    { word: 'recovery', phonetic: '/rɪˈkʌvəri/', meaning: 'n. 恢复；痊愈' },
    { word: 'consider', phonetic: '/kənˈsɪdə(r)/', meaning: 'v. 考虑；认为' },
  ],
};

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/__state') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lastAuth, lastModel }));
      return;
    }
    try {
      const j = JSON.parse(body || '{}');
      lastAuth = req.headers.authorization || null;
      lastModel = j.model || null;
    } catch { /* ignore */ }

    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock-1',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(REPLY) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
});

server.listen(PORT, '127.0.0.1', () => console.log('mock api on', PORT));
