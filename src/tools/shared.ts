import { lumaHistogram } from '../core/adjust';
import { h } from '../app/dom';
import type { Control, ToolHost } from '../app/types';
import type { AdjustParams, Bitmap } from '../core/types';

/** Which tonal sliders a tool wants to expose. */
export interface ToneOptions {
  exposure?: boolean;
  contrast?: boolean;
  brightness?: boolean;
  levels?: boolean;
  gamma?: boolean;
  saturation?: boolean;
  invert?: boolean;
}

/**
 * Tone sliders, bound through an accessor so any tool can embed them wherever
 * its AdjustParams happens to live.
 */
export function toneControls<S>(pick: (s: S) => AdjustParams, opts: ToneOptions = {}): Control<S>[] {
  const want = { exposure: true, contrast: true, brightness: true, levels: true, gamma: true, ...opts };
  const controls: Control<S>[] = [];

  if (want.exposure) {
    controls.push({
      kind: 'slider',
      label: 'Exposure',
      min: -4,
      max: 4,
      step: 0.05,
      neutral: 0,
      get: (s) => pick(s).exposure,
      set: (s, v) => { pick(s).exposure = v; },
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`,
      hint: 'Multiplies light in linear space, like opening the aperture.',
    });
  }
  if (want.contrast) {
    controls.push({
      kind: 'slider',
      label: 'Contrast',
      min: -100,
      max: 100,
      step: 1,
      neutral: 0,
      get: (s) => pick(s).contrast,
      set: (s, v) => { pick(s).contrast = v; },
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    });
  }
  if (want.brightness) {
    controls.push({
      kind: 'slider',
      label: 'Brightness',
      min: -100,
      max: 100,
      step: 1,
      neutral: 0,
      get: (s) => pick(s).brightness,
      set: (s, v) => { pick(s).brightness = v; },
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    });
  }
  if (want.levels) {
    controls.push(
      {
        kind: 'slider',
        label: 'Black point',
        min: 0,
        max: 90,
        step: 0.5,
        neutral: 0,
        get: (s) => pick(s).blacks,
        set: (s, v) => { pick(s).blacks = v; },
        format: (v) => `${v.toFixed(1)}%`,
      },
      {
        kind: 'slider',
        label: 'White point',
        min: 10,
        max: 100,
        step: 0.5,
        neutral: 100,
        get: (s) => pick(s).whites,
        set: (s, v) => { pick(s).whites = v; },
        format: (v) => `${v.toFixed(1)}%`,
      },
    );
  }
  if (want.gamma) {
    controls.push({
      kind: 'slider',
      label: 'Midtones (gamma)',
      min: 0.2,
      max: 3,
      step: 0.01,
      neutral: 1,
      get: (s) => pick(s).gamma,
      set: (s, v) => { pick(s).gamma = v; },
      format: (v) => v.toFixed(2),
    });
  }
  if (want.saturation) {
    controls.push({
      kind: 'slider',
      label: 'Saturation',
      min: -100,
      max: 100,
      step: 1,
      neutral: 0,
      get: (s) => pick(s).saturation,
      set: (s, v) => { pick(s).saturation = v; },
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    });
  }
  if (want.invert) {
    controls.push({
      kind: 'toggle',
      label: 'Invert',
      hint: 'Flip the tone curve — a negative.',
      get: (s) => pick(s).invert,
      set: (s, v) => { pick(s).invert = v; },
    });
  }

  return controls;
}

/** Luma histogram of the current processed preview, drawn on a small canvas. */
export function histogramControl<S>(): Control<S> {
  return {
    kind: 'custom',
    render(host: HTMLElement, tool: ToolHost<S>) {
      const canvas = h('canvas', { class: 'histogram', width: 256, height: 72 }) as HTMLCanvasElement;
      host.append(h('div', { class: 'ctl-row' },
        h('div', { class: 'ctl-label' }, h('span', { text: 'Histogram' })),
        canvas,
        h('p', { class: 'ctl-hint', text: 'Luma distribution of the current preview.' }),
      ));
      drawHistogram(canvas, tool.processedPreview ?? tool.originalPreview);
    },
  };
}

function drawHistogram(canvas: HTMLCanvasElement, bitmap: Bitmap): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const hist = lumaHistogram(bitmap);
  let peak = 0;
  for (const v of hist) if (v > peak) peak = v;
  if (peak === 0) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const style = getComputedStyle(canvas);
  ctx.fillStyle = style.getPropertyValue('--hist-fill').trim() || '#7dd3fc';
  // Log scale keeps the shadows readable next to a spiky midtone peak.
  const norm = (v: number) => Math.log1p(v) / Math.log1p(peak);
  for (let i = 0; i < 256; i++) {
    const height = norm(hist[i]) * canvas.height;
    ctx.fillRect(i, canvas.height - height, 1, height);
  }
}

/**
 * Auto levels: clip the given fraction of pixels at each end of the histogram
 * and map what is left onto the full range.
 */
export function autoLevels(bitmap: Bitmap, params: AdjustParams, clipPercent = 0.2): void {
  const hist = lumaHistogram(bitmap);
  const total = bitmap.width * bitmap.height;
  const clip = (total * clipPercent) / 100;

  let low = 0;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= clip) { low = i; break; }
  }
  let high = 255;
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= clip) { high = i; break; }
  }
  if (high - low < 8) return;

  params.blacks = (low / 255) * 100;
  params.whites = (high / 255) * 100;
}
