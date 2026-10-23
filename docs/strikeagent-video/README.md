# StrikeAGent hackathon demo video

1920×1080, 82 s, H.264 Main 4.2 + AAC. Voiceover: Fish Audio (speed 1.25).

Build: `python3 mkvo.py` (VO → vo/, cues.json) → `python3 build.py` (src.html + cues → strike.html) →
`node render.mjs meta` (captions + SFX cue list) → `python3 music.py` (music.wav, sfx.wav) →
`node render.mjs video silent.mp4 30` → mix and mux with ffmpeg (the music is sidechain-ducked under the VO, then loudnorm to -15 LUFS).

Sources shown: the receipt text is copied verbatim from x.com/StrikeAGentt/status/2113625563189412037. The health JSON is from
strikeagent-paper.fly.dev/health. The Strike app screenshot was captured on Oct 23, 2026. Every other UI is an illustration and is labelled that way on screen.
