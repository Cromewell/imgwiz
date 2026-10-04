import { numberField } from '../app/controls';
import { h, ICONS } from '../app/dom';
import type { Control, ToolDefinition, ToolHost } from '../app/types';
import { KERNEL_OPTIONS } from '../core/resample';
import type { Op, ResampleKernel } from '../core/types';

interface ResizeState {
  width: number;
  height: number;
  kernel: ResampleKernel;
  lock: boolean;
}

const LONG_EDGES = [4096, 2048, 1600, 1200, 800, 512, 256];
const SCALES = [200, 150, 100, 75, 50, 33, 25, 10];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function setLongEdge(state: ResizeState, image: { width: number; height: number }, edge: number): void {
  const scale = edge / Math.max(image.width, image.height);
  state.width = Math.max(1, Math.round(image.width * scale));
  state.height = Math.max(1, Math.round(image.height * scale));
}

function setScale(state: ResizeState, image: { width: number; height: number }, percent: number): void {
  state.width = Math.max(1, Math.round((image.width * percent) / 100));
  state.height = Math.max(1, Math.round((image.height * percent) / 100));
}

function dimensionBlock(tool: ToolHost<ResizeState>): Control<ResizeState> {
  return {
    kind: 'custom',
    render(host: HTMLElement) {
      const { state, image } = tool;
      const ratio = image.width / image.height;

      const commitWidth = (value: number) => {
        state.width = clamp(Math.round(value), 1, 16384);
        if (state.lock) state.height = clamp(Math.round(state.width / ratio), 1, 16384);
        tool.update();
      };
      const commitHeight = (value: number) => {
        state.height = clamp(Math.round(value), 1, 16384);
        if (state.lock) state.width = clamp(Math.round(state.height * ratio), 1, 16384);
        tool.update();
      };

      const lockButton = h('button', {
        type: 'button',
        class: `btn btn-ghost lock-toggle ${state.lock ? 'is-active' : ''}`,
        title: state.lock ? 'Aspect ratio locked' : 'Aspect ratio free',
        onclick: () => {
          state.lock = !state.lock;
          if (state.lock) state.height = clamp(Math.round(state.width / ratio), 1, 16384);
          tool.update();
        },
      }, state.lock ? 'Locked' : 'Free');

      host.append(h('div', { class: 'field-grid' },
        numberField('Width', state.width, commitWidth, { min: 1, max: 16384, suffix: 'px' }),
        numberField('Height', state.height, commitHeight, { min: 1, max: 16384, suffix: 'px' }),
      ));
      host.append(h('div', { class: 'ctl-row' },
        h('div', { class: 'ctl-label' }, h('span', { text: 'Aspect ratio' })),
        lockButton,
      ));
    },
  };
}

export const resizeTool: ToolDefinition<ResizeState> = {
  id: 'resize',
  title: 'Resize',
  tagline: 'Resample to exact dimensions',
  about: 'Scale to a target size with a choice of resampling filters.',
  iconPath: ICONS.resize,
  exportSuffix: 'resized',

  createState: (image) => ({
    width: image.width,
    height: image.height,
    kernel: 'lanczos3',
    lock: true,
  }),

  buildOps: (state): Op[] => [
    { type: 'resize', params: { width: state.width, height: state.height, kernel: state.kernel } },
  ],

  controls(tool): Control<ResizeState>[] {
    const { state, image } = tool;
    const percent = (state.width / image.width) * 100;
    const megapixels = (state.width * state.height) / 1e6;
    const upscaling = state.width > image.width || state.height > image.height;
    const distorted = Math.abs(state.width / state.height - image.width / image.height) > 0.01;

    return [
      { kind: 'section', label: 'Target size' },
      dimensionBlock(tool),
      {
        kind: 'slider',
        label: 'Scale',
        min: 1,
        max: 400,
        step: 1,
        neutral: 100,
        get: () => Math.round(percent),
        set: (s, v) => setScale(s, image, v),
        format: (v) => `${Math.round(v)}%`,
      },
      {
        kind: 'presets',
        label: 'Longest edge',
        items: LONG_EDGES.map((edge) => ({ id: String(edge), label: `${edge}px` })),
        isActive: (s, id) => Math.max(s.width, s.height) === Number(id),
        apply: (s, id) => setLongEdge(s, image, Number(id)),
      },
      {
        kind: 'presets',
        label: 'Percentage',
        items: SCALES.map((value) => ({ id: String(value), label: `${value}%` })),
        isActive: (s, id) => Math.round((s.width / image.width) * 100) === Number(id),
        apply: (s, id) => setScale(s, image, Number(id)),
      },
      { kind: 'section', label: 'Resampling' },
      {
        kind: 'select',
        label: 'Filter',
        options: KERNEL_OPTIONS.map((k) => ({ value: k.value, label: `${k.label} — ${k.hint}` })),
        get: (s) => s.kernel,
        set: (s, v) => { s.kernel = v as ResampleKernel; },
        hint: 'Alpha is premultiplied during resampling, so transparent edges stay clean.',
      },
      {
        kind: 'actions',
        items: [
          {
            label: 'Reset to original',
            run: (s) => {
              s.width = image.width;
              s.height = image.height;
            },
          },
        ],
      },
      {
        kind: 'note',
        text: `Output: ${state.width} x ${state.height} px · ${megapixels.toFixed(2)} MP`,
      },
      ...(upscaling
        ? [{
            kind: 'note' as const,
            tone: 'warn' as const,
            text: 'Upscaling cannot add detail — it only interpolates what is already there.',
          }]
        : []),
      ...(distorted
        ? [{
            kind: 'note' as const,
            tone: 'warn' as const,
            text: 'Aspect ratio differs from the source; the image will be stretched.',
          }]
        : []),
      {
        kind: 'note',
        text: 'The preview is resampled at preview scale, so judge fine detail from the exported file.',
      },
    ];
  },

  preferredFormat: (image) => (image.sourceType === 'image/png' ? 'image/png' : 'image/jpeg'),

  exportNote: (tool) => `Exports at ${tool.state.width} x ${tool.state.height} px.`,
};
