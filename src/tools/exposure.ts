import { ICONS } from '../app/dom';
import type { Control, ToolDefinition } from '../app/types';
import { defaultAdjust, type AdjustParams, type Op } from '../core/types';
import { autoLevels, histogramControl, toneControls } from './shared';

interface ExposureState {
  adjust: AdjustParams;
}

const PRESETS: { id: string; label: string; hint: string; patch: Partial<AdjustParams> }[] = [
  { id: 'reset', label: 'Neutral', hint: 'No adjustment', patch: {} },
  { id: 'lift', label: 'Brighten', hint: '+0.5 EV, gentle lift', patch: { exposure: 0.5, blacks: 1 } },
  { id: 'recover', label: 'Recover highlights', hint: '-0.6 EV, midtones held up', patch: { exposure: -0.6, gamma: 1.2 } },
  { id: 'pop', label: 'Pop', hint: 'More contrast and colour', patch: { contrast: 26, saturation: 14, blacks: 3, whites: 98 } },
  { id: 'flat', label: 'Flat / log', hint: 'Low contrast for further editing', patch: { contrast: -26, gamma: 1.2, blacks: 0, whites: 94 } },
  { id: 'shadows', label: 'Open shadows', hint: 'Midtones up, blacks untouched', patch: { gamma: 1.45, contrast: 8 } },
  { id: 'mono-tone', label: 'Desaturate', hint: 'Colour pulled back halfway', patch: { saturation: -55 } },
];

export const exposureTool: ToolDefinition<ExposureState> = {
  id: 'exposure',
  title: 'Exposure & contrast',
  tagline: 'Tone adjustment with colour kept intact',
  about: 'Exposure, contrast, levels and saturation. Colour is preserved — no conversion.',
  iconPath: ICONS.sun,
  exportSuffix: 'adjusted',

  createState: () => ({ adjust: defaultAdjust() }),

  buildOps: (state): Op[] => [{ type: 'adjust', params: state.adjust }],

  controls(tool): Control<ExposureState>[] {
    return [
      {
        kind: 'presets',
        label: 'Starting point',
        items: PRESETS.map(({ id, label, hint }) => ({ id, label, hint })),
        isActive: () => false,
        apply: (s, id) => {
          const preset = PRESETS.find((p) => p.id === id);
          if (!preset) return;
          Object.assign(s.adjust, defaultAdjust(), preset.patch);
        },
      },
      { kind: 'section', label: 'Tone' },
      ...toneControls<ExposureState>((s) => s.adjust, { saturation: true, invert: true }),
      {
        kind: 'actions',
        items: [
          { label: 'Auto levels', run: (s) => autoLevels(tool.originalPreview, s.adjust) },
          { label: 'Reset all', run: (s) => Object.assign(s.adjust, defaultAdjust()) },
        ],
      },
      histogramControl<ExposureState>(),
      {
        kind: 'note',
        text: 'Adjustments are computed in 8-bit sRGB, the only colour space a browser canvas exposes. Exposure itself is applied in linear light.',
      },
    ];
  },

  preferredFormat: (image) => (image.sourceType === 'image/png' ? 'image/png' : 'image/jpeg'),
};
