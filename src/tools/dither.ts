import { h, ICONS } from '../app/dom';
import type { Control, ToolDefinition, ToolHost } from '../app/types';
import { DITHER_METHODS } from '../core/dither';
import { PALETTE_OPTIONS, resolvePalette } from '../core/palettes';
import { defaultAdjust, defaultDither, type AdjustParams, type DitherParams, type Op } from '../core/types';
import { toneControls } from './shared';

interface DitherState {
  pre: AdjustParams;
  dither: DitherParams;
}

const PRESETS: { id: string; label: string; hint: string; apply(s: DitherState): void }[] = [
  {
    id: 'classic',
    label: '1-bit classic',
    hint: 'Floyd–Steinberg, pure black & white',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'floyd-steinberg', palette: 'mono' });
      Object.assign(s.pre, defaultAdjust(), { contrast: 10 });
    },
  },
  {
    id: 'mac',
    label: 'Atkinson',
    hint: 'The original Macintosh look — airy, high contrast',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'atkinson', palette: 'mono' });
      Object.assign(s.pre, defaultAdjust(), { contrast: 18, brightness: 4 });
    },
  },
  {
    id: 'newsprint',
    label: 'Newsprint',
    hint: 'Clustered halftone dots, coarse grid',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'cluster8', palette: 'mono', pixelSize: 2 });
      Object.assign(s.pre, defaultAdjust(), { contrast: 22, whites: 96 });
    },
  },
  {
    id: 'zine',
    label: 'Photocopy zine',
    hint: 'Chunky pixels, blown-out contrast',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'cluster4', palette: 'mono', pixelSize: 4 });
      Object.assign(s.pre, defaultAdjust(), { contrast: 48, blacks: 10, whites: 92 });
    },
  },
  {
    id: 'bluenoise',
    label: 'Blue noise',
    hint: 'Even, grainless texture over 4 grey levels',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'bluenoise', palette: 'gray', levels: 4 });
      Object.assign(s.pre, defaultAdjust());
    },
  },
  {
    id: 'gameboy',
    label: 'Game Boy',
    hint: 'Four greens, Bayer 4x4, 3x pixels',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'bayer4', palette: 'gameboy', pixelSize: 3 });
      Object.assign(s.pre, defaultAdjust(), { contrast: 14 });
    },
  },
  {
    id: 'c64',
    label: 'Commodore 64',
    hint: '16 colours, error diffusion, 2x pixels',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'floyd-steinberg', palette: 'c64', pixelSize: 2 });
      Object.assign(s.pre, defaultAdjust(), { saturation: 18 });
    },
  },
  {
    id: 'riso',
    label: 'Risograph',
    hint: 'Five ink colours on a Bayer screen',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'bayer8', palette: 'risograph', pixelSize: 2 });
      Object.assign(s.pre, defaultAdjust(), { contrast: 16, saturation: 26 });
    },
  },
  {
    id: 'crt',
    label: 'Amber terminal',
    hint: 'Four amber steps, fine ordered grid',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'bayer2', palette: 'amber', pixelSize: 2 });
      Object.assign(s.pre, defaultAdjust(), { contrast: 24, gamma: 0.9 });
    },
  },
  {
    id: 'cyano',
    label: 'Cyanotype',
    hint: 'Five blue tones, Stucki diffusion',
    apply: (s) => {
      Object.assign(s.dither, defaultDither(), { method: 'stucki', palette: 'cyanotype' });
      Object.assign(s.pre, defaultAdjust(), { contrast: 12 });
    },
  },
];

function usesLevels(palette: string): boolean {
  return palette === 'gray' || palette === 'rgb';
}

const ORDERED_METHODS = new Set(['bayer2', 'bayer4', 'bayer8', 'cluster4', 'cluster8', 'bluenoise']);

function isOrdered(method: string): boolean {
  return ORDERED_METHODS.has(method);
}

function paletteSwatches<S extends DitherState>(): Control<S> {
  return {
    kind: 'custom',
    render(host: HTMLElement, tool: ToolHost<S>) {
      const colors = resolvePalette(tool.state.dither.palette, tool.state.dither.levels);
      const count = colors.length / 3;
      const strip = h('div', { class: 'swatches' });
      for (let i = 0; i < count; i++) {
        strip.append(h('span', {
          class: 'swatch',
          style: `background: rgb(${colors[i * 3]},${colors[i * 3 + 1]},${colors[i * 3 + 2]})`,
          title: `#${[0, 1, 2].map((k) => colors[i * 3 + k].toString(16).padStart(2, '0')).join('')}`,
        }));
      }
      host.append(h('div', { class: 'ctl-row' },
        h('div', { class: 'ctl-label' },
          h('span', { text: 'Palette' }),
          h('output', { class: 'ctl-value', text: `${count} colours` }),
        ),
        strip,
      ));
    },
  };
}

export const ditherTool: ToolDefinition<DitherState> = {
  id: 'dither',
  title: 'Dither',
  tagline: 'Error diffusion, ordered screens and retro palettes',
  about: 'Reduce the image to a small palette and shape the quantization error into texture.',
  iconPath: ICONS.grid,
  exportSuffix: 'dither',

  createState: () => ({
    pre: defaultAdjust(),
    dither: defaultDither(),
  }),

  buildOps: (state): Op[] => [
    { type: 'adjust', params: state.pre },
    { type: 'dither', params: state.dither },
  ],

  controls(tool): Control<DitherState>[] {
    const d = tool.state.dither;
    const ordered = isOrdered(d.method);
    const diffusion = !ordered && d.method !== 'none' && d.method !== 'random';

    return [
      {
        kind: 'presets',
        label: 'Presets',
        items: PRESETS.map(({ id, label, hint }) => ({ id, label, hint })),
        isActive: () => false,
        apply: (s, id) => PRESETS.find((p) => p.id === id)?.apply(s),
      },
      { kind: 'section', label: 'Algorithm' },
      {
        kind: 'select',
        label: 'Method',
        options: DITHER_METHODS,
        get: (s) => s.dither.method,
        set: (s, v) => { s.dither.method = v as DitherParams['method']; },
        hint: diffusion
          ? 'Error diffusion pushes the rounding error onto neighbouring pixels.'
          : ordered
            ? 'An ordered screen compares each pixel against a fixed threshold tile.'
            : 'No error is carried — each pixel is decided on its own.',
      },
      {
        kind: 'slider',
        label: diffusion ? 'Diffusion strength' : 'Noise amplitude',
        min: 0,
        max: 100,
        step: 1,
        neutral: 100,
        get: (s) => s.dither.strength,
        set: (s, v) => { s.dither.strength = v; },
        format: (v) => `${Math.round(v)}%`,
        hint: diffusion ? 'Below 100% the texture gets flatter and more posterized.' : undefined,
      },
      ...(diffusion
        ? [{
            kind: 'toggle' as const,
            label: 'Serpentine scan',
            hint: 'Alternate direction each row to break up diagonal worming.',
            get: (s: DitherState) => s.dither.serpentine,
            set: (s: DitherState, v: boolean) => { s.dither.serpentine = v; },
          }]
        : []),
      {
        kind: 'slider',
        label: 'Threshold bias',
        min: -50,
        max: 50,
        step: 1,
        neutral: 0,
        get: (s) => s.dither.threshold,
        set: (s, v) => { s.dither.threshold = v; },
        format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}%`,
        hint: 'Shifts the whole image toward light or dark before quantizing.',
      },
      { kind: 'section', label: 'Palette' },
      {
        kind: 'select',
        label: 'Colours',
        options: PALETTE_OPTIONS,
        get: (s) => s.dither.palette,
        set: (s, v) => { s.dither.palette = v; },
      },
      ...(usesLevels(d.palette)
        ? [{
            kind: 'slider' as const,
            label: d.palette === 'rgb' ? 'Levels per channel' : 'Grey levels',
            min: 2,
            max: d.palette === 'rgb' ? 8 : 16,
            step: 1,
            neutral: 2,
            get: (s: DitherState) => s.dither.levels,
            set: (s: DitherState, v: number) => { s.dither.levels = v; },
            format: (v: number) => String(Math.round(v)),
          }]
        : []),
      paletteSwatches<DitherState>(),
      {
        kind: 'toggle',
        label: 'Invert',
        get: (s) => s.dither.invert,
        set: (s, v) => { s.dither.invert = v; },
      },
      { kind: 'section', label: 'Pixel grid' },
      {
        kind: 'slider',
        label: 'Pixel size',
        min: 1,
        max: 16,
        step: 1,
        neutral: 1,
        get: (s) => s.dither.pixelSize,
        set: (s, v) => { s.dither.pixelSize = v; },
        format: (v) => (v === 1 ? 'native' : `${Math.round(v)}x blocks`),
        hint: 'Dither at a lower resolution, then blow the pixels back up.',
      },
      {
        kind: 'note',
        text: 'Dither last, at the size you will actually display. Any viewer that shrinks the picture to fit its window blends the dots back into flat grey — the exported file is still 1-bit, the scaling is not. Judge it at 100% zoom, and use the Resize tool first if the final image should be smaller.',
      },
      { kind: 'section', label: 'Pre-adjustment', hint: 'Dithering is unforgiving — tone it first.' },
      ...toneControls<DitherState>((s) => s.pre, { gamma: true, saturation: true, levels: true }),
      {
        kind: 'actions',
        items: [{ label: 'Reset pre-adjustment', run: (s) => Object.assign(s.pre, defaultAdjust()) }],
      },
    ];
  },

  // Dithered output is flat colour on a hard grid: PNG keeps it exact, and a
  // lossy codec would smear the very texture the tool just created.
  preferredFormat: () => 'image/png',

  exportNote(tool) {
    const colors = resolvePalette(tool.state.dither.palette, tool.state.dither.levels).length / 3;
    return `${colors} colours. PNG is strongly recommended — JPEG would blur the pattern into mush. Open the saved file at 100%: a viewer that scales it down will appear to lose the dither.`;
  },
};
