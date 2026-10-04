import { clear, h, ICONS } from '../app/dom';
import type { Control, ToolDefinition, ToolHost } from '../app/types';
import { canEncode, encodeBitmap, formatBytes, FORMAT_INFO } from '../core/encode';
import { defaultExport, type ExportFormat, type Op } from '../core/types';

interface ConvertState {
  /** Results of the last size comparison, kept so switching tools does not lose it. */
  comparison: { format: ExportFormat; bytes: number | null; note?: string }[] | null;
  quality: number;
}

const ALL_FORMATS = Object.keys(FORMAT_INFO) as ExportFormat[];

function supportMatrix<S>(): Control<S> {
  return {
    kind: 'custom',
    render(host: HTMLElement) {
      const list = h('ul', { class: 'support-list' });
      host.append(h('div', { class: 'ctl-row' },
        h('div', { class: 'ctl-label' }, h('span', { text: 'Encoders in this browser' })),
        list,
        h('p', { class: 'ctl-hint', text: 'Probed by asking the canvas to encode a 2x2 test image.' }),
      ));

      for (const format of ALL_FORMATS) {
        const row = h('li', { class: 'support-row' },
          h('span', { class: 'support-name', text: FORMAT_INFO[format].label }),
          h('span', { class: 'support-state', text: 'checking…' }),
        );
        list.append(row);
        void canEncode(format).then((ok) => {
          const state = row.querySelector('.support-state') as HTMLElement;
          state.textContent = ok ? 'available' : 'not supported';
          state.classList.add(ok ? 'is-yes' : 'is-no');
        });
      }
    },
  };
}

/**
 * Encode the full-resolution result once per supported format so the user can
 * pick on real numbers instead of folklore about which codec is smaller.
 */
function comparison(tool: ToolHost<ConvertState>): Control<ConvertState> {
  return {
    kind: 'custom',
    render(host: HTMLElement) {
      const results = h('div', { class: 'compare-results' });
      const button = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Compare file sizes') as HTMLButtonElement;

      const paint = () => {
        clear(results);
        const rows = tool.state.comparison;
        if (!rows) return;
        const sizes = rows.filter((r) => r.bytes !== null).map((r) => r.bytes as number);
        const smallest = sizes.length ? Math.min(...sizes) : 0;
        for (const row of rows) {
          const relative = row.bytes !== null && row.bytes > 0 ? row.bytes / smallest : null;
          results.append(h('div', { class: `compare-row ${row.bytes === smallest ? 'is-best' : ''}` },
            h('span', { class: 'compare-name', text: FORMAT_INFO[row.format].label }),
            h('span', { class: 'compare-size', text: row.bytes === null ? (row.note ?? 'unavailable') : formatBytes(row.bytes) }),
            relative !== null ? h('span', { class: 'compare-rel', text: relative === 1 ? 'smallest' : `${relative.toFixed(1)}x` }) : null,
          ));
        }
      };

      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Encoding at full resolution…';
        try {
          const bitmap = await tool.renderFull();
          const rows: { format: ExportFormat; bytes: number | null; note?: string }[] = [];
          for (const format of ALL_FORMATS) {
            if (!(await canEncode(format))) {
              rows.push({ format, bytes: null, note: 'no encoder' });
              continue;
            }
            const encoded = await encodeBitmap(bitmap, {
              ...defaultExport(),
              format,
              quality: tool.state.quality,
            });
            rows.push(
              encoded.fellBack
                ? { format, bytes: null, note: 'encoder fell back' }
                : { format, bytes: encoded.blob.size },
            );
          }
          tool.state.comparison = rows;
          paint();
        } catch (error) {
          clear(results);
          results.append(h('p', { class: 'ctl-note is-warn', text: error instanceof Error ? error.message : String(error) }));
        } finally {
          button.disabled = false;
          button.textContent = 'Compare file sizes';
        }
      });

      host.append(h('div', { class: 'ctl-row' },
        h('div', { class: 'ctl-label' }, h('span', { text: 'Size comparison' })),
        button,
        h('p', { class: 'ctl-hint', text: `Lossy formats are measured at quality ${tool.state.quality}.` }),
      ));
      host.append(results);
      paint();
    },
  };
}

export const convertTool: ToolDefinition<ConvertState> = {
  id: 'convert',
  title: 'Convert format',
  tagline: 'Re-encode to another common format',
  about: 'Decode and re-encode locally. Pixels are untouched; only the container changes.',
  iconPath: ICONS.swap,
  exportSuffix: '',

  createState: () => ({ comparison: null, quality: 85 }),

  // Nothing to transform — the export panel does the encoding.
  buildOps: (): Op[] => [],

  controls(tool): Control<ConvertState>[] {
    const { image } = tool;
    const sourceLabel = image.sourceType || 'unknown type';

    return [
      {
        kind: 'note',
        text: `Source: ${sourceLabel}, ${image.width} x ${image.height} px, ${formatBytes(image.sourceBytes)}.`,
      },
      { kind: 'section', label: 'Availability', hint: 'Format support is a browser capability, not a server one.' },
      supportMatrix<ConvertState>(),
      { kind: 'section', label: 'Comparison' },
      {
        kind: 'slider',
        label: 'Comparison quality',
        min: 10,
        max: 100,
        step: 1,
        neutral: 85,
        get: (s) => s.quality,
        set: (s, v) => { s.quality = v; s.comparison = null; },
        format: (v) => String(Math.round(v)),
      },
      comparison(tool),
      { kind: 'section', label: 'Notes' },
      {
        kind: 'note',
        text: 'Every conversion is a full decode and re-encode. Going from a lossy source to any format cannot recover detail the source already discarded.',
      },
      {
        kind: 'note',
        text: 'Animated GIF and WebP collapse to their first frame — the canvas only ever holds one.',
        tone: 'warn',
      },
      {
        kind: 'note',
        text: '16-bit PNG input is reduced to 8 bits per channel, and wide-gamut sources are converted to sRGB. That is the only pixel format a browser canvas offers.',
        tone: 'warn',
      },
    ];
  },

  preferredFormat: (image) => (image.sourceType === 'image/png' ? 'image/webp' : 'image/png'),

  exportNote: () => 'Choose the format above, then download. Metadata is not carried over.',
};
