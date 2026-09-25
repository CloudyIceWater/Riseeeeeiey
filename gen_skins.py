"""Rise Client item skins: ~50 cosmetic resource-pack skins (swords, axes,
pickaxes, bows, shields, totems, ender pearls and food), some animated.

Each skin is its own tiny resource pack that replaces item textures only, so
nothing about gameplay changes. Output: theme_extra/skins.json
  { "packs": {pack_id: {path: b64}}, "list": [meta...] }

Run: .venv/bin/python gen_skins.py
"""
import base64, colorsys, io, json, math, os, random, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from gen_extras import load_assets, png, pack_mcmeta, recolor

T = 'assets/minecraft/textures/'


# ---------------------------------------------------------------- tiny pixel-art kit
def hexc(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mix(c, d, t):
    return tuple(int(c[i] + (d[i] - c[i]) * t) for i in range(3)) + (c[3] if len(c) > 3 else 255,)


def canvas(w=16, h=16):
    return Image.new('RGBA', (w, h), (0, 0, 0, 0))


def draw(rows, pal, im=None, ox=0, oy=0):
    """String pixel art; '.' is transparent, other chars index pal."""
    im = im or canvas()
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.' and ch != ' ' and 0 <= x + ox < im.width and 0 <= y + oy < im.height:
                c = pal[ch]
                px[x + ox, y + oy] = hexc(c) if isinstance(c, str) else c
    return im


def rect(im, x0, y0, x1, y1, c):
    px = im.load()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= x < im.width and 0 <= y < im.height:
                px[x, y] = hexc(c) if isinstance(c, str) else c


def ellipse(im, cx, cy, rx, ry, c):
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                px[x, y] = hexc(c) if isinstance(c, str) else c


def dot(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.load()[x, y] = hexc(c) if isinstance(c, str) else c


def outline(im, c='#1b1b1f'):
    """1px dark outline around the shape: the classic Minecraft item look."""
    src = im.copy(); sp = src.load(); px = im.load()
    col = hexc(c)
    for y in range(im.height):
        for x in range(im.width):
            if sp[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < im.width and 0 <= ny < im.height and sp[nx, ny][3] and sp[nx, ny][:3] != col[:3]:
                    px[x, y] = col
                    break
    return im


def strip(frames):
    im = Image.new('RGBA', (16, 16 * len(frames)))
    for i, f in enumerate(frames):
        im.paste(f, (0, 16 * i))
    return im


def anim(frames, frametime=2):
    return strip(frames), json.dumps({'animation': {'frametime': frametime}}).encode()


def shine(base, n=12, band=(255, 255, 255), strength=0.75):
    out = []
    for i in range(n):
        f = base.copy(); fp = f.load(); bp = base.load()
        cx = -6 + 30 * i / (n - 1)
        for y in range(16):
            for x in range(16):
                r, g, b, a = bp[x, y]
                if a:
                    k = max(0.0, 1 - abs((x - y * 0.8 + 6) - cx) / 2.2) * strength
                    fp[x, y] = (int(r + (band[0] - r) * k), int(g + (band[1] - g) * k), int(b + (band[2] - b) * k), a)
        out.append(f)
    return out


def steam(base, n=8, cols=(4, 8, 11), top=0, height=5):
    """Wisps of steam rising above a dish."""
    out = []
    for i in range(n):
        f = base.copy()
        for k, cx in enumerate(cols):
            for j in range(3):
                y = top + height - ((i + k * 3 + j * 3) % (height + 2))
                x = cx + (1 if (y + k) % 4 < 2 else 0)
                if top <= y < top + height:
                    a = int(200 * (y - top + 1) / height)
                    if f.getpixel((x, y))[3] == 0:
                        dot(f, x, y, (235, 240, 245, a))
        out.append(f)
    return out


# ---------------------------------------------------------------- material tints (swords / axes / pickaxes)
MATERIALS = {
    'wooden': '#a0703d', 'stone': '#8e8e8e', 'copper': '#d0784f', 'iron': '#e8e8e8',
    'golden': '#f5d33f', 'diamond': '#46e0d4', 'netherite': '#5a4b52',
}


def tinted(art, pal, mat, extra=None):
    base = hexc(MATERIALS[mat])
    p = dict(pal)
    p.update({'1': mix(base, (255, 255, 255, 255), 0.45), '2': base, '3': mix(base, (0, 0, 0, 255), 0.35), '4': mix(base, (0, 0, 0, 255), 0.6)})
    if extra:
        p.update(extra(base))
    return outline(draw(art, p))


HILT = {'H': '#5a3a1e', 'h': '#8a5a2b', 'G': '#d8b040', 'g': '#9c7a22', 'K': '#3b2a1a', 'W': '#ffffff', 'R': '#d8283a', 'r': '#8e1522', 'B': '#1a1a22', 'C': '#bdefff'}

KATANA = ['...............1', '..............12', '.............12.', '............123.', '...........123..', '..........123...',
          '.........123....', '........123.....', '.......123......', '......123.......', '....GG23........', '....GGG.........',
          '...hHG..........', '..hHh...........', '.hHh............', 'KK..............']
LASER = ['.............WW.', '............W11W', '...........W11W.', '..........W11W..', '.........W11W...', '........W11W....',
         '.......W11W.....', '......W11W......', '.....W11W.......', '....BB1W........', '...BBBB.........', '...BCB..........',
         '..BCB...........', '.BCB............', 'BCB.............', 'BB..............']
CRYSTAL = ['.............11.', '............1221', '...........12232', '..........122321', '.........122321.', '........122321..',
           '.......122321...', '......122321....', '.....122321.....', '....GG2321......', '...GGGG21.......', '...gGGg.........',
           '..hHg...........', '.hHh............', 'hHh.............', 'KK..............']
CLEAVER = ['......1111111111', '.....12222222221', '.....122222224.1', '.....12222222221', '.....12222222221', '.....12222222231',
           '.....12222222331', '.....13333333331', '....GG..........', '...hH...........', '..hHh...........', '.hHh............',
           'hHh.............', 'KK..............', '................', '................']
SCYTHE = ['..11111111......', '.1222222221.....', '1223333332221...', '.3.......33221..', '...........3321.', '............331.',
          '.............hH.', '............hH..', '...........hH...', '..........hH....', '.........hH.....', '........hH......',
          '.......hH.......', '......hH........', '.....hH.........', '....KK..........']
CANDY = [''.join(('W' if ((x + y) // 2) % 2 else '2') if ch in '123' and y < 10 else ch for x, ch in enumerate(row)) for y, row in enumerate(CRYSTAL)]
FLAME = KATANA
OCEAN = CRYSTAL

def _banhammer():
    g = [['.'] * 16 for _ in range(16)]
    for y in range(0, 9):
        for x in range(1, 15):
            g[y][x] = '1' if y == 0 or x == 1 else ('3' if y >= 7 or x == 14 else '2')
    for y in range(2, 7):
        for x in range(2, 14):
            g[y][x] = 'R'
    letters = {2: ['WW.', 'W.W', 'WW.', 'W.W', 'WW.'], 6: ['.W.', 'W.W', 'WWW', 'W.W', 'W.W'], 10: ['W..W', 'WW.W', 'W.WW', 'W..W', 'W..W']}
    for ox, rows in letters.items():
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch == 'W' and ox + dx < 14:
                    g[2 + dy][ox + dx] = 'W'
    for y in range(9, 16):
        g[y][7] = 'h'; g[y][8] = 'H'
    g[15][7] = g[15][8] = 'K'
    return [''.join(r) for r in g]


BANHAMMER = _banhammer()
BATTLEAXE = ['.....11...11....', '....122.1221....', '...12223122221..', '..122223H222221.', '..12223.H322221.', '..1223..H.32221.',
              '..123...H..3221.', '...3...hH...33..', '.......hH.......', '......hH........', '.....hH.........', '....hH..........',
              '...hH...........', '..hH............', '.hH.............', 'KK..............']
DRILL = ['..............1.', '.............121', '............1232', '...........12321', '..........12321.', '.........12321..',
         '........12321...', '.......G2321....', '......GGG21.....', '.....RRGG.......', '....RrRR........', '...hRrR.........',
         '..hHh...........', '.hHh............', 'hHh.............', 'KK..............']
CRYSTALPICK = ['...11111111.....', '..122222221.....', '.1233333322.....', '.23......322....', '.3.....hH.32....', '.......hH..3....',
               '......hH........', '.....hH.........', '....hH..........', '...hH...........', '..hH............', '.hH.............',
               'hH..............', 'H...............', '................', '................']


def sword_skin(art, animated=None, extra=None):
    """Returns {texture path: image or (strip, mcmeta)} for all sword materials."""
    out = {}
    for mat in MATERIALS:
        base = tinted(art, HILT, mat, extra)
        out['item/%s_sword' % mat] = animated(base, mat) if animated else base
    return out


def tool_skin(tool, art, animated=None):
    out = {}
    for mat in MATERIALS:
        base = tinted(art, HILT, mat)
        out['item/%s_%s' % (mat, tool)] = animated(base, mat) if animated else base
    return out


def laser_anim(base, mat):
    frames = []
    for i in range(8):
        k = 0.5 + 0.5 * math.sin(i / 8 * 2 * math.pi)
        f = base.copy(); p = f.load()
        for y in range(16):
            for x in range(16):
                r, g, b, a = p[x, y]
                if a and (r, g, b) != (27, 27, 31) and y < 10:
                    p[x, y] = mix((r, g, b, a), (255, 255, 255, 255), 0.35 * k)
        frames.append(f)
    return anim(frames, 2)


def flame_anim(base, mat):
    frames = []
    rnd = random.Random(7)
    for i in range(8):
        f = base.copy()
        for j in range(10):
            t = rnd.random()
            x = int(5 + 10 * t); y = int(10 - 10 * t) + rnd.choice((-1, 0, 0, 1))
            dot(f, x + rnd.choice((0, 1)), max(0, y - 1), rnd.choice(('#ffcf3a', '#ff8a1f', '#ff4d1f')))
        frames.append(f)
    return anim(frames, 2)


def wave_anim(base, mat):
    frames = []
    for i in range(10):
        f = base.copy(); p = f.load()
        for y in range(16):
            for x in range(16):
                r, g, b, a = p[x, y]
                if a and y < 11 and x > 3:
                    k = 0.5 + 0.5 * math.sin((x + y) * 0.9 - i / 10 * 2 * math.pi)
                    p[x, y] = mix((r, g, b, a), (120, 220, 255, 255), 0.45 * k)
        frames.append(f)
    return anim(frames, 2)


def sparkle_anim(base, mat):
    frames = []
    spots = [(13, 2), (10, 5), (7, 8), (12, 3), (9, 6), (6, 9)]
    for i in range(12):
        f = base.copy()
        sx, sy = spots[i % len(spots)]
        if i % 2 == 0:
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                if f.getpixel((sx + dx, sy + dy))[3]:
                    dot(f, sx + dx, sy + dy, '#ffffff')
        frames.append(f)
    return anim(frames, 2)


def banhammer_anim(base, mat):
    frames = []
    for i in range(6):
        f = base.copy(); p = f.load()
        if i < 3:
            for y in range(2, 7):
                for x in range(2, 14):
                    r, g, b, a = p[x, y]
                    if a and r > 150 and g < 90:
                        p[x, y] = (255, 70, 70, 255)
            for y in range(2, 7):
                for x in range(2, 14):
                    r, g, b, a = p[x, y]
                    if a and r > 200 and g > 200:
                        p[x, y] = (255, 255, 160, 255)
        frames.append(f)
    return anim(frames, 4)


def drill_anim(base, mat):
    frames = []
    for i in range(4):
        f = base.copy(); p = f.load()
        for y in range(8):
            for x in range(7, 16):
                r, g, b, a = p[x, y]
                if a and (x + y + i) % 4 == 0 and (r, g, b) != (27, 27, 31):
                    p[x, y] = mix((r, g, b, a), (0, 0, 0, 255), 0.35)
        frames.append(f)
    return anim(frames, 1)


# ---------------------------------------------------------------- bows / shields
def bow_skin(A, **rc):
    out = {}
    for n in ('bow', 'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2'):
        out['item/' + n] = recolor(Image.open(io.BytesIO(A[T + 'item/%s.png' % n])), **rc)
    return out


def neon_bow(A):
    out = {}
    for n in ('bow', 'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2'):
        src = Image.open(io.BytesIO(A[T + 'item/%s.png' % n])).convert('RGBA')
        frames = [recolor(src, hue=(0.5 + i / 8) % 1, sat=1.0, bright=1.25) for i in range(8)]
        out['item/' + n] = anim(frames, 3)
    return out


def shield_skin(A, paint):
    src = Image.open(io.BytesIO(A[T + 'entity/shield/shield_base_nopattern.png'])).convert('RGBA')
    face = canvas(12, 22)
    paint(face)
    src.paste(face, (1, 1))
    return {'entity/shield/shield_base_nopattern': src}


def rise_face(f):
    rect(f, 0, 0, 11, 21, '#0b5f8e')
    for y in range(22):
        for x in range(12):
            if (x + y) % 7 == 0:
                dot(f, x, y, '#0e6fa4')
    draw(['1111111.', '1.....11', '1......1', '1.....11', '1111111.', '1...11..', '1....11.', '1.....11'], {'1': '#40f0dc'}, f, 2, 7)


def creeper_face(f):
    rect(f, 0, 0, 11, 21, '#5bb84a')
    rnd = random.Random(3)
    for _ in range(40):
        dot(f, rnd.randrange(12), rnd.randrange(22), rnd.choice(('#3f8f33', '#8fd67a')))
    draw(['KK..KK', 'KK..KK', '..KK..', '.KKKK.', '.KKKK.', '.K..K.'], {'K': '#111111'}, f, 3, 7)


def ocean_face(f):
    for y in range(22):
        for x in range(12):
            k = 0.5 + 0.5 * math.sin(x * 0.9 + y * 0.35)
            dot(f, x, y, mix(hexc('#06345c'), hexc('#1ebec8'), k * 0.8))


def ender_face(f):
    rect(f, 0, 0, 11, 21, '#1a0f2e')
    ellipse(f, 6, 11, 4.6, 3.2, '#2fae8c')
    ellipse(f, 6, 11, 2.2, 2.2, '#0b3d34')
    dot(f, 6, 11, '#000000'); dot(f, 5, 10, '#bff5e6')


# ---------------------------------------------------------------- totems, pearls
def fries():
    return draw(['....Y..Y..Y.....', '..Y.Yy.Yy.Yy.Y..', '..YyYy.YyYYy.Yy.', '.YYyYyYYyYYyYYy.', '.YyYYyYyYyYyYy..', '.OYyYYyYYyYYyYO.',
                 '.ORRRRRRRRRRRRO.', '.ORRRRRRRRRRRRO.', '..ORRWWWWWWRRO..', '..ORRRRRRRRRRO..', '..ORRRRRRRRRRO..', '..OrRRRRRRRRrO..',
                 '...OrRRRRRRrO...', '...OrrRRRRrrO...', '...OOOOOOOOOO...', '................'],
                {'Y': '#ffd84a', 'y': '#e0a92a', 'R': '#d83a2e', 'r': '#a2261d', 'W': '#ffffff', 'O': '#3a1510'})


def creeper_bucket():
    # like the axolotl bucket: an iron bucket with water, a tiny creeper (wearing shades) inside
    return draw(['................', '..OOOOOOOOOOOO..', '.OiiiiiiiiiiiiO.', '.OIwwwwwwwwwwIO.', '.OIwGGGGGGwwwIO.', '.OIwGKKGKKwwwIO.',
                 '.OIwGKKKKGwwbIO.', '.OIwGGMMGGwbwIO.', '..OIwGMMGwwwIO..', '..OIwGGGGwbwIO..', '..OIIwwwwwwIIO..', '...OIIIIIIIIO...',
                 '...OiIIIIIIiO...', '....OOOOOOOO....', '................', '................'],
                {'O': '#2a2a2e', 'i': '#e8e8e8', 'I': '#b8b8bc', 'w': '#3b8fd9', 'b': '#8fd0ff', 'G': '#5bb84a', 'K': '#111111', 'M': '#1d3b18'})


def burger():
    return outline(draw(['................', '................', '....bbbbbbbb....', '...bBBsBBBsBb...', '..bBBBBBBBBBBb..', '..bBsBBBBBsBBb..',
                         '..llllllllllll..', '..cccccccccccc..', '..mmmmmmmmmmmm..', '..mMmmmMmmmMmm..', '..rrrrrrrrrrrr..', '..bBBBBBBBBBBb..',
                         '...bbbbbbbbbb...', '................', '................', '................'],
                        {'b': '#b86b2b', 'B': '#e3953f', 's': '#fff3c4', 'l': '#6fcf4a', 'c': '#ffd23f', 'm': '#6b3a22', 'M': '#4a2716', 'r': '#e34a3a'}))


def eyeball():
    im = canvas(); ellipse(im, 8, 8, 6.2, 6.2, '#f4f4f4'); ellipse(im, 9, 8, 3.2, 3.2, '#2aa0e8'); ellipse(im, 9, 8, 1.6, 1.6, '#101418')
    dot(im, 8, 7, '#ffffff')
    for x, y in ((3, 6), (4, 11), (12, 12)):
        dot(im, x, y, '#e05050')
    return outline(im)


def swirl_frames():
    out = []
    for i in range(16):
        im = canvas(); p = im.load()
        for y in range(16):
            for x in range(16):
                dx, dy = x - 7.5, y - 7.5
                r = (dx * dx + dy * dy) ** 0.5
                if r > 6.6:
                    continue
                a = math.atan2(dy, dx) + r * 0.55 - i * (2 * math.pi / 16)
                v = 0.5 + 0.5 * math.sin(a * 2)
                c = (int(20 + 90 * v), int(10 + 40 * v), int(60 + 150 * v)) if r <= 5.6 else (8, 4, 24)
                if r < 1.6:
                    c = (220, 200, 255)
                p[x, y] = c + (255,)
        out.append(im)
    return out


# ---------------------------------------------------------------- food
def plate(im, y=11):
    ellipse(im, 8, y, 7.4, 3.2, '#e9eef2'); ellipse(im, 8, y, 5.6, 2.2, '#ffffff')


def steak_dinner():
    im = canvas(); plate(im, 11)
    ellipse(im, 7, 9.5, 4.2, 2.6, '#7a3b1f'); ellipse(im, 7, 9.2, 3.4, 2.0, '#9c4e28')
    for x in (5, 7, 9):
        dot(im, x, 9, '#4a2112'); dot(im, x + 1, 10, '#4a2112')
    for x, y in ((12, 10), (13, 11), (12, 12)):
        dot(im, x, y, '#5cc445')
    rect(im, 11, 8, 11, 9, '#ffd84a'); rect(im, 13, 8, 13, 9, '#ffd84a')
    return outline(im)


def cereal():
    im = canvas()
    ellipse(im, 8, 9, 7.2, 3.0, '#f7f7f7')
    rect(im, 1, 9, 14, 11, '#3b7fd9'); ellipse(im, 8, 12, 6.2, 2.4, '#2f6ac0')
    ellipse(im, 8, 9, 6.0, 2.2, '#fffdf4')
    rnd = random.Random(5)
    for _ in range(12):
        dot(im, rnd.randint(3, 12), rnd.randint(8, 10), rnd.choice(('#ff5a5a', '#ffd23f', '#5ad14a', '#b35aff', '#ff9a3a')))
    rect(im, 11, 2, 11, 8, '#c0c4cc'); ellipse(im, 11.5, 2.5, 1.4, 1.8, '#dfe3ea')
    return outline(im)


def ramen():
    im = canvas()
    rect(im, 1, 8, 14, 10, '#d8283a'); ellipse(im, 8, 11, 6.6, 3, '#b81e2e'); ellipse(im, 8, 8, 7, 2.2, '#e8b35a')
    for x in range(3, 13, 2):
        dot(im, x, 8, '#f6dc8a')
    ellipse(im, 5, 8, 1.6, 1.1, '#ffffff'); dot(im, 5, 8, '#ffb52e')
    dot(im, 10, 7, '#3fae4a'); dot(im, 11, 8, '#3fae4a')
    return outline(im)


def cocoa():
    im = canvas()
    rect(im, 3, 6, 11, 14, '#e8e8f0'); rect(im, 4, 7, 10, 13, '#ffffff')
    rect(im, 4, 6, 10, 7, '#6b3a22'); rect(im, 12, 8, 13, 11, '#e8e8f0'); dot(im, 12, 9, (0, 0, 0, 0)); dot(im, 12, 10, (0, 0, 0, 0))
    for x in (5, 8, 9):
        rect(im, x, 5, x, 5, '#ffffff')
    rect(im, 4, 10, 10, 10, '#40c8dc')
    return outline(im)


def pizza():
    im = canvas()
    for y in range(2, 15):
        w = int((y - 1) * 0.5)
        rect(im, 8 - w, y, 8 + w, y, '#ffcf4a')
    rect(im, 2, 14, 14, 15, '#c8862e')
    for x, y in ((7, 6), (9, 9), (6, 11), (10, 12), (8, 13)):
        ellipse(im, x + 0.5, y + 0.5, 1.2, 1.1, '#c8323a')
    dot(im, 5, 13, '#3fae4a'); dot(im, 9, 7, '#3fae4a')
    return outline(im)


def donut(glaze='#ff7ab8', gold=False):
    im = canvas()
    ellipse(im, 8, 8.5, 6.8, 6.4, '#d8984a')
    ellipse(im, 8, 8, 6.0, 5.4, glaze)
    ellipse(im, 8, 8.5, 2.2, 2.0, (0, 0, 0, 0))
    if not gold:
        rnd = random.Random(9)
        for _ in range(10):
            x, y = rnd.randint(3, 12), rnd.randint(3, 12)
            if im.getpixel((x, y))[:3] == hexc(glaze)[:3]:
                dot(im, x, y, rnd.choice(('#ffffff', '#5ad1ff', '#ffe45a', '#7aff7a')))
    return outline(im)


def pancakes():
    im = canvas(); plate(im, 13)
    for i, y in enumerate((11, 9, 7)):
        ellipse(im, 8, y, 5.8, 1.6, '#d89040'); ellipse(im, 8, y - 0.6, 5.4, 1.2, '#f0b85a')
    ellipse(im, 8, 6, 3.6, 1.0, '#8a4a14'); rect(im, 11, 6, 11, 9, '#8a4a14'); rect(im, 7, 5, 9, 5, '#fff1a8')
    return outline(im)


def chicken_bucket():
    im = canvas()
    for y in range(6, 15):
        w = 5 - (y - 6) // 3
        rect(im, 8 - w, y, 7 + w, y, '#d8283a' if (y // 2) % 2 == 0 else '#ffffff')
    for x, y in ((5, 4), (8, 3), (11, 4), (7, 5), (10, 5)):
        ellipse(im, x + 0.5, y + 0.5, 1.8, 1.6, '#c8782e')
    return outline(im)


def ice_pop():
    im = canvas()
    rect(im, 5, 1, 10, 10, '#ff6aa8'); rect(im, 5, 1, 10, 3, '#ffd23f'); rect(im, 5, 4, 10, 6, '#5ad1ff')
    rect(im, 6, 1, 6, 9, '#ffffff'); rect(im, 7, 11, 8, 14, '#d8b070')
    return outline(im)


def burger_food():
    return burger()


def cake_slice():
    im = canvas()
    rect(im, 2, 8, 13, 13, '#fff1d6'); rect(im, 2, 10, 13, 10, '#ff7ab8'); rect(im, 2, 7, 13, 8, '#ffffff')
    for x in (4, 7, 10, 12):
        dot(im, x, 7, '#ff3a5a')
    rect(im, 7, 3, 8, 6, '#5ad1ff')
    return outline(im)


def cake_anim(base):
    frames = []
    for i in range(6):
        f = base.copy()
        dot(f, 7 + (i % 2), 1, '#ffd23f'); dot(f, 7 + (i % 2), 2, '#ff8a1f'); dot(f, 8 - (i % 2), 2, '#ffe86a')
        frames.append(f)
    return frames


def ice_cream():
    im = canvas()
    for y in range(8, 16):
        w = max(0, 3 - (y - 8) // 2)
        rect(im, 8 - w, y, 7 + w, y, '#d8984a')
    for x in range(5, 11):
        for y in range(8, 15):
            if (x + y) % 3 == 0 and im.getpixel((x, y))[3]:
                dot(im, x, y, '#a86a2a')
    ellipse(im, 8, 6, 3.8, 3.2, '#ff9ac8'); ellipse(im, 8, 3.5, 2.8, 2.4, '#fff4f0'); dot(im, 8, 1, '#e8283a')
    return outline(im)


def gummies():
    im = canvas()
    for (x, y, c) in ((4, 5, '#ff4a5a'), (10, 4, '#5ad14a'), (7, 10, '#ffd23f')):
        ellipse(im, x + 0.5, y, 1.8, 1.6, c); ellipse(im, x + 0.5, y + 3, 2.4, 2.4, c)
        dot(im, x - 1, y - 1, c); dot(im, x + 2, y - 1, c)
        dot(im, x, y, '#ffffff')
    return outline(im)


def choc_milk():
    im = canvas()
    rect(im, 4, 4, 11, 14, '#6b3a22'); rect(im, 5, 6, 10, 12, '#ffffff'); rect(im, 5, 8, 10, 10, '#8a4a2a')
    for x in range(4, 12):
        dot(im, x, 3 - abs(x - 7.5) // 3, '#6b3a22')
    rect(im, 6, 1, 7, 2, '#e8e8e8')
    return outline(im)


def boba():
    im = canvas()
    rect(im, 4, 4, 11, 14, '#e8d2b0'); rect(im, 4, 4, 11, 5, '#ffffff')
    for x, y in ((5, 12), (7, 13), (9, 12), (10, 13), (6, 11), (8, 11)):
        dot(im, x, y, '#2a1a14')
    rect(im, 9, 0, 9, 4, '#ff6aa8')
    return outline(im)


def boba_anim(base):
    frames = []
    for i in range(8):
        f = base.copy()
        for k, x in enumerate((5, 7, 9)):
            y = 11 - ((i + k * 3) % 6)
            if 6 <= y <= 10:
                dot(f, x, y, '#fff6e6')
        frames.append(f)
    return frames


def chocolate_cookie():
    im = canvas()
    ellipse(im, 8, 8, 6.5, 6.2, '#c8883a'); ellipse(im, 8, 8, 5.5, 5.2, '#dea050')
    for x, y in ((6, 6), (10, 7), (7, 10), (11, 11), (5, 9), (9, 4)):
        dot(im, x, y, '#4a2412'); dot(im, x + 1, y, '#4a2412')
    return outline(im)


def cupcake(frost='#ffd23f', cup='#e0a92a', sprinkle=True):
    im = canvas()
    for y in range(9, 15):
        w = 5 - (y - 9) // 3
        rect(im, 8 - w, y, 7 + w, y, cup)
    for x in range(3, 13, 2):
        rect(im, x, 9, x, 14, mix(hexc(cup), (0, 0, 0, 255), 0.2))
    ellipse(im, 8, 7.5, 5.6, 3.2, frost); ellipse(im, 8, 5, 3.8, 2.4, frost); ellipse(im, 8, 3, 2, 1.5, frost)
    ellipse(im, 6.5, 5, 1.4, 0.9, (255, 255, 255, 140))
    if sprinkle:
        for x, y in ((5, 7), (9, 6), (11, 8), (7, 4), (8, 8)):
            dot(im, x, y, '#ff5aa0')
    dot(im, 8, 1, '#e8283a')
    return outline(im)


def honey_toast():
    im = canvas()
    rect(im, 3, 4, 12, 14, '#e8b060'); rect(im, 2, 3, 13, 5, '#c8863a'); ellipse(im, 4, 4, 2.2, 2, '#c8863a'); ellipse(im, 11, 4, 2.2, 2, '#c8863a')
    rect(im, 4, 6, 11, 13, '#f6d08a')
    rect(im, 5, 7, 10, 10, '#ffd23f'); dot(im, 5, 11, '#ffd23f'); dot(im, 9, 11, '#ffd23f'); dot(im, 9, 12, '#ffd23f')
    rect(im, 7, 8, 8, 9, '#fff6c8')
    return outline(im)


def sun_orb(i, n):
    im = canvas()
    k = 0.5 + 0.5 * math.sin(i / n * 2 * math.pi)
    for a in range(8):
        ang = a / 8 * 2 * math.pi + i / n * 0.8
        r = 6.4 + k
        dot(im, int(round(7.5 + math.cos(ang) * r)), int(round(7.5 + math.sin(ang) * r)), '#ffe45a')
    ellipse(im, 8, 8, 4.8, 4.8, mix(hexc('#ffb52e'), hexc('#ffe86a'), k))
    ellipse(im, 8, 8, 3.2, 3.2, '#fff4b0'); dot(im, 6, 6, '#ffffff')
    return outline(im, '#7a4a10')


def apple_shape(body, hl, leaf='#3fae4a'):
    im = canvas()
    ellipse(im, 8, 9.5, 6, 5.6, body); ellipse(im, 5.5, 8, 2.2, 2.4, hl)
    rect(im, 8, 2, 8, 4, '#6b3a22'); dot(im, 9, 3, leaf); dot(im, 10, 3, leaf); dot(im, 10, 2, leaf)
    dot(im, 8, 4, (0, 0, 0, 0))
    return outline(im)


def galaxy_apple(i, n):
    im = apple_shape('#2a1450', '#5a2aa0')
    rnd = random.Random(11)
    stars = [(rnd.randint(4, 12), rnd.randint(6, 13)) for _ in range(7)]
    for j, (x, y) in enumerate(stars):
        if (i + j) % 3 == 0:
            dot(im, x, y, '#ffffff')
        elif (i + j) % 3 == 1:
            dot(im, x, y, '#b8a0ff')
    return im


def crown_cake():
    im = canvas()
    rect(im, 3, 9, 12, 14, '#ffffff'); rect(im, 3, 11, 12, 11, '#b35aff'); rect(im, 3, 9, 12, 9, '#ffe4f4')
    draw(['Y..Y..Y', 'YY.YY.Y', 'YYYYYYY', 'YRYYYBY'], {'Y': '#ffd23f', 'R': '#e8283a', 'B': '#3aa0ff'}, im, 4, 4)
    return outline(im)


def model_json(tex):
    return json.dumps({'parent': 'minecraft:item/generated', 'textures': {'layer0': 'minecraft:' + tex}}).encode()


# ---------------------------------------------------------------- the catalogue
def build(A):
    base_totem = Image.open(io.BytesIO(A[T + 'item/totem_of_undying.png'])).convert('RGBA')
    base_pearl = Image.open(io.BytesIO(A[T + 'item/ender_pearl.png'])).convert('RGBA')
    S = []  # (id, name, group, category, desc, textures dict)

    def add(sid, name, group, cat, desc, tex):
        S.append((sid, name, group, cat, desc, tex))

    add('katana', 'Katana', 'sword', 'Weapons', 'A thin curved katana. Every sword gets it, tinted by its material.', sword_skin(KATANA, sparkle_anim))
    add('laser', 'Laser Sword', 'sword', 'Weapons', 'A glowing energy blade that pulses. Tinted by material.', sword_skin(LASER, laser_anim))
    add('flame', 'Flame Sword', 'sword', 'Weapons', 'A katana with flickering fire along the edge.', sword_skin(FLAME, flame_anim))
    add('cleaver', 'Meat Cleaver', 'sword', 'Weapons', 'A big chunky cleaver.', sword_skin(CLEAVER))
    add('scythe', 'Scythe', 'sword', 'Weapons', 'A reaper scythe.', sword_skin(SCYTHE))
    add('candy', 'Candy Cane', 'sword', 'Weapons', 'A striped candy-cane sword.', sword_skin(CANDY))


    add('crystal_bow', 'Crystal Bow', 'bow', 'Weapons', 'An icy turquoise bow (all draw stages).', bow_skin(A, hue=0.47, sat=0.8, bright=1.15))
    add('golden_bow', 'Golden Bow', 'bow', 'Weapons', 'A shiny golden bow.', bow_skin(A, hue=0.12, sat=0.9, bright=1.2))
    add('ender_bow', 'Ender Bow', 'bow', 'Weapons', 'A dark purple ender bow.', bow_skin(A, hue=0.78, sat=0.7))
    add('neon_bow', 'Neon Bow', 'bow', 'Weapons', 'A bow that cycles through neon colours.', neon_bow(A))

    add('rise_shield', 'Rise Shield', 'shield', 'Weapons', 'An ocean-blue shield with the Rise R.', shield_skin(A, rise_face))
    add('creeper_shield', 'Creeper Shield', 'shield', 'Weapons', 'A creeper face shield.', shield_skin(A, creeper_face))
    add('ocean_shield', 'Wave Shield', 'shield', 'Weapons', 'Turquoise waves.', shield_skin(A, ocean_face))
    add('ender_shield', 'Ender Eye Shield', 'shield', 'Weapons', 'A watching ender eye.', shield_skin(A, ender_face))

    totem = 'item/totem_of_undying'
    add('fries', 'French Fries', 'totem', 'Totems', 'Your totem is a box of fries.', {totem: fries()})
    add('burger', 'Burger Totem', 'totem', 'Totems', 'A burger. It saves your life.', {totem: burger()})
    add('shiny_totem', 'Shiny Gold', 'totem', 'Totems', 'A gold totem with a shine sweeping over it.', {totem: anim(shine(base_totem, band=(255, 250, 200)))})
    add('rainbow_wave', 'Rainbow Wave', 'totem', 'Totems', 'Cycles through every colour.', {totem: anim([recolor(base_totem, hue=i / 16, sat=0.85) for i in range(16)])})
    for tid, name, rc in (('turquoise', 'Turquoise', dict(hue=0.47, sat=0.8)), ('ocean', 'Ocean', dict(hue=0.58, sat=0.85)),
                          ('ender', 'Ender', dict(hue=0.78, sat=0.7)), ('ruby', 'Ruby', dict(hue=0.98, sat=0.8)), ('rainbow', 'Rainbow', dict(rainbow=True))):
        add('totem_' + tid, name + ' Totem', 'totem', 'Totems', 'The totem in %s.' % name.lower(), {totem: recolor(base_totem, **rc)})

    pearl = 'item/ender_pearl'
    add('void_swirl', 'Void Swirl', 'pearl', 'Pearls', 'A spinning purple vortex.', {pearl: anim(swirl_frames(), 2)})
    add('pulse', 'Glowing Pulse', 'pearl', 'Pearls', 'Pulses with turquoise light.', {pearl: anim([recolor(base_pearl, hue=0.47, sat=0.9, bright=1 + 0.45 * (0.5 + 0.5 * math.sin(i / 12 * 2 * math.pi))) for i in range(12)])})
    add('shiny_pearl', 'Shiny Pearl', 'pearl', 'Pearls', 'A shine sweeps across it.', {pearl: anim(shine(base_pearl, band=(190, 255, 245)))})
    add('eyeball', 'Eyeball', 'pearl', 'Pearls', 'Throw an eyeball. Gross.', {pearl: eyeball()})
    add('pearl_turquoise', 'Turquoise Pearl', 'pearl', 'Pearls', 'A turquoise pearl.', {pearl: recolor(base_pearl, hue=0.47, sat=0.85, bright=1.1)})

    add('steak_dinner', 'Steak Dinner', 'cooked_beef', 'Food', 'Cooked steak becomes a steak dinner, still steaming.', {'item/cooked_beef': anim(steam(steak_dinner(), cols=(5, 8, 11), top=2, height=5), 3)})
    add('cereal', 'Cereal', 'mushroom_stew', 'Food', 'Mushroom stew becomes a bowl of cereal.', {'item/mushroom_stew': cereal()})
    add('ramen', 'Ramen', 'rabbit_stew', 'Food', 'Rabbit stew becomes steaming ramen.', {'item/rabbit_stew': anim(steam(ramen(), cols=(4, 8, 12), top=1, height=5), 3)})
    add('cocoa', 'Hot Cocoa', 'beetroot_soup', 'Food', 'Beetroot soup becomes hot cocoa.', {'item/beetroot_soup': anim(steam(cocoa(), cols=(6, 9), top=0, height=5), 3)})
    add('pizza', 'Pizza Slice', 'bread', 'Food', 'Bread becomes a pizza slice.', {'item/bread': pizza()})
    add('donut', 'Donut', 'apple', 'Food', 'Apples become sprinkle donuts.', {'item/apple': donut()})
    ga = 'item/rise_gapple_'
    add('golden_donut', 'Golden Donut', 'golden_apple', 'Food', 'Golden apples become shining golden donuts.',
        {ga + 'donut': anim(shine(donut('#ffd23f', gold=True), band=(255, 255, 220))), 'model:item/golden_apple': model_json(ga + 'donut')})
    add('golden_cupcake', 'Golden Cupcake', 'golden_apple', 'Food', 'Golden apples become golden cupcakes.',
        {ga + 'cupcake': cupcake(), 'model:item/golden_apple': model_json(ga + 'cupcake')})
    add('honey_toast', 'Honey Toast', 'golden_apple', 'Food', 'Golden apples become honey toast.',
        {ga + 'toast': honey_toast(), 'model:item/golden_apple': model_json(ga + 'toast')})
    add('sun_orb', 'Sun Orb', 'golden_apple', 'Food', 'Golden apples become a glowing little sun.',
        {ga + 'sun': anim([sun_orb(i, 12) for i in range(12)], 2), 'model:item/golden_apple': model_json(ga + 'sun')})
    eg = 'item/rise_egap_'
    add('rainbow_donut', 'Rainbow Donut', 'egap', 'Food', 'Enchanted golden apples become a donut that cycles through every colour.',
        {eg + 'rainbow': anim([recolor(donut('#ff5ab8', gold=True), hue=i / 16, sat=0.9) for i in range(16)], 2), 'model:item/enchanted_golden_apple': model_json(eg + 'rainbow')})
    add('galaxy_apple', 'Galaxy Apple', 'egap', 'Food', 'A deep-space apple with twinkling stars.',
        {eg + 'galaxy': anim([galaxy_apple(i, 6) for i in range(6)], 4), 'model:item/enchanted_golden_apple': model_json(eg + 'galaxy')})
    add('diamond_apple', 'Diamond Apple', 'egap', 'Food', 'A shining diamond apple.',
        {eg + 'diamond': anim(shine(apple_shape('#46e0d4', '#b8fff8'), band=(255, 255, 255))), 'model:item/enchanted_golden_apple': model_json(eg + 'diamond')})
    add('crown_cake', 'Royal Cake', 'egap', 'Food', 'A cake with a golden crown, fit for a king.',
        {eg + 'crown': crown_cake(), 'model:item/enchanted_golden_apple': model_json(eg + 'crown')})
    add('pancakes', 'Pancakes', 'cookie', 'Food', 'Cookies become a stack of pancakes.', {'item/cookie': pancakes()})
    add('choc_cookie', 'Chocolate Chip', 'cookie', 'Food', 'A big chocolate chip cookie.', {'item/cookie': chocolate_cookie()})
    add('chicken_bucket', 'Chicken Bucket', 'cooked_chicken', 'Food', 'Cooked chicken becomes a bucket of fried chicken.', {'item/cooked_chicken': chicken_bucket()})
    add('ice_pop', 'Ice Pop', 'carrot', 'Food', 'Carrots become ice pops.', {'item/carrot': ice_pop()})
    add('burger_food', 'Burger', 'baked_potato', 'Food', 'Baked potatoes become burgers.', {'item/baked_potato': burger_food()})
    add('cake_slice', 'Birthday Cake', 'pumpkin_pie', 'Food', 'Pumpkin pie becomes birthday cake with a flickering candle.', {'item/pumpkin_pie': anim(cake_anim(cake_slice()), 3)})
    add('ice_cream', 'Ice Cream', 'melon_slice', 'Food', 'Melon slices become ice cream cones.', {'item/melon_slice': ice_cream()})
    add('gummies', 'Gummy Bears', 'sweet_berries', 'Food', 'Sweet berries become gummy bears.', {'item/sweet_berries': gummies()})
    add('choc_milk', 'Chocolate Milk', 'milk_bucket', 'Food', 'The milk bucket becomes a chocolate milk carton.', {'item/milk_bucket': choc_milk()})
    add('boba', 'Boba Tea', 'honey_bottle', 'Food', 'Honey bottles become boba tea with floating pearls.', {'item/honey_bottle': anim(boba_anim(boba()), 3)})
    return S


GROUP_NAMES = {'egap': 'Enchanted Golden Apple', 'golden_apple': 'Golden Apple', 'sword': 'Swords', 'axe': 'Axes', 'pickaxe': 'Pickaxes', 'bow': 'Bow', 'shield': 'Shield', 'totem': 'Totem', 'pearl': 'Ender Pearl'}


def main():
    A = load_assets()
    packs, meta = {}, []
    for sid, name, group, cat, desc, tex in build(A):
        files = {'pack.mcmeta': pack_mcmeta('Rise skin: ' + name)}
        preview, frames = None, 1
        for path, v in tex.items():
            if path.startswith('model:'):
                files['assets/minecraft/models/' + path[6:] + '.json'] = v
                continue
            if isinstance(v, tuple):
                img, mcmeta = v
                files[T + path + '.png'] = png(img)
                files[T + path + '.png.mcmeta'] = mcmeta
                n = img.height // 16
            else:
                img = v; files[T + path + '.png'] = png(img); n = 1
            # the preview is the diamond version for tinted skins, else the first texture
            if preview is None or 'diamond' in path:
                preview, frames = img, n
        if group == 'shield':
            preview = preview.crop((0, 0, 14, 24)); frames = 1
        pid = 'rise_skin_' + sid
        packs[pid] = {k: base64.b64encode(v).decode() for k, v in files.items()}
        tints = []
        if group in ('sword', 'axe', 'pickaxe'):
            for mat in MATERIALS:
                v = tex['item/%s_%s' % (mat, group)]
                im = v[0] if isinstance(v, tuple) else v
                tints.append(base64.b64encode(png(im.crop((0, 0, 16, 16)))).decode())
        meta.append({'id': sid, 'name': name, 'group': group, 'groupName': GROUP_NAMES.get(group, group.replace('_', ' ').title()),
                     'cat': cat, 'desc': desc, 'anim': frames > 1, 'frames': frames,
                     'img': base64.b64encode(png(preview)).decode(), 'tints': tints})
    out = os.path.join(ROOT, 'theme_extra', 'skins.json')
    json.dump({'packs': packs, 'list': meta}, open(out, 'w'), separators=(',', ':'))
    print('%d skins, %d animated, %d KB' % (len(meta), sum(m['anim'] for m in meta), os.path.getsize(out) // 1024))


if __name__ == '__main__':
    main()
