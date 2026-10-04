import { encodeBitmap, FORMAT_INFO, formatBytes, suggestFilename, supportedFormats } from '../core/encode';
import { pipelineSize } from '../core/pipeline';
import { defaultExport, type Bitmap, type ExportFormat, type ExportParams, type Op } from '../core/types';
import { ImageProcessor } from '../worker/client';
import { renderControls } from './controls';
import { append, clear, h, ICONS, icon } from './dom';
import type { AnyTool, ImageMeta, ToolHost } from './types';

/** Longest preview edge. Large enough to judge detail, small enough to stay live. */
const PREVIEW_BUDGET = 1600;

export interface WorkspaceNodes {
  stage: HTMLElement;
  panel: HTMLElement;
}

interface ToolSlot {
  state: unknown;
  exportParams: ExportParams;
}

export class Workspace {
  private slots = new Map<string, ToolSlot>();
  private tool!: AnyTool;
  private previewRunning = false;
  private previewPending = false;
  private processedPreview: Bitmap | null = null;
  private formats: ExportFormat[] = ['image/png'];

  private canvas = h('canvas', { class: 'preview-canvas' }) as HTMLCanvasElement;
  private frame = h('div', { class: 'preview-frame' });
  private overlayHost = h('div', { class: 'preview-overlay' });
  private statusNode = h('div', { class: 'stage-status' });
  private sizeNode = h('span', { class: 'stage-meta' });
  private exportHost = h('div', { class: 'export-panel' });
  private controlHost = h('div', { class: 'control-list' });
  private titleHost = h('div', { class: 'panel-head' });
  private compareHeld = false;

  private constructor(
    public readonly image: ImageMeta,
    public readonly originalPreview: Bitmap,
    public readonly previewScale: number,
    private nodes: WorkspaceNodes,
    private processor: ImageProcessor,
  ) {
    this.buildStage();
    void supportedFormats().then((list) => {
      this.formats = list.length ? list : ['image/png'];
      this.renderExport();
    });
  }

  /** Hand the decoded pixels to the worker and build the workspace. */
  static async create(
    decoded: Bitmap & { name: string; sourceType: string; sourceBytes: number },
    nodes: WorkspaceNodes,
  ): Promise<Workspace> {
    const meta: ImageMeta = {
      name: decoded.name,
      sourceType: decoded.sourceType,
      sourceBytes: decoded.sourceBytes,
      width: decoded.width,
      height: decoded.height,
    };
    const processor = new ImageProcessor();
    try {
      const { preview, previewScale } = await processor.load(
        { width: decoded.width, height: decoded.height, data: decoded.data },
        PREVIEW_BUDGET,
      );
      return new Workspace(meta, preview, previewScale, nodes, processor);
    } catch (error) {
      processor.terminate();
      throw error;
    }
  }

  dispose(): void {
    this.processor.terminate();
  }

  private buildStage(): void {
    const compare = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      title: 'Hold to see the original',
    }, 'Compare');
    const startCompare = () => {
      this.compareHeld = true;
      this.draw(this.originalPreview);
    };
    const endCompare = () => {
      if (!this.compareHeld) return;
      this.compareHeld = false;
      this.draw(this.processedPreview ?? this.originalPreview);
    };
    compare.addEventListener('pointerdown', startCompare);
    compare.addEventListener('pointerup', endCompare);
    compare.addEventListener('pointerleave', endCompare);
    compare.addEventListener('pointercancel', endCompare);

    const zoom = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Actual size');
    zoom.addEventListener('click', () => {
      const actual = this.frame.classList.toggle('is-actual');
      zoom.textContent = actual ? 'Fit' : 'Actual size';
    });

    this.frame.append(this.canvas, this.overlayHost);

    clear(this.nodes.stage);
    this.nodes.stage.append(
      h('div', { class: 'stage-bar' },
        h('div', { class: 'stage-bar-left' },
          h('span', { class: 'stage-name', text: this.image.name }),
          this.sizeNode,
        ),
        h('div', { class: 'stage-bar-right' }, compare, zoom),
      ),
      h('div', { class: 'stage-canvas' }, this.frame),
      this.statusNode,
    );

    clear(this.nodes.panel);
    this.nodes.panel.append(this.titleHost, this.controlHost, this.exportHost);
  }

  /** Switch the active tool, keeping each tool's own settings alive. */
  setTool(tool: AnyTool): void {
    this.tool = tool;
    if (!this.slots.has(tool.id)) {
      this.slots.set(tool.id, {
        state: tool.createState(this.image),
        exportParams: {
          ...defaultExport(),
          format: tool.preferredFormat ? tool.preferredFormat(this.image) : 'image/png',
        },
      });
    }
    this.renderPanelHead();
    this.update();
  }

  private get slot(): ToolSlot {
    return this.slots.get(this.tool.id)!;
  }

  private host(): ToolHost<unknown> {
    return {
      state: this.slot.state,
      image: this.image,
      originalPreview: this.originalPreview,
      processedPreview: this.processedPreview,
      previewScale: this.previewScale,
      update: () => this.update(),
      refresh: () => this.schedulePreview(),
      renderFull: () => this.processor.process(this.tool.buildOps(this.slot.state, this.image), 'full'),
    };
  }

  private renderPanelHead(): void {
    clear(this.titleHost);
    this.titleHost.append(
      h('div', { class: 'panel-title' }, icon(this.tool.iconPath, 20), h('h2', { text: this.tool.title })),
      h('p', { class: 'panel-about', text: this.tool.about }),
    );
  }

  /** Rebuild controls, overlay and export panel, then recompute the preview. */
  update(): void {
    const host = this.host();
    renderControls(this.controlHost, this.tool.controls(host), host);
    this.renderOverlay();
    this.renderExport();
    this.schedulePreview();
  }

  private renderOverlay(): void {
    clear(this.overlayHost);
    const node = this.tool.overlay ? this.tool.overlay(this.host()) : null;
    if (node) this.overlayHost.append(node);
    this.overlayHost.classList.toggle('is-active', !!node);
  }

  private previewOps(): Op[] {
    return this.tool.previewOps
      ? this.tool.previewOps(this.slot.state, this.image)
      : this.tool.buildOps(this.slot.state, this.image);
  }

  private async schedulePreview(): Promise<void> {
    if (this.previewRunning) {
      this.previewPending = true;
      return;
    }
    this.previewRunning = true;
    this.setStatus('Rendering…', 'busy');
    try {
      do {
        this.previewPending = false;
        const bitmap = await this.processor.process(this.previewOps(), 'preview');
        this.processedPreview = bitmap;
        if (!this.compareHeld) this.draw(bitmap);
        this.updateSizeReadout();
      } while (this.previewPending);
      this.setStatus('', 'idle');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.previewRunning = false;
    }
  }

  private draw(bitmap: Bitmap): void {
    this.canvas.width = bitmap.width;
    this.canvas.height = bitmap.height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(bitmap.data, bitmap.width, bitmap.height), 0, 0);
  }

  private updateSizeReadout(): void {
    const out = pipelineSize(this.image, this.tool.buildOps(this.slot.state, this.image));
    const same = out.width === this.image.width && out.height === this.image.height;
    this.sizeNode.textContent = same
      ? `${this.image.width} x ${this.image.height} px`
      : `${this.image.width} x ${this.image.height} -> ${out.width} x ${out.height} px`;
  }

  private setStatus(text: string, tone: 'idle' | 'busy' | 'error'): void {
    this.statusNode.textContent = text;
    this.statusNode.dataset.tone = tone;
    this.statusNode.classList.toggle('is-visible', text !== '');
  }

  private renderExport(): void {
    const params = this.slot.exportParams;
    if (!this.formats.includes(params.format)) params.format = this.formats[0];
    const info = FORMAT_INFO[params.format];

    const result = h('div', { class: 'export-result' });
    const button = h('button', { class: 'btn btn-primary', type: 'button' },
      icon(ICONS.download, 18), h('span', { text: 'Download' }),
    ) as HTMLButtonElement;

    button.addEventListener('click', async () => {
      button.disabled = true;
      button.classList.add('is-busy');
      clear(result);
      result.append(h('span', { class: 'muted', text: 'Processing at full resolution…' }));
      try {
        const bitmap = await this.processor.process(this.tool.buildOps(this.slot.state, this.image), 'full');
        const encoded = await encodeBitmap(bitmap, params);
        const name = suggestFilename(this.image.name, this.tool.exportSuffix, encoded.format);
        triggerDownload(encoded.blob, name);
        clear(result);
        append(result,
          h('span', { text: `${name} · ${bitmap.width} x ${bitmap.height} · ${formatBytes(encoded.blob.size)}` }),
          encoded.fellBack
            ? h('p', { class: 'ctl-note is-warn', text: `Your browser cannot encode ${info.label}; saved as ${FORMAT_INFO[encoded.format]?.label ?? encoded.format} instead.` })
            : null,
        );
      } catch (error) {
        clear(result);
        result.append(h('p', { class: 'ctl-note is-warn', text: error instanceof Error ? error.message : String(error) }));
      } finally {
        button.disabled = false;
        button.classList.remove('is-busy');
      }
    });

    const formatSelect = h('select', { class: 'ctl-select' }) as HTMLSelectElement;
    for (const format of this.formats) {
      formatSelect.append(h('option', { value: format, text: FORMAT_INFO[format].label }));
    }
    formatSelect.value = params.format;
    formatSelect.addEventListener('change', () => {
      params.format = formatSelect.value as ExportFormat;
      this.renderExport();
    });

    const note = this.tool.exportNote ? this.tool.exportNote(this.host()) : null;

    clear(this.exportHost);
    append(this.exportHost,
      h('div', { class: 'ctl-section' }, h('h3', { text: 'Export' })),
      h('div', { class: 'ctl-row' },
        h('div', { class: 'ctl-label' }, h('span', { text: 'Format' })),
        formatSelect,
      ),
      info.lossy
        ? qualityRow(params, () => {
            /* live value only; nothing to re-render */
          })
        : h('p', { class: 'ctl-hint', text: 'Lossless — every pixel is preserved exactly.' }),
      !info.alpha
        ? h('div', { class: 'ctl-row' },
            h('div', { class: 'ctl-label' }, h('span', { text: 'Flatten transparency onto' })),
            colorField(params),
          )
        : null,
      note ? h('p', { class: 'ctl-hint', text: note }) : null,
      h('div', { class: 'export-actions' }, button),
      result,
      h('p', { class: 'export-privacy' }, icon(ICONS.shield, 14),
        h('span', { text: 'Encoded in this tab. Re-encoding also strips EXIF, GPS and other metadata.' }),
      ),
    );
  }
}

function qualityRow(params: ExportParams, onChange: () => void): HTMLElement {
  const readout = h('output', { class: 'ctl-value', text: `${params.quality}` });
  const input = h('input', {
    class: 'ctl-range',
    type: 'range',
    min: 10,
    max: 100,
    step: 1,
    value: params.quality,
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    params.quality = Number(input.value);
    readout.textContent = `${params.quality}`;
    onChange();
  });
  return h('div', { class: 'ctl-row' },
    h('div', { class: 'ctl-label' }, h('span', { text: 'Quality' }), readout),
    input,
  );
}

function colorField(params: ExportParams): HTMLElement {
  const input = h('input', { type: 'color', class: 'ctl-color', value: params.background }) as HTMLInputElement;
  input.addEventListener('input', () => {
    params.background = input.value;
  });
  return input;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before dropping the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
