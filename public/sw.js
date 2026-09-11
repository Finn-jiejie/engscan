'use strict';

/* engscan Service Worker —— 让应用能装到手机主屏、断网也能打开外壳。
 * 策略：
 *   - 页面导航（HTML）→ 网络优先：保证内容永远最新，断网时回落到缓存
 *   - 其它同源静态资源 → stale-while-revalidate：先给缓存，再后台更新
 *   - 接口请求（/api/）与跨域云端 API → 一律直连，绝不缓存
 */

const CACHE = 'engscan-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './vocab.js',
  './vocab-ui.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // 云端 API、本地接口：不拦截，直连
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') !== -1) return;

  const isDocument = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isDocument) {
    // 网络优先：改完代码刷新就能看到新的，断网时用缓存兜底
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);

      return hit || net;
    })
  );
});
