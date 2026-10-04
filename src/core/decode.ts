import { type Bitmap } from './types';

export interface DecodedImage extends Bitmap {
  name: string;
  /** MIME type as reported by the file, may be empty for odd sources. */
  sourceType: string;
  sourceBytes: number;
}

/**
 * Browsers cap canvas dimensions; Safari on iOS also caps total area. Staying
 * under both keeps decoding predictable instead of silently blank.
 */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 64 * 1024 * 1024;

export class DecodeError extends Error {}

async function toImageBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the EXIF orientation tag; without it phone photos
      // come out sideways once the metadata is dropped on re-encode.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // SVG and a few exotic codecs only decode through an <img> element.
    }
  }
  return await decodeViaImgElement(file);
}

function decodeViaImgElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new DecodeError('This file could not be decoded by your browser.'));
    };
    img.src = url;
  });
}

function sizeOf(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  }
  return { width: source.width, height: source.height };
}

/** Decode any browser-supported image file into raw RGBA pixels. */
export async function decodeFile(file: File): Promise<DecodedImage> {
  const source = await toImageBitmap(file);
  const { width, height } = sizeOf(source);

  if (!width || !height) {
    throw new DecodeError('The image reports zero size — it may be a vector file without intrinsic dimensions.');
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new DecodeError(`Image is ${width}x${height}px; the browser canvas limit is ${MAX_SIDE}px per side.`);
  }
  if (width * height > MAX_PIXELS) {
    throw new DecodeError(`Image has ${(width * height / 1e6).toFixed(1)} megapixels, above the ${MAX_PIXELS / 1e6} MP limit.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new DecodeError('Could not create a 2D canvas context.');
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  if ('close' in source) source.close();

  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    width,
    height,
    data: imageData.data,
    name: file.name || 'image',
    sourceType: file.type || '',
    sourceBytes: file.size,
  };
}

export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,.png,.jpg,.jpeg,.webp,.avif,.gif,.bmp,.svg';
