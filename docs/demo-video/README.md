# Demo video source

The submission video is generated, not screen-recorded: real screenshots of the
live site, composed with GSAP into a timeline that is synced to the narration and
rendered frame by frame in headless Chromium.

| File | What it does |
|---|---|
| `NARRATION.md` | The narration, with timestamps. Read it over the music-only cut to use your own voice |
| `script.json` | Narration lines and the pause after each |
| `mkvo.py` | Speaks each line with [Piper](https://github.com/rhasspy/piper) (`en_US-ryan-high`) and writes `cues.json` |
| `music.py` | Synthesises the original music bed from `cues.json` (no samples, no licensed audio) |
| `mix.py` | Places the voice lines on the music and ducks the music under them |
| `capture.mjs` | Screenshots the live site (dark theme, 2× scale) into `assets/` |
| `comp.html` | The composition: every scene, keyed to the narration cue times |
| `build.py` | Injects the cues and the human calls from `data/human_picks.json` into `render.html` |
| `render.mjs` | Renders `render.html` at 30 fps to H.264 through ffmpeg |

```bash
pip install piper-tts numpy        # plus ffmpeg and playwright
node capture.mjs                   # -> assets/*.png (avatars come from unavatar.io)
python mkvo.py && python music.py && python mix.py
python build.py && node render.mjs video silent.mp4 30
ffmpeg -i silent.mp4 -i mix.wav -c:v copy -c:a aac -b:a 192k -shortest overline-demo.mp4
```

Every figure on screen is taken from the site and `data/` as of 12 Oct 2026. The
price ladder is in fill order, from `avgPrice` in `data/human_picks.json`.
