/** Fixed palettes for the dither tool, plus generated grey/RGB ramps. */

export interface Palette {
  id: string;
  label: string;
  /** Flat RGB triplets, 0..255. */
  colors: Uint8Array;
}

function rgb(...hex: string[]): Uint8Array {
  const out = new Uint8Array(hex.length * 3);
  hex.forEach((h, i) => {
    const v = parseInt(h.replace('#', ''), 16);
    out[i * 3] = (v >> 16) & 255;
    out[i * 3 + 1] = (v >> 8) & 255;
    out[i * 3 + 2] = v & 255;
  });
  return out;
}

export const FIXED_PALETTES: Palette[] = [
  { id: 'gameboy', label: 'Game Boy', colors: rgb('#0f380f', '#306230', '#8bac0f', '#9bbc0f') },
  { id: 'gameboy-pocket', label: 'Game Boy Pocket', colors: rgb('#181818', '#4a4a4a', '#8c8c8c', '#c6c6c6') },
  { id: 'cga', label: 'CGA 16', colors: rgb(
    '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
    '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff') },
  { id: 'c64', label: 'Commodore 64', colors: rgb(
    '#000000', '#ffffff', '#883932', '#67b6bd', '#8b3f96', '#55a049', '#40318d', '#bfce72',
    '#8b5429', '#574200', '#b86962', '#505050', '#787878', '#94e089', '#7869c4', '#9f9f9f') },
  { id: 'pico8', label: 'PICO-8', colors: rgb(
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa') },
  { id: 'zx', label: 'ZX Spectrum', colors: rgb(
    '#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
    '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff') },
  { id: 'cyanotype', label: 'Cyanotype', colors: rgb('#082b47', '#1f5e8b', '#4a93bf', '#a8d4e8', '#f2f7f9') },
  { id: 'sepia', label: 'Sepia', colors: rgb('#2b1d0e', '#5c4321', '#99784a', '#cdb189', '#f4e9d8') },
  { id: 'risograph', label: 'Risograph', colors: rgb('#1a1a1a', '#ff5470', '#2d9bf0', '#ffd500', '#f7f3e8') },
  { id: 'amber', label: 'Amber CRT', colors: rgb('#1a0f00', '#4a2c00', '#b36b00', '#ffb000') },
  { id: 'green-crt', label: 'Green CRT', colors: rgb('#001100', '#003300', '#00aa33', '#33ff66') },
];

const paletteCache = new Map<string, Uint8Array>();

/** Evenly spaced grey ramp with `levels` steps. */
function grayRamp(levels: number): Uint8Array {
  const n = Math.max(2, Math.min(256, levels | 0));
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = Math.round((i * 255) / (n - 1));
    out[i * 3] = v;
    out[i * 3 + 1] = v;
    out[i * 3 + 2] = v;
  }
  return out;
}

/** Full RGB cube with `levels` steps per channel. */
function rgbCube(levels: number): Uint8Array {
  const n = Math.max(2, Math.min(8, levels | 0));
  const out = new Uint8Array(n * n * n * 3);
  let i = 0;
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++) {
        out[i++] = Math.round((r * 255) / (n - 1));
        out[i++] = Math.round((g * 255) / (n - 1));
        out[i++] = Math.round((b * 255) / (n - 1));
      }
    }
  }
  return out;
}

/**
 * Resolve a palette id to RGB triplets. 'mono' is pure black/white, 'gray' and
 * 'rgb' are generated from `levels`, anything else comes from FIXED_PALETTES.
 */
export function resolvePalette(id: string, levels: number): Uint8Array {
  if (id === 'mono') return grayRamp(2);
  if (id === 'gray') {
    const key = `gray:${levels}`;
    let p = paletteCache.get(key);
    if (!p) paletteCache.set(key, (p = grayRamp(levels)));
    return p;
  }
  if (id === 'rgb') {
    const key = `rgb:${levels}`;
    let p = paletteCache.get(key);
    if (!p) paletteCache.set(key, (p = rgbCube(levels)));
    return p;
  }
  const fixed = FIXED_PALETTES.find((p) => p.id === id);
  return fixed ? fixed.colors : grayRamp(2);
}

/** True when every entry is neutral grey — lets the dither fast-path on luma. */
export function isGrayPalette(colors: Uint8Array): boolean {
  for (let i = 0; i < colors.length; i += 3) {
    if (colors[i] !== colors[i + 1] || colors[i] !== colors[i + 2]) return false;
  }
  return true;
}

export const PALETTE_OPTIONS = [
  { value: 'mono', label: 'Black & white (1-bit)' },
  { value: 'gray', label: 'Grey ramp (n levels)' },
  { value: 'rgb', label: 'RGB cube (n per channel)' },
  ...FIXED_PALETTES.map((p) => ({ value: p.id, label: p.label })),
];
