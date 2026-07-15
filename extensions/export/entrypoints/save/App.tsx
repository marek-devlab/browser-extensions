import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, ErrorState, LocaleProvider, Spinner, useLocaleController } from '@blur/ui';
import { localeItem } from '../../utils/storage';
import { useT } from '../../utils/i18n';
import { SESSION_PREFIX, type PendingSave } from '../../utils/messages';

// `save.html` — the honest escape hatch of design §5.5.
//
// THE PROBLEM: a page served with `Content-Security-Policy: sandbox` (without
// `allow-downloads`), or embedded in a sandboxed frame, silently drops a download
// triggered from that page — our `<a download>` click does nothing at all. And
// there is NO reliable way to detect that from inside the page (design §13.4 says
// so outright; the "wait 1.5 s and guess" heuristic is not a signal). So instead of
// shipping a fake detector, the toast on the page ALWAYS offers "the file didn't
// appear?" and lands here.
//
// THE FIX: the bytes are stashed in `storage.session` by the background and rebuilt
// into a Blob HERE — on the extension's OWN origin, under the extension's OWN CSP.
// The site's sandbox policy has no say over this page.
//
// 🔴 The stash is deleted the moment it is read: a table's contents are the user's
// data and have no business outliving the save (design §8.4).

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; payload: PendingSave }
  | { phase: 'saved'; filename: string }
  | { phase: 'error'; message: string };

export function App() {
  const { locale } = useLocaleController({
    key: 'blur-export:locale',
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
  return (
    <LocaleProvider locale={locale}>
      <AppBody />
    </LocaleProvider>
  );
}

function AppBody() {
  const t = useT();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    void (async () => {
      const key = new URLSearchParams(location.search).get('key');
      if (!key || !key.startsWith(SESSION_PREFIX)) {
        setState({ phase: 'error', message: t('saveErrorManual') });
        return;
      }
      const area = browser.storage.session ?? browser.storage.local;
      const stash = (await area.get(key)) as Record<string, PendingSave | undefined>;
      const payload = stash[key];
      // 🔴 Read once, then wipe. The user's data does not linger.
      await area.remove(key);
      if (!payload) {
        setState({ phase: 'error', message: t('saveErrorNoData') });
        return;
      }
      setState({ phase: 'ready', payload });
    })();
  }, [t]);

  function save(payload: PendingSave): void {
    // The same Blob + <a download> as on the page — but this origin is OURS, so no
    // site CSP can drop it, and a blob: URL is always same-origin with its creator
    // (so the `download` attribute is always honoured — see file-writer.ts).
    const url = URL.createObjectURL(new Blob([payload.text], { type: payload.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename;
    a.click();
    // 🔴 Not revoked immediately: in Firefox the download may not have started yet
    // and would be silently cancelled (design §9.4).
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setState({ phase: 'saved', filename: payload.filename });
  }

  return (
    <div className="pv-page">
      <div className="pv">
        <h1 className="pv__title">{t('saveTitle')}</h1>

        {state.phase === 'loading' && <Spinner label={t('savePreparing')} />}

        {state.phase === 'error' && <ErrorState message={state.message} />}

        {state.phase === 'ready' && (
          <>
            <p className="pv__sub mono">
              {state.payload.filename} · {formatBytes(state.payload.text, t)}
            </p>
            <Callout tone="info" title={t('saveWhyTitle')}>
              {t('saveWhyBody')}
            </Callout>
            <div className="pv__actions">
              <Button variant="primary" onClick={() => save(state.payload)}>
                {t('saveButton')}
              </Button>
            </div>
            <pre className="pv__raw mono" aria-label={t('firstLines')}>
              {state.payload.text.split(/\r?\n/).slice(0, 20).join('\n')}
            </pre>
          </>
        )}

        {state.phase === 'saved' && (
          <>
            <Callout tone="info" title={t('saveStarted', { filename: state.filename })}>
              {t('saveSavedBody')}
            </Callout>
            <div className="pv__actions">
              <Button onClick={() => window.close()}>{t('closeTab')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatBytes(text: string, t: ReturnType<typeof useT>): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < 1024) return `${bytes} ${t('bytesB')}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('bytesKb')}`;
  return `${(bytes / 1024 / 1024).toFixed(1)} ${t('bytesMb')}`;
}
