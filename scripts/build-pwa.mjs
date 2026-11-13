import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const files = (await readdir('dist', { recursive: true }))
  .filter(file => /\.(html|js|css|svg|png|webmanifest|woff2?|ttf)$/.test(file) && file !== 'sw.js')
const hash = createHash('sha256')
for (const file of files) hash.update(await readFile(`dist/${file}`))
const cacheName = `verso-shell-${hash.digest('hex').slice(0, 12)}`
await writeFile('dist/sw.js', `
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ${JSON.stringify(files.map(file => `/${file}`))};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => (key.startsWith('verso-shell-') || key.startsWith('ephemeral-shell-')) && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
`)
