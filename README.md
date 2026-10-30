# 🚪 Gatecrasher 2

A tribute clone of **Gatecrasher 2** by Ben Grant — built with plain JavaScript and Canvas 2D, no frameworks, no build step.

## 🎮 About the Game

You're flying at full speed down an endless neon tube. Gates — glowing red arcs with a single gap — rush toward you from the vanishing point. Steer your ship around the circumference of the tube and slip through the gaps.

Clip a gate and you explode into a shower of pixels. Each level is 5 gates; every level the tube gets faster and the gaps get tighter. How deep can you go?

## 🕹️ How to Play

- **Mobile:** hold the left or right side of the screen (or the `<` `>` buttons) to rotate around the tube
- **Desktop:** `←` `→` (or `A` `D`)
- **Space / Enter:** start from the menu
- Your best level is saved locally and shown on the menu

## 🛠️ Tech

Same recipe as my other clones: one `index.html`, one `index.js`, vanilla JS with the Canvas 2D API. The pseudo-3D tube, gates, ship, particles, and sound effects (Web Audio API) are all generated in code. The only external resource is the [Rajdhani](https://fonts.google.com/specimen/Rajdhani) font, loaded from Google Fonts with a sans-serif fallback.

## 🚀 Run It Locally

Because the game uses an ES module (`type="module"`), serve the folder with any static server instead of opening the file directly:

```bash
# with Python
python3 -m http.server 8000

# or with Node
npx serve .
```

Then open http://localhost:8000.

## 🌐 Deploy to GitHub Pages

1. Create a new repository and push these files (they belong in the repo root — no `docs/` folder needed)
2. In the repo, go to **Settings → Pages**
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose `main` (or `master`) and the `/ (root)` folder
4. Save, wait a minute or two, and the game will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

Any static host works too (Netlify, Vercel, Cloudflare Pages): just point it at the folder, no build command required.

## 🗂️ Structure

```
├── index.html   # minimal shell — canvas + styles + font
├── index.js     # the whole game (tube renderer, gates, input, audio)
└── test/
    ├── e2e.py   # Playwright end-to-end tests (menus, steering, collisions, mobile)
    └── bot.py   # automated playtest bot for difficulty balancing
```

The tests are optional extras — the game runs fine without them. To use them: `pip install playwright && python -m playwright install chromium`, then run `python3 test/e2e.py`.

## 🙏 Credits

Original game design by Ben Grant. This is a fan-made tribute for learning purposes — go play the real thing if you can find it.

---

Thanks for checking out Gatecrasher 2! 🚪💥
# gate-crasher-2
