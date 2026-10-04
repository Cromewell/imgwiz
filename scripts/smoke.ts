/**
 * End-to-end smoke test: drives the built app in a real headless Chromium so
 * the parts the Node checks cannot reach — the worker, canvas decode/encode and
 * the download path — are actually exercised.
 *
 * Usage: bun scripts/smoke.ts [baseUrl]
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8731/index.html';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium';

let failures = 0;
const problems: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

const TOOLS = ['Black & white', 'Exposure & contrast', 'Dither', 'Crop', 'Resize', 'Convert format'];

async function main(): Promise<void> {
  const downloadDir = mkdtempSync(join(tmpdir(), 'imgwiz-dl-'));
  const browser: Browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page: Page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()}`));

    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(BASE.replace(/\/index\.html$/, '')) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        external.push(url);
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });

    console.log('\nlanding');
    await page.waitForSelector('.dropzone');
    check('landing page renders', (await page.$$('.tool-card')).length === 6);
    check('privacy badge is present', !!(await page.$('.privacy-badge')));

    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    console.log('\nload an image');
    await page.evaluate(async () => {
      // A 320x200 test image with a colour gradient and an alpha corner.
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, 320, 200);
      grad.addColorStop(0, '#1b2a6b');
      grad.addColorStop(0.5, '#d2694a');
      grad.addColorStop(1, '#f6e7c1');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 320, 200);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(230, 60, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.clearRect(0, 170, 40, 30);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob!], 'smoke-test.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.querySelector('input[type=file]') as HTMLInputElement;
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    });

    await page.waitForSelector('.preview-canvas', { timeout: 15_000 });
    await page.waitForFunction(
      () => !document.querySelector('.stage-status')?.classList.contains('is-visible'),
      { timeout: 15_000 },
    );
    const dims = await page.evaluate(() => {
      const canvas = document.querySelector('.preview-canvas') as HTMLCanvasElement;
      return { w: canvas.width, h: canvas.height, meta: document.querySelector('.stage-meta')?.textContent };
    });
    check('preview canvas is populated', dims.w === 320 && dims.h === 200, JSON.stringify(dims));
    check('size readout shows source dimensions', dims.meta?.includes('320 x 200') ?? false, String(dims.meta));

    console.log('\ntools');
    for (const title of TOOLS) {
      await selectTool(page, title);
      const heading = await page.$eval('.panel-title h2', (node) => node.textContent);
      check(`${title}: panel opens`, heading === title, String(heading));
      const live = await page.evaluate(() => {
        const canvas = document.querySelector('.preview-canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonBlank = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) nonBlank++;
        return { nonBlank, total: data.length / 4, controls: document.querySelectorAll('.control-list > *').length };
      });
      check(`${title}: preview has visible pixels`, live.nonBlank > live.total * 0.5, JSON.stringify(live));
      check(`${title}: controls rendered`, live.controls > 0, JSON.stringify(live));
    }

    console.log('\ndither runs in the worker');
    await selectTool(page, 'Dither');
    await page.waitForFunction(
      () => !document.querySelector('.stage-status')?.classList.contains('is-visible'),
      { timeout: 15_000 },
    );
    const bits = await page.evaluate(() => {
      const canvas = document.querySelector('.preview-canvas') as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const values = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        values.add(data[i]);
        if (values.size > 6) break;
      }
      return [...values];
    });
    check('default dither output is 1-bit', bits.every((v) => v === 0 || v === 255), JSON.stringify(bits));

    console.log('\ncrop overlay');
    await selectTool(page, 'Crop');
    await page.waitForSelector('.crop-rect');
    const before = await page.$eval('.crop-readout', (n) => n.textContent);
    const handle = await page.$('.crop-se');
    const box = (await handle!.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y - 70, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      (prev: string) => document.querySelector('.crop-readout')?.textContent !== prev,
      { timeout: 5000 },
      before ?? '',
    );
    const after = await page.$eval('.crop-readout', (n) => n.textContent);
    check('dragging a handle resizes the crop frame', after !== before, `${before} -> ${after}`);
    const cropMeta = await page.$eval('.stage-meta', (n) => n.textContent ?? '');
    check('size readout reflects the crop', cropMeta.includes('->'), cropMeta);

    console.log('\nresize');
    await selectTool(page, 'Resize');
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.chip')].find((c) => c.textContent === '512px') as HTMLButtonElement;
      chip.click();
    });
    await page.waitForFunction(
      () => (document.querySelector('.stage-meta')?.textContent ?? '').includes('512 x 320'),
      { timeout: 10_000 },
    );
    check('longest-edge preset updates the target size', true);

    console.log('\nexport');
    for (const title of ['Black & white', 'Dither', 'Resize', 'Convert format']) {
      await selectTool(page, title);
      await page.waitForFunction(
        () => !document.querySelector('.stage-status')?.classList.contains('is-visible'),
        { timeout: 15_000 },
      );
      await page.evaluate(() => (document.querySelector('.export-actions .btn') as HTMLButtonElement).click());
      await page.waitForFunction(
        () => {
          const text = document.querySelector('.export-result')?.textContent ?? '';
          return text.length > 0 && !text.includes('Processing');
        },
        { timeout: 30_000 },
      );
      const result = await page.$eval('.export-result', (n) => n.textContent ?? '');
      check(`${title}: export reports a file`, /\d+ x \d+/.test(result) && /(B|kB|MB)$/.test(result.trim()), result);
    }

    // Downloads are asynchronous; give Chromium a moment to flush them.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const files = readdirSync(downloadDir).filter((f) => !f.endsWith('.crdownload'));
    check('files actually landed on disk', files.length >= 4, files.join(', '));
    check('filenames carry the tool suffix', files.some((f) => f.includes('-dither')), files.join(', '));

    console.log('\nnetwork');
    check('no requests left this origin', external.length === 0, external.join(', '));
    check('no console errors or failed requests', problems.length === 0, problems.join(' | '));
  } finally {
    await browser.close();
    rmSync(downloadDir, { recursive: true, force: true });
  }
}

async function selectTool(page: Page, title: string): Promise<void> {
  await page.evaluate((label: string) => {
    const tab = [...document.querySelectorAll('.tool-tab')].find((t) => t.textContent?.trim() === label) as HTMLButtonElement;
    tab.click();
  }, title);
  await page.waitForFunction(
    (label: string) => document.querySelector('.panel-title h2')?.textContent === label,
    { timeout: 10_000 },
    title,
  );
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'SMOKE TEST PASSED' : `${failures} CHECK(S) FAILED`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error('\nSmoke test crashed:', error);
    process.exit(1);
  });
