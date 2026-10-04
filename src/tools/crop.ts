import { numberField } from '../app/controls';
import { h, ICONS } from '../app/dom';
import type { Control, ToolDefinition, ToolHost } from '../app/types';
import { FULL_RECT, type NormRect, type Op, type Rotation } from '../core/types';

interface CropState {
  /** Crop rectangle in the rotated/flipped frame — i.e. what the user sees. */
  crop: NormRect;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  aspect: string;
  grid: boolean;
}

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

/** Image dimensions as the user currently sees them, after rotation. */
function framedSize(state: CropState, image: { width: number; height: number }): { w: number; h: number } {
  return state.rotate === 90 || state.rotate === 270
    ? { w: image.height, h: image.width }
    : { w: image.width, h: image.height };
}

function activeRatio(state: CropState, image: { width: number; height: number }): number | null {
  if (state.aspect === 'free') return null;
  const frame = framedSize(state, image);
  if (state.aspect === 'original') return frame.w / frame.h;
  return ASPECTS.find((a) => a.id === state.aspect)?.ratio ?? null;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Largest rect with the given pixel aspect ratio, centred on the current one. */
function fitRatio(current: NormRect, ratio: number, frameW: number, frameH: number): NormRect {
  const w = Math.min(1, (ratio * frameH) / frameW);
  const h = Math.min(1, frameW / (ratio * frameH));
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** Carry the crop rect through a 90-degree frame rotation so it stays put. */
function rotateRect(rect: NormRect, direction: 1 | -1): NormRect {
  return direction === 1
    ? { x: 1 - (rect.y + rect.h), y: rect.x, w: rect.h, h: rect.w }
    : { x: rect.y, y: 1 - (rect.x + rect.w), w: rect.h, h: rect.w };
}

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: DragMode[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function buildOverlay(tool: ToolHost<CropState>): HTMLElement {
  const state = tool.state;
  const frame = framedSize(state, tool.image);
  const ratio = activeRatio(state, tool.image);
  const minW = Math.min(0.5, 8 / frame.w);
  const minH = Math.min(0.5, 8 / frame.h);

  const root = h('div', { class: 'crop-root' });
  // The darkened surround lives in its own clipped layer so the shadow stops at
  // the edge of the image instead of flooding the whole stage.
  const shadeClip = h('div', { class: 'crop-shade-clip' });
  const shade = h('div', { class: 'crop-shade' });
  shadeClip.append(shade);
  const rect = h('div', { class: 'crop-rect' });
  const label = h('div', { class: 'crop-readout' });
  rect.append(label);
  if (state.grid) {
    rect.append(h('div', { class: 'crop-grid' }));
  }
  for (const handle of HANDLES) {
    rect.append(h('div', { class: `crop-handle crop-${handle}`, 'data-handle': handle }));
  }
  root.append(shadeClip, rect);

  const paint = () => {
    const c = state.crop;
    for (const node of [rect, shade]) {
      node.style.left = `${c.x * 100}%`;
      node.style.top = `${c.y * 100}%`;
      node.style.width = `${c.w * 100}%`;
      node.style.height = `${c.h * 100}%`;
    }
    label.textContent = `${Math.round(c.w * frame.w)} x ${Math.round(c.h * frame.h)}`;
  };
  paint();

  let mode: DragMode | null = null;
  let start: NormRect = { ...state.crop };
  let originX = 0;
  let originY = 0;

  root.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    const handle = target.dataset.handle as DragMode | undefined;
    if (!handle && target !== rect && !rect.contains(target)) return;
    mode = handle ?? 'move';
    start = { ...state.crop };
    originX = event.clientX;
    originY = event.clientY;
    root.setPointerCapture(event.pointerId);
    root.classList.add('is-dragging');
    event.preventDefault();
  });

  root.addEventListener('pointermove', (event) => {
    if (!mode) return;
    const bounds = root.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dx = (event.clientX - originX) / bounds.width;
    const dy = (event.clientY - originY) / bounds.height;

    state.crop = mode === 'move'
      ? {
          x: clamp(start.x + dx, 0, 1 - start.w),
          y: clamp(start.y + dy, 0, 1 - start.h),
          w: start.w,
          h: start.h,
        }
      : resize(mode, start, dx, dy);
    paint();
  });

  const finish = (event: PointerEvent) => {
    if (!mode) return;
    mode = null;
    root.classList.remove('is-dragging');
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    tool.update();
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);

  function resize(handle: DragMode, from: NormRect, dx: number, dy: number): NormRect {
    let left = from.x;
    let right = from.x + from.w;
    let top = from.y;
    let bottom = from.y + from.h;

    if (handle.includes('w')) left = clamp(from.x + dx, 0, right - minW);
    if (handle.includes('e')) right = clamp(from.x + from.w + dx, left + minW, 1);
    if (handle.includes('n')) top = clamp(from.y + dy, 0, bottom - minH);
    if (handle.includes('s')) bottom = clamp(from.y + from.h + dy, top + minH, 1);

    let w = right - left;
    let h = bottom - top;

    if (ratio !== null) {
      // Re-derive the dependent side, driven by whichever axis the handle owns.
      const maxW = Math.min(1, (ratio * frame.h) / frame.w);
      const vertical = handle === 'n' || handle === 's';
      if (vertical) {
        w = Math.min(maxW, (h * frame.h * ratio) / frame.w);
      }
      w = clamp(w, minW, maxW);
      h = Math.min(1, (w * frame.w) / (ratio * frame.h));

      // Keep the edge the user is not dragging pinned in place.
      if (handle.includes('w')) left = right - w;
      else if (handle.includes('e')) right = left + w;
      else {
        const cx = (left + right) / 2;
        left = cx - w / 2;
        right = cx + w / 2;
      }
      if (handle.includes('n')) top = bottom - h;
      else if (handle.includes('s')) bottom = top + h;
      else {
        const cy = (top + bottom) / 2;
        top = cy - h / 2;
        bottom = cy + h / 2;
      }
    }

    return {
      x: clamp(left, 0, 1 - w),
      y: clamp(top, 0, 1 - h),
      w,
      h,
    };
  }

  return root;
}

export const cropTool: ToolDefinition<CropState> = {
  id: 'crop',
  title: 'Crop',
  tagline: 'Drag a frame, lock a ratio, rotate in quarter turns',
  about: 'Drag the frame on the preview. Rotation and mirroring apply before the crop.',
  iconPath: ICONS.crop,
  exportSuffix: 'crop',

  createState: () => ({
    crop: { ...FULL_RECT },
    rotate: 0,
    flipH: false,
    flipV: false,
    aspect: 'free',
    grid: true,
  }),

  // The preview shows the rotated image uncropped, with the frame drawn on top.
  previewOps: (state): Op[] => [
    { type: 'geometry', params: { crop: { ...FULL_RECT }, rotate: state.rotate, flipH: state.flipH, flipV: state.flipV } },
  ],

  buildOps: (state): Op[] => [
    { type: 'geometry', params: { crop: { ...FULL_RECT }, rotate: state.rotate, flipH: state.flipH, flipV: state.flipV } },
    { type: 'geometry', params: { crop: state.crop, rotate: 0, flipH: false, flipV: false } },
  ],

  overlay: (tool) => buildOverlay(tool),

  controls(tool): Control<CropState>[] {
    const frame = framedSize(tool.state, tool.image);
    const c = tool.state.crop;
    const px = {
      x: Math.round(c.x * frame.w),
      y: Math.round(c.y * frame.h),
      w: Math.round(c.w * frame.w),
      h: Math.round(c.h * frame.h),
    };

    return [
      {
        kind: 'presets',
        label: 'Aspect ratio',
        items: ASPECTS.map(({ id, label }) => ({ id, label })),
        isActive: (s, id) => s.aspect === id,
        apply: (s, id) => {
          s.aspect = id;
          const ratio = activeRatio({ ...s, aspect: id }, tool.image);
          if (ratio !== null) {
            const f = framedSize(s, tool.image);
            s.crop = fitRatio(s.crop, ratio, f.w, f.h);
          }
        },
      },
      { kind: 'section', label: 'Orientation' },
      {
        kind: 'actions',
        items: [
          {
            label: 'Rotate left',
            run: (s) => {
              s.rotate = (((s.rotate + 270) % 360) as Rotation);
              s.crop = rotateRect(s.crop, -1);
            },
          },
          {
            label: 'Rotate right',
            run: (s) => {
              s.rotate = (((s.rotate + 90) % 360) as Rotation);
              s.crop = rotateRect(s.crop, 1);
            },
          },
          { label: 'Flip horizontal', run: (s) => { s.flipH = !s.flipH; } },
          { label: 'Flip vertical', run: (s) => { s.flipV = !s.flipV; } },
        ],
      },
      { kind: 'section', label: 'Frame', hint: `Pixel coordinates inside the ${frame.w} x ${frame.h} frame.` },
      {
        kind: 'custom',
        render(host) {
          const commit = (patch: Partial<Record<'x' | 'y' | 'w' | 'h', number>>) => {
            const next = { ...px, ...patch };
            const w = clamp(next.w, 1, frame.w);
            const h = clamp(next.h, 1, frame.h);
            tool.state.crop = {
              x: clamp(next.x, 0, frame.w - w) / frame.w,
              y: clamp(next.y, 0, frame.h - h) / frame.h,
              w: w / frame.w,
              h: h / frame.h,
            };
            tool.update();
          };
          host.append(h('div', { class: 'field-grid' },
            numberField('X', px.x, (v) => commit({ x: v }), { min: 0, max: frame.w - 1, suffix: 'px' }),
            numberField('Y', px.y, (v) => commit({ y: v }), { min: 0, max: frame.h - 1, suffix: 'px' }),
            numberField('Width', px.w, (v) => commit({ w: v }), { min: 1, max: frame.w, suffix: 'px' }),
            numberField('Height', px.h, (v) => commit({ h: v }), { min: 1, max: frame.h, suffix: 'px' }),
          ));
        },
      },
      {
        kind: 'toggle',
        label: 'Thirds grid',
        get: (s) => s.grid,
        set: (s, v) => { s.grid = v; },
      },
      {
        kind: 'actions',
        items: [
          { label: 'Reset frame', run: (s) => { s.crop = { ...FULL_RECT }; s.aspect = 'free'; } },
          {
            label: 'Centre frame',
            run: (s) => {
              s.crop = { ...s.crop, x: (1 - s.crop.w) / 2, y: (1 - s.crop.h) / 2 };
            },
          },
        ],
      },
      {
        kind: 'note',
        text: 'Cropping is a pure pixel copy — nothing is resampled, so quality is untouched.',
      },
    ];
  },

  preferredFormat: (image) => (image.sourceType === 'image/png' ? 'image/png' : 'image/jpeg'),
};
