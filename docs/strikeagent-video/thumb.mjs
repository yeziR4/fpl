import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('file://' + process.cwd() + '/thumb.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
await p.screenshot({ path: 'strikeagent-thumbnail.png' }); await br.close();
