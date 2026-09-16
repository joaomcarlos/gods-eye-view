import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_URL = process.env.APP_URL || 'http://localhost:4173';
const OUT_DIR = '/tmp/beach_mapview';
const FRAME_DIR = '/tmp/beach_frames_fresh';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_CFG = path.resolve(__dirname, '../config/cctv_sources.portugal.json');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

// Get beach camera IDs from the config
const cfg = JSON.parse(fs.readFileSync(SOURCES_CFG, 'utf8'));
const arr = Array.isArray(cfg) ? cfg : (cfg.sources || []);
const beachCams = arr.filter(s => s.sourceKind === 'meo-beachcam');
console.log(`Found ${beachCams.length} beach cameras`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
         '--disable-dev-shm-usage', '--window-size=1920,1080'],
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

// Collect console errors
page.on('console', msg => {
  if (msg.type() === 'error') console.error('PAGE ERROR:', msg.text());
});

console.log('Navigating to', APP_URL);
await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });

// Wait for the app to initialize
console.log('Waiting for app init...');
await page.waitForFunction(() => window.__godsEyeView?.viewer != null, { timeout: 30000 });
console.log('Cesium viewer ready');

// Wait a bit for terrain/tiles to load
await new Promise(r => setTimeout(r, 5000));

// Enable CCTV layer
console.log('Enabling CCTV layer...');
await page.evaluate(async () => {
  const dm = window.__godsEyeView?.dataManager;
  if (!dm) throw new Error('No dataManager');
  await dm.setEnabled('cctv', true, { origin: 'user' });
});

// Wait for cameras to load
await page.evaluate(() => {
  return new Promise((resolve) => {
    const check = () => {
      const cctv = window.__godsEyeView?.dataManager?.layers?.get('cctv')?.module;
      const state = cctv?.getUIState?.();
      if (state?.cameras?.length > 0) resolve(state.cameras.length);
      else setTimeout(check, 500);
    };
    check();
  });
}).then(n => console.log(`CCTV loaded with ${n} cameras`));

// Make sure projection is enabled
await page.evaluate(() => {
  const dm = window.__godsEyeView?.dataManager;
  dm?.setLayerParams('cctv', { showProjection: true }, { origin: 'user' });
});

// Get the Cesium canvas element
const canvasSelector = '#cesiumContainer .cesium-widget canvas';

for (const cam of beachCams) {
  const id = cam.id;
  console.log(`\nProcessing ${id} (heading=${cam.headingDeg})...`);

  try {
    // Select and focus the camera
    await page.evaluate(async (cameraId) => {
      const cctv = window.__godsEyeView?.dataManager?.layers?.get('cctv')?.module;
      if (!cctv) throw new Error('No cctv layer');
      cctv.selectCamera(cameraId);
      cctv.focusCamera(cameraId, 1.5);
    }, id);

    // Wait for fly-to animation + HLS load + projection
    console.log(`  Waiting for view to settle...`);
    await new Promise(r => setTimeout(r, 6000));

    // Take screenshot of the 3D view
    const screenshotPath = path.join(OUT_DIR, `${id}.jpg`);
    const canvas = await page.$(canvasSelector);
    if (canvas) {
      await canvas.screenshot({ path: screenshotPath, type: 'jpeg', quality: 85 });
      console.log(`  Saved 3D view: ${screenshotPath}`);
    } else {
      console.log(`  No canvas found, taking full page screenshot`);
      await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 85 });
    }

    // Also fetch a raw frame from the API (no heading label)
    try {
      const framePath = path.join(FRAME_DIR, `${id}.jpg`);
      const resp = await fetch(`${APP_URL}/api/cctv/frame/${id}`);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(framePath, buf);
        console.log(`  Saved raw frame: ${framePath}`);
      }
    } catch (e) {
      console.log(`  Frame fetch failed: ${e.message}`);
    }

  } catch (e) {
    console.error(`  Error for ${id}: ${e.message}`);
  }
}

await browser.close();
console.log('\nDone!');
console.log(`3D view screenshots: ${OUT_DIR}`);
console.log(`Raw frames: ${FRAME_DIR}`);
