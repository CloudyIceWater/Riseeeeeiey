# Rise Client

A re-skinned, performance-tuned Eaglercraft **26.2** client (Minecraft 26.2 in the
browser, Wasm-GC). The base game is o_xer's Eaglercraft 26.2 port; Rise adds:

- **Ocean theme**: turquoise/ocean-blue buttons with an animated shine on hover,
  RISE CLIENT logo, underwater panorama and custom splash texts. The stock
  Eaglercraft loading screen stays.
- **Rise Video Settings** (ShadowNet / Sodium layout): the game's own
  "Video Settings..." button opens it. Tabs: General, Quality, Performance,
  Advanced, plus Chromebook / Balanced / Quality presets. Resolution options
  apply instantly; game options apply on **Apply & Restart**.
- **Mods**: the title screen's "Credits" button becomes **Mods**, and the in-game
  Escape menu gets a **Mods** button under "Save and Quit". Right-click any mod
  for a picture, what it does and its settings:
  - HUD: keystrokes, CPS, FPS, custom crosshair
  - Gameplay: zoom (hold C), fullbright (K), toggle sprint/sneak, hitboxes,
    chunk borders, Blueprints
  - Redstone: tick freeze/step/rate, TNT Lag Fix, redstone kit, quick commands
  - Lag: entity culling, Clear Lag timer, entity cramming, TNT lag fix
  - Misc: enchant glint colours, glowing ores, clean glass, low fire, clear water,
    no pumpkin blur, shader filters, camera tweaks
  - **Skins**: 52 cosmetic item skins (19 animated) with search and filters:
    swords and axes (one design, tinted per material), pickaxes, bows, shields,
    totems, ender pearls and food (steak dinner, cereal, ramen, pizza...)
- **Chromebook Mode** (auto on ChromeOS or <=4GB RAM / <=4 cores; force it with
  `?chromebook`) and render / dynamic resolution.
- **Fast world start**: 1562 recipe-unlock advancements are replaced by one that
  unlocks every recipe on the first tick (server start 8.0s -> 6.6s in testing).

How the buttons work: the game is a compiled Wasm blob, so Rise reads each
finished frame (menu text is matched against the game's own font) to know
which screen is open, and draws pixel-matched buttons over the game's.

## Builds

| File | Use |
| --- | --- |
| `dist/RiseClient.html` | Single offline file (77 MB). Download it and open it. |
| `dist/web/` | Web version for hosting: `index.html` + `payload/*.bin`, 56 MB, cached in the browser after the first load. |

## Rebuilding

```
.venv/bin/python gen_textures.py   # theme textures -> theme/, theme_extra/
.venv/bin/python gen_extras.py     # font, glyph table, texture-mod packs -> theme_extra/
.venv/bin/python gen_skins.py      # the 52 item skins -> theme_extra/skins.json
python3 build.py                   # -> dist/RiseClient.html and dist/web/
```

The base file is `ref/wispcraft-26.2.html`. `epk.py` reads and writes EPK packs.
Blueprints come from `../BlueprintMod/blueprint.js`.
