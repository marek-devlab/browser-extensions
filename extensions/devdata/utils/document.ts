import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, type Locale } from '@blur/ui';
import { tAt } from './i18n';
import {
  HARD_MAX_BYTES,
  parseDocument,
  ParseFailed,
  resolveFormat,
  SOFT_MAX_BYTES,
} from './format';
import { isCancelled, JobError, type RunningJob } from './worker/client';
import { takeHandoff } from './handoff';
import { documentItem, saveDocument, MAX_PERSIST_BYTES } from './storage';
import type { DevdataPrefs, FormatPref } from './storage';
import type { DocFormat, ParsedDoc, ParseFailure } from './types';

// The document state machine, shared by the Data tab (which edits it) and the
// Schema tab (which validates it). One document at a time, by design (§4.2).
//
// Every transition is explicit and every failure has a message. There is no path
// through this hook that produces a blank screen (design §8).

export type DocState =
  | { phase: 'empty' }
  | { phase: 'loading'; label: string; cancel: () => void }
  | { phase: 'ready'; doc: ParsedDoc }
  | { phase: 'failed'; failure: ParseFailure }
  | { phase: 'fatal'; message: string; reason: JobError['reason'] | 'unknown'; text: string };

export interface LoadOptions {
  name?: string | null;
  /** An explicit format override; otherwise the pref (possibly 'auto') decides. */
  format?: FormatPref;
  /** Skip the 50 MB confirmation (the user already agreed). */
  confirmedLarge?: boolean;
}

export interface DocApi {
  state: DocState;
  /** A JWT-looking paste is OFFERED to the JWT tab, never auto-switched (§4.1). */
  jwtOffer: string | null;
  dismissJwtOffer: () => void;
  /** A >50 MB input awaiting explicit confirmation (design §4.2). */
  oversize: { text: string; name: string | null; bytes: number } | null;
  confirmOversize: () => void;
  cancelOversize: () => void;
  /** Storage feedback: the document was too big to persist, or the quota blew. */
  saveNote: string | null;
  load: (text: string, opts?: LoadOptions) => void;
  reparseAs: (format: DocFormat) => void;
  reset: () => void;
  /** Replace the document text in place (beautify / "make this the document"). */
  replaceText: (text: string, format: DocFormat) => void;
}

export function useDocument(prefs: DevdataPrefs | null): DocApi {
  const [state, setState] = useState<DocState>({ phase: 'empty' });
  const [jwtOffer, setJwtOffer] = useState<string | null>(null);
  const [oversize, setOversize] = useState<DocApi['oversize']>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const job = useRef<RunningJob<ParsedDoc> | null>(null);
  const prefsRef = useRef<DevdataPrefs | null>(prefs);
  prefsRef.current = prefs;
  // Keep the current locale in a ref so the stable `run`/`load`/`persist`
  // callbacks read the live value without being re-created on every switch.
  const locale = useLocale();
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;

  // Cancel any in-flight parse when the tool page goes away: an orphaned worker
  // chewing on 50 MB would keep the tab hot for nothing.
  useEffect(() => () => job.current?.cancel(), []);

  const run = useCallback(
    (text: string, format: DocFormat, autodetected: boolean, name: string | null) => {
      const current = prefsRef.current;
      if (!current) return;
      job.current?.cancel();

      const running = parseDocument(text, format, {
        autodetected,
        name,
        prefs: current,
        locale: localeRef.current,
      });
      job.current = running;

      const bytes = text.length;
      setState({
        phase: 'loading',
        label: tAt(localeRef.current, 'doc.parsing', {
          size: formatBytes(bytes, localeRef.current),
        }),
        cancel: () => {
          running.cancel();
          setState({ phase: 'empty' });
        },
      });

      running.promise.then(
        (doc) => {
          if (job.current !== running) return;
          job.current = null;
          setState({ phase: 'ready', doc });
          void persist(doc, current, setSaveNote, localeRef.current);
        },
        (err: unknown) => {
          if (job.current !== running) return;
          job.current = null;
          if (isCancelled(err)) return; // the user pressed Cancel; not an error
          if (err instanceof ParseFailed) {
            setState({ phase: 'failed', failure: err.failure });
            return;
          }
          if (err instanceof JobError) {
            setState({
              phase: 'fatal',
              message: err.message,
              reason: err.reason,
              text,
            });
            return;
          }
          setState({
            phase: 'fatal',
            message: err instanceof Error ? err.message : String(err),
            reason: 'unknown',
            text,
          });
        },
      );
    },
    [],
  );

  const load = useCallback(
    (text: string, opts: LoadOptions = {}) => {
      const current = prefsRef.current;
      if (!current) return;
      setSaveNote(null);
      setJwtOffer(null);

      if (text.trim() === '') {
        setState({ phase: 'empty' });
        return;
      }

      const bytes = text.length;
      if (bytes > HARD_MAX_BYTES) {
        setState({
          phase: 'fatal',
          reason: 'unknown',
          text: '',
          message: tAt(localeRef.current, 'doc.tooBig', {
            size: formatBytes(bytes, localeRef.current),
            limit: formatBytes(HARD_MAX_BYTES, localeRef.current),
          }),
        });
        return;
      }
      if (bytes > SOFT_MAX_BYTES && !opts.confirmedLarge) {
        setOversize({ text, name: opts.name ?? null, bytes });
        return;
      }

      const pref = opts.format ?? current.defaultFormat;
      const resolved = resolveFormat(text, pref);

      if (resolved.format === 'jwt') {
        // A credential is not a document. We OFFER the JWT tab with a button —
        // auto-jumping to a screen with a big red warning disorients (§4.1).
        setJwtOffer(text.trim());
        setState({ phase: 'empty' });
        return;
      }

      run(text, resolved.format, resolved.autodetected, opts.name ?? null);
    },
    [run],
  );

  const reparseAs = useCallback(
    (format: DocFormat) => {
      const text =
        state.phase === 'ready'
          ? state.doc.text
          : state.phase === 'failed'
            ? state.failure.text
            : state.phase === 'fatal'
              ? state.text
              : '';
      if (text === '') return;
      const name = state.phase === 'ready' ? state.doc.name : null;
      run(text, format, false, name);
    },
    [state, run],
  );

  const replaceText = useCallback(
    (text: string, format: DocFormat) => {
      run(text, format, false, state.phase === 'ready' ? state.doc.name : null);
    },
    [run, state],
  );

  const reset = useCallback(() => {
    job.current?.cancel();
    job.current = null;
    setState({ phase: 'empty' });
    setSaveNote(null);
    setJwtOffer(null);
  }, []);

  // Restore: a handoff (context menu / clipboard) wins over the cached document.
  useEffect(() => {
    if (!prefs) return;
    let alive = true;
    void (async () => {
      const handoff = await takeHandoff();
      if (!alive) return;
      if (handoff) {
        load(handoff.text, { name: null });
        return;
      }
      if (!prefs.restore) return;
      try {
        const cached = await documentItem.getValue();
        if (!alive || !cached) return;
        load(cached.text, { name: cached.name, format: cached.format });
      } catch {
        // A corrupt cache must not block an empty, usable tool.
      }
    })();
    return () => {
      alive = false;
    };
    // Run once, as soon as prefs are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs !== null]);

  return {
    state,
    jwtOffer,
    dismissJwtOffer: () => setJwtOffer(null),
    oversize,
    confirmOversize: () => {
      const pending = oversize;
      setOversize(null);
      if (pending) load(pending.text, { name: pending.name, confirmedLarge: true });
    },
    cancelOversize: () => setOversize(null),
    saveNote,
    load,
    reparseAs,
    reset,
    replaceText,
  };
}

async function persist(
  doc: ParsedDoc,
  prefs: DevdataPrefs,
  setNote: (note: string | null) => void,
  locale: Locale,
): Promise<void> {
  const outcome = await saveDocument(
    {
      text: doc.text,
      format: doc.format,
      bytes: doc.bytes,
      name: doc.name,
      savedAt: Date.now(),
    },
    prefs.restore,
  );
  switch (outcome.status) {
    case 'saved':
    case 'skipped-off':
      setNote(null);
      return;
    case 'skipped-too-big':
      setNote(
        tAt(locale, 'doc.saveTooBig', {
          size: formatBytes(outcome.bytes, locale),
          max: formatBytes(MAX_PERSIST_BYTES, locale),
        }),
      );
      return;
    case 'failed':
      setNote(tAt(locale, 'doc.saveFailed', { message: outcome.message }));
  }
}

export function formatBytes(n: number, locale: Locale): string {
  if (n < 1024) return tAt(locale, 'unit.bytes', { n });
  if (n < 1024 * 1024) return tAt(locale, 'unit.kb', { n: (n / 1024).toFixed(1) });
  return tAt(locale, 'unit.mb', { n: (n / 1024 / 1024).toFixed(1) });
}
