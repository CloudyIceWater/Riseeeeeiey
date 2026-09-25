/*
 * Rise Client 2 — layer for Eaglercraft 26.2 (Wasm-GC).
 *
 *  - Rise Video Settings (ShadowNet/Sodium layout, ocean theme) replaces the
 *    game's "Video Settings..." button, and a "Mods" button replaces the title
 *    screen's "Credits" button. Both are pixel-matched overlays that only show
 *    on those screens: Rise reads the finished frame (menu text is matched
 *    against the game's own font) to know which screen is open.
 *  - Mods: keystrokes, CPS, FPS, crosshair, zoom, fullbright, toggle sprint and
 *    sneak, hitboxes, chunk borders, tick control, quick commands, TNT lag fix,
 *    blueprints, and texture mods (low fire, clear water, no pumpkin blur).
 *  - Pre-boot options pass, Chromebook mode and render resolution.
 *
 * Loaded after the page's eaglercraftXOpts script and before the boot script,
 * which awaits window.__risePreboot.
 */
(function () {
	'use strict';
	var VERSION = '2.0.0';
	var OPT_KEY = '_eaglercraftX.g';
	var CFG_KEY = 'rise.config';
	var MODS_KEY = 'rise.mods';
	var PENDING_KEY = 'rise.pending';
	var GLYPHS = %GLYPHS%;
	var FONT_B64 = '%FONT%';
	var PACKS = %PACKS%;
	var BLUEPRINT_SRC = %BLUEPRINT%;
	var PREVIEWS = %PREVIEWS%;
	var SKINS = %SKINS%;
	for (var sp in SKINS.packs) PACKS[sp] = SKINS.packs[sp];
	var SKIN_BY_ID = {};
	SKINS.list.forEach(function (s) { SKIN_BY_ID[s.id] = s; });

	function readJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
	function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
	function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

	// ------------------------------------------------------------ device + config
	var nav = navigator;
	var forced = /[?&]chromebook\b/.test(location.search);
	var isChromeOS = /\bCrOS\b/.test(nav.userAgent || '');
	var mem = nav.deviceMemory || 8;
	var cores = nav.hardwareConcurrency || 8;
	var lowEnd = forced || isChromeOS || mem <= 4 || cores <= 4;

	var DEF_CFG = { seeded: false, chromebook: lowEnd, scale: 1, hidpi: !lowEnd, dynamic: false, targetFps: 50, meshWorkers: 0, chunkCap: lowEnd };
	var cfg = readJSON(CFG_KEY) || {};
	for (var k in DEF_CFG) if (!(k in cfg)) cfg[k] = DEF_CFG[k];
	function saveCfg() { writeJSON(CFG_KEY, cfg); }

	var DEF_MODS = {
		keystrokes: false, cps: false, fps: true, crosshair: false, crosshairStyle: 'cross', crosshairColor: '#40f0dc',
		zoom: true, zoomLevel: 3, fullbright: false, fullbrightOn: false, toggleSprint: false, toggleSneak: false,
		lowFire: false, clearWater: false, noPumpkin: false, entityCull: false, clearLag: false,
		crosshairSize: 1, fullbrightStrength: 'medium', fpsCorner: 'left', clearLagMinutes: 3, cullDistance: 0.5,
		skins: {}, shader: false, shaderStyle: 'vibrant', glowOres: false, glint: false, glintColor: 'turquoise', cleanGlass: false,
		noHurtTilt: false, noFovFx: false, noWobble: false, noLightning: false
	};
	var mods = readJSON(MODS_KEY) || {};
	for (var mk in DEF_MODS) if (!(mk in mods)) mods[mk] = DEF_MODS[mk];
	function saveMods() { writeJSON(MODS_KEY, mods); }
	if ((mods._v || 0) < 3) { mods.fpsCorner = 'left'; mods._v = 3; saveMods(); } // FPS moved off the game's pop-up corner

	// ------------------------------------------------------------ options file (gzip + base64 key:value lines)
	function b64ToBytes(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
	function bytesToB64(b) { var s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
	function gunzip(bytes) { return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
	function gzip(text) { return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
	function parseOpts(text) {
		var map = {}, order = [];
		text.split('\n').forEach(function (line) {
			var i = line.indexOf(':');
			if (i <= 0) return;
			var key = line.slice(0, i);
			if (!(key in map)) order.push(key);
			map[key] = line.slice(i + 1);
		});
		return { map: map, order: order };
	}
	function serialiseOpts(o) { return o.order.map(function (key) { return key + ':' + o.map[key]; }).join('\n') + '\n'; }
	async function readOptions() {
		var raw = null;
		try { raw = localStorage.getItem(OPT_KEY); } catch (e) {}
		if (!raw) return { map: {}, order: [] };
		try { return parseOpts(await gunzip(b64ToBytes(raw))); } catch (e) { return null; }
	}
	var guiScaleOpt = 0;
	var writeQueue = Promise.resolve();
	function patchOptions(values, edit) {
		// Serialised: two concurrent read-modify-writes would drop settings.
		writeQueue = writeQueue.then(async function () {
			var o = await readOptions();
			if (!o) return;
			if (!o.order.length) { o.map.version = '4903'; o.order.push('version'); }
			for (var key in values) {
				if (!(key in o.map)) o.order.push(key);
				o.map[key] = values[key];
			}
			if (edit) edit(o);
			guiScaleOpt = parseInt(o.map.guiScale, 10) || 0;
			localStorage.setItem(OPT_KEY, bytesToB64(await gzip(serialiseOpts(o))));
		}).catch(function (e) { console.warn('[Rise] options write failed', e); });
		return writeQueue;
	}

	var PRESETS = {
		chromebook: {
			renderDistance: '4', simulationDistance: '4', maxFps: '60', particles: '2', ao: 'false',
			biomeBlendRadius: '0', entityDistanceScaling: '0.5', entityShadows: 'false', cutoutLeaves: 'false',
			improvedTransparency: 'false', mipmapLevels: '0', textureFiltering: '0', renderClouds: '"false"',
			weatherRadius: '3', vignette: 'false', chunkSectionFadeInTime: '0.0', menuBackgroundBlurriness: '0',
			prioritizeChunkUpdates: '0', syncChunkWrites: 'false', graphicsPreset: '"custom"'
		},
		balanced: {
			renderDistance: '6', simulationDistance: '5', maxFps: '120', particles: '1', ao: 'true',
			biomeBlendRadius: '1', entityDistanceScaling: '0.75', entityShadows: 'false', cutoutLeaves: 'false',
			improvedTransparency: 'false', mipmapLevels: '2', textureFiltering: '0', renderClouds: '"fast"',
			weatherRadius: '5', vignette: 'true', chunkSectionFadeInTime: '0.5', menuBackgroundBlurriness: '2',
			prioritizeChunkUpdates: '0', syncChunkWrites: 'false', graphicsPreset: '"custom"'
		},
		quality: {
			renderDistance: '10', simulationDistance: '8', maxFps: '260', particles: '0', ao: 'true',
			biomeBlendRadius: '2', entityDistanceScaling: '1.0', entityShadows: 'true', cutoutLeaves: 'true',
			improvedTransparency: 'false', mipmapLevels: '4', textureFiltering: '0', renderClouds: '"true"',
			weatherRadius: '8', vignette: 'true', chunkSectionFadeInTime: '0.75', menuBackgroundBlurriness: '5',
			prioritizeChunkUpdates: '1', syncChunkWrites: 'false', graphicsPreset: '"custom"'
		}
	};
	var ALWAYS = { darkMojangStudiosBackground: 'true' };

	// ------------------------------------------------------------ texture-mod resource packs (worlds DB, like a .minecraft folder)
	function wantedPacks() {
		var w = [];
		if (mods.lowFire) w.push('rise_low_fire');
		if (mods.clearWater) w.push('rise_clear_water');
		if (mods.noPumpkin) w.push('rise_no_pumpkin');
		if (mods.crosshair) w.push('rise_crosshair');
		if (mods.glowOres) w.push('rise_glow_ores');
		if (mods.cleanGlass) w.push('rise_clean_glass');
		var sk = mods.skins || {};
		Object.keys(sk).forEach(function (g) { if (sk[g]) w.push('rise_skin_' + sk[g]); });
		if (mods.glint) w.push('rise_glint_' + mods.glintColor);
		return w.filter(function (p) { return PACKS[p]; });
	}
	function fsDBName() {
		var o = window.eaglercraftXOpts || {};
		return '_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_' + (o.worldsDB || 'worlds');
	}
	function openFS() {
		return new Promise(function (res, rej) {
			var r = indexedDB.open(fsDBName(), 1);
			// the game's own schema; never open it without creating the store
			r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('filesystem')) r.result.createObjectStore('filesystem', { keyPath: ['path'] }); };
			r.onsuccess = function () { res(r.result); };
			r.onerror = function () { rej(r.error); };
		});
	}
	async function installPacks() {
		var want = wantedPacks();
		var stamp = 'rise.packs.' + VERSION;
		var have = readJSON(stamp) || [];
		var missing = want.filter(function (p) { return have.indexOf(p) < 0; });
		if (missing.length) {
			var db = await openFS();
			await new Promise(function (res, rej) {
				var tx = db.transaction('filesystem', 'readwrite');
				var st = tx.objectStore('filesystem');
				var dirs = { 'resourcepacks': 1 };
				missing.forEach(function (pid) {
					var files = PACKS[pid];
					Object.keys(files).forEach(function (rel) {
						var path = 'resourcepacks/' + pid + '/' + rel;
						var parts = path.split('/');
						for (var i = 1; i < parts.length; i++) dirs[parts.slice(0, i).join('/')] = 1;
						st.put({ path: path, data: b64ToBytes(files[rel]).buffer });
					});
				});
				Object.keys(dirs).forEach(function (d) { st.put({ path: d + '/.eaglerfsdir', data: new ArrayBuffer(0) }); });
				tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
			});
			db.close();
			writeJSON(stamp, have.concat(missing));
		}
		return want;
	}
	function editPackList(o, want) {
		var cur = [];
		try { cur = JSON.parse(o.map.resourcePacks || '[]'); } catch (e) {}
		cur = cur.filter(function (p) { return String(p).indexOf('file/rise_') !== 0; });
		if (want.length && cur.indexOf('vanilla') < 0) cur.unshift('vanilla');
		want.forEach(function (p) { cur.push('file/' + p); });
		if (!('resourcePacks' in o.map)) o.order.push('resourcePacks');
		o.map.resourcePacks = JSON.stringify(cur);
	}

	// ------------------------------------------------------------ pre-boot
	var opts = window.eaglercraftXOpts;
	if (opts) {
		if (cfg.meshWorkers > 0) opts.meshWorkerCount = cfg.meshWorkers;
		else if (cfg.chromebook && cores <= 4) opts.meshWorkerCount = 1;
		if (cfg.chunkCap) { opts.chunkUnloadHardCap = true; window.__eaglerChunkUnloadHardCap = true; }
	}
	var optionsPass = Promise.race([
		(async function () {
			var values = {};
			if (!cfg.seeded) {
				Object.assign(values, cfg.chromebook ? PRESETS.chromebook : PRESETS.balanced);
				cfg.seeded = true; saveCfg();
			}
			var pending = readJSON(PENDING_KEY);
			if (pending) Object.assign(values, pending);
			values.toggleSprint = mods.toggleSprint ? 'true' : 'false';
			values.toggleCrouch = mods.toggleSneak ? 'true' : 'false';
			if (mods.entityCull) { values.entityDistanceScaling = String(mods.cullDistance); values.entityShadows = 'false'; }
			values.damageTiltStrength = mods.noHurtTilt ? '0.0' : '1.0';
			values.fovEffectScale = mods.noFovFx ? '0.0' : '1.0';
			values.screenEffectScale = mods.noWobble ? '0.0' : '1.0';
			values.hideLightningFlashes = mods.noLightning ? 'true' : 'false';
			Object.assign(values, ALWAYS);
			var want = [];
			try { want = await installPacks(); } catch (e) { console.warn('[Rise] packs', e); }
			await patchOptions(values, function (o) { editPackList(o, want); });
			try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
		})(),
		sleep(3000) // never hold the game hostage
	]).catch(function (e) { console.warn('[Rise] preboot', e); });
	// web build: also wait for the downloaded payloads (see web-loader.js)
	window.__risePreboot = Promise.all([optionsPass, window.__riseBinReady || null]);

	// ------------------------------------------------------------ render resolution (devicePixelRatio)
	var realDpr = window.devicePixelRatio || 1;
	var armed = false, dynScale = 1;
	function effectiveDpr() {
		var base = cfg.hidpi ? realDpr : Math.min(realDpr, 1);
		return Math.max(0.25, base * cfg.scale * dynScale);
	}
	try {
		Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: function () { return armed ? effectiveDpr() : realDpr; } });
	} catch (e) {}
	function applyScale() { if (armed) window.dispatchEvent(new Event('resize')); }
	function gameReady() { return window.__eaglerGameReady === true; }
	(function waitCanvas() {
		// Eagler's own layout breaks if the ratio lies before its canvas exists.
		if (gameReady() && document.querySelector('canvas')) { armed = true; applyScale(); boostUntil = performance.now() + 15000; return; }
		setTimeout(waitCanvas, 250);
	})();

	// ------------------------------------------------------------ frame hook: FPS + reading the finished frame
	var presents = 0, fps = 0, onFrame = null;
	var GLP = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
	var oBind = GLP ? GLP.bindFramebuffer : null;
	if (GLP) {
		var oDraw = GLP.drawArrays;
		GLP.bindFramebuffer = function (t, f) {
			if (t === 0x8D40 || t === 0x8CA9) this.__riseDef = (f == null);
			return oBind.call(this, t, f);
		};
		// The game presents with one fullscreen drawArrays into the default
		// framebuffer; right after it the frame is complete and still readable.
		GLP.drawArrays = function (m, first, count) {
			var r = oDraw.call(this, m, first, count);
			if (this.__riseDef) {
				presents++;
				if (onFrame) { try { onFrame(this); } catch (e) { onFrame = null; console.warn('[Rise] frame', e); } }
			}
			return r;
		};
	}
	function readPx(gl, x, y, w, h) {
		var pb = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
		if (pb) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		var rf = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
		if (rf) oBind.call(gl, gl.READ_FRAMEBUFFER, null);
		var buf = new Uint8Array(w * h * 4);
		gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
		if (pb) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb);
		if (rf) oBind.call(gl, gl.READ_FRAMEBUFFER, rf);
		return buf;
	}
	function calcScale(W, H) {
		var i = 1;
		while (i !== guiScaleOpt && i < W && i < H && Math.floor(W / (i + 1)) >= 320 && Math.floor(H / (i + 1)) >= 240) i++;
		return i;
	}
	// grab a GUI-space rectangle; returns sampler(gx, gy) -> is that GUI pixel white (text)?
	function grab(gl, s, xg, yg, wg, hg) {
		var W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
		var x = Math.max(0, xg * s), y = Math.max(0, yg * s);
		var w = Math.min(W - x, wg * s), h = Math.min(H - y, hg * s);
		if (w <= 0 || h <= 0) return function () { return false; };
		var buf = readPx(gl, x, H - y - h, w, h), half = s >> 1;
		// sampler(gx, gy) -> whiteness of that GUI pixel (min of r,g,b; white text is high on all three)
		return function (gx, gy) {
			var px = gx * s + half - x, py = gy * s + half - y;
			if (px < 0 || py < 0 || px >= w || py >= h) return 0;
			var i = ((h - 1 - py) * w + px) * 4;
			var r = buf[i], g = buf[i + 1], b = buf[i + 2];
			return r < g ? (r < b ? r : b) : (g < b ? g : b);
		};
	}
	// text templates from the game's own font (font/ascii.png)
	var TPL = {};
	function template(text) {
		if (TPL[text]) return TPL[text];
		var on = [], off = [], x = 0;
		for (var i = 0; i < text.length; i++) {
			var g = GLYPHS[text[i]] || GLYPHS['?'];
			for (var y = 0; y < 8; y++) for (var c = 0; c < g[0]; c++) ((g[1][y] >> c) & 1 ? on : off).push(x + c, y);
			x += g[0] + 1;
		}
		return (TPL[text] = { on: on, off: off, w: x });
	}
	// Letters must be brighter than the pixels right around them. Local contrast
	// (not a fixed "white") so text is found even while a screen fades in, and
	// bright bubbles elsewhere in the panorama don't matter.
	function matchAt(get, t, gx, gy) {
		var on = t.on, off = t.off, i, n = on.length / 2, m = off.length / 2;
		// quick reject: a few letter pixels must beat a few gap pixels
		var lo = 999, hi = 0;
		for (i = 0; i < 12 && i < on.length; i += 2) { var a = get(gx + on[i], gy + on[i + 1]); if (a < lo) lo = a; }
		for (i = 0; i < 12 && i < off.length; i += 2) { var b = get(gx + off[i], gy + off[i + 1]); if (b > hi) hi = b; }
		if (lo <= hi) return 0;
		var onSum = 0, offSum = 0;
		for (i = 0; i < on.length; i += 2) onSum += get(gx + on[i], gy + on[i + 1]);
		for (i = 0; i < off.length; i += 2) offSum += get(gx + off[i], gy + off[i + 1]);
		var onMean = onSum / n, offMean = offSum / m;
		if (onMean < 9 || onMean < offMean * 1.5 + 4) return 0;
		var mid = (onMean + offMean) / 2, miss = 0, wrong = 0;
		for (i = 0; i < on.length; i += 2) if (get(gx + on[i], gy + on[i + 1]) < mid) miss++;
		for (i = 0; i < off.length; i += 2) if (get(gx + off[i], gy + off[i + 1]) > mid) wrong++;
		if (miss > Math.max(1, n * 0.05) || wrong > Math.max(2, m * 0.07)) return 0;
		return onMean / 255; // how visible the text is (it fades in with its screen)
	}
	function findText(get, text, x0, x1, y0, y1) {
		var t = template(text);
		for (var gy = y0; gy <= y1; gy++) for (var gx = x0; gx <= x1; gx++) {
			var lv = matchAt(get, t, gx, gy);
			if (lv) return { x: gx, y: gy, w: t.w - 1, level: lv };
		}
		return null;
	}

	// ------------------------------------------------------------ screen watcher
	var screen = { name: null, s: 1, gw: 0, gh: 0, rects: {} }, layoutCache = {};
	var lastCheck = 0, boostUntil = 0, pendingCheck = false;
	function watcher(gl) {
		var now = performance.now();
		// unknown screen (or just changed): look every frame so our buttons land before you can see the game's
		// Unknown or still-fading screens are checked on every frame, and the check
		// runs inside the game's own frame, so our button lands in the same frame the
		// game's button first shows up (the "Credits" label is never visible on its own).
		var gap = (now < boostUntil || !screen.name || screen.level < 0.97) ? 0 : 160;
		if (!pendingCheck && now - lastCheck < gap) return;
		pendingCheck = false; lastCheck = now;
		if (document.pointerLockElement || isOpen || !gameReady()) { if (screen.name) setScreen(null); return; }
		var W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
		var s = calcScale(W, H), gw = Math.floor(W / s), gh = Math.floor(H / s);
		screen.s = s; screen.gw = gw; screen.gh = gh;
		var key = W + 'x' + H + 's' + s;
		// 1. header titles, centred at the top
		var head = grab(gl, s, 0, 0, gw, 60);
		var titles = ['Options', 'Video Settings', 'Game Menu'];
		for (var i = 0; i < titles.length; i++) {
			var t = template(titles[i]);
			var cx = Math.floor(gw / 2) - Math.floor(t.w / 2);
			var hit = findText(head, titles[i], cx - 1, cx + 1, 2, titles[i] === 'Game Menu' ? 52 : 36);
			if (hit) {
				if (titles[i] === 'Video Settings') { vanillaVideoOpened(); return; }
				if (titles[i] === 'Game Menu') {
					// in-game Escape menu: a full-width Mods button one row under its last button
					if (screen.name !== 'pause') delete layoutCache[key + 'pause']; // re-measure each time it opens (Open to LAN etc. shift it)
					var pr = layoutCache[key + 'pause'];
					if (pr === undefined) {
						var allp = grab(gl, s, 0, 0, gw, gh), cxp = Math.floor(gw / 2), last = null;
						['Save and Quit to Title', 'Disconnect'].forEach(function (lbl) {
							if (last) return;
							var tw = template(lbl).w;
							last = findText(allp, lbl, cxp - Math.floor(tw / 2) - 1, cxp - Math.floor(tw / 2) + 1, hit.y + 20, gh - 20);
						});
						pr = layoutCache[key + 'pause'] = last ? { x: cxp - 102, y: last.y - 6 + 24, w: 204, h: 20 } : null;
					}
					setScreen('pause', { mods: pr }, hit.level);
					return;
				}
				var r = layoutCache[key + 'opt'];
				if (r === undefined) {
					var all = grab(gl, s, 0, 0, gw, gh);
					var f = findText(all, 'Video Settings...', Math.floor(gw / 2) - 175, Math.floor(gw / 2) + 20, 40, gh - 30);
					r = layoutCache[key + 'opt'] = f ? btnRect(f, 150) : null;
				}
				setScreen('options', { video: r }, hit.level);
				return;
			}
		}
		// 2. title screen: its version line bottom-left
		var foot = grab(gl, s, 0, gh - 30, 140, 30);
		var tf = findText(foot, 'Rewritten by o_xer', 1, 3, gh - 26, gh - 8);
		if (tf) {
			// 26.2 title layout: the Credits button sits at (w/2 + 2, h/4 + 144), 98x20
			setScreen('title', { mods: { x: Math.floor(gw / 2) + 2, y: Math.floor(gh / 4) + 144, w: 98, h: 20 } }, tf.level);
			return;
		}
		setScreen(null);
	}
	// buttons centre their label: textX = x + (w - textWidth) / 2, textY = y + 6
	function btnRect(f, w) { return { x: f.x - Math.floor((w - (f.w + 1)) / 2), y: f.y - 6, w: w, h: 20 }; }
	function setScreen(name, rects, level) {
		screen.name = name; screen.rects = rects || {};
		screen.level = level == null ? 1 : Math.min(1, level * 1.04);
		placeOverlays();
	}
	var lastVanilla = 0;
	function vanillaVideoOpened() {
		// fallback: the game's own Video Settings opened anyway (keyboard navigation)
		if (performance.now() - lastVanilla < 1500) return;
		lastVanilla = performance.now();
		tapKey('Escape', 'Escape', 27);
		setTimeout(function () { openPanel('video'); }, 120);
	}

	// ------------------------------------------------------------ synthetic input (the game accepts it)
	var synth = 0;
	function keyEvent(type, key, code, keyCode, shift) {
		synth++;
		try {
			window.dispatchEvent(new KeyboardEvent(type, { key: key, code: code, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true, shiftKey: !!shift }));
		} finally { synth--; }
	}
	async function tapKey(key, code, keyCode) { keyEvent('keydown', key, code, keyCode); await sleep(35); keyEvent('keyup', key, code, keyCode); }
	var CHAR_CODES = { ' ': ['Space', 32], '/': ['Slash', 191], '_': ['Minus', 189, 1], '-': ['Minus', 189], '@': ['Digit2', 50, 1], '~': ['Backquote', 192, 1], '.': ['Period', 190], '=': ['Equal', 187], ':': ['Semicolon', 186, 1], '*': ['Digit8', 56, 1], '[': ['BracketLeft', 219], ']': ['BracketRight', 221], ',': ['Comma', 188], '#': ['Digit3', 51, 1], '{': ['BracketLeft', 219, 1], '}': ['BracketRight', 221, 1] };
	async function typeText(text) {
		for (var i = 0; i < text.length; i++) {
			var ch = text[i], code, kc, shift = false;
			if (/[a-z]/i.test(ch)) { code = 'Key' + ch.toUpperCase(); kc = ch.toUpperCase().charCodeAt(0); shift = ch !== ch.toLowerCase(); }
			else if (/[0-9]/.test(ch)) { code = 'Digit' + ch; kc = ch.charCodeAt(0); }
			else { var m = CHAR_CODES[ch] || ['', 0]; code = m[0]; kc = m[1]; shift = !!m[2]; }
			keyEvent('keydown', ch, code, kc, shift); keyEvent('keypress', ch, code, kc, shift);
			await sleep(6);
			keyEvent('keyup', ch, code, kc, shift);
			await sleep(6);
		}
	}
	// commands wait until you are back in the game (chat only opens there)
	var cmdQueue = [], running = false;
	function queueCommands(list, label) {
		cmdQueue = cmdQueue.concat(list);
		toast(document.pointerLockElement ? 'Running ' + label + '…' : label + ': runs when you go back to the game');
		runCommands();
	}
	async function runCommands() {
		if (running || !cmdQueue.length || !document.pointerLockElement) return;
		running = true;
		await sleep(350);
		while (cmdQueue.length && document.pointerLockElement) {
			var c = cmdQueue.shift();
			await tapKey('t', 'KeyT', 84);
			await sleep(160);
			await typeText(c);
			await sleep(60);
			await tapKey('Enter', 'Enter', 13);
			await sleep(220);
		}
		running = false;
	}
	var chordQueue = [];
	async function runChords() {
		while (chordQueue.length && document.pointerLockElement) {
			var c = chordQueue.shift();
			keyEvent('keydown', 'F3', 'F3', 114); await sleep(40);
			await tapKey(c.key, c.code, c.kc); await sleep(40);
			keyEvent('keyup', 'F3', 'F3', 114); await sleep(80);
		}
	}

	// ------------------------------------------------------------ UI shell
	var host = document.createElement('div');
	host.id = 'rise-client';
	var root = host.attachShadow({ mode: 'open' });
	var HOST_CSS = 'position:fixed;inset:0;width:0;height:0;z-index:2147483600;pointer-events:auto;';
	host.style.cssText = HOST_CSS;
	var fbSvg = null;
	function mountTarget() { return document.fullscreenElement || document.body; }
	function ensureMounted() {
		var t = mountTarget();
		if (!t) return;
		// The game can re-parent / restyle injected nodes while booting.
		if (host.parentNode !== t) t.appendChild(host);
		if (host.style.cssText !== HOST_CSS) host.style.cssText = HOST_CSS;
		if (fbSvg && fbSvg.parentNode !== document.body && document.body) document.body.appendChild(fbSvg);
		if (!fontStyle.isConnected) (document.head || document.documentElement).appendChild(fontStyle);
	}
	setInterval(ensureMounted, 1000);
	document.addEventListener('fullscreenchange', ensureMounted);

	var C = { accent: '#40f0dc', box: 'rgba(2,18,34,.9)', row: 'rgba(3,26,46,.78)', rowHover: 'rgba(12,78,120,.85)', text: '#e8fffc', dim: '#8fc9d2' };
	var CSS = [
		':host{all:initial}',
		'*{box-sizing:border-box}',
		'.mc{font-family:RiseMC,monospace;font-size:16px;line-height:1;color:' + C.text + ';text-shadow:2px 2px 0 rgba(0,0,0,.55);-webkit-font-smoothing:none;user-select:none}',
		/* game-matched overlay buttons */
		'.gbtn{position:fixed;display:none;align-items:center;justify-content:center;padding-top:1px;cursor:pointer;border:1px solid #28aac8;border-radius:2px;background:linear-gradient(180deg,#0e5c8c,#06345c);color:#fff;overflow:hidden;transition:background .25s ease,border-color .25s ease,box-shadow .25s ease}',
		'.gbtn::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(210,255,250,.35),transparent);pointer-events:none}',
		'.gbtn:hover{background:linear-gradient(180deg,#1ebec8,#0c76be);border-color:#aafff5;box-shadow:0 0 10px rgba(64,240,220,.35)}',
		'.gbtn:hover::after{animation:shine 1.1s ease-in-out infinite}',
		'@keyframes shine{0%{left:-60%}60%,100%{left:130%}}',
		/* panels: ShadowNet / Sodium layout */
		'.scrim{position:fixed;inset:0;z-index:2147483601;opacity:0;transition:opacity .18s ease;background:radial-gradient(ellipse at 50% -10%,rgba(160,250,245,.28),transparent 55%),linear-gradient(180deg,#1a8aa3 0%,#0b5f8e 34%,#05355c 66%,#021426 100%)}',
		'.scrim::before{content:"";position:absolute;inset:0;background:rgba(2,20,38,.5);pointer-events:none}',
		'.scrim>*{z-index:1}',
		'.scrim.open{opacity:1}',
		'.tabs{position:absolute;left:12px;top:10px;display:flex;gap:10px;flex-wrap:wrap}',
		'.tab{padding:6px 10px 5px;background:' + C.box + ';cursor:pointer;border-bottom:2px solid transparent;transition:background .2s ease,border-color .2s ease,color .2s ease;color:' + C.dim + '}',
		'.tab:hover{background:rgba(10,60,96,.95);color:' + C.text + '}',
		'.tab.on{border-bottom-color:' + C.accent + ';color:' + C.text + '}',
		'.list{position:absolute;left:12px;top:44px;width:min(600px,calc(100vw - 24px));max-height:calc(100vh - 110px);overflow:auto;background:rgba(2,16,30,.55)}',
		'.list::-webkit-scrollbar{width:6px}.list::-webkit-scrollbar-thumb{background:' + C.accent + '}',
		'.gh{padding:9px 12px 5px;color:' + C.accent + ';font-size:12px}',
		'.row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:32px;padding:3px 12px;background:' + C.row + ';transition:background .18s ease}',
		'.row:hover{background:' + C.rowHover + '}',
		'.row .lbl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
		'.row.mod .lbl{color:#ffe38a}',
		'.val{min-width:150px;height:24px;padding:0 8px;display:flex;align-items:center;justify-content:center;background:#01101e;border:1px solid rgba(64,240,220,.18);cursor:pointer;transition:border-color .2s ease,background .2s ease;white-space:nowrap}',
		'.val:hover{border-color:' + C.accent + ';background:#03213a}',
		'.chk{width:22px;height:22px;border:2px solid ' + C.accent + ';display:flex;align-items:center;justify-content:center;cursor:pointer;transition:box-shadow .2s ease}',
		'.chk::after{content:"";width:12px;height:12px;background:' + C.accent + ';transform:scale(0);transition:transform .18s ease}',
		'.chk.on::after{transform:scale(1)}',
		'.chk:hover{box-shadow:0 0 8px rgba(64,240,220,.55)}',
		'.sl{width:250px;display:flex;flex-direction:column;align-items:center;gap:3px}',
		'.sl span{font-size:13px}',
		'input[type=range]{-webkit-appearance:none;appearance:none;width:250px;height:4px;background:linear-gradient(90deg,' + C.accent + ' var(--p,50%),rgba(255,255,255,.18) var(--p,50%));outline:none;cursor:pointer;margin:4px 0}',
		'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:8px;height:16px;background:' + C.accent + ';border:1px solid #eafffb;transition:transform .15s ease}',
		'input[type=range]:hover::-webkit-slider-thumb{transform:scaleY(1.15)}',
		'.acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
		'.info{position:absolute;top:44px;left:calc(min(600px,100vw - 24px) + 24px);width:280px;padding:9px 11px;background:' + C.box + ';border-left:2px solid ' + C.accent + ';opacity:0;transform:translateY(-4px);transition:opacity .18s ease,transform .18s ease;pointer-events:none;line-height:1.35}',
		'.info.show{opacity:1;transform:none}',
		'.info b{display:block;margin-bottom:6px;color:' + C.accent + ';font-weight:normal}',
		'.info p{margin:0 0 6px;font-size:13px;color:#cdeff3}',
		'.info i{font-style:normal;font-size:12px;color:#ffd166}',
		'@media (max-width:920px){.info{display:none}}',
		'.bar{position:absolute;right:14px;bottom:14px;display:flex;gap:10px;align-items:center}',
		'.btn{position:relative;overflow:hidden;min-width:124px;height:34px;padding:0 14px;display:flex;align-items:center;justify-content:center;background:' + C.box + ';border:1px solid rgba(64,240,220,.25);cursor:pointer;white-space:nowrap;transition:background .25s ease,border-color .25s ease,box-shadow .25s ease}',
		'.btn::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(210,255,250,.28),transparent);pointer-events:none}',
		'.btn:hover{background:linear-gradient(180deg,#1ebec8,#0c76be);border-color:#aafff5;box-shadow:0 0 10px rgba(64,240,220,.3)}',
		'.btn:hover::after{animation:shine 1.1s ease-in-out infinite}',
		'.btn.small{min-width:0;height:26px;padding:0 10px;font-size:13px}',
		'.hint{padding:8px 12px 4px;color:' + C.dim + ';font-size:12px}',
		'.scrim.wide .list{width:calc(100vw - 24px);max-height:calc(100vh - 118px)}',
		'.scrim.wide .info{display:none}',
		/* big, full-screen layout for both screens (scrolls when it does not fit) */
		'.scrim.big .tabs{top:12px;gap:12px}',
		'.scrim.big .tab{font-size:20px;padding:9px 16px 8px}',
		'.scrim.big .list{top:62px;bottom:70px;max-height:none}',
		'.scrim.big .gh{font-size:15px;padding:14px 18px 8px}',
		'.scrim.big .hint{font-size:15px;padding:12px 18px 6px}',
		'.scrim.big .row{min-height:52px;padding:6px 18px;font-size:20px;margin-bottom:2px}',
		'.scrim.big .chk{width:30px;height:30px}.scrim.big .chk::after{width:16px;height:16px}',
		'.scrim.big .val{min-width:220px;height:34px;font-size:18px}',
		'.scrim.big .sl{width:360px}.scrim.big .sl span{font-size:16px}.scrim.big input[type=range]{width:360px;height:6px}',
		'.scrim.big .btn.small{height:34px;font-size:16px;padding:0 14px}',
		'.scrim.big .bar .btn{height:44px;min-width:160px;font-size:20px}',
		'.scrim.big .grid{grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:14px;padding:6px 18px 20px}',
		'.scrim.big .tile{padding:16px 8px 12px}.scrim.big .tile .nm{font-size:17px}.scrim.big .tile .gp{font-size:13px}',
		'.scrim.big .sbar{padding:14px 18px}.scrim.big .sbar input{font-size:18px;width:300px;padding:8px 12px}.scrim.big .chip{font-size:16px;padding:8px 14px}',
		'.scrim.video .list{width:calc(100vw - 364px)}',
		'.scrim.video .info{left:auto;right:14px;top:62px;width:320px;font-size:18px}',
		'.scrim.video .info p{font-size:15px}',
		'@media (max-width:900px){.scrim.video .list{width:calc(100vw - 24px)}.scrim.video .info{display:none}}',
		'.sbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px}',
		'.sbar input{font-family:RiseMC,monospace;font-size:14px;color:' + C.text + ';background:#01101e;border:1px solid rgba(64,240,220,.35);padding:6px 9px;width:220px;outline:none;transition:border-color .2s ease}',
		'.sbar input:focus{border-color:' + C.accent + '}',
		'.chip{padding:5px 10px;font-size:13px;background:' + C.box + ';border:1px solid rgba(64,240,220,.2);cursor:pointer;transition:background .2s ease,border-color .2s ease}',
		'.chip:hover{border-color:' + C.accent + '}',
		'.chip.on{background:linear-gradient(180deg,#1ebec8,#0c76be);border-color:#aafff5}',
		'.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px;padding:4px 12px 16px}',
		'.tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px 8px;background:' + C.row + ';border:2px solid transparent;cursor:pointer;transition:background .18s ease,border-color .18s ease,transform .18s ease}',
		'.tile:hover{background:' + C.rowHover + ';transform:translateY(-2px)}',
		'.tile.eq{border-color:' + C.accent + ';box-shadow:0 0 12px rgba(64,240,220,.3)}',
		'.tile .nm{font-size:13px;text-align:center}',
		'.tile .gp{font-size:11px;color:' + C.dim + '}',
		'.tile .badge{position:absolute;top:5px;right:5px;font-size:10px;padding:2px 4px;background:#ffd166;color:#221;text-shadow:none}',
		'.tile .eqb{position:absolute;top:5px;left:5px;font-size:10px;padding:2px 4px;background:' + C.accent + ';color:#012;text-shadow:none}',
		'.sk{width:64px;height:64px;background-repeat:no-repeat;background-size:64px auto;image-rendering:pixelated}',
		'.sk.an{animation:strip var(--t) steps(var(--n)) infinite}',
		'.tints{display:flex;gap:6px;justify-content:center;padding:0 14px 10px}',
		'.tints img{width:40px;height:40px;image-rendering:pixelated;background:rgba(0,0,0,.25)}',
		'.cardbg{position:absolute;inset:0;z-index:5;background:rgba(1,10,20,.55);opacity:0;transition:opacity .15s ease}',
		'.cardbg.open{opacity:1}',
		'.card{position:absolute;left:50%;top:50%;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;transform:translate(-50%,-50%) scale(.96);transition:transform .18s ease;background:' + C.box + ';border:2px solid ' + C.accent + ';box-shadow:0 12px 40px rgba(0,0,0,.5)}',
		'.cardbg.open .card{transform:translate(-50%,-50%) scale(1)}',
		'.card h2{margin:0;padding:14px 14px 8px;font-size:18px;font-weight:normal;color:' + C.accent + '}',
		'.card .what{padding:0 14px 12px;font-size:13px;line-height:1.45;color:#cdeff3}',
		'.card .row{background:rgba(3,26,46,.9)}',
		'.card .foot{display:flex;justify-content:flex-end;padding:12px 14px}',
		'.card .rs{padding:0 14px 8px;font-size:12px;color:#ffd166}',
		'.pic{position:relative;display:flex;align-items:center;justify-content:center;height:140px;margin:0 14px 12px;overflow:hidden;background:rgba(0,0,0,.28);border:1px solid rgba(64,240,220,.22)}',
		'.pic img,.pic .strip{image-rendering:pixelated}',
		'.pic .strip{width:96px;height:96px;background-repeat:no-repeat;background-size:96px auto;animation:strip var(--t) steps(var(--n)) infinite}',
		'@keyframes strip{to{background-position:0 var(--h)}}',
		'.pic .glint{position:absolute;width:96px;height:96px;mix-blend-mode:screen;opacity:.85;background-size:48px 48px;animation:glint 3s linear infinite;-webkit-mask-size:96px 96px;mask-size:96px 96px;image-rendering:pixelated}',
		'@keyframes glint{to{background-position:96px 48px}}',
		'.pic .scene{width:100%;height:100%;object-fit:cover}',
		'.pic .mock{position:relative;transform:scale(1.2)}',
		'.note{position:absolute;left:14px;bottom:24px;color:#ffd166;font-size:13px;opacity:0;transition:opacity .25s ease}',
		'.note.show{opacity:1}',
		'.toast{position:fixed;left:50%;bottom:70px;transform:translateX(-50%) translateY(14px);z-index:2147483602;padding:9px 14px;background:' + C.box + ';border:1px solid ' + C.accent + ';opacity:0;transition:opacity .25s ease,transform .25s ease;pointer-events:none;white-space:nowrap}',
		'.toast.show{opacity:1;transform:translateX(-50%)}',
		/* HUD mods */
		'.hud{position:fixed;inset:0;pointer-events:none;z-index:2147483599}',
		'.hud .fps{position:absolute;right:8px;top:6px;padding:4px 7px;background:rgba(2,18,34,.55);font-size:13px}',
		'.ks{position:absolute;left:8px;top:34px;display:grid;grid-template-columns:repeat(3,34px);gap:3px}',
		'.ks div{height:34px;display:flex;align-items:center;justify-content:center;background:rgba(2,18,34,.55);border:1px solid rgba(64,240,220,.18);font-size:13px;transition:background .08s linear,color .08s linear}',
		'.ks div.on{background:rgba(64,240,220,.85);color:#012;text-shadow:none}',
		'.ks .w{grid-column:2}.ks .a{grid-column:1}.ks .wide{grid-column:span 3}',
		'.ks .mouse{grid-column:span 3;display:grid;grid-template-columns:1fr 1fr;gap:3px;background:none;border:0;height:auto}',
		'.ks .mouse div{height:30px}',
		'.cps{position:absolute;left:8px;padding:4px 7px;background:rgba(2,18,34,.55);font-size:13px}',
		'.xh{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:24px;height:24px}',
		'@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}'
	].join('\n');

	// @font-face is ignored inside shadow roots, so the font is declared on the page
	var fontStyle = document.createElement('style');
	fontStyle.textContent = '@font-face{font-family:RiseMC;src:url(data:font/ttf;base64,' + FONT_B64 + ') format("truetype");font-display:block}';
	(document.head || document.documentElement).appendChild(fontStyle);
	root.innerHTML = '<style>' + CSS + '</style>' +
		'<div class="gbtn mc" data-b="video">Video Settings...</div>' +
		'<div class="gbtn mc" data-b="mods">Mods</div>' +
		'<div class="hud mc"></div><div class="toast mc"></div>';
	var btnVideo = root.querySelector('[data-b=video]'), btnMods = root.querySelector('[data-b=mods]');
	var hudEl = root.querySelector('.hud'), toastEl = root.querySelector('.toast');
	btnVideo.addEventListener('click', function () { openPanel('video'); });
	btnMods.addEventListener('click', function () { openPanel('mods'); });

	var toastTimer = 0;
	function toast(msg) {
		toastEl.textContent = msg;
		toastEl.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
	}

	function canvasEl() { return document.querySelector('#game_frame canvas') || document.querySelector('canvas'); }
	function placeBtn(el, r) {
		var c = canvasEl();
		if (!r || !c || isOpen) { el.style.display = 'none'; return; }
		var b = c.getBoundingClientRect(), k = (b.width / c.width) * screen.s;
		el.style.display = 'flex';
		el.style.opacity = screen.level; // fades in together with the game's screen
		el.style.left = (b.left + r.x * k) + 'px';
		el.style.top = (b.top + r.y * k) + 'px';
		el.style.width = (r.w * k) + 'px';
		el.style.height = (r.h * k) + 'px';
		el.style.fontSize = (8 * k) + 'px';
		el.style.textShadow = k + 'px ' + k + 'px 0 #3f3f3f';
		el.style.borderWidth = Math.max(1, Math.round(k)) + 'px';
	}
	function placeOverlays() {
		placeBtn(btnVideo, screen.name === 'options' ? screen.rects.video : null);
		placeBtn(btnMods, screen.name === 'title' || screen.name === 'pause' ? screen.rects.mods : null);
	}
	window.addEventListener('resize', function () { layoutCache = {}; pendingCheck = true; setScreen(null); });

	// ------------------------------------------------------------ Rise Video Settings (definitions)
	function num(v) { return parseFloat(String(v).replace(/"/g, '')); }
	function q(s) { return '"' + s + '"'; }
	var BOOL = 'bool';
	var VIDEO = [
		{ id: 'general', name: 'General', groups: [
			{ name: 'PRESETS', items: [{ type: 'presets', label: 'Quick Presets', desc: 'Apply a whole bundle at once. Chromebook is tuned for 4GB school Chromebooks.' }] },
			{ name: 'DISPLAY', items: [
				{ key: 'renderDistance', label: 'Render Distance', type: 'slider', min: 2, max: 32, step: 1, fmt: function (v) { return v + ' chunks'; }, impact: 'High', desc: 'How far terrain is drawn. The biggest FPS and memory cost. 4 is the sweet spot on a Chromebook.' },
				{ key: 'simulationDistance', label: 'Simulation Distance', type: 'slider', min: 2, max: 32, step: 1, fmt: function (v) { return v + ' chunks'; }, impact: 'High', desc: 'How far the world keeps ticking (redstone, mobs, crops). Lower is much lighter on the world thread and helps with TNT.' },
				{ key: 'maxFps', label: 'Max Framerate', type: 'slider', min: 10, max: 260, step: 10, fmt: function (v) { return v >= 260 ? 'Unlimited' : v + ' fps'; }, impact: 'Medium', desc: 'On a Chromebook, 60 keeps the CPU cool and leaves room for the world simulation.' },
				{ key: 'gamma', label: 'Brightness', type: 'slider', min: 0, max: 1, step: 0.05, fmt: function (v) { return v <= 0 ? 'Moody' : v >= 1 ? 'Bright' : Math.round(v * 100) + '%'; }, impact: 'None', desc: 'Lightens dark areas.' },
				{ key: 'guiScale', label: 'GUI Scale', type: 'cycle', values: [['0', 'Auto'], ['1', '1x'], ['2', '2x'], ['3', '3x'], ['4', '4x']], impact: 'None', desc: 'Size of menus and the HUD.' },
				{ key: 'enableVsync', label: 'Use VSync', type: BOOL, impact: 'Low', desc: 'Syncs frames to the screen.' },
				{ key: 'bobView', label: 'View Bobbing', type: BOOL, impact: 'None', desc: 'Camera bob while walking.' },
				{ key: 'attackIndicator', label: 'Attack Indicator', type: 'cycle', values: [['0', 'Off'], ['1', 'Crosshair'], ['2', 'Hotbar']], impact: 'None', desc: 'Where the attack cooldown is shown.' },
				{ key: 'inactivityFpsLimit', label: 'Reduce FPS When', type: 'cycle', values: [[q('afk'), 'AFK'], [q('minimized'), 'Minimized']], impact: 'Low', desc: 'AFK drops to 30 fps after a minute without input (saves battery).' }
			] }
		] },
		{ id: 'quality', name: 'Quality', groups: [
			{ name: 'GRAPHICS', items: [
				{ key: 'ao', label: 'Smooth Lighting', type: BOOL, impact: 'Medium', desc: 'Soft shadows in corners. Off makes chunks build faster.' },
				{ key: 'renderClouds', label: 'Clouds', type: 'cycle', values: [[q('false'), 'Off'], [q('fast'), 'Fast'], [q('true'), 'Fancy']], impact: 'Medium', desc: 'Off is fastest.' },
				{ key: 'cloudRange', label: 'Cloud Distance', type: 'slider', min: 2, max: 128, step: 2, fmt: function (v) { return v + ' chunks'; }, impact: 'Low', desc: 'How far clouds are drawn.' },
				{ key: 'particles', label: 'Particles', type: 'cycle', values: [['0', 'All'], ['1', 'Decreased'], ['2', 'Minimal']], impact: 'High', desc: 'TNT and explosions spawn huge numbers of particles. Minimal is the biggest single fix for TNT lag.' },
				{ key: 'weatherRadius', label: 'Weather Radius', type: 'slider', min: 3, max: 10, step: 1, fmt: function (v) { return v + ' blocks'; }, impact: 'Low', desc: 'Area where rain and snow are drawn.' },
				{ key: 'biomeBlendRadius', label: 'Biome Blend', type: 'slider', min: 0, max: 7, step: 1, fmt: function (v) { return v == 0 ? 'OFF' : (v * 2 + 1) + 'x' + (v * 2 + 1); }, impact: 'Medium', desc: 'Blends grass and water colours. Off makes chunks build much faster.' },
				{ key: 'entityShadows', label: 'Entity Shadows', type: BOOL, impact: 'Low', desc: 'Round shadows under mobs and items.' },
				{ key: 'cutoutLeaves', label: 'See-Through Leaves', type: BOOL, impact: 'Medium', desc: 'Off draws leaves solid, much faster in forests.' },
				{ key: 'improvedTransparency', label: 'Improved Transparency', type: BOOL, impact: 'High', desc: 'Fabulous-style screen shaders. Keep off on Chromebooks.' },
				{ key: 'vignette', label: 'Vignette', type: BOOL, impact: 'Low', desc: 'Darkened screen edges.' },
				{ key: 'menuBackgroundBlurriness', label: 'Menu Blur', type: 'slider', min: 0, max: 10, step: 1, fmt: function (v) { return v == 0 ? 'OFF' : v; }, impact: 'Medium', desc: 'Blur behind menus is expensive on weak GPUs.' }
			] },
			{ name: 'TEXTURES', items: [
				{ key: 'mipmapLevels', label: 'Mipmap Levels', type: 'slider', min: 0, max: 4, step: 1, fmt: function (v) { return v == 0 ? 'OFF' : v + 'x'; }, impact: 'Low', desc: 'Smooths distant textures; off saves video memory.' },
				{ key: 'textureFiltering', label: 'Texture Filtering', type: 'cycle', values: [['0', 'None'], ['1', 'RGSS'], ['2', 'Anisotropic']], impact: 'Medium', desc: 'None is fastest.' },
				{ key: 'chunkSectionFadeInTime', label: 'Chunk Fade-In', type: 'slider', min: 0, max: 1, step: 0.25, fmt: function (v) { return v == 0 ? 'OFF' : v + 's'; }, impact: 'Low', desc: 'New chunks fade in instead of popping.' },
				{ key: 'entityDistanceScaling', label: 'Entity Distance', type: 'slider', min: 0.5, max: 5, step: 0.25, fmt: function (v) { return Math.round(v * 100) + '%'; }, impact: 'Medium', desc: 'How far away mobs, items and TNT are drawn.' }
			] }
		] },
		{ id: 'performance', name: 'Performance', groups: [
			{ name: 'RESOLUTION (INSTANT)', items: [
				{ rise: 'hidpi', label: 'HiDPI Rendering', type: BOOL, impact: 'High', desc: 'Render at the screen\'s full pixel density. Off is much faster on 1.25x-2x Chromebook screens.' },
				{ rise: 'scale', label: 'Render Resolution', type: 'cycle', values: [[1, '100%'], [0.85, '85%'], [0.75, '75%'], [0.6, '60%'], [0.5, '50%']], impact: 'High', desc: 'Draws the game at a lower resolution and stretches it. Menus get a little smaller.' },
				{ rise: 'dynamic', label: 'Dynamic Resolution', type: BOOL, impact: 'High', desc: 'Lowers the resolution in steps when FPS drops below the target, raises it when there is headroom.' },
				{ rise: 'targetFps', label: 'Target FPS', type: 'slider', min: 20, max: 120, step: 5, fmt: function (v) { return v + ' fps'; }, impact: 'None', desc: 'What Dynamic Resolution tries to hold.' }
			] },
			{ name: 'ENGINE', items: [
				{ rise: 'chromebook', label: 'Chromebook Mode', type: BOOL, restart: true, impact: 'High', desc: 'One mesh worker on 4-core CPUs and aggressive chunk unloading. Automatic on ChromeOS.' },
				{ rise: 'meshWorkers', label: 'Chunk Mesh Workers', type: 'cycle', values: [[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], restart: true, impact: 'Medium', desc: 'Threads that build chunk meshes. More rebuilds chunks faster after explosions but uses RAM.' },
				{ rise: 'chunkCap', label: 'Chunk Lag Fix', type: BOOL, restart: true, impact: 'Medium', desc: 'Frees far chunks sooner so the tab stays inside 4GB of RAM.' },
				{ key: 'prioritizeChunkUpdates', label: 'Chunk Builder', type: 'cycle', values: [['0', 'Threaded'], ['1', 'Semi Blocking'], ['2', 'Fully Blocking']], impact: 'Medium', desc: 'Threaded is fastest and smoothest during TNT.' },
				{ key: 'syncChunkWrites', label: 'Sync Chunk Writes', type: BOOL, impact: 'Medium', desc: 'Waits for each chunk save. Off is faster.' }
			] }
		] },
		{ id: 'advanced', name: 'Advanced', groups: [
			{ name: 'ADVANCED', items: [
				{ key: 'eaglerPerformanceCounters', label: 'Show FPS & TPS', type: BOOL, impact: 'None', desc: 'The game\'s own counters in the corner.' },
				{ key: 'rawMouseInput', label: 'Raw Mouse Input', type: BOOL, impact: 'None', desc: 'Unaccelerated mouse movement.' },
				{ key: 'pauseOnLostFocus', label: 'Pause On Lost Focus', type: BOOL, impact: 'None', desc: 'Opens the pause menu when you click away.' },
				{ key: 'showAutosaveIndicator', label: 'Autosave Indicator', type: BOOL, impact: 'None', desc: 'Icon while the world saves.' },
				{ key: 'reducedDebugInfo', label: 'Reduced Debug Info', type: BOOL, impact: 'None', desc: 'Hides coordinates on F3.' },
				{ type: 'reset', label: 'Reset Rise Settings', desc: 'Restores Rise\'s own settings. Worlds and keybinds are untouched.' }
			] }
		] }
	];

	// ------------------------------------------------------------ Mods (definitions)
	function modBool(id, label, desc, extra) { return Object.assign({ mod: id, label: label, type: BOOL, desc: desc }, extra || {}); }
	function cmdRow(label, desc, buttons) { return { type: 'actions', label: label, desc: desc, buttons: buttons }; }
	function chord(key, code, kc, label) { return function () { chordQueue.push({ key: key, code: code, kc: kc }); toast(label + ': toggles when you go back to the game'); runChords(); }; }
	function cmd(list, label) { return function () { queueCommands(list, label); }; }
	var REDSTONE_KIT = ['/give @s observer 64', '/give @s piston 64', '/give @s sticky_piston 64', '/give @s slime_block 64', '/give @s honey_block 64', '/give @s redstone 64', '/give @s repeater 64', '/give @s tnt 64', '/give @s redstone_block 64'];
	function opt(id, label, values, desc, extra) { return Object.assign({ mod: id, label: label, type: 'cycle', values: values, desc: desc }, extra || {}); }
	var MODS = [
		{ id: 'hud', name: 'HUD', groups: [{ name: 'HUD', items: [
			modBool('keystrokes', 'Keystrokes', 'Shows W A S D, Space and your mouse buttons on screen, lighting up when you press them.'),
			modBool('cps', 'CPS Counter', 'Shows how many times you click per second (left | right).'),
			modBool('fps', 'FPS Display', 'Shows your real frames per second.', { opts: [
				opt('fpsCorner', 'Position', [['left', 'Top Left'], ['right', 'Top Right']], 'Which corner the counter sits in. Top right is where the game shows tutorial and advancement pop-ups.')] }),
			modBool('crosshair', 'Custom Crosshair', 'Swaps the vanilla crosshair for your own shape and colour. Hiding the vanilla one takes a restart.', { restart: true, opts: [
				opt('crosshairStyle', 'Style', [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle'], ['plus', 'Plus + Dot']], 'Shape.'),
				opt('crosshairColor', 'Colour', [['#40f0dc', 'Turquoise'], ['#1f9bff', 'Ocean'], ['#ffffff', 'White'], ['#ff5470', 'Red'], ['#9dff5c', 'Lime'], ['#ffd166', 'Gold']], 'Colour.'),
				opt('crosshairSize', 'Size', [[0.75, 'Small'], [1, 'Normal'], [1.5, 'Big']], 'Size.')] })
		] }] },
		{ id: 'gameplay', name: 'Gameplay', groups: [{ name: 'GAMEPLAY', items: [
			modBool('zoom', 'Zoom', 'Hold C to zoom in like a spyglass. Scroll while holding C to zoom further.', { opts: [
				opt('zoomLevel', 'Zoom Level', [[2, '2x'], [3, '3x'], [4, '4x'], [6, '6x']], 'How far it zooms when you first press C.')] }),
			modBool('fullbright', 'Fullbright', 'Press K while playing to light up caves and nights.', { opts: [
				opt('fullbrightStrength', 'Strength', [['soft', 'Soft'], ['medium', 'Medium'], ['max', 'Max']], 'How bright the dark parts get.')] }),
			modBool('toggleSprint', 'Toggle Sprint', 'Tap sprint once instead of holding it. Takes a restart.', { restart: true }),
			modBool('toggleSneak', 'Toggle Sneak', 'Tap sneak once instead of holding it. Takes a restart.', { restart: true }),
			cmdRow('Hitboxes', 'Shows the boxes around mobs and items (same as F3+B).', [['Toggle', chord('b', 'KeyB', 66, 'Hitboxes')]]),
			cmdRow('Chunk Borders', 'Shows the lines between chunks (same as F3+G). Great for redstone and farms.', [['Toggle', chord('g', 'KeyG', 71, 'Chunk borders')]]),
			{ type: 'blueprint', label: 'Blueprints', desc: 'Pick a build and follow it layer by layer. [ and ] change layer, B hides it.' }
		] }] },
		{ id: 'redstone', name: 'Redstone', groups: [
			{ name: 'TICK CONTROL (NEEDS CHEATS)', items: [
				cmdRow('Freeze Time', 'Freezes the game so you can look at a railgun or flying machine mid-fire.', [['Freeze', cmd(['/tick freeze'], 'Freeze')], ['Unfreeze', cmd(['/tick unfreeze'], 'Unfreeze')]]),
				cmdRow('Step', 'Moves a frozen world forward tick by tick.', [['1 tick', cmd(['/tick step 1'], 'Step')], ['20 ticks', cmd(['/tick step 20'], 'Step')]]),
				cmdRow('Tick Rate', 'Slow motion or fast forward (normal is 20).', [['5', cmd(['/tick rate 5'], 'Tick rate 5')], ['20', cmd(['/tick rate 20'], 'Tick rate 20')], ['60', cmd(['/tick rate 60'], 'Tick rate 60')]])
			] },
			{ name: 'QUICK COMMANDS (NEEDS CHEATS)', items: [
				cmdRow('Redstone Kit', 'Gives observers, pistons, slime, honey, redstone, repeaters and TNT.', [['Give', cmd(REDSTONE_KIT, 'Redstone Kit')]]),
				cmdRow('Game Mode', 'Switch game mode.', [['Creative', cmd(['/gamemode creative'], 'Creative')], ['Survival', cmd(['/gamemode survival'], 'Survival')]]),
				cmdRow('Time & Weather', 'Daytime and clear skies.', [['Day', cmd(['/time set day'], 'Day')], ['Clear', cmd(['/weather clear'], 'Clear weather')]]),
				cmdRow('World Rules', 'Keep inventory, stop mob griefing, freeze the day cycle.', [['Keep Inv', cmd(['/gamerule keep_inventory true'], 'Keep inventory')], ['No Grief', cmd(['/gamerule mob_griefing false'], 'No mob griefing')], ['Stop Time', cmd(['/gamerule advance_time false'], 'Stop time')]])
			] }
		] },
		{ id: 'lag', name: 'Lag', groups: [
			{ name: 'YOUR COMPUTER', items: [
				modBool('entityCull', 'Entity Culling', 'Far-away mobs and items are not drawn, and entity shadows are off. (The game already skips entities behind you; ones behind walls still draw, that part is inside the engine.) Takes a restart.', { restart: true, opts: [
					opt('cullDistance', 'Draw Distance', [[0.25, 'Short'], [0.5, 'Medium'], [0.75, 'Long']], 'How far away entities are still drawn.', { restart: true })] })
			] },
			{ name: 'THE WORLD (NEEDS CHEATS)', items: [
				modBool('clearLag', 'Clear Lag', 'Like a server ClearLag plugin: while you play, Rise warns you and then clears all dropped items on a timer. Chat opens for a moment when it runs.', { opts: [
					opt('clearLagMinutes', 'Every', [[1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes']], 'How often dropped items are cleared.')] }),
				cmdRow('Clear Items Now', 'Removes every dropped item right away.', [['Clear', cmd(['/kill @e[type=minecraft:item]'], 'Clear items')]]),
				cmdRow('Entity Cramming', 'Mobs squeezed into one block get hurt past this number (normal is 24). Lower thins out crowded mob farms.', [['8', cmd(['/gamerule max_entity_cramming 8'], 'Cramming 8')], ['16', cmd(['/gamerule max_entity_cramming 16'], 'Cramming 16')], ['24', cmd(['/gamerule max_entity_cramming 24'], 'Cramming 24')]]),
				cmdRow('TNT Lag Fix', 'Explosions drop far fewer items (those items are what lag after big blasts). Also set Particles to Minimal in Video Settings.', [['Apply', cmd(['/gamerule tnt_explosion_drop_decay true', '/gamerule block_explosion_drop_decay true'], 'TNT Lag Fix')]])
			] }
		] },
		{ id: 'misc', name: 'Misc', groups: [
			{ name: 'LOOKS (RESTART)', items: [
				modBool('glint', 'Enchant Glint Colour', 'Changes the shimmer on enchanted items and armour.', { restart: true, preview: 'glint', opts: [
					opt('glintColor', 'Colour', [['turquoise', 'Turquoise'], ['red', 'Red'], ['gold', 'Gold'], ['rainbow', 'Rainbow']], 'Glint colour.', { restart: true })] }),
				modBool('glowOres', 'Glowing Ores', 'Ore blocks glow at full brightness, so you can spot them in dark caves. They do not light up the area around them.', { restart: true }),
				modBool('cleanGlass', 'Clean Glass', 'Glass keeps only its thin frame, no streaks, so windows look clear.', { restart: true }),
				modBool('lowFire', 'Low Fire', 'Shrinks the fire on your screen (and fire blocks) so you can see.', { restart: true }),
				modBool('clearWater', 'Clear Water', 'Makes the water texture mostly see-through.', { restart: true }),
				modBool('noPumpkin', 'No Pumpkin Blur', 'Removes the carved-pumpkin overlay when you wear one.', { restart: true })
			] },
			{ name: 'SHADERS', items: [
				modBool('shader', 'Shader Filter', 'Colour-grades the whole game for a different look, instantly. These are colour filters, not full shaders (no shadows or waving leaves), and they cost a tiny bit of GPU. For less lag use the Performance tab in Video Settings.', { preview: 'shader', opts: [
					opt('shaderStyle', 'Look', [['vibrant', 'Vibrant'], ['cinematic', 'Cinematic'], ['sunset', 'Sunset'], ['ocean', 'Ocean'], ['dreamy', 'Dreamy'], ['noir', 'Noir']], 'Which look.')] })
			] },
			{ name: 'CAMERA (RESTART)', items: [
				modBool('noHurtTilt', 'No Hurt Shake', 'The screen does not tilt when you take damage.', { restart: true }),
				modBool('noFovFx', 'No FOV Change', 'The view does not zoom in and out when you sprint or get speed.', { restart: true }),
				modBool('noWobble', 'No Screen Wobble', 'Removes the nausea and portal wobble effects.', { restart: true }),
				modBool('noLightning', 'No Lightning Flash', 'Lightning no longer flashes the whole sky white.', { restart: true })
			] },
			{ name: 'ABOUT', items: [{ type: 'about', label: 'Rise Client ' + VERSION, desc: 'Eaglercraft 26.2 by o_xer, based on EaglercraftX 1.8 by lax1dude. Minecraft is (c) Mojang.' }] }
		] },
		{ id: 'skins', name: 'Skins', skins: true, groups: [] }
	];

	// ------------------------------------------------------------ panels
	var isOpen = false, scrim = null, which = null, current = null, staged = {}, stagedRise = {}, stagedMods = {}, page = { video: 'general', mods: 'hud' };
	function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

	async function openPanel(kind) {
		if (isOpen) { if (which === kind) return; closePanel(); }
		isOpen = true; which = kind;
		placeOverlays();
		if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) {}
		current = (await readOptions()) || { map: {}, order: [] };
		staged = Object.assign({}, readJSON(PENDING_KEY) || {});
		stagedRise = {}; stagedMods = {};
		build();
		void scrim.offsetWidth; // commit the closed state so the fade-in runs
		scrim.classList.add('open');
		updateHud();
	}
	function closePanel() {
		cardEl = null;
		isOpen = false;
		if (scrim) {
			var s = scrim; scrim = null;
			s.classList.remove('open');
			s.style.pointerEvents = 'none'; // clicks during the fade-out go to the game
			setTimeout(function () { s.remove(); }, 210);
		}
		pendingCheck = true; boostUntil = performance.now() + 2500;
		updateHud();
	}

	function valueOf(it) {
		if (it.rise) return it.rise in stagedRise ? stagedRise[it.rise] : cfg[it.rise];
		if (it.mod) return it.mod in stagedMods ? stagedMods[it.mod] : mods[it.mod];
		if (it.key in staged) return staged[it.key];
		return current.map[it.key];
	}
	function isModified(it) {
		if (it.rise) return it.rise in stagedRise && stagedRise[it.rise] !== cfg[it.rise];
		if (it.mod) return it.mod in stagedMods && stagedMods[it.mod] !== mods[it.mod];
		return it.key in staged && staged[it.key] !== current.map[it.key];
	}
	function setValue(it, v) {
		if (it.rise) {
			if (it.restart) stagedRise[it.rise] = v;
			else { cfg[it.rise] = v; saveCfg(); dynScale = 1; applyScale(); }
		} else if (it.mod) {
			if (it.restart) stagedMods[it.mod] = v;
			else { mods[it.mod] = v; saveMods(); applyMods(); }
			if (cardEl && cardEl._pic) cardEl._pic._draw();
			if (it.mod === 'crosshair') { mods.crosshair = v; saveMods(); applyMods(); } // overlay is instant; only the vanilla hide waits
		} else {
			staged[it.key] = v;
			if (cardEl && cardEl._pic) cardEl._pic._draw();
			if (['renderClouds', 'particles', 'ao', 'biomeBlendRadius', 'entityShadows', 'cutoutLeaves', 'improvedTransparency', 'mipmapLevels', 'textureFiltering', 'renderDistance', 'simulationDistance'].indexOf(it.key) >= 0) staged.graphicsPreset = q('custom');
		}
		refresh();
	}
	function needsRestart() {
		for (var a in staged) if (staged[a] !== current.map[a]) return true;
		for (var b in stagedRise) if (stagedRise[b] !== cfg[b]) return true;
		for (var c in stagedMods) if (c !== 'crosshair' && JSON.stringify(stagedMods[c]) !== JSON.stringify(mods[c])) return true;
		if (stagedMods.crosshair !== undefined && packStamp().indexOf('rise_crosshair') < 0 && stagedMods.crosshair) return true;
		return false;
	}
	function packStamp() { return readJSON('rise.packs.' + VERSION) || []; }
	function commit(restart) {
		for (var r in stagedRise) cfg[r] = stagedRise[r];
		for (var m in stagedMods) mods[m] = stagedMods[m];
		stagedRise = {}; stagedMods = {};
		saveCfg(); saveMods();
		var pend = {};
		for (var key in staged) if (staged[key] !== current.map[key]) pend[key] = staged[key];
		if (Object.keys(pend).length) writeJSON(PENDING_KEY, pend);
		if (restart) { toast('Restarting Rise Client…'); setTimeout(function () { location.reload(); }, 450); }
	}

	function build() {
		if (scrim) scrim.remove();
		var defs = which === 'video' ? VIDEO : MODS;
		scrim = el('div', 'scrim mc big ' + (which === 'mods' ? 'wide' : 'video'));
		var tabs = el('div', 'tabs'), list = el('div', 'list'), info = el('div', 'info');
		defs.forEach(function (p) {
			var t = el('div', 'tab' + (p.id === page[which] ? ' on' : ''), p.name);
			t.onclick = function () { page[which] = p.id; tabs.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === t); }); renderList(); };
			tabs.appendChild(t);
		});
		var note = el('div', 'note', 'Some changes apply after a restart. Save & quit your world first.');
		var bar = el('div', 'bar');
		var apply = el('div', 'btn', 'Apply');
		var done = el('div', 'btn', 'Done');
		apply.onclick = function () { if (needsRestart()) commit(true); else { commit(false); toast('Applied'); } };
		done.onclick = function () { commit(false); if (needsRestart()) toast('Saved: applies next time you open Rise'); closePanel(); };
		bar.appendChild(apply); bar.appendChild(done);
		scrim.appendChild(tabs); scrim.appendChild(list); scrim.appendChild(info); scrim.appendChild(note); scrim.appendChild(bar);
		root.appendChild(scrim);
		scrim._list = list; scrim._info = info; scrim._note = note; scrim._apply = apply; scrim._defs = defs;
		renderList();
	}
	function refresh() {
		if (!scrim) return;
		var r = needsRestart();
		scrim._note.classList.toggle('show', r);
		scrim._apply.textContent = r ? 'Apply & Restart' : 'Apply';
		scrim._list.querySelectorAll('.row').forEach(function (row) { if (row._it && (row._it.key || row._it.rise || row._it.mod)) row.classList.toggle('mod', isModified(row._it)); });
	}
	function showInfo(it, text) {
		if (!scrim) return;
		var info = scrim._info;
		info.textContent = '';
		info.appendChild(el('b', null, it.label + (text ? ': ' + text : '')));
		if (it.desc) info.appendChild(el('p', null, it.desc));
		if (it.impact) info.appendChild(el('i', null, 'Performance impact: ' + it.impact));
		if (it.restart || it.key) { var pr = el('p', null, 'Applies after restart.'); pr.style.marginTop = '6px'; info.appendChild(pr); }
		info.classList.add('show');
	}
	function renderList() {
		var list = scrim._list;
		list.textContent = '';
		var p = scrim._defs.filter(function (x) { return x.id === page[which]; })[0];
		if (p.skins) { renderSkins(list); scrim._info.classList.remove('show'); refresh(); return; }
		list.appendChild(el('div', 'hint', which === 'mods' ? 'Tick a box to turn a mod on. Right-click a mod to see what it does and change its settings.' : 'Right-click an option to see what it does.'));
		p.groups.forEach(function (g) {
			list.appendChild(el('div', 'gh', g.name));
			g.items.forEach(function (it) { list.appendChild(renderRow(it)); });
		});
		scrim._info.classList.remove('show');
		refresh();
	}
	function cycleLabel(it) {
		var v = valueOf(it);
		var hit = it.values.filter(function (x) { return String(x[0]) === String(v); })[0];
		return hit ? hit[1] : (v == null ? it.values[0][1] : String(v).replace(/"/g, ''));
	}
	function renderRow(it) {
		var row = el('div', 'row'); row._it = it;
		row.appendChild(el('div', 'lbl', it.label));
		var right = el('div', 'acts');
		var curText = function () { return ''; };
		if (it.type === BOOL) {
			var v0 = valueOf(it);
			var c = el('div', 'chk' + (v0 === true || v0 === 'true' ? ' on' : ''));
			c.onclick = function () {
				var now = !c.classList.contains('on');
				c.classList.toggle('on', now);
				setValue(it, it.key ? (now ? 'true' : 'false') : now);
				showInfo(it, now ? 'ON' : 'OFF');
			};
			curText = function () { return c.classList.contains('on') ? 'ON' : 'OFF'; };
			right.appendChild(c);
		} else if (it.type === 'cycle') {
			var b = el('div', 'val', cycleLabel(it));
			var step = function (d) {
				var vals = it.values.map(function (x) { return String(x[0]); });
				var idx = vals.indexOf(String(valueOf(it)));
				idx = ((idx < 0 ? 0 : idx) + d + vals.length) % vals.length;
				setValue(it, it.values[idx][0]);
				b.textContent = cycleLabel(it);
				showInfo(it, b.textContent);
			};
			b.onclick = function () { step(1); };
			b.oncontextmenu = function (e) { e.preventDefault(); e.stopPropagation(); step(-1); };
			curText = function () { return b.textContent; };
			right.appendChild(b);
		} else if (it.type === 'slider') {
			var wrap = el('div', 'sl'), out = el('span'), r = el('input');
			r.type = 'range'; r.min = it.min; r.max = it.max; r.step = it.step;
			var v1 = valueOf(it);
			r.value = v1 == null ? it.min : num(v1);
			var paint = function () {
				var v = parseFloat(r.value);
				r.style.setProperty('--p', ((v - it.min) / (it.max - it.min) * 100) + '%');
				out.textContent = it.fmt ? it.fmt(v) : v;
			};
			r.oninput = function () {
				paint();
				var v = parseFloat(r.value);
				if (it.rise || it.mod) setValue(it, v);
				else setValue(it, it.step < 1 && String(v).indexOf('.') < 0 ? v.toFixed(1) : String(v));
				showInfo(it, out.textContent);
			};
			paint();
			curText = function () { return out.textContent; };
			wrap.appendChild(out); wrap.appendChild(r); right.appendChild(wrap);
		} else if (it.type === 'presets') {
			[['chromebook', 'Chromebook'], ['balanced', 'Balanced'], ['quality', 'Quality']].forEach(function (pr) {
				var pb = el('div', 'btn small', pr[1]);
				pb.onclick = function () {
					var vals = PRESETS[pr[0]];
					for (var key in vals) staged[key] = vals[key];
					if (pr[0] === 'chromebook') { stagedRise.chromebook = true; stagedRise.chunkCap = true; cfg.hidpi = false; }
					else { stagedRise.chromebook = false; stagedRise.chunkCap = false; if (pr[0] === 'quality') cfg.hidpi = true; }
					saveCfg(); applyScale(); renderList(); toast(pr[1] + ' preset ready: press Apply & Restart');
				};
				right.appendChild(pb);
			});
		} else if (it.type === 'actions') {
			it.buttons.forEach(function (bt) { var ab = el('div', 'btn small', bt[0]); ab.onclick = bt[1]; right.appendChild(ab); });
		} else if (it.type === 'blueprint') {
			var ob = el('div', 'btn small', 'Open');
			ob.onclick = function () { closePanel(); openBlueprint(); };
			right.appendChild(ob);
		} else if (it.type === 'reset') {
			var rb = el('div', 'btn small', 'Reset');
			rb.onclick = function () { var seeded = cfg.seeded; cfg = Object.assign({}, DEF_CFG, { seeded: seeded }); saveCfg(); dynScale = 1; applyScale(); stagedRise = {}; renderList(); toast('Rise settings reset'); };
			right.appendChild(rb);
		}
		row.addEventListener('mouseenter', function () { showInfo(it, curText()); });
		row.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!row._inCard) openCard(it); });
		if (it.type === BOOL) row.querySelector('.lbl').addEventListener('click', function () { var ch = row.querySelector('.chk'); if (ch) ch.click(); });
		if (it.opts && !row._inCard) row.querySelector('.lbl').textContent = it.label + '  ...';
		row.appendChild(right);
		return row;
	}

	// ---- Skins tab
	var skinFilter = { q: '', cat: 'All' };
	var SKIN_CATS = ['All', 'Weapons', 'Tools', 'Food', 'Totems', 'Pearls', 'Animated', 'Equipped'];
	function curSkins() { return valueOf({ mod: 'skins' }) || {}; }
	function skinPic(s, size) {
		var d = el('div', 'sk' + (s.frames > 1 ? ' an' : ''));
		d.style.width = d.style.height = size + 'px';
		d.style.backgroundSize = size + 'px auto';
		d.style.backgroundImage = dataPng(s.img);
		if (s.frames > 1) { d.style.setProperty('--n', s.frames); d.style.setProperty('--h', (-size * s.frames) + 'px'); d.style.setProperty('--t', (s.frames * 0.1) + 's'); }
		else if (s.group === 'shield') { d.style.backgroundSize = 'auto ' + size + 'px'; d.style.backgroundPosition = 'center'; }
		return d;
	}
	function toggleSkin(s) {
		var cur = Object.assign({}, curSkins());
		cur[s.group] = cur[s.group] === s.id ? null : s.id;
		setValue({ mod: 'skins', restart: true }, cur);
	}
	function renderSkins(list) {
		var bar = el('div', 'sbar');
		var q = el('input'); q.placeholder = 'Search skins...'; q.value = skinFilter.q; q.spellcheck = false;
		bar.appendChild(q);
		SKIN_CATS.forEach(function (c) {
			var ch = el('div', 'chip' + (skinFilter.cat === c ? ' on' : ''), c);
			ch.onclick = function () { skinFilter.cat = c; renderList(); };
			bar.appendChild(ch);
		});
		list.appendChild(bar);
		list.appendChild(el('div', 'hint', 'Click a skin to wear it (one per item), click again to take it off. Right-click for a closer look. Skins only change how things look. Press Apply & Restart when you are done.'));
		var grid = el('div', 'grid');
		list.appendChild(grid);
		function fill() {
			grid.textContent = '';
			var eq = curSkins(), terms = skinFilter.q.toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
			SKINS.list.forEach(function (s) {
				if (skinFilter.cat === 'Animated' && !s.anim) return;
				if (skinFilter.cat === 'Equipped' && eq[s.group] !== s.id) return;
				if (['All', 'Animated', 'Equipped'].indexOf(skinFilter.cat) < 0 && s.cat !== skinFilter.cat) return;
				var hay = (s.name + ' ' + s.groupName + ' ' + s.cat + ' ' + s.desc + (s.anim ? ' animated' : '')).toLowerCase();
				if (terms.some(function (w) { return hay.indexOf(w) < 0; })) return;
				var tl = el('div', 'tile' + (eq[s.group] === s.id ? ' eq' : ''));
				tl.appendChild(skinPic(s, 96));
				tl.appendChild(el('div', 'nm', s.name));
				tl.appendChild(el('div', 'gp', s.groupName));
				if (s.anim) tl.appendChild(el('div', 'badge', 'ANIMATED'));
				if (eq[s.group] === s.id) tl.appendChild(el('div', 'eqb', 'WEARING'));
				tl.onclick = function () { toggleSkin(s); fill(); };
				tl.oncontextmenu = function (e) { e.preventDefault(); openSkinCard(s, fill); };
				grid.appendChild(tl); shown++;
			});
			if (!shown) grid.appendChild(el('div', 'hint', 'No skins match.'));
		}
		q.oninput = function () { skinFilter.q = q.value; fill(); };
		fill();
		setTimeout(function () { try { q.focus({ preventScroll: true }); } catch (e) {} }, 0);
	}
	function openSkinCard(s, onChange) {
		closeCard();
		var bg = el('div', 'cardbg'), card = el('div', 'card');
		card.appendChild(el('h2', null, s.name));
		var pic = el('div', 'pic'); pic.appendChild(skinPic(s, 112)); card.appendChild(pic);
		if (s.tints && s.tints.length) {
			var tr = el('div', 'tints');
			s.tints.forEach(function (b) { tr.appendChild(img(b, 40)); });
			card.appendChild(tr);
		}
		card.appendChild(el('div', 'what', s.desc + (s.anim ? ' (Animated.)' : '') + ' Replaces: ' + s.groupName + '.'));
		var foot = el('div', 'foot'), wear = el('div', 'btn small', curSkins()[s.group] === s.id ? 'Take Off' : 'Wear'), done = el('div', 'btn small', 'Done');
		wear.onclick = function () { toggleSkin(s); wear.textContent = curSkins()[s.group] === s.id ? 'Take Off' : 'Wear'; if (onChange) onChange(); };
		done.onclick = function () { closeCard(); };
		foot.style.gap = '8px'; foot.appendChild(wear); foot.appendChild(done); card.appendChild(foot);
		card.appendChild(el('div', 'rs', 'Skins apply after Apply & Restart.'));
		bg.appendChild(card);
		bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeCard(); });
		bg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
		scrim.appendChild(bg);
		cardEl = bg;
		void bg.offsetWidth; bg.classList.add('open');
	}

	// pictures in the right-click card
	var ICON_OF = { 'Hitboxes': 'hitboxes', 'Chunk Borders': 'chunks', 'Blueprints': 'blueprint', 'Freeze Time': 'freeze', 'Step': 'step', 'Tick Rate': 'rate',
		'Redstone Kit': 'kit', 'Game Mode': 'gamemode', 'Time & Weather': 'time', 'World Rules': 'rules', 'Clear Items Now': 'clearItems',
		'Entity Cramming': 'cramming', 'TNT Lag Fix': 'tnt' };
	function dataPng(b64) { return 'url(data:image/png;base64,' + b64 + ')'; }
	function img(b64, size) { var i = el('img'); i.src = 'data:image/png;base64,' + b64; i.style.width = i.style.height = (size || 80) + 'px'; return i; }
	function buildPic(it) {
		var box = el('div', 'pic'), kind = it.preview || it.mod || ICON_OF[it.label];
		if (!kind) return null;
		function draw() {
			box.textContent = '';
			if (kind === 'totem' || kind === 'pearl') {
				var skin = valueOf({ mod: kind === 'totem' ? 'totemSkin' : 'pearlSkin' }), p = PREVIEWS[kind][skin];
				if (!p) return;
				if (p.frames > 1) {
					var st = el('div', 'strip');
					st.style.backgroundImage = dataPng(p.img);
					st.style.setProperty('--n', p.frames); st.style.setProperty('--h', (-96 * p.frames) + 'px'); st.style.setProperty('--t', (p.frames * 0.1) + 's');
					box.appendChild(st);
				} else {
					var im = img(p.img, 96); im.style.width = 'auto'; im.style.height = '104px'; box.appendChild(im);
				}
			} else if (kind === 'glint') {
				box.appendChild(img(PREVIEWS.icons.glint, 96));
				var g = el('div', 'glint'), b = 'url(data:image/png;base64,' + PREVIEWS.icons.glint + ')';
				g.style.backgroundImage = dataPng(PREVIEWS.glint[valueOf({ mod: 'glintColor' })] || PREVIEWS.glint.turquoise);
				g.style.webkitMaskImage = b; g.style.maskImage = b;
				box.appendChild(g);
			} else if (kind === 'shader' || kind === 'crosshair' || kind === 'fullbright') {
				var sc = img(PREVIEWS.scene); sc.className = 'scene'; sc.style.width = sc.style.height = '100%';
				if (kind === 'shader') sc.style.filter = SHADERS[valueOf({ mod: 'shaderStyle' })]; // preview the chosen look even while off
				if (kind === 'fullbright') sc.style.filter = 'brightness(.35)';
				box.appendChild(sc);
				if (kind === 'shader' && valueOf({ mod: 'shaderStyle' }) === 'cinematic') { var v = el('div'); v.style.cssText = 'position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,.5) 100%)'; box.appendChild(v); }
				if (kind === 'fullbright') {
					var half = img(PREVIEWS.scene); half.className = 'scene';
					half.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;clip-path:inset(0 0 0 50%)';
					half.style.filter = 'brightness(.35) url(#rise-fullbright-' + (valueOf({ mod: 'fullbrightStrength' }) || 'medium') + ')';
					ensureFullbrightFilter(); box.appendChild(half);
				}
				if (kind === 'crosshair') {
					var saved = [mods.crosshairStyle, mods.crosshairColor];
					mods.crosshairStyle = valueOf({ mod: 'crosshairStyle' }); mods.crosshairColor = valueOf({ mod: 'crosshairColor' });
					var sz = 30 * (valueOf({ mod: 'crosshairSize' }) || 1);
					var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
					svg.setAttribute('viewBox', '0 0 24 24'); svg.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:' + sz + 'px;height:' + sz + 'px';
					svg.innerHTML = crosshairSVG();
					mods.crosshairStyle = saved[0]; mods.crosshairColor = saved[1];
					box.appendChild(svg);
				}
			} else if (kind === 'keystrokes') {
				var m = el('div', 'mock'); m.innerHTML = '<div class="ks" style="position:static"><div class="w on">W</div><div class="a">A</div><div>S</div><div class="on">D</div><div class="mouse"><div class="on">LMB</div><div>RMB</div></div><div class="wide">SPACE</div></div>';
				box.appendChild(m);
			} else if (kind === 'cps') {
				var c = el('div', 'cps'); c.style.position = 'static'; c.textContent = '9 | 2 CPS'; c.style.fontSize = '22px'; box.appendChild(c);
			} else if (kind === 'fps') {
				var f = el('div', 'fps'); f.style.cssText = 'position:static;font-size:22px;padding:6px 10px;background:rgba(2,18,34,.55)'; f.textContent = '120 FPS'; box.appendChild(f);
			} else if (PREVIEWS.icons[kind]) {
				box.appendChild(img(PREVIEWS.icons[kind], 88));
			} else return;
		}
		draw();
		box._draw = draw;
		return box;
	}

	// right-click card: what a mod does + its settings
	var cardEl = null;
	function openCard(it) {
		closeCard();
		var bg = el('div', 'cardbg'), card = el('div', 'card');
		card.appendChild(el('h2', null, it.label));
		var pic = which === 'mods' ? buildPic(it) : null;
		if (pic) card.appendChild(pic);
		card.appendChild(el('div', 'what', it.desc || ''));
		var add = function (item) { var r = renderRow(item); r._inCard = true; card.appendChild(r); };
		if (it.type === BOOL) {
			var on = Object.assign({}, it, { label: it.key || it.rise ? 'On' : 'Enabled', opts: null });
			add(on);
		} else if (it.type === 'actions' || it.type === 'blueprint' || it.type === 'cycle' || it.type === 'slider' || it.type === 'presets') {
			add(Object.assign({}, it, { label: it.type === 'actions' ? 'Run' : 'Value' }));
		}
		(it.opts || []).forEach(add);
		if (it.restart || it.key || (it.opts || []).some(function (o) { return o.restart; })) card.appendChild(el('div', 'rs', 'Some of this applies after a restart (press Apply & Restart).'));
		var foot = el('div', 'foot'), done = el('div', 'btn small', 'Done');
		done.onclick = function () { closeCard(); };
		foot.appendChild(done); card.appendChild(foot);
		bg.appendChild(card);
		bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeCard(); });
		bg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
		scrim.appendChild(bg);
		cardEl = bg;
		cardEl._pic = pic;
		void bg.offsetWidth; bg.classList.add('open');
	}
	function closeCard() {
		if (!cardEl) return;
		var c = cardEl; cardEl = null;
		c.classList.remove('open'); c.style.pointerEvents = 'none';
		setTimeout(function () { c.remove(); }, 160);
		if (scrim) renderList(); // main list picks up changes made in the card
	}

	// ------------------------------------------------------------ mods runtime
	var keysDown = {}, clicksL = [], clicksR = [], persp = 0, hideGui = false, zooming = false, zoom = 3;
	function gameFrame() { return document.getElementById('game_frame'); }
	function ensureFullbrightFilter() {
		if (fbSvg) return;
		fbSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		fbSvg.setAttribute('width', '0'); fbSvg.setAttribute('height', '0');
		fbSvg.style.cssText = 'position:absolute;width:0;height:0';
		// shadow lift that pins white at white, so daylight stays normal (a bare gamma looks like milk)
		var T = { soft: '0 0.3 0.55 0.8 1', medium: '0 0.47 0.68 0.86 1', max: '0.16 0.6 0.79 0.92 1' };
		fbSvg.innerHTML = Object.keys(T).map(function (k) {
			return '<filter id="rise-fullbright-' + k + '" color-interpolation-filters="sRGB"><feComponentTransfer>' +
				'<feFuncR type="table" tableValues="' + T[k] + '"/><feFuncG type="table" tableValues="' + T[k] + '"/><feFuncB type="table" tableValues="' + T[k] + '"/>' +
				'</feComponentTransfer><feColorMatrix type="saturate" values="1.12"/></filter>';
		}).join('');
		if (document.body) document.body.appendChild(fbSvg);
	}
	function applyFrameEffects() {
		var gf = gameFrame();
		if (!gf) return;
		var fb = mods.fullbright && mods.fullbrightOn;
		if (fb) ensureFullbrightFilter();
		var f = (fb ? 'url(#rise-fullbright-' + (mods.fullbrightStrength || 'medium') + ') ' : '') + (mods.shader ? SHADERS[mods.shaderStyle] || '' : '');
		f = f.trim();
		var vg = hudEl.querySelector('.vig');
		if (vg) vg.style.display = mods.shader && mods.shaderStyle === 'cinematic' ? '' : 'none';
		if (gf.style.filter !== f) gf.style.filter = f;
		var t = zooming && document.pointerLockElement ? 'scale(' + zoom.toFixed(3) + ')' : '';
		if (gf.style.transform !== t) { gf.style.transition = 'transform .12s ease-out'; gf.style.transform = t; }
	}
	var SHADERS = {
		vibrant: 'saturate(1.35) contrast(1.06)',
		cinematic: 'contrast(1.14) saturate(0.9) brightness(0.97) sepia(0.12)',
		sunset: 'sepia(0.32) saturate(1.35) hue-rotate(-12deg) brightness(1.03)',
		ocean: 'sepia(0.28) hue-rotate(150deg) saturate(1.25) brightness(1.02)',
		dreamy: 'saturate(1.25) brightness(1.07) contrast(0.93)',
		noir: 'grayscale(1) contrast(1.25)'
	};
	function crosshairSVG() {
		var c = mods.crosshairColor, s = mods.crosshairStyle;
		if (s === 'dot') return '<circle cx="12" cy="12" r="2.4" fill="' + c + '" stroke="#000" stroke-opacity=".55"/>';
		if (s === 'circle') return '<circle cx="12" cy="12" r="6" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="12" cy="12" r="1.2" fill="' + c + '"/>';
		if (s === 'plus') return '<path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="' + c + '" stroke-width="2"/><circle cx="12" cy="12" r="1.3" fill="' + c + '"/>';
		return '<path d="M12 2v8M12 14v8M2 12h8M14 12h8" stroke="' + c + '" stroke-width="2"/>';
	}
	var hudBuilt = '';
	function applyMods() {
		var sig = [mods.shader, mods.shaderStyle, mods.keystrokes, mods.cps, mods.fps, mods.fpsCorner, mods.crosshair, mods.crosshairStyle, mods.crosshairColor, mods.crosshairSize].join();
		if (sig !== hudBuilt) {
			hudBuilt = sig;
			var h = '';
			h += '<div class="vig" style="position:absolute;inset:0;display:none;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.45) 100%)"></div>';
			if (mods.fps) h += '<div class="fps"' + (mods.fpsCorner === 'left' ? ' style="left:8px;right:auto;top:20px"' : '') + '>0 FPS</div>';
			if (mods.keystrokes) h += '<div class="ks"' + (mods.fps && mods.fpsCorner === 'left' ? ' style="top:52px"' : '') + '><div class="w" data-k="KeyW">W</div><div class="a" data-k="KeyA">A</div><div data-k="KeyS">S</div><div data-k="KeyD">D</div>' +
				'<div class="mouse"><div data-k="M0">LMB</div><div data-k="M2">RMB</div></div><div class="wide" data-k="Space">SPACE</div></div>';
			var top = (mods.fps && mods.fpsCorner === 'left' ? 52 : 34);
			if (mods.cps) h += '<div class="cps" style="top:' + (mods.keystrokes ? top + 156 : top) + 'px">0 | 0 CPS</div>';
			if (mods.crosshair) h += '<svg class="xh" viewBox="0 0 24 24" style="width:' + (24 * mods.crosshairSize) + 'px;height:' + (24 * mods.crosshairSize) + 'px">' + crosshairSVG() + '</svg>';
			hudEl.innerHTML = h;
		}
		applyFrameEffects();
		updateHud();
	}
	function updateHud() {
		var playing = !!document.pointerLockElement && !hideGui && !isOpen;
		hudEl.style.display = (playing || (mods.fps && !isOpen && gameReady() && !hideGui)) ? '' : 'none';
		var ks = hudEl.querySelector('.ks'), xh = hudEl.querySelector('.xh'), cps = hudEl.querySelector('.cps');
		if (ks) { ks.style.display = playing ? '' : 'none'; ks.querySelectorAll('[data-k]').forEach(function (d) { d.classList.toggle('on', !!keysDown[d.getAttribute('data-k')]); }); }
		if (xh) xh.style.display = playing && persp === 0 ? '' : 'none';
		if (cps) {
			cps.style.display = playing ? '' : 'none';
			var now = performance.now();
			clicksL = clicksL.filter(function (t) { return now - t < 1000; });
			clicksR = clicksR.filter(function (t) { return now - t < 1000; });
			cps.textContent = clicksL.length + ' | ' + clicksR.length + ' CPS';
		}
	}
	setInterval(updateHud, 100);

	var bpLoaded = false;
	function openBlueprint() {
		if (!bpLoaded) {
			bpLoaded = true;
			try { (new Function(BLUEPRINT_SRC))(); } catch (e) { console.warn('[Rise] blueprint', e); toast('Blueprints failed to load'); return; }
		}
		setTimeout(function () { if (window.__blueprintMod && window.__blueprintMod.open) window.__blueprintMod.open(); }, 50);
	}

	// FPS + dynamic resolution from real presented frames
	var lastFpsT = performance.now(), lastPresents = 0, lastChange = 0;
	setInterval(function () {
		var t = performance.now();
		fps = (presents - lastPresents) * 1000 / (t - lastFpsT);
		lastPresents = presents; lastFpsT = t;
		var f = hudEl.querySelector('.fps');
		if (f) f.textContent = Math.round(fps) + ' FPS';
		if (cfg.dynamic && armed && document.pointerLockElement && t - lastChange > 8000) {
			var next = dynScale;
			if (fps < cfg.targetFps * 0.85 && dynScale > 0.55) next = Math.round((dynScale - 0.15) * 100) / 100;
			else if (fps > cfg.targetFps * 1.15 && dynScale < 1) next = Math.min(1, Math.round((dynScale + 0.15) * 100) / 100);
			if (next !== dynScale) { dynScale = next; lastChange = t; applyScale(); }
		}
	}, 1000);
	onFrame = watcher;

	// Clear Lag: countdown only advances while you are actually playing
	var lagLeft = 180, lagWarned = false, lagEvery = 0;
	setInterval(function () {
		if (!mods.clearLag || !document.pointerLockElement) return;
		var every = (mods.clearLagMinutes || 3) * 60;
		if (every !== lagEvery) { lagEvery = every; lagLeft = every; }
		lagLeft--;
		if (lagLeft === 10 && !lagWarned) { lagWarned = true; toast('Clear Lag: dropped items clear in 10 seconds'); }
		if (lagLeft <= 0) {
			lagLeft = lagEvery; lagWarned = false;
			queueCommands(['/kill @e[type=minecraft:item]'], 'Clear Lag');
		}
	}, 1000);

	// ------------------------------------------------------------ input
	function isRShift(e) { return e.code === 'ShiftRight' || (e.key === 'Shift' && e.location === 2); }
	function codeOf(e) { return e.code || (e.key && e.key.length === 1 ? 'Key' + e.key.toUpperCase() : e.key); }
	window.addEventListener('keydown', function (e) {
		if (synth) return;
		if (isOpen) {
			if (e.key === 'Escape' || e.code === 'Escape') { if (cardEl) closeCard(); else { commit(false); closePanel(); } e.stopImmediatePropagation(); return; }
			var inField = e.composedPath && e.composedPath()[0] && e.composedPath()[0].tagName === 'INPUT';
			if (!inField) e.stopImmediatePropagation();
			return;
		}
		if (isRShift(e) && !e.repeat && gameReady()) { e.preventDefault(); e.stopImmediatePropagation(); openPanel('video'); return; }
		if (!document.pointerLockElement) { pendingCheck = true; boostUntil = performance.now() + 2500; return; }
		var c = codeOf(e);
		keysDown[c] = true;
		if (c === 'F1' && !e.repeat) hideGui = !hideGui;
		if (c === 'F5' && !e.repeat) persp = (persp + 1) % 3;
		if (mods.zoom && c === 'KeyC') {
			e.stopImmediatePropagation(); e.preventDefault();
			if (!zooming) { zooming = true; zoom = mods.zoomLevel; applyFrameEffects(); }
			return;
		}
		if (mods.fullbright && c === 'KeyK' && !e.repeat) {
			e.stopImmediatePropagation();
			mods.fullbrightOn = !mods.fullbrightOn; saveMods(); applyFrameEffects();
			toast('Fullbright ' + (mods.fullbrightOn ? 'ON' : 'OFF'));
		}
	}, true);
	window.addEventListener('keyup', function (e) {
		if (synth) return;
		if (isOpen || isRShift(e)) {
			var inField = e.composedPath && e.composedPath()[0] && e.composedPath()[0].tagName === 'INPUT';
			if (!inField) e.stopImmediatePropagation();
			return;
		}
		var c = codeOf(e);
		delete keysDown[c];
		if (c === 'KeyC' && zooming) { zooming = false; applyFrameEffects(); e.stopImmediatePropagation(); }
	}, true);
	window.addEventListener('wheel', function (e) {
		if (zooming && document.pointerLockElement) {
			e.stopImmediatePropagation(); e.preventDefault();
			zoom = Math.max(1.5, Math.min(10, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
			applyFrameEffects();
		}
	}, { capture: true, passive: false });
	window.addEventListener('mousedown', function (e) {
		if (document.pointerLockElement) {
			keysDown['M' + e.button] = true;
			if (e.button === 0) clicksL.push(performance.now());
			if (e.button === 2) clicksR.push(performance.now());
		} else if (!isOpen && e.composedPath().indexOf(host) < 0) {
			// a click in a menu may change screen: check every frame for a while
			// (the watcher runs inside the game's frame, so buttons never lag behind)
			pendingCheck = true; boostUntil = performance.now() + 2500;
		}
	}, true);
	window.addEventListener('mouseup', function (e) { delete keysDown['M' + e.button]; pendingCheck = true; }, true);
	document.addEventListener('pointerlockchange', function () {
		keysDown = {};
		if (!document.pointerLockElement && zooming) zooming = false;
		applyFrameEffects(); updateHud();
		pendingCheck = true; boostUntil = performance.now() + 2500;
		if (document.pointerLockElement) { runCommands(); runChords(); }
	});
	// our own handlers (inside the shadow root) run first; stop events at the host
	['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'mousemove', 'touchstart', 'touchmove', 'touchend'].forEach(function (t) {
		host.addEventListener(t, function (e) { e.stopPropagation(); });
	});

	applyMods();
	window.rise = { version: VERSION, open: openPanel, close: closePanel, config: cfg, mods: mods, lowEnd: lowEnd, screen: screen, fps: function () { return Math.round(fps); }, queueCommands: queueCommands };
	console.log('[Rise] Rise Client ' + VERSION + (lowEnd ? ' (Chromebook mode)' : ''));
})();
