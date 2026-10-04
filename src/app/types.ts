import type { Bitmap, ExportFormat, Op } from '../core/types';

export interface ImageMeta {
  name: string;
  sourceType: string;
  sourceBytes: number;
  width: number;
  height: number;
}

/** What a tool can see and ask for while it is mounted. */
export interface ToolHost<S> {
  readonly state: S;
  readonly image: ImageMeta;
  /** Preview-resolution copy of the untouched source. */
  readonly originalPreview: Bitmap;
  /** Latest processed preview, or null while the first one is in flight. */
  readonly processedPreview: Bitmap | null;
  /** Preview size relative to full resolution (0..1). */
  readonly previewScale: number;
  /** Re-render the control panel and recompute the preview. */
  update(): void;
  /** Recompute the preview without rebuilding controls. */
  refresh(): void;
  /** Run the current ops at full resolution — for size estimates and the like. */
  renderFull(): Promise<Bitmap>;
}

export type Control<S> =
  | { kind: 'section'; label: string; hint?: string }
  | {
      kind: 'slider';
      label: string;
      min: number;
      max: number;
      step: number;
      neutral?: number;
      unit?: string;
      hint?: string;
      get(s: S): number;
      set(s: S, value: number): void;
      format?(value: number): string;
    }
  | { kind: 'toggle'; label: string; hint?: string; get(s: S): boolean; set(s: S, value: boolean): void }
  | {
      kind: 'select';
      label: string;
      hint?: string;
      options: { value: string; label: string; group?: string }[];
      get(s: S): string;
      set(s: S, value: string): void;
    }
  | {
      kind: 'segmented';
      label: string;
      options: { value: string; label: string }[];
      get(s: S): string;
      set(s: S, value: string): void;
    }
  | {
      kind: 'presets';
      label: string;
      hint?: string;
      items: { id: string; label: string; hint?: string }[];
      isActive(s: S, id: string): boolean;
      apply(s: S, id: string): void;
    }
  | { kind: 'actions'; items: { label: string; run(s: S): void }[] }
  | { kind: 'note'; text: string; tone?: 'info' | 'warn' }
  | { kind: 'custom'; render(host: HTMLElement, tool: ToolHost<S>): void };

export interface ToolDefinition<S> {
  id: string;
  title: string;
  tagline: string;
  iconPath: string;
  /** Short line shown under the tool title in the panel. */
  about: string;
  createState(image: ImageMeta): S;
  /** Pipeline ops in full-resolution terms; the runtime scales them for previews. */
  buildOps(state: S, image: ImageMeta): Op[];
  /**
   * Ops to use for the on-screen preview when they differ from the export —
   * the crop tool shows the uncropped image with a rectangle on top.
   */
  previewOps?(state: S, image: ImageMeta): Op[];
  controls(tool: ToolHost<S>): Control<S>[];
  /** Optional interactive layer drawn over the preview (used by crop). */
  overlay?(tool: ToolHost<S>): HTMLElement | null;
  exportSuffix: string;
  /** Format the export panel should start on for this tool. */
  preferredFormat?(image: ImageMeta): ExportFormat;
  /** Extra line in the export panel, e.g. a palette or dimension note. */
  exportNote?(tool: ToolHost<S>): string | null;
}

/** Erase the generic so tools of different state types can live in one list. */
export type AnyTool = ToolDefinition<any>;

export type { Op };
