import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, EmptyState, MockBadge, Spinner, ThemeToggle } from '@blur/ui';
import { useExportTheme } from '../../utils/theme';
import { scanPageInventory } from '../../utils/table-extract';
import { MOCK_INVENTORY_EMPTY } from '../../utils/mock-data';
import type { PageInventory, TableModel } from '../../utils/types';

// The popup is the INVENTORY, not an action bar (design §1.2/§2.4): "what can I
// pull off this page?" — 1 240-char selection, 3 tables, 48 images. There is no
// badge and no precomputed count (that would need a persistent content script,
// design §1.2), so this scans the page fresh on open. Every launch node also
// exists in the context menu — one funnel, two doors.
//
// SCAFFOLD: the scan returns MOCK data (utils/table-extract stub). The demo toggle
// at the bottom flips to the empty-page state so both are viewable.

export function App() {
  const { theme, setTheme } = useExportTheme();
  const [inv, setInv] = useState<PageInventory | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (empty) {
      setInv(MOCK_INVENTORY_EMPTY);
      return;
    }
    setInv(null);
    void scanPageInventory().then(setInv);
  }, [empty]);

  const nothing =
    inv &&
    !inv.selection &&
    inv.tables.length === 0 &&
    inv.images.total === 0;

  function openPreview(table: TableModel): void {
    void table;
    // Wire to the preview surface (in production engine.js mounts it on-page).
    void browser.tabs.create({ url: browser.runtime.getURL('/preview.html') });
  }

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

      <MockBadge />

      {!inv ? (
        <Spinner label="Читаю страницу…" />
      ) : nothing ? (
        <EmptyState
          title="На этой странице нечего экспортировать"
          hint={
            <>
              Выделите текст и нажмите правой кнопкой, или откройте страницу с
              таблицей. Таблицы, нарисованные не тегом &lt;table&gt; (div-«таблицы»,
              Canvas), мы не видим — это честное ограничение.
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
                {inv.selection.paragraphs} абзаца
              </p>
              <div className="btnrow">
                <Button variant="ghost">.md</Button>
                <Button variant="ghost">.txt</Button>
                <Button variant="ghost">Копировать как MD</Button>
              </div>
            </section>
          )}

          <section>
            <h2>Таблицы · {inv.tables.length}</h2>
            <ul className="tables">
              {inv.tables.map((t, i) => (
                <li key={t.id} className="tbl">
                  <button className="tbl__btn" onClick={() => openPreview(t)}>
                    <span className="tbl__num">{i + 1}</span>
                    <span className="tbl__name">{t.caption ?? 'без названия'}</span>
                    <span className="tbl__dim mono">
                      {t.rows} × {t.cols}
                    </span>
                    <span className="tbl__arrow" aria-hidden="true">→</span>
                  </button>
                  {(t.hasMergedCells > 0 || t.looksLikeLayout || t.virtualized) && (
                    <p className="tbl__warn">
                      {t.hasMergedCells > 0 && '⚠ объединённые ячейки '}
                      {t.looksLikeLayout && '⚠ похоже на вёрстку '}
                      {t.virtualized && '⚠ подгружается при прокрутке'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="btnrow">
              <Button variant="ghost">Выбрать на странице</Button>
              <Button variant="ghost">Все таблицы →</Button>
            </div>
          </section>

          <section>
            <h2>Картинки · {inv.images.total}</h2>
            <p className="line">крупнее 200×200: {inv.images.largerThan200}</p>
          </section>

          {inv.crossOriginFrames > 0 && (
            <Callout tone="warn" title={`⚠ ${inv.crossOriginFrames} таблицы во встроенных фреймах (iframe)`}>
              Прочитать их содержимое нельзя без доступа к чужим доменам. Можно
              открыть фрейм в новой вкладке.
            </Callout>
          )}
          {inv.closedShadowHosts > 0 && (
            <Callout tone="info" title={`⚠ ${inv.closedShadowHosts} компонент со скрытым (closed) содержимым`}>
              Closed shadow DOM недостижим ни для кого, включая нас.
            </Callout>
          )}
        </>
      )}

      <footer className="foot">
        Ничего не уходит в сеть. Файл собирается у вас в браузере.
      </footer>

      {/* Scaffold-only: flip between a populated page and the empty state. */}
      <label className="demo-toggle">
        <input type="checkbox" checked={empty} onChange={() => setEmpty((v) => !v)} />
        Демо: показать состояние «нечего экспортировать»
      </label>
    </div>
  );
}
