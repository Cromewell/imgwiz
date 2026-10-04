import type { Bitmap, ExportFormat, ExportParams } from './types';

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; alpha: boolean; lossy: boolean }> = {
  'image/png': { label: 'PNG', ext: 'png', alpha: true, lossy: false },
  'image/jpeg': { label: 'JPEG', ext: 'jpg', alpha: false, lossy: true },
  'image/webp': { label: 'WebP', ext: 'webp', alpha: true, lossy: true },
  'image/avif': { label: 'AVIF', ext: 'avif', alpha: true, lossy: true },
};

const supportCache = new Map<ExportFormat, boolean>();

/**
 * Probe whether this browser can actually *encode* a format. Asking for an
 * unsupported type silently yields PNG, so we compare the result's MIME type.
 */
export async function canEncode(format: ExportFormat): Promise<boolean> {
  const cached = supportCache.get(format);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, 0.8));
    ok = !!blob && blob.type === format;
  } catch {
    ok = false;
  }
  supportCache.set(format, ok);
  return ok;
}

export async function supportedFormats(): Promise<ExportFormat[]> {
  const all = Object.keys(FORMAT_INFO) as ExportFormat[];
  const checks = await Promise.all(all.map((f) => canEncode(f)));
  return all.filter((_, i) => checks[i]);
}

function bitmapToCanvas(bmp: Bitmap, background: string | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas context.');

  if (background) {
    // Formats without an alpha channel need the transparency flattened first,
    // otherwise the encoder decides the matte colour for us.
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, bmp.width, bmp.height);
    const layer = document.createElement('canvas');
    layer.width = bmp.width;
    layer.height = bmp.height;
    const lctx = layer.getContext('2d');
    if (!lctx) throw new Error('Could not create a 2D canvas context.');
    lctx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0);
    ctx.drawImage(layer, 0, 0);
  } else {
    ctx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0);
  }
  return canvas;
}

export interface EncodedImage {
  blob: Blob;
  /** The format actually produced, which may differ if a fallback kicked in. */
  format: ExportFormat;
  fellBack: boolean;
}

/** Encode pixels to a file blob. Re-encoding also drops all source metadata. */
export async function encodeBitmap(bmp: Bitmap, params: ExportParams): Promise<EncodedImage> {
  const info = FORMAT_INFO[params.format];
  const canvas = bitmapToCanvas(bmp, info.alpha ? null : params.background);
  const quality = Math.min(1, Math.max(0.01, params.quality / 100));

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, params.format, quality));
  if (!blob) throw new Error('The browser refused to encode this image.');

  const actual = (blob.type || 'image/png') as ExportFormat;
  return { blob, format: actual, fellBack: actual !== params.format };
}

export function suggestFilename(originalName: string, suffix: string, format: ExportFormat): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'image';
  return `${base}${suffix ? `-${suffix}` : ''}.${FORMAT_INFO[format].ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
