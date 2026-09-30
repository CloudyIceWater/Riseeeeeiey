/*
 * Rise Client service worker: opens instantly with no network.
 *  - the page itself comes from disk (refreshed in the background),
 *  - the unpacked game code (wasm/*) comes from Rise's cache as real .wasm
 *    responses, so Chrome can keep the compiled machine code between starts.
 */
var PAGE = 'rise-page';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function payloadCache() {
	return caches.keys().then(function (ks) {
		var k = ks.filter(function (n) { return n.indexOf('rise-payload-') === 0; })[0];
		return k ? caches.open(k) : null;
	});
}

self.addEventListener('fetch', function (e) {
	var req = e.request;
	if (req.method !== 'GET') return;
	var url = new URL(req.url), scope = new URL(self.registration.scope);
	if (url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) return;
	var rest = url.pathname.slice(scope.pathname.length);
	if (rest.indexOf('wasm/') === 0) {
		e.respondWith(payloadCache().then(function (c) { return c && c.match(req.url); }).then(function (r) {
			return r || new Response('', { status: 404 });
		}));
		return;
	}
	if (rest !== '' && rest !== 'index.html') return;
	var key = scope.href;
	if (req.cache === 'reload' || req.cache === 'no-store') {
		e.respondWith(fetch(req).then(function (r) {
			if (r.ok) { var copy = r.clone(); e.waitUntil(caches.open(PAGE).then(function (c) { return c.put(key, copy); })); }
			return r;
		}));
		return;
	}
	e.respondWith(caches.open(PAGE).then(function (c) {
		return c.match(key).then(function (hit) {
			var net = fetch(req).then(function (r) { if (r.ok) return c.put(key, r.clone()).then(function () { return r; }); return r; });
			if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
			return net;
		});
	}));
});
