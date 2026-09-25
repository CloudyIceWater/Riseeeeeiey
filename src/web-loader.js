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

	async function load(id, cache) {
		var url = 'payload/' + id + '.bin?v=' + V;
		var resp = cache ? await cache.match(url) : null;
		var fromCache = !!resp;
		if (!resp) {
			resp = await fetch(url);
			if (!resp.ok) throw new Error('Rise payload ' + id + ': HTTP ' + resp.status);
		}
		var put = !fromCache && cache ? cache.put(url, resp.clone()).catch(function () {}) : null;
		window.__riseBin[id] = await readWithProgress(resp);
		if (put) await put;
		return fromCache;
	}

	window.__riseBinReady = (async function () {
		var cache = await openCache();
		var hits = await Promise.all(IDS.map(function (id) { return load(id, cache); }));
		status(hits.every(Boolean) ? 'Starting Rise Client (cached)…' : 'Starting Rise Client…');
	})();
	window.__riseBinReady.catch(function (e) {
		status('Download failed: ' + e.message + ' — check your connection and reload.');
	});
})();
