import { ACCEPTED_TYPES, decodeFile, DecodeError, MAX_SIDE } from '../core/decode';
import { formatBytes } from '../core/encode';
import { bwTool } from '../tools/bw';
import { convertTool } from '../tools/convert';
import { cropTool } from '../tools/crop';
import { ditherTool } from '../tools/dither';
import { exposureTool } from '../tools/exposure';
import { resizeTool } from '../tools/resize';
import { clear, h, ICONS, icon } from './dom';
import type { AnyTool } from './types';
import { Workspace } from './workspace';

const TOOLS: AnyTool[] = [bwTool, exposureTool, ditherTool, cropTool, resizeTool, convertTool];

const PRIVACY_POINTS = [
  'Your image is read with the File API and decoded by the browser. It is never uploaded.',
  'All processing runs in a Web Worker in this tab — no server, no API, no analytics.',
  'There are no third-party requests at all: fonts, styles and scripts all ship with the page.',
  'Re-encoding drops EXIF, GPS and every other metadata block as a side effect.',
  'Once loaded, the page keeps working with the network switched off.',
];

export class App {
  private workspace: Workspace | null = null;
  private activeToolId = TOOLS[0].id;
  private fileInput: HTMLInputElement;
  private navHost = h('nav', { class: 'tool-nav' });
  private body = h('div', { class: 'app-body' });
  private statusBar = h('div', { class: 'app-status' });
  private closeButton: HTMLButtonElement;

  constructor(private root: HTMLElement) {
    this.fileInput = h('input', {
      type: 'file',
      accept: ACCEPTED_TYPES,
      class: 'visually-hidden',
    }) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.loadFile(file);
      this.fileInput.value = '';
    });

    this.closeButton = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'Close image',
      onclick: () => this.closeImage(),
    }) as HTMLButtonElement;

    this.build();
    this.wireGlobalInput();
    this.applyHash();
    window.addEventListener('hashchange', () => this.applyHash());
  }

  private build(): void {
    clear(this.root);
    this.root.append(
      h('header', { class: 'app-header' },
        h('div', { class: 'brand' },
          h('span', { class: 'brand-mark', text: 'iw' }),
          h('div', {},
            h('strong', { class: 'brand-name', text: 'imgwiz' }),
            h('span', { class: 'brand-sub', text: 'local image tools' }),
          ),
        ),
        this.navHost,
        h('div', { class: 'header-actions' },
          h('span', { class: 'privacy-badge', title: 'Nothing leaves this browser tab' },
            icon(ICONS.lock, 14),
            h('span', { text: '100% local' }),
          ),
          h('button', {
            class: 'btn btn-primary',
            type: 'button',
            onclick: () => this.fileInput.click(),
          }, icon(ICONS.image, 16), h('span', { text: 'Open image' })),
          this.closeButton,
        ),
      ),
      this.body,
      this.statusBar,
      this.fileInput,
    );
    this.renderNav();
    this.renderLanding();
  }

  private renderNav(): void {
    clear(this.navHost);
    for (const tool of TOOLS) {
      const button = h('button', {
        type: 'button',
        class: `tool-tab ${tool.id === this.activeToolId ? 'is-active' : ''}`,
        title: tool.tagline,
        onclick: () => this.selectTool(tool.id),
      }, icon(tool.iconPath, 16), h('span', { text: tool.title }));
      this.navHost.append(button);
    }
    this.closeButton.hidden = !this.workspace;
  }

  private applyHash(): void {
    const id = location.hash.replace(/^#\/?/, '');
    if (id && TOOLS.some((t) => t.id === id) && id !== this.activeToolId) {
      this.selectTool(id);
    }
  }

  private selectTool(id: string): void {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) return;
    this.activeToolId = id;
    if (location.hash !== `#/${id}`) location.hash = `#/${id}`;
    this.renderNav();
    if (this.workspace) this.workspace.setTool(tool);
    else this.renderLanding();
  }

  private wireGlobalInput(): void {
    // Drag and drop anywhere in the window, plus paste from the clipboard.
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('dragover', (event) => {
      stop(event);
      this.body.classList.add('is-drop-target');
    });
    window.addEventListener('dragleave', (event) => {
      stop(event);
      this.body.classList.remove('is-drop-target');
    });
    window.addEventListener('drop', (event) => {
      stop(event);
      this.body.classList.remove('is-drop-target');
      const file = (event as DragEvent).dataTransfer?.files?.[0];
      if (file) void this.loadFile(file);
    });
    window.addEventListener('paste', (event) => {
      const items = (event as ClipboardEvent).clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) void this.loadFile(file);
          return;
        }
      }
    });
  }

  private setStatus(text: string, tone: 'info' | 'error' | 'none'): void {
    this.statusBar.textContent = text;
    this.statusBar.dataset.tone = tone;
    this.statusBar.classList.toggle('is-visible', tone !== 'none');
  }

  private async loadFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(file.name)) {
      this.setStatus(`"${file.name}" does not look like an image file.`, 'error');
      return;
    }
    this.setStatus(`Decoding ${file.name} (${formatBytes(file.size)})…`, 'info');
    try {
      const decoded = await decodeFile(file);
      this.workspace?.dispose();
      this.workspace = null;
      const nodes = this.renderWorkspaceShell();
      this.workspace = await Workspace.create(decoded, nodes);
      const tool = TOOLS.find((t) => t.id === this.activeToolId) ?? TOOLS[0];
      this.workspace.setTool(tool);
      this.renderNav();
      this.setStatus('', 'none');
    } catch (error) {
      const message = error instanceof DecodeError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
      this.setStatus(message, 'error');
      this.renderLanding();
    }
  }

  private closeImage(): void {
    this.workspace?.dispose();
    this.workspace = null;
    this.renderNav();
    this.renderLanding();
    this.setStatus('', 'none');
  }

  private renderWorkspaceShell(): { stage: HTMLElement; panel: HTMLElement } {
    const stage = h('section', { class: 'stage' });
    const panel = h('aside', { class: 'panel' });
    clear(this.body);
    this.body.classList.remove('is-landing');
    this.body.append(stage, panel);
    return { stage, panel };
  }

  private renderLanding(): void {
    clear(this.body);
    this.body.classList.add('is-landing');

    const dropzone = h('button', {
      class: 'dropzone',
      type: 'button',
      onclick: () => this.fileInput.click(),
    },
      icon(ICONS.image, 40),
      h('strong', { text: 'Drop an image here' }),
      h('span', { class: 'muted', text: 'or click to choose · or paste from the clipboard' }),
      h('span', { class: 'dropzone-formats', text: 'PNG · JPEG · WebP · AVIF · GIF · BMP · SVG' }),
    );

    const cards = h('div', { class: 'tool-cards' },
      TOOLS.map((tool) =>
        h('button', {
          class: `tool-card ${tool.id === this.activeToolId ? 'is-active' : ''}`,
          type: 'button',
          onclick: () => {
            this.selectTool(tool.id);
            this.fileInput.click();
          },
        },
          icon(tool.iconPath, 22),
          h('strong', { text: tool.title }),
          h('span', { class: 'muted', text: tool.tagline }),
        ),
      ),
    );

    this.body.append(
      h('div', { class: 'landing' },
        h('div', { class: 'landing-head' },
          h('h1', { text: 'Image editing that never leaves your browser' }),
          h('p', { class: 'lede', text: 'Six focused tools for black & white conversion, exposure, dithering, cropping, resizing and format conversion. No account, no upload, no server.' }),
        ),
        dropzone,
        cards,
        h('section', { class: 'privacy-card' },
          h('h2', {}, icon(ICONS.shield, 18), h('span', { text: 'Why this is actually private' })),
          h('ul', {}, PRIVACY_POINTS.map((point) => h('li', { text: point }))),
          h('p', { class: 'muted', text: `Browser limits apply: canvas tops out at ${MAX_SIDE}px per side, and colour work happens in 8-bit sRGB.` }),
        ),
      ),
    );
  }
}

export function mountApp(root: HTMLElement): App {
  return new App(root);
}
