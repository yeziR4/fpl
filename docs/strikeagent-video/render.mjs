import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const [,, mode, a, b] = process.argv; // mode: stills t1,t2,... | video out.mp4 fps
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('file://' + process.cwd() + '/strike.html', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.READY);
await p.waitForTimeout(500);
if (mode === 'meta') { const fs = await import('fs'); fs.writeFileSync('meta.json', JSON.stringify(await p.evaluate(() => ({ caps: CAPS, sfx: SFX })))); } else if (mode === 'stills') {
  for (const t of a.split(',')) { await p.evaluate(t => seek(t), +t); await p.screenshot({ path: `${process.env.SD||'stills'}/t${t}.png` }); }
} else {
  const fps = +(b || 30); const total = await p.evaluate(() => TOTAL); const n = Math.ceil(total * fps);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', a], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < n; i++) {
    await p.evaluate(t => seek(t), i / fps);
    const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log('frame', i, '/', n);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
}
await br.close();
