# imgwiz

A privacy-first image editing suite. Every byte of work happens in your browser
tab — no upload, no server, no account, no analytics.

Six focused tools:

| Tool | What it does |
| --- | --- |
| **Black & white** | Monochrome conversion with classic colour filters (red/orange/yellow/green/blue), plus exposure, contrast, levels and gamma |
| **Exposure & contrast** | The same tone controls with colour kept intact, plus saturation, auto levels and a live histogram |
| **Dither** | 17 algorithms (Floyd–Steinberg, Atkinson, Jarvis, Stucki, Burkes, Sierra, Bayer, clustered halftone, blue noise, …), 14 palettes and 10 presets |
| **Crop** | Draggable frame with aspect-ratio locking, quarter-turn rotation, mirroring and a thirds grid |
| **Resize** | Lanczos 3, Mitchell, bilinear, box and nearest resampling to exact dimensions |
| **Convert format** | Re-encode to PNG, JPEG, WebP or AVIF, with a real side-by-side file-size comparison |

## Why this is actually private

Privacy here is a property of the architecture, not a promise in a footer:

- The image is read through the **File API** and decoded by the browser. It is
  never read by anything but this page.
- All processing runs in a **Web Worker** in the same tab. There is no backend,
  no API call and no telemetry.
- **No third-party resources at all.** Fonts, styles and scripts all ship with
  the page — nothing is pulled from a CDN.
- Production builds carry a **Content Security Policy with `connect-src 'none'`**,
  so the browser itself forbids the page from opening any connection. Open
  DevTools → Network and watch it stay empty.
- Re-encoding through the canvas **drops EXIF, GPS and every other metadata
  block** as a side effect. EXIF orientation is applied at decode time so photos
  do not come out sideways.
- Once loaded, the tab keeps working with the network switched off.

The CSP is injected at build time (see `vite.config.ts`). A `<meta>` policy is
good; serving the same policy as a real HTTP header is better, because a header
applies before the parser has acted on anything. For nginx:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" always;
```

## Running it

The project uses [Bun](https://bun.sh) (npm/pnpm work equally well — swap the
command prefix).

```bash
bun install
bun run dev        # dev server
bun run build      # production build into dist/
bun run preview    # serve the built output
bun run typecheck  # tsc --noEmit
bun run test       # core algorithm checks, headless, no browser needed
bun run smoke      # end-to-end test in a real headless Chromium
```

`bun run smoke` expects a built app being served (`bun run preview`, or any
static server on `dist/`) and a Chromium binary. Point it elsewhere with an
argument and `CHROME_PATH`:

```bash
CHROME_PATH=/usr/bin/chromium bun scripts/smoke.ts http://127.0.0.1:4173/index.html
```

The build is a static bundle — drop `dist/` on any static host, or open it from
a local web server. It needs no server-side code of any kind.

## Architecture

```
src/
  core/        DOM-free image math — runs on the main thread or in a worker
    types.ts       Bitmap, op definitions and parameter defaults
    adjust.ts      Tone LUT, channel mixer, saturation, histogram
    dither.ts      Error-diffusion kernels, ordered screens, quantizers
    noise.ts       Bayer, clustered-dot and void-and-cluster blue noise
    palettes.ts    Fixed retro palettes plus generated grey/RGB ramps
    resample.ts    Separable Lanczos/Mitchell/bilinear/box/nearest
    geometry.ts    Crop, flip and rotate in one gather pass
    pipeline.ts    Runs an op list; understands preview scaling
    decode.ts      File -> RGBA, with EXIF orientation and size limits
    encode.ts      RGBA -> Blob, with real encoder feature detection
  worker/      Owns the full-resolution pixels; main thread only sees previews
  app/         Shell, declarative control renderer, workspace runtime
  tools/       The six tools, each a small declarative ToolDefinition
```

Two ideas carry most of the design:

**The worker owns the pixels.** The main thread hands the decoded image over
once and then only ever exchanges previews (longest edge 1600px). Interaction
stays smooth on large images, and there is never a second full-resolution copy
in memory.

**Tools are data, not DOM.** A tool declares its state, the pipeline ops it
produces and a list of controls; the shell renders all of it. Adding a tool
means writing one file, and every tool gets previews, compare-to-original,
full-resolution export, format detection and metadata stripping for free.

Absolute pixel parameters (resize targets, dither pixel size) are scaled by the
preview factor, so what you see really is a smaller copy of what you export.

## Known limits (browser, not implementation)

- **Canvas is 8-bit sRGB.** 16-bit PNG input is reduced to 8 bits per channel
  and wide-gamut sources are converted to sRGB. No browser canvas offers more.
- **Canvas size caps.** 16384px per side, and iOS Safari also caps total area.
  Oversized files are rejected with a clear message rather than silently
  producing a blank image.
- **AVIF encoding is Chromium-only** today, and HEIC cannot be decoded outside
  Safari. The Convert tool probes the actual encoders and tells you what this
  browser can do instead of guessing. Adding WASM codecs (`@jsquash/*`,
  `libheif-js`) would close both gaps and stays fully local — it just costs
  roughly a megabyte of lazily loaded bundle.
- **Animation is dropped.** A canvas holds one frame, so animated GIF and WebP
  collapse to their first frame.

## Possible next steps

- A service worker, so a reload works offline too and the privacy claim holds
  across sessions rather than only within a loaded tab.
- WASM encoders for AVIF/JPEG XL and a HEIC decoder.
- Batch mode: apply one tool's settings to a folder of images, still locally.
