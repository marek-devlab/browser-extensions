import { useCallback, useEffect, useState } from 'react';
import { CHROME_DEFAULT_CAPS, FIREFOX_CAPS, type EngineCaps, type Platform } from './engine-select';
import { sendQuery, usePushMessages } from './messaging';
import type { PermissionStatus } from './protocol';

// Build capabilities for the editor's LIVE engine badge (design §2.4): the
// tool page runs `selectEngine(draft, platform, caps)` on every keystroke with
// the same caps the background compiled with, so the badge the user sees while
// typing is the badge the list will show after Save. Until the reply lands the
// platform default is used (never null: the badge must not flicker to "none").
// The background re-applies (and pushes `rules:applied`) when the "allow the
// page engine" pref flips, so the caps are re-read on that push — no stale
// `page: false` after the user turns the engine back on in Settings.

export interface BuildCaps {
  platform: Platform;
  caps: EngineCaps;
  version: string;
  loaded: boolean;
}

const FALLBACK: BuildCaps = {
  platform: import.meta.env.FIREFOX ? 'firefox' : 'chrome',
  caps: import.meta.env.FIREFOX ? FIREFOX_CAPS : CHROME_DEFAULT_CAPS,
  version: '',
  loaded: false,
};

export function useBuildCaps(): BuildCaps {
  const [state, setState] = useState<BuildCaps>(FALLBACK);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void sendQuery({ type: 'getCaps' })
      .then((r) => {
        if (alive && r && 'caps' in r) setState({ platform: r.platform, caps: r.caps, version: r.version, loaded: true });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tick]);
  usePushMessages(
    useCallback((m) => {
      if (m.type === 'rules:applied') setTick((n) => n + 1);
    }, []),
  );
  return state;
}

/** `permissions.getAll()` as the background sees it, refreshed on grant/revoke. */
export function usePermissionStatus(): { status: PermissionStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void sendQuery({ type: 'getPermissionStatus' })
      .then((s) => {
        if (alive && s && 'origins' in s) setStatus(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tick]);
  return { status, refresh: () => setTick((n) => n + 1) };
}
