// Per-browser progress and settings. Storage can be missing or throw
// (private windows, blocked site data); the game must still run without it.
export interface Clear { selves: number; ticks: number }

export interface Saved {
  clears: Record<string, Clear>;
  /** Levels whose reference solution the player watched (unlocks the next one). */
  watched: Record<string, true>;
  sfx: boolean;
  music: boolean;
  /** null = follow the system setting */
  reduced: boolean | null;
}

const KEY = 'clockwork-echoes:v1';

const fresh = (): Saved => ({ clears: {}, watched: {}, sfx: true, music: true, reduced: null });

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const v = JSON.parse(raw) as Partial<Saved>;
    return { ...fresh(), ...v, clears: { ...(v.clears ?? {}) }, watched: { ...(v.watched ?? {}) } };
  } catch {
    return fresh();
  }
}

export function save(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: progress lasts for this visit */ }
}

export function reset(s: Saved): Saved {
  const n = { ...fresh(), sfx: s.sfx, music: s.music, reduced: s.reduced };
  save(n);
  return n;
}
