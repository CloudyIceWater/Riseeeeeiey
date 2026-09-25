"""Generates the Rise Client theme: logo, buttons, widgets, starfield panorama,
loading-screen logo and menu backgrounds.  Output: theme/<asset path>.

Run with the local venv:  .venv/bin/python gen_textures.py
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'theme')
GUI = 'assets/minecraft/textures/gui/'

# Rise palette
BG = (2, 18, 34)
CYAN = (64, 240, 220)      # turquoise
VIOLET = (18, 120, 230)    # ocean blue (kept the old name: second gradient stop)
INK = (3, 22, 40)


def save(img, path):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    img.save(full, optimize=True)


def save_text(text, path):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(text)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def grad_h(w, h, c0, c1, alpha=255):
    im = Image.new('RGBA', (w, h))
    px = im.load()
    for x in range(w):
        c = lerp(c0, c1, x / max(1, w - 1))
        for y in range(h):
            px[x, y] = c + (alpha,)
    return im


# ---------------------------------------------------------------- pixel font
FONT = {
    'R': ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
    'I': ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "11111"],
    'S': [".1111", "1....", "1....", ".111.", "....1", "....1", "1111."],
    'E': ["11111", "1....", "1....", "1111.", "1....", "1....", "11111"],
    'C': [".1111", "1....", "1....", "1....", "1....", "1....", ".1111"],
    'L': ["1....", "1....", "1....", "1....", "1....", "1....", "11111"],
    'N': ["1...1", "11..1", "1.1.1", "1..11", "1...1", "1...1", "1...1"],
    'T': ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "..1.."],
    ' ': [".....", ".....", ".....", ".....", ".....", ".....", "....."],
}


def glyph_mask(text, cell, gap_cells=1):
    """Returns an L-mode mask of the text drawn in the block font."""
    cols = sum(5 + gap_cells for _ in text) - gap_cells
    w, h = cols * cell, 7 * cell
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    x0 = 0
    for ch in text:
        g = FONT[ch]
        for r, row in enumerate(g):
            for c, v in enumerate(row):
                if v == '1':
                    d.rectangle([x0 + c * cell, r * cell, x0 + (c + 1) * cell - 1, (r + 1) * cell - 1], fill=255)
        x0 += (5 + gap_cells) * cell
    return m


def wordmark(text, cell, depth, outline, gap_cells=1):
    """Chunky 3D wordmark: gradient face, dark extrusion, black outline."""
    m = glyph_mask(text, cell, gap_cells)
    w, h = m.size
    pad = outline + depth + 2
    W, H = w + pad * 2, h + pad * 2
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # outline + extrusion silhouette
    sil = Image.new('L', (W, H), 0)
    for k in range(depth + 1):
        sil.paste(255, (pad + k, pad + k), m)
    sil = sil.filter(ImageFilter.MaxFilter(outline * 2 + 1))
    img.paste((2, 12, 24, 255), (0, 0), sil)
    # extrusion (dark violet steps)
    for k in range(depth, 0, -1):
        c = lerp((6, 70, 110), (3, 34, 64), k / depth)
        img.paste(c + (255,), (pad + k, pad + k), m)
    # face: vertical cyan -> violet gradient with a highlight band
    face = Image.new('RGBA', (w, h))
    fp = face.load()
    for y in range(h):
        t = y / (h - 1)
        c = lerp(CYAN, VIOLET, t)
        if t < 0.12:
            c = lerp((215, 255, 250), c, t / 0.12)
        for x in range(w):
            fp[x, y] = c + (255,)
    img.paste(face, (pad, pad), m)
    # pixel bevel: lighter top-left edge of every cell block
    inner = m.filter(ImageFilter.MinFilter(3))
    edge = Image.eval(Image.composite(Image.new('L', m.size, 0), m, inner), lambda v: v)
    hl = Image.new('RGBA', (w, h), (255, 255, 255, 70))
    img.paste(hl, (pad, pad), edge)
    return img


def fit_into(canvas_size, art, area, align='center'):
    cw, ch = canvas_size
    ax, ay, aw, ah = area
    s = min(aw / art.width, ah / art.height)
    art = art.resize((max(1, int(art.width * s)), max(1, int(art.height * s))), Image.NEAREST)
    im = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
    x = ax + (aw - art.width) // 2
    y = ay + (ah - art.height) // 2
    im.alpha_composite(art, (x, y))
    return im


# ---------------------------------------------------------------- logos
def make_logo():
    # Title logo: 1024x256 texture, the game shows the top 176 rows (44/64).
    art = wordmark('RISE', cell=20, depth=10, outline=6)
    save(fit_into((1024, 256), art, (262, 2, 500, 172)), GUI + 'title/minecraft.png')
    save(fit_into((1024, 256), art, (262, 2, 500, 172)), GUI + 'title/minceraft.png')
    # Edition strip: 512x64 texture, shown region is 392x56 from the left.
    ed = wordmark('CLIENT', cell=8, depth=3, outline=3, gap_cells=1)
    save(fit_into((512, 64), ed, (40, 2, 312, 54)), GUI + 'title/edition.png')


def make_loading_logo():
    # mojangstudios.png: top half = left half of the wordmark, bottom half = right half.
    m = glyph_mask('RISE CLIENT', cell=10)
    art = Image.new('RGBA', m.size, (255, 255, 255, 0))
    art.paste((255, 255, 255, 255), (0, 0), m)
    strip = fit_into((1024, 256), art, (40, 60, 944, 136))
    tex = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    tex.paste(strip.crop((0, 0, 512, 256)), (0, 0))
    tex.paste(strip.crop((512, 0, 1024, 256)), (0, 256))
    save(tex, GUI + 'title/mojangstudios.png')


# ---------------------------------------------------------------- widgets
def rounded_box(w, h, fill, border, r=2, border2=None):
    """Pixel-rounded box with a 1px border (and optional inner glow line)."""
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = im.load()
    for y in range(h):
        for x in range(w):
            # cut corners (radius r in pixels)
            dx = min(x, w - 1 - x)
            dy = min(y, h - 1 - y)
            if dx + dy < r:
                continue
            on_edge = dx == 0 or dy == 0 or dx + dy == r
            if on_edge:
                px[x, y] = border
            elif border2 and (dx == 1 or dy == 1 or dx + dy == r + 1):
                px[x, y] = border2
            else:
                px[x, y] = fill
    return im


def button_face(w, h, top, bottom, border, glow=None, r=2):
    im = rounded_box(w, h, (0, 0, 0, 0), border, r, glow)
    px = im.load()
    for y in range(h):
        c = lerp(top, bottom, y / max(1, h - 1))
        for x in range(w):
            if px[x, y] == (0, 0, 0, 0):
                dx = min(x, w - 1 - x)
                dy = min(y, h - 1 - y)
                if dx + dy >= r:
                    px[x, y] = c
    return im


def accent_underline(im, alpha=255):
    """Cyan->violet line along the bottom inner edge (Rise hover accent)."""
    w, h = im.size
    line = grad_h(w - 6, 1, CYAN, VIOLET, alpha)
    im.alpha_composite(line, (3, h - 2))
    return im


def nine(path, w, h, border):
    save_text(json.dumps({"gui": {"scaling": {"type": "nine_slice", "width": w, "height": h,
                                             "border": border}}}, indent=4), path + '.mcmeta')


def shine_frames(base, n=14):
    """Frames of a soft white highlight sweeping left->right across a button."""
    w, h = base.size
    frames = []
    for i in range(n):
        f = base.copy()
        cx = -30 + (w + 60) * i / (n - 1)
        glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        gp = glow.load()
        bp = base.load()
        for x in range(w):
            # diagonal band, 26px wide, soft falloff
            for y in range(h):
                d = abs((x - cx) - (y - h / 2) * 0.6)
                a = max(0.0, 1 - d / 13)
                if a > 0 and bp[x, y][3] > 0:
                    gp[x, y] = (210, 255, 250, int(90 * a * a))
        f.alpha_composite(glow)
        frames.append(f)
    return frames


def animated(path, frames, w, h, border, timeline):
    """Save a vertical frame strip + mcmeta with animation and nine-slice scaling."""
    strip = Image.new('RGBA', (w, h * len(frames)), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.alpha_composite(f, (0, i * h))
    save(strip, path)
    save_text(json.dumps({
        "animation": {"frametime": 1, "interpolate": False, "width": w, "height": h, "frames": timeline},
        "gui": {"scaling": {"type": "nine_slice", "width": w, "height": h, "border": border}},
    }, indent=4), path + '.mcmeta')


# Ocean palette for widgets
OCEAN_TOP = (14, 92, 140)
OCEAN_BOT = (6, 52, 92)
EDGE = (40, 170, 200, 255)
HOVER_TOP = (30, 190, 200)
HOVER_BOT = (12, 118, 190)
HOVER_EDGE = (170, 255, 245, 255)


def make_widgets():
    W = GUI + 'sprites/widget/'
    # buttons (200x20): ocean blue, turquoise rim
    b = button_face(200, 20, OCEAN_TOP + (235,), OCEAN_BOT + (235,), EDGE, (255, 255, 255, 30))
    save(b, W + 'button.png'); nine(W + 'button.png', 200, 20, 4)
    # hover: brighter turquoise with an animated shine sweep (plays while hovered)
    bh = button_face(200, 20, HOVER_TOP + (245,), HOVER_BOT + (245,), HOVER_EDGE, (255, 255, 255, 60))
    bh.alpha_composite(grad_h(194, 1, (220, 255, 250), (160, 220, 255), 120), (3, 2))
    fr = shine_frames(bh)
    timeline = [{"index": 0, "time": 6}] + list(range(1, len(fr))) + [{"index": 0, "time": 24}]
    animated(W + 'button_highlighted.png', fr, 200, 20, 4, timeline)
    bd = button_face(200, 20, (10, 34, 52, 180), (8, 26, 42, 180), (30, 70, 90, 255))
    save(bd, W + 'button_disabled.png'); nine(W + 'button_disabled.png', 200, 20, 4)
    # sliders
    s = button_face(200, 20, (4, 30, 52, 225), (6, 40, 66, 225), (30, 130, 170, 255))
    save(s, W + 'slider.png'); nine(W + 'slider.png', 200, 20, 4)
    sh = button_face(200, 20, (6, 44, 72, 235), (8, 56, 90, 235), HOVER_EDGE)
    save(sh, W + 'slider_highlighted.png'); nine(W + 'slider_highlighted.png', 200, 20, 4)
    hb = {"left": 2, "top": 2, "right": 2, "bottom": 3}
    handle = button_face(8, 20, (90, 245, 225, 255), (20, 150, 220, 255), (210, 255, 250, 255), r=1)
    save(handle, W + 'slider_handle.png'); nine(W + 'slider_handle.png', 8, 20, hb)
    handle_h = button_face(8, 20, (190, 255, 245, 255), (90, 200, 255, 255), (255, 255, 255, 255), r=1)
    save(handle_h, W + 'slider_handle_highlighted.png'); nine(W + 'slider_handle_highlighted.png', 8, 20, hb)
    # text fields
    tf = button_face(200, 20, (2, 16, 30, 240), (2, 16, 30, 240), (30, 130, 170, 255), r=2)
    save(tf, W + 'text_field.png'); nine(W + 'text_field.png', 200, 20, 3)
    tfh = button_face(200, 20, (3, 20, 36, 245), (3, 20, 36, 245), HOVER_EDGE, r=2)
    save(tfh, W + 'text_field_highlighted.png'); nine(W + 'text_field_highlighted.png', 200, 20, 3)
    # tabs (130x24, bottom border 0)
    tb = {"left": 3, "top": 3, "right": 3, "bottom": 0}
    def tab(top, bottom, border, underline):
        im = button_face(130, 28, top, bottom, border).crop((0, 0, 130, 24))
        if underline:
            im.alpha_composite(grad_h(124, 2, CYAN, VIOLET), (3, 22))
        return im
    save(tab((8, 50, 84, 210), (5, 36, 64, 210), (30, 120, 160, 255), False), W + 'tab.png'); nine(W + 'tab.png', 130, 24, tb)
    save(tab((14, 80, 124, 235), (8, 56, 96, 235), (90, 220, 230, 255), False), W + 'tab_highlighted.png'); nine(W + 'tab_highlighted.png', 130, 24, tb)
    save(tab((16, 96, 146, 245), (10, 66, 112, 245), HOVER_EDGE, True), W + 'tab_selected.png'); nine(W + 'tab_selected.png', 130, 24, tb)
    save(tab((26, 130, 170, 250), (14, 86, 140, 250), (230, 255, 252, 255), True), W + 'tab_selected_highlighted.png'); nine(W + 'tab_selected_highlighted.png', 130, 24, tb)
    # checkboxes (20x20)
    def check(selected, hover):
        border = HOVER_EDGE if hover else EDGE
        im = button_face(20, 20, (6, 46, 80, 240), (4, 32, 60, 240), border, r=2)
        if selected:
            inner = button_face(12, 12, CYAN + (255,), VIOLET + (255,), (220, 255, 250, 255), r=1)
            im.alpha_composite(inner, (4, 4))
        return im
    save(check(False, False), W + 'checkbox.png')
    save(check(False, True), W + 'checkbox_highlighted.png')
    save(check(True, False), W + 'checkbox_selected.png')
    save(check(True, True), W + 'checkbox_selected_highlighted.png')
    # scroller (6x32)
    save(button_face(6, 32, CYAN + (255,), VIOLET + (255,), (210, 255, 250, 255), r=1), W + 'scroller.png')
    nine(W + 'scroller.png', 6, 32, 1)
    save(button_face(6, 32, (2, 20, 36, 210), (2, 20, 36, 210), (20, 70, 100, 255), r=1), W + 'scroller_background.png')
    nine(W + 'scroller_background.png', 6, 32, 1)


def make_backgrounds():
    # Menu backgrounds are tiled over the blurred panorama.
    save(Image.new('RGBA', (16, 16), (2, 20, 38, 140)), GUI + 'menu_background.png')
    save(Image.new('RGBA', (16, 16), (2, 20, 38, 110)), GUI + 'inworld_menu_background.png')
    save(Image.new('RGBA', (16, 16), (1, 14, 28, 170)), GUI + 'menu_list_background.png')
    save(Image.new('RGBA', (16, 16), (1, 14, 28, 130)), GUI + 'inworld_menu_list_background.png')
    for name in ('header_separator', 'footer_separator', 'inworld_header_separator', 'inworld_footer_separator'):
        im = Image.new('RGBA', (32, 2), (0, 0, 0, 0))
        im.alpha_composite(grad_h(32, 1, CYAN, VIOLET, 210), (0, 0 if 'header' in name else 1))
        im.alpha_composite(Image.new('RGBA', (32, 1), (0, 0, 0, 150)), (0, 1 if 'header' in name else 0))
        save(im, GUI + name + '.png')


def make_panorama():
    """Six 256x256 cube faces of a deep ocean: light from the surface above,
    god-rays and drifting bubbles on the sides, the dark abyss below.
    Side faces share one vertical gradient so the seams line up."""
    S = 256
    SURF = (70, 210, 220)
    MID = (8, 96, 150)
    DEEP = (2, 18, 40)

    def side_color(t):  # t: 0 top .. 1 bottom
        return lerp(SURF, MID, t / 0.45) if t < 0.45 else lerp(MID, DEEP, (t - 0.45) / 0.55)

    for face in range(6):
        rnd = random.Random(2000 + face)
        im = Image.new('RGBA', (S, S))
        px = im.load()
        if face < 4:
            for y in range(S):
                c = side_color(y / (S - 1))
                for x in range(S):
                    px[x, y] = c + (255,)
            # god rays: soft slanted bright bands fading downward (kept off the edges)
            rays = Image.new('RGBA', (S, S), (0, 0, 0, 0))
            rd = ImageDraw.Draw(rays)
            for _ in range(4):
                x0 = rnd.randint(30, 200)
                wdt = rnd.randint(8, 22)
                slant = rnd.randint(-40, 40)
                rd.polygon([(x0, 0), (x0 + wdt, 0), (x0 + wdt + slant + 20, S), (x0 + slant - 20, S)],
                           fill=(200, 255, 250, 46))
            rays = rays.filter(ImageFilter.GaussianBlur(7))
            fade = Image.new('L', (S, S))
            fp = fade.load()
            for y in range(S):
                for x in range(S):
                    edge = min(x, S - 1 - x) / 40
                    fp[x, y] = int(255 * max(0, 1 - y / S) * min(1, edge))
            rays.putalpha(Image.eval(Image.composite(rays.getchannel('A'), Image.new('L', (S, S), 0), fade), lambda v: v))
            im.alpha_composite(rays)
            d = ImageDraw.Draw(im)
            # bubbles
            for _ in range(26):
                x, y = rnd.randint(10, 245), rnd.randint(10, 245)
                r = rnd.choice((1, 1, 2, 2, 3))
                d.ellipse([x - r, y - r, x + r, y + r], outline=(200, 255, 250, 150))
                d.point([(x - r // 2, y - r // 2)], fill=(255, 255, 255, 200))
            # floating particles (plankton)
            for _ in range(60):
                x, y = rnd.randrange(S), rnd.randrange(S)
                d.point([(x, y)], fill=(160, 240, 235, rnd.randint(60, 160)))
        elif face == 4:  # up: the surface seen from below, bright caustics
            for y in range(S):
                for x in range(S):
                    dx, dy = (x - 128) / 128, (y - 128) / 128
                    t = min(1, math.sqrt(dx * dx + dy * dy))
                    px[x, y] = lerp((190, 250, 245), SURF, t) + (255,)
            d = ImageDraw.Draw(im)
            for _ in range(70):
                x, y = rnd.randrange(S), rnd.randrange(S)
                pts = [(x, y)]
                for _ in range(3):
                    x += rnd.randint(-18, 18); y += rnd.randint(-18, 18)
                    pts.append((x, y))
                d.line(pts, fill=(235, 255, 252, 90), width=2)
            im = im.filter(ImageFilter.GaussianBlur(1.2))
        else:  # down: the abyss
            for y in range(S):
                for x in range(S):
                    dx, dy = (x - 128) / 128, (y - 128) / 128
                    t = min(1, math.sqrt(dx * dx + dy * dy))
                    px[x, y] = lerp((1, 8, 20), DEEP, t) + (255,)
        save(im.convert('RGB'), GUI + 'title/background/panorama_%d.png' % face)
    save(Image.new('RGBA', (1, 1), (0, 0, 0, 0)), GUI + 'title/background/panorama_overlay.png')


SPLASHES = """Now with observers!
Railguns approved!
Flying machines fly!
Stasis chambers work!
Sodium-style settings!
Right Shift for Rise!
Runs on a Chromebook!
LAN worlds for the class!
Quasi-connectivity intact!
Bubble columns bubble!
Zero-tick ready!
Rise and grind!
26.2 in a browser!
Built for 4GB of RAM!
Also try redstone!
Slime blocks stick!
Observers observe!
Piston timing: Java!
Now 100% more Rise!
Chunk loading, but faster!
"""


def main():
    make_logo()
    make_loading_logo()
    make_widgets()
    make_backgrounds()
    make_panorama()
    save_text(SPLASHES, 'assets/minecraft/texts/splashes.txt')
    n = sum(len(f) for _, _, f in os.walk(OUT))
    print('theme files:', n)


if __name__ == '__main__':
    main()


def make_extras():
    """Loading-screen logo and favicon for the HTML shell (theme_extra/)."""
    ex = os.path.join(ROOT, 'theme_extra')
    os.makedirs(ex, exist_ok=True)
    rise = wordmark('RISE', cell=20, depth=10, outline=6)
    client = wordmark('CLIENT', cell=7, depth=3, outline=3)
    W = max(rise.width, client.width)
    im = Image.new('RGBA', (W, rise.height + client.height - 10), (0, 0, 0, 0))
    im.alpha_composite(rise, ((W - rise.width) // 2, 0))
    im.alpha_composite(client, ((W - client.width) // 2, rise.height - 10))
    fit_into((1024, 256), im, (0, 0, 1024, 256)).save(os.path.join(ex, 'boot_logo.png'), optimize=True)
    r = wordmark('R', cell=8, depth=3, outline=3)
    fit_into((64, 64), r, (2, 2, 60, 60)).save(os.path.join(ex, 'icon.png'), optimize=True)


make_extras()
