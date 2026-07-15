import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, EmptyState, ErrorState, LocaleProvider, Spinner, ThemeToggle, useLocale, useLocaleController } from '@blur/ui';
import { useExportTheme } from '../../utils/theme';
import { NoPageAccess, runOnActiveTab } from '../../utils/inject';
import { localeItem } from '../../utils/storage';
import { localeTag, useT } from '../../utils/i18n';
import type { EngineCommand } from '../../utils/messages';
import type { PageInventory, TableModel } from '../../utils/types';

// The popup is the INVENTORY (design §1.2 / §2.4): "what can I pull off this
// page?" — a live read on open. There is no badge and no precomputed count: either
// would require a standing content script on <all_urls>, which is the one thing we
// will not trade (design §0).
//
// ⚠️ IT IS ALSO THE ENTIRE MOBILE UI. Firefox for Android exposes no
// `contextMenus` and has no right-click; Chrome for Android has no extensions at
// all. So EVERY capability of the context menu is duplicated here — export the
// selection, pick a table, export all tables, and pick an image for the three image
// actions. We feature-detect `browser.contextMenus`; we never sniff the user agent.
//
// 🔴 Page content (captions, hostnames) reaches this UI only as React text
// children — auto-escaped, no dangerouslySetInnerHTML anywhere.

const hasContextMenus = Boolean(browser.contextMenus?.create);

export function App() {
  // Locale seed key reuses the theme prefix (`blur-export:`) so a switch is
  // flash-free on the next open, exactly like the theme (see @blur/ui/i18n).
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
  const tag = localeTag(useLocale());
  const { theme, setTheme } = useExportTheme();
  const [inv, setInv] = useState<PageInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = useCallback(async () => {
    setError(null);
    try {
      const res = await runOnActiveTab({ type: 'scan' });
      if (res.ok && res.kind === 'scan') setInv(res.inventory);
      else if (!res.ok) setError(res.error);
    } catch (e) {
      setError(e instanceof NoPageAccess ? e.message : t('scanError'));
    }
  }, [t]);

  useEffect(() => {
    void scan();
  }, [scan]);

  /** Every action closes the popup: the UI it opens lives ON THE PAGE. */
  const act = useCallback(async (cmd: EngineCommand) => {
    setBusy(true);
    try {
      await runOnActiveTab(cmd);
      window.close();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const nothing =
    inv && !inv.selection && inv.tables.length === 0 && inv.images.total === 0;

  return (
    <div className="popup">
      <header className="head">
        <div className="head__top">
          <h1>💾 {t('popupTitle')}</h1>
          <ThemeToggle theme={theme ?? 'auto'} onChange={setTheme} />
        </div>
        <span className="host mono" title={inv?.host}>
          {inv?.host ?? '…'}
        </span>
      </header>

      {error ? (
        <ErrorState message={error} retry={() => void scan()} />
      ) : !inv ? (
        <Spinner label={t('reading')} />
      ) : nothing ? (
        <EmptyState
          title={t('nothingTitle')}
          hint={t('nothingHint', {
            action: hasContextMenus ? t('actionRightClick') : t('actionOpenMenu'),
          })}
        />
      ) : (
        <>
          {inv.selection && (
            <section>
              <h2>{t('selectionHeading')}</h2>
              <p className="line">
                {t('selectionLine', {
                  chars: inv.selection.chars.toLocaleString(tag),
                  paragraphs: inv.selection.paragraphs,
                  unit: inv.selection.paragraphs === 1 ? t('paragraphOne') : t('paragraphOther'),
                })}
              </p>
              <div className="btnrow">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act({ type: 'exportSelection', format: 'md' })}
                >
                  .md
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act({ type: 'exportSelection', format: 'txt' })}
                >
                  .txt
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act({ type: 'copySelectionMarkdown' })}
                >
                  {t('copyAsMd')}
                </Button>
              </div>
            </section>
          )}

          <section>
            <h2>{t('tables')} · {inv.tables.length}</h2>
            {inv.tables.length === 0 ? (
              <p className="line dim">{t('noTablesInline')}</p>
            ) : (
              <ul className="tables">
                {inv.tables.map((tbl, i) => (
                  <li key={tbl.id} className="tbl">
                    <button
                      className="tbl__btn"
                      disabled={busy}
                      onClick={() => void act({ type: 'exportTable', tableId: tbl.id })}
                    >
                      <span className="tbl__num">{i + 1}</span>
                      <span className="tbl__name">{tbl.caption ?? t('untitled')}</span>
                      <span className="tbl__dim mono">
                        {tbl.rows} × {tbl.cols}
                      </span>
                      <span className="tbl__arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                    {warningsOf(tbl, t).length > 0 && (
                      <p className="tbl__warn">{warningsOf(tbl, t).join(' · ')}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="btnrow">
              <Button
                variant="ghost"
                disabled={busy || inv.tables.length === 0}
                onClick={() => void act({ type: 'exportTable' })}
              >
                {t('pickOnPage')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || inv.tables.length < 2}
                onClick={() => void act({ type: 'exportAllTables' })}
              >
                {t('allTables')} →
              </Button>
            </div>
          </section>

          <section>
            <h2>{t('images')} · {inv.images.total}</h2>
            <p className="line">{t('largerThan200', { n: inv.images.largerThan200 })}</p>
            <div className="btnrow">
              <Button
                variant="ghost"
                disabled={busy || inv.images.total === 0}
                onClick={() => void act({ type: 'pickImage' })}
              >
                {t('pickImageOnPage')}
              </Button>
            </div>
            {!hasContextMenus && (
              <p className="line dim">{t('noCtxImagesNote')}</p>
            )}
          </section>

          {inv.crossOriginFrames > 0 && (
            <Callout tone="warn" title={t('crossOriginTitle', { n: inv.crossOriginFrames })}>
              {t('crossOriginBody')}
            </Callout>
          )}
          {inv.closedShadowHosts > 0 && (
            <Callout tone="info" title={t('closedShadowTitle', { n: inv.closedShadowHosts })}>
              {t('closedShadowBody')}
            </Callout>
          )}
        </>
      )}

      <footer className="foot">{t('footer')}</footer>
    </div>
  );
}

/** Warnings as TEXT, never colour alone (WCAG 1.4.1 — PLAN.md §18a). */
function warningsOf(tbl: TableModel, t: ReturnType<typeof useT>): string[] {
  const w: string[] = [];
  if (tbl.hasMergedCells > 0) w.push(t('warnMerged'));
  if (tbl.hasNestedTables > 0) w.push(t('warnNested'));
  if (tbl.looksLikeLayout) w.push(t('warnLayout'));
  if (tbl.virtualized) w.push(t('warnVirtualized'));
  return w;
}
