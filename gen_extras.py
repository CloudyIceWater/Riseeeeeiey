"""Build-time extras for Rise Client, all derived from the game's own assets:

  theme_extra/rise-font.ttf   pixel font built from font/ascii.png (Rise menus)
  theme_extra/glyphs.json     ascii glyph bitmaps + widths (screen-title reader)
  theme_extra/packs.json      texture-mod resource packs (base64 files per pack)

Run: .venv/bin/python gen_extras.py   (build.py embeds the results)
"""
import base64, io, json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from epk import read_epk
import re

EX = os.path.join(ROOT, 'theme_extra')
BASE = os.path.join(ROOT, 'ref', 'wispcraft-26.2.html')
PACK_FORMAT = 88


def load_assets():
    html = open(BASE, 'r', encoding='utf-8').read()
    m = re.search(r'id="eag-inline-assets" data-size="\d+">(.*?)</script>', html, re.S)
    meta, files, _ = read_epk(base64.b64decode(re.sub(r'\s', '', m.group(1))))
    return {n: d for t, n, d in files if t == 'FILE'}


def png(im):
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()


# ---------------------------------------------------------------- font
def glyph_table(ascii_png):
    im = Image.open(io.BytesIO(ascii_png)).convert('RGBA')
    px = im.load()
    table = {}
    for code in range(32, 127):
        cx, cy = (code % 16) * 8, (code // 16) * 8
        rows, width = [], 0
        for y in range(8):
            bits = 0
            for x in range(8):
                if px[cx + x, cy + y][3] > 128:
                    bits |= 1 << x
                    width = max(width, x + 1)
            rows.append(bits)
        if code == 32:
            width = 3  # space advance is 4 (width + 1)
        table[chr(code)] = [width, rows]
    return table


def build_font(table, path):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    U = 128  # font units per pixel; em = 8 px
    names = ['.notdef'] + ['g%d' % ord(c) for c in table]
    cmap = {ord(c): 'g%d' % ord(c) for c in table}
    glyphs, metrics = {}, {}
    pen = TTGlyphPen(None); glyphs['.notdef'] = pen.glyph(); metrics['.notdef'] = (4 * U, 0)
    for c, (w, rows) in table.items():
        pen = TTGlyphPen(None)
        for y, bits in enumerate(rows):
            for x in range(8):
                if bits >> x & 1:
                    x0, x1 = x * U, (x + 1) * U
                    y1, y0 = (7 - y) * U, (6 - y) * U  # row 0 is the top; baseline under row 6
                    pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
        glyphs['g%d' % ord(c)] = pen.glyph()
        metrics['g%d' % ord(c)] = ((w + 1) * U, 0)
    fb = FontBuilder(8 * U, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=7 * U, descent=-2 * U)
    fb.setupNameTable({'familyName': 'RiseMC', 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=7 * U, sTypoDescender=-2 * U, usWinAscent=7 * U, usWinDescent=2 * U)
    fb.setupPost()
    fb.save(path)


# ---------------------------------------------------------------- texture-mod packs
def pack_mcmeta(desc):
    return json.dumps({"pack": {"description": desc, "min_format": PACK_FORMAT, "max_format": PACK_FORMAT,
                                "pack_format": PACK_FORMAT}}, indent=2).encode()


def low_fire(A):
    out = {}
    for n in ('fire_0', 'fire_1'):
        src = Image.open(io.BytesIO(A['assets/minecraft/textures/block/%s.png' % n])).convert('RGBA')
        w, h = src.size
        dst = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        # every 16x16 frame: squash the flame into the lower 45% of the tile
        for f in range(h // w):
            fr = src.crop((0, f * w, w, (f + 1) * w)).resize((w, int(w * 0.45)), Image.NEAREST)
            dst.alpha_composite(fr, (0, (f + 1) * w - fr.height))
        out['assets/minecraft/textures/block/%s.png' % n] = png(dst)
        mm = 'assets/minecraft/textures/block/%s.png.mcmeta' % n
        if mm in A:
            out[mm] = A[mm]
    return out


def clear_water(A):
    out = {}
    for n in ('water_still', 'water_flow', 'water_overlay'):
        k = 'assets/minecraft/textures/block/%s.png' % n
        im = Image.open(io.BytesIO(A[k])).convert('RGBA')
        r, g, b, a = im.split()
        a = a.point(lambda v: int(v * 0.35))
        out[k] = png(Image.merge('RGBA', (r, g, b, a)))
        if k + '.mcmeta' in A:
            out[k + '.mcmeta'] = A[k + '.mcmeta']
    return out


def no_pumpkin(A):
    return {'assets/minecraft/textures/misc/pumpkinblur.png': png(Image.new('RGBA', (16, 16), (0, 0, 0, 0)))}


def hide_crosshair(A):
    return {'assets/minecraft/textures/gui/sprites/hud/crosshair.png': png(Image.new('RGBA', (15, 15), (0, 0, 0, 0)))}


# ---------------------------------------------------------------- Misc skins
import colorsys, math


def recolor(im, hue=None, sat=None, rainbow=False, bright=1.0):
    """Hue-shift an RGBA texture; rainbow maps hue across the image height."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if rainbow:
                hh = ((x + y) / (w + h)) % 1.0
                ss = max(ss, 0.75)
            elif hue is not None:
                hh = hue
            if sat is not None:
                ss = sat
            ll = min(1, ll * bright)
            r2, g2, b2 = colorsys.hls_to_rgb(hh, ll, ss)
            px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return im


def load_png(A, n):
    return Image.open(io.BytesIO(A[n])).convert('RGBA')


TOTEMS = {'turquoise': dict(hue=0.47, sat=0.8), 'ocean': dict(hue=0.58, sat=0.85), 'ender': dict(hue=0.78, sat=0.7),
          'ruby': dict(hue=0.98, sat=0.8), 'rainbow': dict(rainbow=True)}
GLINTS = {'turquoise': dict(hue=0.47, sat=1.0, bright=1.2), 'red': dict(hue=0.0, sat=1.0, bright=1.1),
          'gold': dict(hue=0.12, sat=1.0, bright=1.2), 'rainbow': dict(rainbow=True)}


def totem_pack(A, name):
    n = 'assets/minecraft/textures/item/totem_of_undying.png'
    return {n: png(recolor(load_png(A, n), **TOTEMS[name]))}


def glint_pack(A, name):
    out = {}
    for k in ('item', 'armor'):
        n = 'assets/minecraft/textures/misc/enchanted_glint_%s.png' % k
        out[n] = png(recolor(load_png(A, n), **GLINTS[name]))
        if n + '.mcmeta' in A:
            out[n + '.mcmeta'] = A[n + '.mcmeta']
    return out


def glow_ores(A):
    """Ore blocks render at full brightness (model light_emission), so they
    glow in dark caves. They do not light up the world around them."""
    out = {}
    for n, d in A.items():
        if not (n.startswith('assets/minecraft/models/block/') and n.endswith('.json')):
            continue
        base = n.rsplit('/', 1)[1][:-5]
        if not (base.endswith('_ore') or base == 'ancient_debris' or base.endswith('_ore_on')):
            continue
        m = json.loads(d)
        parent = m.get('parent', '').replace('minecraft:', '')
        t = m.get('textures', {})
        if parent == 'block/cube_all':
            faces = {f: t['all'] for f in ('down', 'up', 'north', 'south', 'east', 'west')}
            particle = t['all']
        elif parent == 'block/cube_column':
            faces = {'down': t['end'], 'up': t['end'], 'north': t['side'], 'south': t['side'], 'east': t['side'], 'west': t['side']}
            particle = t['side']
        else:
            continue
        out[n] = json.dumps({
            'parent': 'minecraft:block/block',
            'textures': {'particle': particle, **{f: v for f, v in faces.items()}},
            'elements': [{'from': [0, 0, 0], 'to': [16, 16, 16], 'light_emission': 15,
                          'faces': {f: {'texture': '#' + f, 'cullface': f} for f in faces}}]
        }).encode()
    return out


def clean_glass(A):
    n = 'assets/minecraft/textures/block/glass.png'
    src = load_png(A, n)
    w, h = src.size
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sp, dp = src.load(), im.load()
    for y in range(h):
        for x in range(w):
            if x in (0, w - 1) or y in (0, h - 1):
                dp[x, y] = sp[x, y]  # keep only the frame, drop the streaks
    return {n: png(im)}


# ---------------------------------------------------------------- hand-made item skins (2D, animated, 3D)
def art(rows, pal):
    """16-row pixel art from strings; '.' is transparent."""
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        row = (row + '.' * 16)[:16]
        for x, ch in enumerate(row):
            if ch != '.':
                c = pal[ch]
                px[x, y] = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    return im


FRIES = art([
    '....Y..Y..Y.....',
    '..Y.Yy.Yy.Yy.Y..',
    '..YyYy.YyYYy.Yy.',
    '.YYyYyYYyYYyYYy.',
    '.YyYYyYyYyYyYy..',
    '.OYyYYyYYyYYyYO.',
    '.ORRRRRRRRRRRRO.',
    '.ORRRRRRRRRRRRO.',
    '..ORRWWWWWWRRO..',
    '..ORRRRRRRRRRO..',
    '..ORRRRRRRRRRO..',
    '..OrRRRRRRRRrO..',
    '...OrRRRRRRrO...',
    '...OrrRRRRrrO...',
    '...OOOOOOOOOO...',
    '................'], {'Y': '#ffd84a', 'y': '#e0a92a', 'R': '#d83a2e', 'r': '#a2261d', 'W': '#ffffff', 'O': '#3a1510'})

CREEPER_SHADES = art([
    '................',
    '.gGGLGGgGGLGGGg.',
    '.GGgGGLGGgGGLGG.',
    '.GLGGgGGGGLGgGG.',
    '.KKKKKKKKKKKKKK.',
    '.KkkwkKKKKkkwkK.',
    '.KkkkkKGGKkkkkK.',
    '.GKkkKGGGGKkkKG.',
    '.GGGGGgMMgGGGGG.',
    '.GgGGGMMMMGGgGG.',
    '.GGGGMMMMMMGGGG.',
    '.GLGGMMGGMMGGLG.',
    '.GGgGMMGGMMGgGG.',
    '.gGGGGGGGGGGGGg.',
    '..gggggggggggg..',
    '................'], {'G': '#5bb84a', 'g': '#3f8f33', 'L': '#8fd67a', 'K': '#111111', 'k': '#2e2e3a', 'w': '#ffffff', 'M': '#1d3b18'})

CREEPER_SIDE = art(['.gGGLGGgGGLGGGg.'[1:] + 'G'] * 16, {'G': '#5bb84a', 'g': '#3f8f33', 'L': '#8fd67a'})
FRY_TEX = Image.new('RGBA', (16, 16), (255, 216, 74, 255))
CARTON_TEX = art(['R' * 16] * 5 + ['W' * 16] * 2 + ['R' * 16] * 9, {'R': '#d83a2e', 'W': '#ffffff'})


def shine_strip(base, n=12, band=(255, 255, 255)):
    """Animation frames of a diagonal shine sweeping over an item."""
    frames = []
    for i in range(n):
        f = base.copy(); fp = f.load(); bp = base.load()
        cx = -6 + 28 * i / (n - 1)
        for y in range(16):
            for x in range(16):
                r, g, b, a = bp[x, y]
                if not a:
                    continue
                d = abs((x + y * 0.5) - cx)
                k = max(0.0, 1 - d / 2.5) * 0.75
                fp[x, y] = (int(r + (band[0] - r) * k), int(g + (band[1] - g) * k), int(b + (band[2] - b) * k), a)
        frames.append(f)
    return frames


def hue_strip(base, n=16):
    return [recolor(base, hue=i / n, sat=0.85) for i in range(n)]


def swirl_strip(n=16):
    frames = []
    for i in range(n):
        im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); p = im.load()
        for y in range(16):
            for x in range(16):
                dx, dy = x - 7.5, y - 7.5
                r = (dx * dx + dy * dy) ** 0.5
                if r > 6.6:
                    continue
                a = math.atan2(dy, dx) + r * 0.55 - i * (2 * math.pi / n)
                v = 0.5 + 0.5 * math.sin(a * 2)
                edge = 1 if r > 5.6 else 0
                c = (int(20 + 90 * v), int(10 + 40 * v), int(60 + 150 * v)) if not edge else (8, 4, 24)
                if r < 1.6:
                    c = (220, 200, 255)
                p[x, y] = c + (255,)
        frames.append(im)
    return frames


def pulse_strip(base, n=12):
    frames = []
    for i in range(n):
        k = 0.5 + 0.5 * math.sin(i / n * 2 * math.pi)
        frames.append(recolor(base, hue=0.47, sat=0.9, bright=1.0 + 0.45 * k))
    return frames


def strip_files(path, frames, frametime=2):
    im = Image.new('RGBA', (16, 16 * len(frames)))
    for i, f in enumerate(frames):
        im.paste(f, (0, 16 * i))
    return {path: png(im), path + '.mcmeta': json.dumps({'animation': {'frametime': frametime}}).encode()}


def gen_model(tex):
    return json.dumps({'parent': 'minecraft:item/generated', 'textures': {'layer0': tex}}).encode()


def cube(fr, to, tex_all=None, faces=None):
    fs = faces or {f: tex_all for f in ('down', 'up', 'north', 'south', 'east', 'west')}
    return {'from': fr, 'to': to, 'faces': {f: {'uv': [0, 0, 16, 16], 'texture': t} for f, t in fs.items()}}


def model_3d(elements, textures, scale=1.0):
    d = {'thirdperson_righthand': {'rotation': [75, 45, 0], 'translation': [0, 2.5, 0], 'scale': [0.5 * scale] * 3},
         'firstperson_righthand': {'rotation': [0, 45, 0], 'translation': [1, 3, 1], 'scale': [0.36 * scale] * 3},
         'firstperson_lefthand': {'rotation': [0, 225, 0], 'translation': [1, 3, 1], 'scale': [0.36 * scale] * 3},
         'ground': {'translation': [0, 3, 0], 'scale': [0.5 * scale] * 3},
         'gui': {'rotation': [30, 225, 0], 'scale': [0.7 * scale] * 3},
         'head': {'rotation': [0, 180, 0], 'scale': [1, 1, 1]},
         'fixed': {'rotation': [0, 180, 0], 'scale': [0.8 * scale] * 3}}
    return json.dumps({'textures': textures, 'elements': elements, 'display': d}).encode()


def iso_preview(faces):
    """Isometric render of a cube: faces = (top, left/front, right) 16x16 images."""
    out = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    def paste(img, coeffs, shade):
        img = img.convert('RGBA').resize((32, 32), Image.NEAREST)
        r, g, b, a = img.split()
        img = Image.merge('RGBA', [c.point(lambda v: int(v * shade)) for c in (r, g, b)] + [a])
        out.alpha_composite(img.transform((64, 64), Image.AFFINE, coeffs, resample=Image.NEAREST))
    top, left, right = faces
    paste(top, (0.5, -1, 16, 0.5, 1, -16), 1.0)    # diamond on top
    paste(left, (1, 0, 0, -0.5, 1, -16), 0.85)      # front-left face
    paste(right, (1, 0, -32, 0.5, 1, -48), 0.65)    # front-right face
    return out


def item_skin(item, sid, A):
    """Returns (files, preview_png_bytes, frames) for one skin of an item."""
    tex_path = 'assets/minecraft/textures/item/rise_%s_%s.png' % (item, sid)
    tex_id = 'minecraft:item/rise_%s_%s' % (item, sid)
    model_path = 'assets/minecraft/models/item/%s.json' % ('totem_of_undying' if item == 'totem' else 'ender_pearl')
    base_png = 'assets/minecraft/textures/item/%s.png' % ('totem_of_undying' if item == 'totem' else 'ender_pearl')
    base = load_png(A, base_png)
    files = {}
    frames = 1
    if sid in TOTEMS and item == 'totem':
        img = recolor(base, **TOTEMS[sid]); files[base_png] = png(img); prev = img
    elif sid == 'fries':
        files[tex_path] = png(FRIES); files[model_path] = gen_model(tex_id); prev = FRIES
    elif sid == 'creeper':
        files[tex_path] = png(CREEPER_SHADES); files[model_path] = gen_model(tex_id); prev = CREEPER_SHADES
    elif sid in ('shine', 'rainbow_wave', 'swirl', 'pulse', 'shine_pearl'):
        fr = {'shine': lambda: shine_strip(base, band=(255, 250, 200)), 'rainbow_wave': lambda: hue_strip(base),
              'swirl': swirl_strip, 'pulse': lambda: pulse_strip(base), 'shine_pearl': lambda: shine_strip(base, band=(190, 255, 245))}[sid]()
        files.update(strip_files(tex_path, fr)); files[model_path] = gen_model(tex_id)
        frames = len(fr)
        prev = Image.new('RGBA', (16, 16 * frames))
        for i, f in enumerate(fr):
            prev.paste(f, (0, 16 * i))
    elif sid == 'creeper3d':
        files[tex_path] = png(CREEPER_SHADES)
        side = 'assets/minecraft/textures/item/rise_totem_creeperside.png'; files[side] = png(CREEPER_SIDE)
        sid_tex = 'minecraft:item/rise_totem_creeperside'
        faces = {'north': '#face', 'south': '#side', 'east': '#side', 'west': '#side', 'up': '#side', 'down': '#side'}
        files[model_path] = model_3d([cube([3, 3, 3], [13, 13, 13], faces=faces)], {'face': tex_id, 'side': sid_tex, 'particle': tex_id}, 1.2)
        prev = iso_preview((CREEPER_SIDE, CREEPER_SHADES, CREEPER_SIDE))
    elif sid == 'fries3d':
        fry = 'assets/minecraft/textures/item/rise_totem_fry.png'; car = 'assets/minecraft/textures/item/rise_totem_carton.png'
        files[fry] = png(FRY_TEX); files[car] = png(CARTON_TEX)
        els = [cube([4, 0, 5], [12, 8, 11], '#carton')]
        for i, (x, z, h) in enumerate([(5, 6, 13), (6.5, 8, 15), (8, 6, 14), (9.5, 8.5, 12.5), (10.5, 6.5, 14.5), (7, 9, 12)]):
            els.append(cube([x, 8, z], [x + 1.2, h, z + 1.2], '#fry'))
        files[model_path] = model_3d(els, {'carton': 'minecraft:item/rise_totem_carton', 'fry': 'minecraft:item/rise_totem_fry', 'particle': 'minecraft:item/rise_totem_carton'})
        prev = Image.new('RGBA', (64, 80), (0, 0, 0, 0)); prev.alpha_composite(iso_preview((CARTON_TEX, CARTON_TEX, CARTON_TEX)), (0, 16))
        for fx, fy in ((22, 2), (30, 0), (38, 4), (26, 8), (34, 9)):
            prev.alpha_composite(Image.new('RGBA', (4, 22), (255, 216, 74, 255)), (fx, fy)); prev.alpha_composite(Image.new('RGBA', (1, 22), (224, 169, 42, 255)), (fx + 3, fy))
    elif sid == 'orb3d':
        orb = recolor(base.crop((4, 4, 12, 12)).resize((16, 16), Image.NEAREST), hue=0.47, sat=0.9, bright=1.15)  # solid, no see-through corners on a 3D model
        files[tex_path] = png(orb)
        els = [cube([5, 5, 5], [11, 11, 11], '#o'), cube([4, 6, 6], [12, 10, 10], '#o'), cube([6, 4, 6], [10, 12, 10], '#o'), cube([6, 6, 4], [10, 10, 12], '#o')]
        files[model_path] = model_3d(els, {'o': tex_id, 'particle': tex_id}, 1.4)
        prev = iso_preview((orb, orb, orb))
    elif item == 'pearl' and sid == 'turquoise':
        img = recolor(base, hue=0.47, sat=0.85, bright=1.1); files[base_png] = png(img); prev = img
    else:
        raise KeyError(sid)
    return files, png(prev), frames


# item skins now live in gen_skins.py (the Skins tab); 3D skins were dropped
TOTEM_SKINS = []
PEARL_SKINS = []


def shader_scene(A):
    """A small Minecraft-style scene (from the game's own textures) that the
    shader-filter previews are applied to, live, in the mod card."""
    W, H = 192, 112
    im = Image.new('RGBA', (W, H))
    p = im.load()
    for y in range(H):
        t = y / H
        c = (int(120 + 60 * t), int(170 + 40 * t), 255)
        for x in range(W):
            p[x, y] = c + (255,)
    tex = lambda n: load_png(A, 'assets/minecraft/textures/block/%s.png' % n).crop((0, 0, 16, 16)).resize((16, 16), Image.NEAREST)
    grass_top, grass_side, dirt, log, leaves, water, stone, ore = (tex('grass_block_side'), tex('grass_block_side'), tex('dirt'), tex('oak_log'),
        recolor(tex('oak_leaves'), hue=0.3, sat=0.6), recolor(tex('water_still'), hue=0.58, sat=0.7), tex('stone'), tex('diamond_ore'))
    for x in range(0, W, 16):
        im.alpha_composite(grass_side, (x, 72)); im.alpha_composite(dirt, (x, 88)); im.alpha_composite(stone, (x, 104))
    for x in range(112, W, 16):
        im.alpha_composite(water, (x, 72))
    im.alpha_composite(ore, (48, 104))
    for y in (56, 40):
        im.alpha_composite(log, (40, y))
    for dx, dy in ((-16, 24), (0, 24), (16, 24), (-16, 8), (0, 8), (16, 8), (0, -8)):
        im.alpha_composite(leaves, (40 + dx, 24 + dy))
    # sun
    for y in range(12, 28):
        for x in range(150, 166):
            p[x, y] = (255, 246, 190, 255)
    return png(im.convert('RGB'))


ICONS = {
    'zoom': 'item/spyglass', 'fullbright': 'item/glowstone_dust', 'toggleSprint': 'item/sugar', 'toggleSneak': 'item/feather',
    'hitboxes': 'item/armor_stand', 'chunks': 'block/structure_block', 'blueprint': 'item/map', 'freeze': 'item/clock_00',
    'step': 'item/clock_32', 'rate': 'item/compass_00', 'kit': 'item/redstone', 'gamemode': 'block/grass_block_side',
    'time': 'item/clock_00', 'rules': 'item/writable_book', 'entityCull': 'item/ender_eye', 'clearLag': 'item/lava_bucket',
    'clearItems': 'block/hopper_outside', 'cramming': 'block/spawner', 'tnt': 'block/tnt_side', 'glint': 'item/enchanted_book',
    'glowOres': 'block/diamond_ore', 'cleanGlass': 'block/glass', 'lowFire': 'block/fire_0', 'clearWater': 'item/water_bucket',
    'noPumpkin': 'block/carved_pumpkin', 'noHurtTilt': 'item/iron_sword', 'noFovFx': 'item/potion', 'noWobble': 'block/nether_portal',
    'noLightning': 'block/lightning_rod', 'shader': 'item/amethyst_shard', 'totem': 'item/totem_of_undying', 'pearl': 'item/ender_pearl',
}


def build_previews(A):
    prev = {'totem': {}, 'pearl': {}, 'icons': {}}
    packs = {}
    for item, skins in (('totem', TOTEM_SKINS), ('pearl', PEARL_SKINS)):
        for sid in skins:
            files, img, frames = item_skin(item, sid, A)
            files['pack.mcmeta'] = pack_mcmeta('Rise: %s skin %s' % (item, sid))
            packs['rise_%s_%s' % (item, sid)] = files
            prev[item][sid] = {'img': base64.b64encode(img).decode(), 'frames': frames}
    for k, t in ICONS.items():
        n = 'assets/minecraft/textures/%s.png' % t
        if n in A:
            im = load_png(A, n)
            im = im.crop((0, 0, im.width, im.width))  # first frame of animated strips
            prev['icons'][k] = base64.b64encode(png(im)).decode()
    prev['scene'] = base64.b64encode(shader_scene(A)).decode()
    for g in GLINTS:
        f = recolor(load_png(A, 'assets/minecraft/textures/misc/enchanted_glint_item.png'), **GLINTS[g]).resize((32, 32))
        prev.setdefault('glint', {})[g] = base64.b64encode(png(f)).decode()
    return prev, packs


PACKS = {
    'rise_low_fire': ('Rise: Low Fire', low_fire),
    'rise_clear_water': ('Rise: Clear Water', clear_water),
    'rise_no_pumpkin': ('Rise: No Pumpkin Blur', no_pumpkin),
    'rise_crosshair': ('Rise: Custom Crosshair (hides vanilla)', hide_crosshair),
    'rise_glow_ores': ('Rise: Glowing Ores', glow_ores),
    'rise_clean_glass': ('Rise: Clean Glass', clean_glass),
}
for _g in GLINTS:
    PACKS['rise_glint_' + _g] = ('Rise: %s Glint' % _g.title(), (lambda name: lambda A: glint_pack(A, name))(_g))


def main():
    os.makedirs(EX, exist_ok=True)
    A = load_assets()
    table = glyph_table(A['assets/minecraft/textures/font/ascii.png'])
    json.dump(table, open(os.path.join(EX, 'glyphs.json'), 'w'), separators=(',', ':'))
    build_font(table, os.path.join(EX, 'rise-font.ttf'))
    packs = {}
    for pid, (desc, fn) in PACKS.items():
        files = fn(A)
        files['pack.mcmeta'] = pack_mcmeta(desc)
        packs[pid] = {k: base64.b64encode(v).decode() for k, v in files.items()}
    previews, skin_packs = build_previews(A)
    for pid, files in skin_packs.items():
        packs[pid] = {k: base64.b64encode(v).decode() for k, v in files.items()}
    json.dump(previews, open(os.path.join(EX, 'previews.json'), 'w'), separators=(',', ':'))
    json.dump(packs, open(os.path.join(EX, 'packs.json'), 'w'), separators=(',', ':'))
    print('font %d bytes, glyphs %d, packs %s (%d KB)' % (
        os.path.getsize(os.path.join(EX, 'rise-font.ttf')), len(table), list(packs),
        os.path.getsize(os.path.join(EX, 'packs.json')) // 1024))


if __name__ == '__main__':
    main()
