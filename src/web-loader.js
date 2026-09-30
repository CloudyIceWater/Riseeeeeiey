/*
 * Rise Client web build: downloads the game payloads as separate binary files
 * (instead of 77MB of base64 inside the page) and keeps them in the Cache API,
 * so later launches read them from disk. Payload URLs carry the build version.
 */
(function () {
	'use strict';
	var V = '%VERSION%';
	var IDS = %IDS%;
	var CACHE = 'rise-payload-' + V;
	var total = %TOTAL%, done = 0;
	window.__riseBin = {};
	var nativeFetch = window.fetch.bind(window); // before the page wraps fetch
	try { if (navigator.serviceWorker && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {}

	function status(t) {
		var el = document.getElementById('boot_status');
		if (el) el.textContent = t;
	}
	function mb(n) { return (n / 1048576).toFixed(1); }

	async function openCache() {
		try {
			if (!window.caches) return null;
			var names = await caches.keys();
			names.forEach(function (n) { if (n.indexOf('rise-payload-') === 0 && n !== CACHE) caches.delete(n); });
			return await caches.open(CACHE);
		} catch (e) { return null; }
	}

	async function readWithProgress(resp) {
		if (!resp.body || !resp.body.getReader) { var b = await resp.arrayBuffer(); done += b.byteLength; return new Uint8Array(b); }
		var len = Number(resp.headers.get('content-length')) || 0;
		var reader = resp.body.getReader(), parts = [], got = 0;
		for (;;) {
			var r = await reader.read();
			if (r.done) break;
			parts.push(r.value); got += r.value.length; done += r.value.length;
			status('Downloading Rise Client… ' + mb(done) + ' / ' + mb(total) + ' MB');
		}
		var out = new Uint8Array(len && len === got ? len : got), o = 0;
		for (var i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
		return out;
	}

	// The game's code (.wasm, 160 MB unpacked) ships brotli-packed. Unpacking it and
	// compiling it from scratch on every start was most of the start time on a
	// Chromebook, so the unpacked files are kept in the cache and handed to the
	// browser as real .wasm responses (Chrome also keeps its compiled machine code
	// for those, so later starts skip most of the compile work and save battery).
	var WASM = { 'classes.wasm': 'eag-inline-wasm-br', 'mesh-worker.wasm': 'eag-inline-mesh-wasm-br', 'server-worker.wasm': 'eag-inline-server-wasm-br' };
	var BR = {}; for (var wn in WASM) BR[WASM[wn]] = wn;
	var SIZES = %SIZES%;
	var cacheP = null;
	function wasmKey(name) { return new URL('wasm/' + name + '?v=' + V, location.href).href; }

	async function fetchBin(id) {
		var resp = await fetch('payload/' + id + '.bin?v=' + V);
		if (!resp.ok) throw new Error('Rise payload ' + id + ': HTTP ' + resp.status);
		return resp;
	}
	async function load(id, cache) {
		if (BR[id] && cache && await cache.match(wasmKey(BR[id]))) { done += SIZES[id] || 0; return true; }
		var url = 'payload/' + id + '.bin?v=' + V;
		var resp = !BR[id] && cache ? await cache.match(url) : null;
		var fromCache = !!resp;
		if (!resp) resp = await fetchBin(id);
		var put = !fromCache && !BR[id] && cache ? cache.put(url, resp.clone()).catch(function () {}) : null;
		var bytes = window.__riseBin[id] = await readWithProgress(resp);
		// the world thread's copy of the assets: a blob in memory, not a network request
		if (id === 'eag-inline-assets') window.__riseAssetBlobURL = URL.createObjectURL(new Blob([bytes]));
		if (put) await put;
		return fromCache;
	}

	window.__riseWasm = function (name, unpack) {
		if (!WASM[name]) return null;
		return (async function () {
			var cache = await cacheP;
			var hit = cache ? await cache.match(wasmKey(name)) : null;
			if (hit) {
				// through the service worker: a real .wasm request, so its compiled code gets cached too
				if (navigator.serviceWorker && navigator.serviceWorker.controller) {
					try { var sw = await nativeFetch(wasmKey(name)); if (sw.ok) return sw; } catch (e) {}
				}
				return hit;
			}
			var id = WASM[name];
			if (!window.__riseBin[id]) window.__riseBin[id] = new Uint8Array(await (await fetchBin(id)).arrayBuffer()); // cache was cleared under us
			var resp = await unpack();
			if (cache) {
				var raw = await resp.arrayBuffer();
				resp = new Response(raw, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
				try { await cache.put(wasmKey(name), new Response(raw, { status: 200, headers: { 'Content-Type': 'application/wasm' } })); } catch (e) {}
			}
			return resp;
		})();
	};

	// One link, always current: if the site has a newer build than this (browser-
	// cached) page, refresh the cached page and reload once.
	(function () {
		try {
			fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (latest) {
				latest = latest.trim();
				if (latest && latest !== V && sessionStorage.getItem('rise.updated') !== latest) {
					sessionStorage.setItem('rise.updated', latest);
					fetch(location.href, { cache: 'reload' }).then(function () { location.reload(); }, function () { location.reload(); });
				}
			}).catch(function () {});
		} catch (e) {}
	})();

	window.__riseBinReady = (async function () {
		cacheP = openCache();
		var cache = await cacheP;
		var hits = await Promise.all(IDS.map(function (id) { return load(id, cache); }));
		status(hits.every(Boolean) ? 'Starting Rise Client (cached)…' : 'Starting Rise Client…');
	})();
	window.__riseBinReady.catch(function (e) {
		status('Download failed: ' + e.message + ' — check your connection and reload.');
	});
})();
