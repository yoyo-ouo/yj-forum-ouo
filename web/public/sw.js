// 妖精论坛 Service Worker：仅缓存静态资源，页面走网络优先
const CACHE_NAME = 'yj-forum-v1';
const STATIC_ASSETS = [
  '/assets/css/main.css',
  '/assets/js/marked.min.js',
  '/assets/fonts/CEFFontsCJK.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // API 不缓存
  // 静态资源：缓存优先
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  // 页面：网络优先，不缓存 HTML（避免旧壳）
  e.respondWith(fetch(e.request).catch(() => caches.match('/assets/css/main.css')));
});
