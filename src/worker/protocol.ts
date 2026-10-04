import type { Bitmap, Op } from '../core/types';

export type WorkerRequest =
  | { id: number; kind: 'load'; bitmap: Bitmap; previewBudget: number }
  | { id: number; kind: 'process'; ops: Op[]; quality: 'preview' | 'full' }
  | { id: number; kind: 'dispose' };

export type WorkerResponse =
  | { id: number; ok: true; kind: 'load'; preview: Bitmap; previewScale: number; width: number; height: number }
  | { id: number; ok: true; kind: 'process'; bitmap: Bitmap }
  | { id: number; ok: true; kind: 'dispose' }
  | { id: number; ok: false; error: string };
