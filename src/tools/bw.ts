import { ICONS } from '../app/dom';
import type { Control, ToolDefinition } from '../app/types';
import { BW_FILTERS } from '../core/adjust';
import { defaultAdjust, type AdjustParams, type Op } from '../core/types';
import { autoLevels, histogramControl, toneControls } from './shared';

interface BwState {
  adjust: AdjustParams;
  filter: string;
}

/** Darkroom-style looks: a filter choice plus a tone curve. */
const LOOKS: { id: string; label: string; hint: string; apply(s: BwState): void }[] = [
  {
    id: 'natural',
    label: 'Natural',
    hint: 'Straight conversion, nothing pushed',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true });
      s.filter = 'neutral';
    },
  },
  {
    id: 'punch',
    label: 'Punchy',
    hint: 'Deeper blacks, brighter highlights',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true, contrast: 32, blacks: 4, whites: 97 });
      s.filter = 'neutral';
    },
  },
  {
    id: 'noir',
    label: 'Film noir',
    hint: 'Hard contrast with crushed shadows',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true, contrast: 62, blacks: 12, whites: 100, gamma: 0.9 });
      s.filter = 'red';
    },
  },
  {
    id: 'matte',
    label: 'Faded matte',
    hint: 'Lifted blacks, soft highlights',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true, contrast: -14, brightness: 6, blacks: 0, whites: 92, gamma: 1.12 });
      s.filter = 'flat';
    },
  },
  {
    id: 'highkey',
    label: 'High key',
    hint: 'Bright, airy, almost no deep tone',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true, exposure: 0.55, contrast: -8, blacks: 0, whites: 88, gamma: 1.25 });
      s.filter = 'yellow';
    },
  },
  {
    id: 'lowkey',
    label: 'Low key',
    hint: 'Dark and moody, highlights held back',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true, exposure: -0.6, contrast: 28, blacks: 6, whites: 100, gamma: 0.85 });
      s.filter = 'orange';
    },
  },
  {
    id: 'landscape',
    label: 'Landscape',
    hint: 'Green filter, strong sky separation',
    apply: (s) => {
      Object.assign(s.adjust, defaultAdjust(), { grayscale: true, contrast: 24, blacks: 3, whites: 98 });
      s.filter = 'green';
    },
  },
];

function filterMix(id: string): [number, number, number] {
  return (BW_FILTERS.find((f) => f.id === id) ?? BW_FILTERS[0]).mix;
}

export const bwTool: ToolDefinition<BwState> = {
  id: 'bw',
  title: 'Black & white',
  tagline: 'Monochrome conversion with exposure and contrast',
  about: 'Convert to monochrome with a channel filter, then shape exposure and contrast.',
  iconPath: ICONS.contrast,
  exportSuffix: 'bw',

  createState: () => ({
    adjust: { ...defaultAdjust(), grayscale: true },
    filter: 'neutral',
  }),

  buildOps: (state): Op[] => [
    { type: 'adjust', params: { ...state.adjust, grayscale: true, mix: filterMix(state.filter) } },
  ],

  controls(tool): Control<BwState>[] {
    const activeFilter = BW_FILTERS.find((f) => f.id === tool.state.filter);
    return [
      {
        kind: 'presets',
        label: 'Look',
        items: LOOKS.map(({ id, label, hint }) => ({ id, label, hint })),
        isActive: () => false,
        apply: (s, id) => LOOKS.find((l) => l.id === id)?.apply(s),
      },
      { kind: 'section', label: 'Conversion', hint: 'Channel weights decide how colours become grey.' },
      {
        kind: 'presets',
        label: 'Colour filter',
        hint: activeFilter?.hint,
        items: BW_FILTERS.map(({ id, label, hint }) => ({ id, label, hint })),
        isActive: (s, id) => s.filter === id,
        apply: (s, id) => { s.filter = id; },
      },
      { kind: 'section', label: 'Tone' },
      ...toneControls<BwState>((s) => s.adjust, { saturation: false, invert: true }),
      {
        kind: 'actions',
        items: [
          {
            label: 'Auto levels',
            run: (s) => autoLevels(tool.originalPreview, s.adjust),
          },
          {
            label: 'Reset tone',
            run: (s) => {
              const filter = s.filter;
              Object.assign(s.adjust, defaultAdjust(), { grayscale: true });
              s.filter = filter;
            },
          },
        ],
      },
      histogramControl<BwState>(),
    ];
  },

  preferredFormat: (image) => (image.sourceType === 'image/png' ? 'image/png' : 'image/jpeg'),
};
