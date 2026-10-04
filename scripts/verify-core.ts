import { applyAdjust, lumaHistogram } from '../src/core/adjust';
import { applyDither } from '../src/core/dither';
import { applyGeometry, geometrySize } from '../src/core/geometry';
import { getThresholdMatrix } from '../src/core/noise';
import { resolvePalette } from '../src/core/palettes';
import { pipelineSize, runPipeline } from '../src/core/pipeline';
import { resample } from '../src/core/resample';
import { createBitmap, defaultAdjust, defaultDither, type Bitmap } from '../src/core/types';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

function gradient(w: number, h: number): Bitmap {
  const b = createBitmap(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    b.data[i] = Math.round((x / (w - 1)) * 255);
    b.data[i + 1] = Math.round((y / (h - 1)) * 255);
    b.data[i + 2] = 128;
    b.data[i + 3] = 255;
  }
  return b;
}

function solid(w: number, h: number, r: number, g: number, bl: number, a = 255): Bitmap {
  const b = createBitmap(w, h);
  for (let i = 0; i < b.data.length; i += 4) { b.data[i] = r; b.data[i+1] = g; b.data[i+2] = bl; b.data[i+3] = a; }
  return b;
}

console.log('\nadjust');
{
  const src = gradient(64, 64);
  const copy = { ...src, data: new Uint8ClampedArray(src.data) };
  applyAdjust(copy, defaultAdjust());
  check('neutral params are an exact identity', copy.data.every((v, i) => v === src.data[i]));

  const brighter = { ...src, data: new Uint8ClampedArray(src.data) };
  applyAdjust(brighter, { ...defaultAdjust(), exposure: 1 });
  const mid = (64 * 32 + 32) * 4;
  check('+1 EV brightens midtones', brighter.data[mid] > src.data[mid], `${brighter.data[mid]} vs ${src.data[mid]}`);

  const gray = { ...src, data: new Uint8ClampedArray(src.data) };
  applyAdjust(gray, { ...defaultAdjust(), grayscale: true });
  let neutral = true;
  for (let i = 0; i < gray.data.length; i += 4) {
    if (gray.data[i] !== gray.data[i+1] || gray.data[i] !== gray.data[i+2]) { neutral = false; break; }
  }
  check('grayscale yields neutral pixels', neutral);

  const red = { ...solid(8, 8, 200, 60, 60), data: new Uint8ClampedArray(solid(8, 8, 200, 60, 60).data) };
  const redFilter = { ...red, data: new Uint8ClampedArray(red.data) };
  const blueFilter = { ...red, data: new Uint8ClampedArray(red.data) };
  applyAdjust(redFilter, { ...defaultAdjust(), grayscale: true, mix: [0.8, 0.15, 0.05] });
  applyAdjust(blueFilter, { ...defaultAdjust(), grayscale: true, mix: [0.05, 0.25, 0.7] });
  check('red filter lightens reds vs blue filter', redFilter.data[0] > blueFilter.data[0], `${redFilter.data[0]} vs ${blueFilter.data[0]}`);

  const inverted = { ...src, data: new Uint8ClampedArray(src.data) };
  applyAdjust(inverted, { ...defaultAdjust(), invert: true });
  check('invert mirrors the tone curve', Math.abs(inverted.data[0] - (255 - src.data[0])) <= 1);

  const alpha = solid(4, 4, 10, 20, 30, 77);
  applyAdjust(alpha, { ...defaultAdjust(), exposure: 2, contrast: 50 });
  check('alpha is left untouched', alpha.data[3] === 77);

  const hist = lumaHistogram(gradient(16, 16));
  check('histogram counts every pixel', hist.reduce((a, b) => a + b, 0) === 256);
}

console.log('\nnoise / threshold matrices');
{
  const bayer = getThresholdMatrix('bayer4');
  check('bayer4 is 4x4', bayer?.size === 4);
  const sorted = Array.from(bayer!.values).sort((a, b) => a - b);
  check('bayer4 thresholds are distinct', new Set(sorted).size === 16);
  check('bayer4 thresholds are inside (0,1)', sorted[0] > 0 && sorted[15] < 1);

  const t0 = Date.now();
  const blue = getThresholdMatrix('bluenoise');
  const elapsed = Date.now() - t0;
  check('blue noise is 64x64', blue?.size === 64);
  check('blue noise ranks are a permutation', new Set(Array.from(blue!.values)).size === 4096);
  check(`blue noise builds fast (${elapsed}ms)`, elapsed < 3000, `${elapsed}ms`);
  const mean = Array.from(blue!.values).reduce((a, b) => a + b, 0) / 4096;
  check('blue noise mean is ~0.5', Math.abs(mean - 0.5) < 0.01, mean.toFixed(4));
  check('blue noise matrix is cached', getThresholdMatrix('bluenoise') === blue);
  check('non-ordered methods return null', getThresholdMatrix('floyd-steinberg') === null);
}

console.log('\ndither');
{
  const src = gradient(96, 96);
  for (const method of ['floyd-steinberg', 'atkinson', 'stucki', 'jarvis', 'burkes', 'sierra3', 'sierra2', 'sierra-lite', 'false-floyd-steinberg', 'bayer2', 'bayer4', 'bayer8', 'cluster4', 'cluster8', 'bluenoise', 'random', 'none'] as const) {
    const out = applyDither(src, { ...defaultDither(), method, palette: 'mono' });
    const values = new Set(Array.from(out.data).filter((_, i) => i % 4 !== 3));
    const onlyBlackWhite = Array.from(values).every((v) => v === 0 || v === 255);
    check(`${method}: mono output is strictly 1-bit`, onlyBlackWhite && out.width === 96 && out.height === 96);
  }

  const gb = applyDither(src, { ...defaultDither(), palette: 'gameboy' });
  const palette = resolvePalette('gameboy', 2);
  const allowed = new Set<string>();
  for (let i = 0; i < palette.length; i += 3) allowed.add(`${palette[i]},${palette[i+1]},${palette[i+2]}`);
  let inPalette = true;
  for (let i = 0; i < gb.data.length; i += 4) {
    if (!allowed.has(`${gb.data[i]},${gb.data[i+1]},${gb.data[i+2]}`)) { inPalette = false; break; }
  }
  check('palette dither emits only palette colours', inPalette);

  const levels = applyDither(src, { ...defaultDither(), method: 'bayer4', palette: 'gray', levels: 4 });
  const greys = new Set(Array.from(levels.data).filter((_, i) => i % 4 === 0));
  check('4 grey levels produce at most 4 values', greys.size <= 4, `${[...greys].join(',')}`);

  const cube = applyDither(src, { ...defaultDither(), method: 'bayer8', palette: 'rgb', levels: 3 });
  const steps = new Set(Array.from(cube.data).filter((_, i) => i % 4 === 0));
  check('rgb cube quantizes each channel to its levels', steps.size <= 3, `${[...steps].join(',')}`);

  const chunky = applyDither(src, { ...defaultDither(), pixelSize: 4 });
  check('pixelSize keeps the output dimensions', chunky.width === 96 && chunky.height === 96);
  const a = (0 * 96 + 0) * 4, b = (1 * 96 + 1) * 4;
  check('pixelSize produces 4x4 blocks', chunky.data[a] === chunky.data[b]);

  const dark = applyDither(src, { ...defaultDither(), threshold: -40 });
  const bright = applyDither(src, { ...defaultDither(), threshold: 40 });
  const mean = (b2: Bitmap) => { let s = 0; for (let i = 0; i < b2.data.length; i += 4) s += b2.data[i]; return s / (b2.data.length / 4); };
  check('threshold bias shifts overall tone', mean(dark) < mean(bright), `${mean(dark).toFixed(1)} vs ${mean(bright).toFixed(1)}`);

  const inv = applyDither(solid(16, 16, 255, 255, 255), { ...defaultDither(), invert: true });
  check('invert flips a white source to black', inv.data[0] === 0);

  const flat = solid(64, 64, 128, 128, 128);
  const fs = applyDither(flat, { ...defaultDither(), method: 'floyd-steinberg' });
  let white = 0;
  for (let i = 0; i < fs.data.length; i += 4) if (fs.data[i] === 255) white++;
  const ratio = white / 4096;
  check('mid grey diffuses to ~50% coverage', Math.abs(ratio - 0.5) < 0.08, ratio.toFixed(3));

  const alphaSrc = solid(8, 8, 128, 128, 128, 90);
  const alphaOut = applyDither(alphaSrc, defaultDither());
  check('dither preserves alpha', alphaOut.data[3] === 90);
}

console.log('\nresample');
{
  const src = solid(100, 50, 40, 90, 160);
  for (const kernel of ['lanczos3', 'mitchell', 'bilinear', 'box', 'nearest'] as const) {
    const out = resample(src, 33, 17, kernel);
    const exact = out.width === 33 && out.height === 17;
    let flat = true;
    for (let i = 0; i < out.data.length; i += 4) {
      if (Math.abs(out.data[i] - 40) > 1 || Math.abs(out.data[i+1] - 90) > 1 || Math.abs(out.data[i+2] - 160) > 1) { flat = false; break; }
    }
    check(`${kernel}: exact dims and flat colour survives`, exact && flat);
  }

  const up = resample(src, 200, 100, 'lanczos3');
  check('upscale dimensions are exact', up.width === 200 && up.height === 100);

  const same = resample(src, 100, 50, 'lanczos3');
  check('identity resize returns the same pixels', same.data.every((v, i) => v === src.data[i]));

  // A transparent red region must not bleed colour into an opaque neighbour.
  const edge = createBitmap(8, 1);
  for (let x = 0; x < 8; x++) {
    const i = x * 4;
    const opaque = x < 4;
    edge.data[i] = opaque ? 0 : 255;
    edge.data[i + 1] = opaque ? 0 : 0;
    edge.data[i + 2] = opaque ? 255 : 0;
    edge.data[i + 3] = opaque ? 255 : 0;
  }
  const halved = resample(edge, 4, 1, 'bilinear');
  check('transparent pixels do not bleed colour', halved.data[2] > halved.data[0], `b=${halved.data[2]} r=${halved.data[0]}`);

  const gradOut = resample(gradient(256, 256), 64, 64, 'lanczos3');
  check('downscaled gradient stays monotonic', gradOut.data[0] < gradOut.data[(63) * 4], `${gradOut.data[0]} -> ${gradOut.data[63*4]}`);
}

console.log('\ngeometry');
{
  const src = gradient(40, 20);
  const half = applyGeometry(src, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 }, rotate: 0, flipH: false, flipV: false });
  check('crop dimensions', half.width === 20 && half.height === 20);
  check('crop reads from the right offset', half.data[0] === src.data[(0 * 40 + 20) * 4]);

  const rotated = applyGeometry(src, { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 90, flipH: false, flipV: false });
  check('rotate 90 swaps dimensions', rotated.width === 20 && rotated.height === 40);
  // Source top-left must land at the output top-right after a clockwise turn.
  const tl = [src.data[0], src.data[1], src.data[2]];
  const topRight = ((0) * rotated.width + (rotated.width - 1)) * 4;
  check('rotate 90 is clockwise', rotated.data[topRight] === tl[0] && rotated.data[topRight+1] === tl[1]);

  const r360 = applyGeometry(applyGeometry(applyGeometry(applyGeometry(src, { crop:{x:0,y:0,w:1,h:1}, rotate:90, flipH:false, flipV:false }), { crop:{x:0,y:0,w:1,h:1}, rotate:90, flipH:false, flipV:false }), { crop:{x:0,y:0,w:1,h:1}, rotate:90, flipH:false, flipV:false }), { crop:{x:0,y:0,w:1,h:1}, rotate:90, flipH:false, flipV:false });
  check('four quarter turns are the identity', r360.data.every((v, i) => v === src.data[i]));

  const flipped = applyGeometry(src, { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flipH: true, flipV: false });
  check('flipH mirrors horizontally', flipped.data[0] === src.data[(40 - 1) * 4]);

  const twice = applyGeometry(flipped, { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flipH: true, flipV: false });
  check('double flip is the identity', twice.data.every((v, i) => v === src.data[i]));

  check('geometrySize matches applyGeometry', (() => {
    const p = { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, rotate: 270 as const, flipH: true, flipV: true };
    const predicted = geometrySize(src, p);
    const actual = applyGeometry(src, p);
    return predicted.width === actual.width && predicted.height === actual.height;
  })());

  const degenerate = applyGeometry(src, { crop: { x: 0.99, y: 0.99, w: 0.001, h: 0.001 }, rotate: 0, flipH: false, flipV: false });
  check('a degenerate crop still yields at least one pixel', degenerate.width >= 1 && degenerate.height >= 1);
}

console.log('\npipeline');
{
  const src = gradient(80, 60);
  const ops = [
    { type: 'geometry' as const, params: { crop: { x: 0, y: 0, w: 0.5, h: 1 }, rotate: 90 as const, flipH: false, flipV: false } },
    { type: 'resize' as const, params: { width: 30, height: 40, kernel: 'lanczos3' as const } },
    { type: 'adjust' as const, params: { ...defaultAdjust(), contrast: 20 } },
    { type: 'dither' as const, params: { ...defaultDither(), pixelSize: 2 } },
  ];
  const out = runPipeline(src, ops);
  const predicted = pipelineSize(src, ops);
  check('pipeline output matches pipelineSize', out.width === predicted.width && out.height === predicted.height, `${out.width}x${out.height} vs ${predicted.width}x${predicted.height}`);
  check('pipeline output is the resize target', out.width === 30 && out.height === 40);

  const empty = runPipeline(src, []);
  check('an empty op list copies the source', empty.data.every((v, i) => v === src.data[i]) && empty.data !== src.data);

  // Preview scale must shrink absolute pixel parameters proportionally.
  const previewSrc = resample(src, 40, 30, 'mitchell');
  const preview = runPipeline(previewSrc, ops, { scale: 0.5 });
  check('preview scaling halves the resize target', preview.width === 15 && preview.height === 20, `${preview.width}x${preview.height}`);

  const srcCopy = new Uint8ClampedArray(src.data);
  runPipeline(src, ops);
  check('runPipeline does not mutate its input', src.data.every((v, i) => v === srcCopy[i]));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
