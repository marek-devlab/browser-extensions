import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, EmptyState, ErrorState, Spinner, ThemeToggle } from '@blur/ui';
import { useExportTheme } from '../../utils/theme';
import { NoPageAccess, runOnActiveTab } from '../../utils/inject';
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
      setError(
        e instanceof NoPageAccess
          ? e.message
          : 'Не удалось прочитать страницу. Перезагрузите её и попробуйте снова.',
      );
    }
  }, []);

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
          <h1>💾 Экспорт контента</h1>
          <ThemeToggle theme={theme ?? 'auto'} onChange={setTheme} />
        </div>
        <span className="host mono" title={inv?.host}>
          {inv?.host ?? '…'}
        </span>
      </header>

      {error ? (
        <ErrorState message={error} retry={() => void scan()} />
      ) : !inv ? (
        <Spinner label="Читаю страницу…" />
      ) : nothing ? (
        <EmptyState
          title="На этой странице нечего экспортировать"
          hint={
            <>
              Выделите текст{hasContextMenus ? ' и нажмите правой кнопкой' : ' и откройте это меню снова'},
              или откройте страницу с таблицей. Таблицы, которые страница рисует не тегом
              &lt;table&gt; (div-«таблицы», Canvas), мы не видим — это честное ограничение,
              а не поломка.
            </>
          }
        />
      ) : (
        <>
          {inv.selection && (
            <section>
              <h2>Выделение</h2>
              <p className="line">
                {inv.selection.chars.toLocaleString('ru-RU')} символов,{' '}
                {inv.selection.paragraphs}{' '}
                {inv.selection.paragraphs === 1 ? 'абзац' : 'абзаца'}
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
                  Копировать как MD
                </Button>
              </div>
            </section>
          )}

          <section>
            <h2>Таблицы · {inv.tables.length}</h2>
            {inv.tables.length === 0 ? (
              <p className="line dim">
                Тегов &lt;table&gt; на странице нет. Данные, нарисованные через div или
                Canvas, мы не видим.
              </p>
            ) : (
              <ul className="tables">
                {inv.tables.map((t, i) => (
                  <li key={t.id} className="tbl">
                    <button
                      className="tbl__btn"
                      disabled={busy}
                      onClick={() => void act({ type: 'exportTable', tableId: t.id })}
                    >
                      <span className="tbl__num">{i + 1}</span>
                      <span className="tbl__name">{t.caption ?? 'без названия'}</span>
                      <span className="tbl__dim mono">
                        {t.rows} × {t.cols}
                      </span>
                      <span className="tbl__arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                    {warningsOf(t).length > 0 && (
                      <p className="tbl__warn">{warningsOf(t).join(' · ')}</p>
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
                Выбрать на странице
              </Button>
              <Button
                variant="ghost"
                disabled={busy || inv.tables.length < 2}
                onClick={() => void act({ type: 'exportAllTables' })}
              >
                Все таблицы →
              </Button>
            </div>
          </section>

          <section>
            <h2>Картинки · {inv.images.total}</h2>
            <p className="line">крупнее 200×200: {inv.images.largerThan200}</p>
            <div className="btnrow">
              <Button
                variant="ghost"
                disabled={busy || inv.images.total === 0}
                onClick={() => void act({ type: 'pickImage' })}
              >
                Выбрать картинку на странице
              </Button>
            </div>
            {!hasContextMenus && (
              <p className="line dim">
                На этом устройстве контекстного меню нет — все действия с картинками
                (копировать URL, открыть, сохранить) доступны отсюда.
              </p>
            )}
          </section>

          {inv.crossOriginFrames > 0 && (
            <Callout
              tone="warn"
              title={`⚠ ${inv.crossOriginFrames} встроенных фрейма (iframe) с чужого домена`}
            >
              Их содержимое прочитать нельзя — для этого нужен доступ к чужим сайтам, а
              мы его не просим. Откройте фрейм как обычную страницу, и всё заработает.
            </Callout>
          )}
          {inv.closedShadowHosts > 0 && (
            <Callout
              tone="info"
              title={`⚠ ${inv.closedShadowHosts} компонент(а) со скрытым (closed) содержимым`}
            >
              Closed shadow DOM недостижим ни для кого, включая нас. Это ограничение
              платформы, и мы его называем.
            </Callout>
          )}
        </>
      )}

      <footer className="foot">
        Ничего не уходит в сеть. Файл собирается у вас в браузере.
      </footer>
    </div>
  );
}

/** Warnings as TEXT, never colour alone (WCAG 1.4.1 — PLAN.md §18a). */
function warningsOf(t: TableModel): string[] {
  const w: string[] = [];
  if (t.hasMergedCells > 0) w.push('⚠ объединённые ячейки');
  if (t.hasNestedTables > 0) w.push('⚠ вложенные таблицы');
  if (t.looksLikeLayout) w.push('⚠ похоже на вёрстку, а не данные');
  if (t.virtualized) w.push('⚠ строки могут подгружаться при прокрутке');
  return w;
}
