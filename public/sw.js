'use strict';

/* engscan Service Worker —— 让应用能装到手机主屏、断网也能打开外壳。
 *
 * 策略：同源资源一律「网络优先，缓存兜底」。
 *   理由：这是个人学习工具，改版频繁；网络优先保证刷新即最新，
 *         断网时回落到缓存，PWA 的离线打开能力不受影响。
 * 绝不拦截：本地接口（/api/）与跨域云端 API —— 识别结果必须实时。
 */

const CACHE = 'engscan-v2';
// 只预缓存外壳；具体 js/css 由 stamp 脚本加内容哈希，按实际请求缓存
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

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

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (isDocument ? caches.match('./index.html') : undefined))
      )
  );
});
