import { useEffect, useState } from 'react';
import type { RedactionRegion, Watermark } from './types';

// The edit state of the clip currently open in the Studio: trim window, redaction
// regions, watermark. It lives in ONE place so the editor and the export dialog
// cannot disagree — and disagreeing here is not cosmetic: an export that "forgot"
// a redaction region would ship the password (design §7.6, the worst bug this
// product can have).
//
// In memory only: it is scoped to the Studio tab and dies with it, exactly like
// an unsaved document. Nothing here is a secret, but nothing here is worth
// persisting either — the moment the user exports, it is baked into pixels.

export interface EditState {
  clipId: string;
  trimInMs: number;
  trimOutMs: number;
  regions: RedactionRegion[];
  watermark: Watermark | null;
}

let state: EditState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function initEdit(clipId: string, durationMs: number): EditState {
  if (state?.clipId !== clipId) {
    state = { clipId, trimInMs: 0, trimOutMs: durationMs, regions: [], watermark: null };
  }
  return state;
}

export function patchEdit(patch: Partial<EditState>): void {
  if (!state) return;
  state = { ...state, ...patch };
  emit();
}

export function getEdit(): EditState | null {
  return state;
}

export function useEdit(clipId: string, durationMs: number): EditState {
  const [, force] = useState(0);
  useEffect(() => {
    initEdit(clipId, durationMs);
    force((n) => n + 1);
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [clipId, durationMs]);
  return state ?? initEdit(clipId, durationMs);
}

let seq = 0;
export function newRegionId(): string {
  seq += 1;
  return `r-${seq}`;
}
