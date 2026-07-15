import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Badge, Button, Callout, Spinner, useLocale, type Locale } from '@blur/ui';
import { useT, nfmt, type MsgKey } from '../../../utils/i18n';
import {
  childrenOf,
  expandToDepth,
  pathOf,
  visibleRows,
  type FlatNode,
} from '../../../utils/core/tree';
import {
  convert,
  convertSubtree,
  HARD_MAX_BYTES,
  inspectValue,
  MAX_SEARCH_BYTES,
  reformat,
  searchPath,
  searchText,
  SOFT_MAX_BYTES,
} from '../../../utils/format';
import { isCancelled, type RunningJob } from '../../../utils/worker/client';
import {
  applyHighlights,
  clearHighlights,
  highlightSupported,
} from '../../../utils/highlight';
import { formatBytes, type DocApi } from '../../../utils/document';
import {
  EXAMPLE_CSV,
  EXAMPLE_JSON,
  EXAMPLE_XML,
  EXAMPLE_YAML,
} from '../../../utils/examples';
import {
  FORMAT_LABELS,
  type ConversionResult,
  type DocFormat,
  type ParsedDoc,
  type ParseFailure,
} from '../../../utils/types';
import type { DevdataPrefs, FormatPref } from '../../../utils/storage';

// The Data tab — the core workspace (design §2.3–§2.5).
//
// Format is a PROPERTY of the document (a chip with autodetect + a one-click
// override), not a tab: six formats × four states would be twenty-four tabs and
// a lost user (§1.3). Conversion is an ACTION over the document, shown as a
// split view with a MANDATORY warnings panel (§2.5) — silently losing data in a
// conversion is the same class of lie as a fake statistic.
//
// Rendering strategy (§10.1): the tree and the text pane are virtualised to a
// ~200-row window; the text pane is ONE flat <pre> coloured through the CSS
// Custom Highlight API. No generated <span>s, hence no HTML-injection surface
// and no 40 000-node DOM.

const ROW_H = 22;
const LINE_H = 19;
const OVERSCAN = 20;
/** Above this we stop rendering the whole text at once and virtualise (no wrap). */
const WRAP_LIMIT = 200_000;

const FORMAT_OPTIONS: FormatPref[] = [
  'auto',
  'json',
  'json5',
  'jsonc',
  'yaml',
  'xml',
  'csv',
];

const CONVERT_TARGETS: DocFormat[] = ['json', 'yaml', 'xml', 'csv', 'json5'];

type ViewMode = 'tree' | 'text' | 'both';

export function DataTab({
  prefs,
  doc,
  onOpenJwt,
  revealPath,
}: {
  prefs: DevdataPrefs | null;
  doc: DocApi;
  onOpenJwt: (token: string) => void;
  /** A JSONPath the Schema tab asked us to reveal ("Show in data"). */
  revealPath?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [dragging, setDragging] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      void openFile(files, doc, setFileNote, t, locale);
    },
    [doc, t, locale],
  );

  return (
    <div
      className={dragging ? 'data data--drag' : 'data'}
      // The drop zone is the WHOLE tab, not a small rectangle: hitting a small
      // target with a file in hand is misery (design §4.2).
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="dropoverlay" aria-hidden="true">
          {t('data.dropOverlay')}
        </div>
      )}

      {doc.jwtOffer !== null && (
        <Callout tone="warn" title={t('data.jwtOfferTitle')}>
          {t('data.jwtOfferBody1')}
          <span className="mono">alg</span>
          {t('data.jwtOfferBody2')}
          <div className="row row--gap">
            <Button
              variant="primary"
              onClick={() => {
                const token = doc.jwtOffer;
                doc.dismissJwtOffer();
                if (token) onOpenJwt(token);
              }}
            >
              {t('data.openInJwtTab')}
            </Button>
            <Button onClick={doc.dismissJwtOffer}>{t('data.dontOpen')}</Button>
          </div>
        </Callout>
      )}

      {doc.oversize !== null && (
        <Callout
          tone="warn"
          title={t('data.oversizeTitle', { size: formatBytes(doc.oversize.bytes, locale) })}
        >
          {t('data.oversizeBody', { soft: formatBytes(SOFT_MAX_BYTES, locale) })}
          <div className="row row--gap">
            <Button variant="primary" onClick={doc.confirmOversize}>
              {t('common.open')}
            </Button>
            <Button onClick={doc.cancelOversize}>{t('common.cancel')}</Button>
          </div>
        </Callout>
      )}

      {fileNote !== null && <Callout tone="info">{fileNote}</Callout>}
      {doc.saveNote !== null && <Callout tone="warn">{doc.saveNote}</Callout>}

      {doc.state.phase === 'empty' && <EmptyView doc={doc} onFileNote={setFileNote} />}
      {doc.state.phase === 'loading' && (
        <LoadingView label={doc.state.label} onCancel={doc.state.cancel} />
      )}
      {doc.state.phase === 'failed' && (
        <FailureView failure={doc.state.failure} doc={doc} />
      )}
      {doc.state.phase === 'fatal' && (
        <FatalView
          message={doc.state.message}
          text={doc.state.text}
          onText={(t) => doc.load(t, { format: 'json' })}
          onReset={doc.reset}
        />
      )}
      {doc.state.phase === 'ready' && prefs !== null && (
        <Ready
          doc={doc}
          parsed={doc.state.doc}
          prefs={prefs}
          revealPath={revealPath ?? null}
        />
      )}
    </div>
  );
}

/* ------------------------------- file input ------------------------------- */

async function openFile(
  files: File[],
  doc: DocApi,
  setNote: (n: string | null) => void,
  t: (k: MsgKey, v?: Record<string, string | number>) => string,
  locale: Locale,
): Promise<void> {
  const file = files[0];
  if (!file) return;
  if (files.length > 1) {
    // Silently taking the first of ten is also a lie (design §4.2).
    setNote(t('data.openFileMulti', { name: file.name, count: files.length - 1 }));
  } else {
    setNote(null);
  }
  if (file.size > HARD_MAX_BYTES) {
    setNote(
      t('data.fileTooBig', {
        size: formatBytes(file.size, locale),
        limit: formatBytes(HARD_MAX_BYTES, locale),
      }),
    );
    return;
  }
  try {
    const text = await file.text();
    // The extension is a HINT for the detector, never a verdict — a .txt full of
    // JSON parses as JSON (design §4.2).
    doc.load(text, { name: file.name, format: formatFromName(file.name) });
  } catch (err) {
    setNote(t('data.fileReadFail', { error: err instanceof Error ? err.message : String(err) }));
  }
}

function formatFromName(name: string): FormatPref | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'json':
    case 'geojson':
      return 'json';
    case 'jsonc':
      return 'jsonc';
    case 'json5':
      return 'json5';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'xml':
    case 'svg':
    case 'rss':
      return 'xml';
    case 'csv':
    case 'tsv':
      return 'csv';
    default:
      return undefined; // let autodetect decide
  }
}

/* --------------------------------- states -------------------------------- */

function EmptyView({
  doc,
  onFileNote,
}: {
  doc: DocApi;
  onFileNote: (n: string | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="empty">
      <div className="dropzone">
        <p className="dropzone__title">{t('data.dropTitle')}</p>
        <Button variant="primary" onClick={() => input.current?.click()}>
          {t('data.chooseFile')}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            void openFile(files, doc, onFileNote, t, locale);
            e.target.value = '';
          }}
        />
        <p className="dropzone__formats mono">JSON · JSON5 · JSONC · YAML · XML · CSV · JWT</p>
      </div>
      <p className="empty__note">
        {t('data.emptyNote', { soft: formatBytes(SOFT_MAX_BYTES, locale) })}
      </p>
      <div className="row row--gap">
        <span className="empty__examplelabel">{t('data.examples')}</span>
        <button className="chip" type="button" onClick={() => doc.load(EXAMPLE_JSON, { format: 'json' })}>
          JSON
        </button>
        <button className="chip" type="button" onClick={() => doc.load(EXAMPLE_YAML, { format: 'yaml' })}>
          YAML
        </button>
        <button className="chip" type="button" onClick={() => doc.load(EXAMPLE_XML, { format: 'xml' })}>
          XML
        </button>
        <button className="chip" type="button" onClick={() => doc.load(EXAMPLE_CSV, { format: 'csv' })}>
          CSV
        </button>
      </div>
    </div>
  );
}

function LoadingView({ label, onCancel }: { label: string; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="loading" role="status" aria-live="polite">
      <Spinner label={label} />
      {/* No fabricated percentage. We do not know how far a parser has got, and
          inventing "87%" is exactly the fake-number bug the house rules exist to
          prevent (design §5.1). */}
      <p className="fine">{t('data.loadingNote')}</p>
      <Button onClick={onCancel}>{t('data.cancelParse')}</Button>
    </div>
  );
}

function FailureView({ failure, doc }: { failure: ParseFailure; doc: DocApi }) {
  const t = useT();
  const from = Math.max(0, failure.line - 3);
  const window = useMemo(() => {
    // Bounded slice: NEVER split the whole document (it can be 40 MB) just to
    // show ~5 lines. Walk forward to the start of the first context line, then
    // read at most `to - from` lines — we touch only a small window of the
    // string, never the whole thing.
    const to = failure.line + 2; // exclusive; ~5 lines around the error
    const { text } = failure;
    let offset = 0;
    for (let ln = 0; ln < from; ln += 1) {
      const nl = text.indexOf('\n', offset);
      if (nl === -1) {
        offset = text.length;
        break;
      }
      offset = nl + 1;
    }
    const out: string[] = [];
    for (let ln = from; ln < to && offset <= text.length; ln += 1) {
      const nl = text.indexOf('\n', offset);
      if (nl === -1) {
        out.push(text.slice(offset));
        break;
      }
      out.push(text.slice(offset, nl));
      offset = nl + 1;
    }
    return out;
  }, [failure, from]);

  return (
    <div className="parse-error">
      <p className="parse-error__status" role="alert">
        <Badge severity="poor">{t('data.parseErrorBadge')}</Badge>{' '}
        {t('data.lineColumn', { line: failure.line, column: failure.column })}
      </p>

      <pre className="mono errbox">
        {window
          .map((line, i) => {
            const n = from + i + 1;
            const marker =
              n === failure.line
                ? `\n${' '.repeat(String(n).length + 2 + failure.column - 1)}^ ${t('data.lineColumn', { line: failure.line, column: failure.column })}`
                : '';
            return `${String(n).padStart(4, ' ')}  ${line}${marker}`;
          })
          .join('\n')}
      </pre>

      <p className="parse-error__msg">✗ {failure.message}</p>

      {failure.suggestions.length > 0 && (
        <>
          <p className="fine">{t('data.suggestions')}</p>
          <div className="row row--gap">
            {failure.suggestions.map((s) => (
              <Button key={s.id} onClick={() => doc.reparseAs(s.id)}>
                {s.label}
              </Button>
            ))}
          </div>
        </>
      )}

      {failure.partial && failure.partial.length > 0 && (
        <section className="partial">
          <h2 className="ui-section-heading">{t('data.parsedUpToError')}</h2>
          <p className="fine">{t('data.parsedUpToErrorNote')}</p>
          <ul className="partial__list mono">
            {failure.partial.slice(0, 40).map((node, i) => (
              <li key={i} style={{ paddingLeft: `${node.depth * 14}px` }}>
                {node.key ?? (node.index !== null ? `[${node.index}]` : '$')} {node.preview}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="row row--gap">
        <Button onClick={doc.reset}>{t('data.startOver')}</Button>
      </div>
    </div>
  );
}

function FatalView({
  message,
  text,
  onText,
  onReset,
}: {
  message: string;
  text: string;
  onText: (text: string) => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="parse-error">
      <p className="parse-error__status" role="alert">
        <Badge severity="poor">{t('data.fatalBadge')}</Badge>
      </p>
      <p className="parse-error__msg">{message}</p>
      <p className="fine">{t('data.whatToDo')}</p>
      <div className="row row--gap">
        {text !== '' && <Button onClick={() => onText(text)}>{t('common.retry')}</Button>}
        <Button onClick={onReset}>{t('data.openAnother')}</Button>
      </div>
      <Callout tone="info">{t('data.fatalNote')}</Callout>
    </div>
  );
}

/* ---------------------------------- ready --------------------------------- */

function Ready({
  doc,
  parsed,
  prefs,
  revealPath,
}: {
  doc: DocApi;
  parsed: ParsedDoc;
  prefs: DevdataPrefs;
  revealPath: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(() =>
    expandToDepth(parsed.tree, prefs.expandDepth),
  );
  const [mode, setMode] = useState<ViewMode>('both');
  const [conversion, setConversion] = useState<ConversionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [gotoLine, setGotoLine] = useState<number | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const jobRef = useRef<RunningJob<ConversionResult> | null>(null);

  // A new document ⇒ a fresh tree state.
  useEffect(() => {
    setSelected(0);
    setExpanded(expandToDepth(parsed.tree, prefs.expandDepth));
    setConversion(null);
    setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  useEffect(() => () => jobRef.current?.cancel(), []);

  const rows = useMemo(() => visibleRows(parsed.tree, expanded), [parsed.tree, expanded]);
  const inspected = useMemo(
    () => inspectValue(parsed, selected, locale),
    [parsed, selected, locale],
  );

  const hits = useMemo(() => {
    if (query === '' || query.startsWith('$')) return [];
    return searchText(parsed, query);
  }, [parsed, query]);

  const searchDisabled = parsed.text.length > MAX_SEARCH_BYTES;

  const runConvert = useCallback(
    (to: DocFormat, subtreePath?: string) => {
      setBusy(true);
      setConvertError(null);
      jobRef.current?.cancel();
      const job = subtreePath
        ? convertSubtree(parsed, subtreePath, to, prefs)
        : convert(parsed, to, prefs);
      jobRef.current = job;
      job.promise.then(
        (result) => {
          jobRef.current = null;
          setBusy(false);
          setConversion(result);
        },
        (err: unknown) => {
          jobRef.current = null;
          setBusy(false);
          if (isCancelled(err)) return;
          setConvertError(err instanceof Error ? err.message : String(err));
        },
      );
    },
    [parsed, prefs],
  );

  const copy = useCallback(
    async (value: string, toastKey: MsgKey) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopyState(t(toastKey));
      } catch {
        // NEVER show "Copied" without checking the promise (design §8).
        setCopyState(t('data.clipboardUnavailable'));
      }
      setTimeout(() => setCopyState(null), 1800);
    },
    [t],
  );

  const beautify = useCallback(
    (minify: boolean) => {
      setBusy(true);
      setConvertError(null);
      // Re-serialising 50 MB is Worker work: doing it here would freeze the tab.
      const job = reformat(parsed, prefs, {
        indent: minify ? 'min' : prefs.indent === 'min' ? '2' : prefs.indent,
      });
      job.promise.then(
        (text) => {
          setBusy(false);
          doc.replaceText(text, 'json');
        },
        (err: unknown) => {
          setBusy(false);
          if (isCancelled(err)) return;
          setConvertError(err instanceof Error ? err.message : String(err));
        },
      );
    },
    [parsed, prefs, doc],
  );

  const reveal = useCallback(
    (path: string) => {
      const found = searchPath(parsed.tree, path);
      if (!found) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of found.reveal) next.add(a);
        return next;
      });
      setSelected(found.index);
      const line = parsed.tree[found.index]?.line;
      if (line) setGotoLine(line);
    },
    [parsed.tree],
  );

  // "Показать в данных" from the Schema tab (design §4.5 step 3).
  useEffect(() => {
    if (revealPath) reveal(revealPath);
  }, [revealPath, reveal]);

  return (
    <>
      <Toolbar
        parsed={parsed}
        prefs={prefs}
        doc={doc}
        busy={busy}
        mode={mode}
        setMode={setMode}
        onConvert={runConvert}
        onBeautify={beautify}
        onCopy={() => void copy(parsed.text, 'data.copiedDocument')}
        onDownload={() => download(parsed.text, parsed.name ?? `document.${parsed.format}`)}
      />

      <div className="statusline" aria-live="polite">
        {copyState !== null && <span className="fine">{copyState}</span>}
      </div>

      {parsed.truncated && (
        <Callout tone="warn" title={t('data.truncatedTitle')}>
          {t('data.truncatedBody')}
        </Callout>
      )}
      {parsed.notes.map((note) => (
        <Callout key={note} tone="info">
          {note}
        </Callout>
      ))}
      {convertError !== null && (
        <Callout tone="poor" title={t('data.convertErrorTitle')}>
          {convertError}
        </Callout>
      )}

      {conversion !== null ? (
        <ConversionView
          parsed={parsed}
          result={conversion}
          onBack={() => setConversion(null)}
          onAdopt={(text, format) => {
            setConversion(null);
            doc.replaceText(text, format);
          }}
          onConvertSubtree={(path, to) => runConvert(to, path)}
          onCopy={(text) => void copy(text, 'data.copiedResult')}
        />
      ) : (
        <div className={`workspace workspace--${mode}`}>
          {mode !== 'text' && (
            <TreePane
              tree={parsed.tree}
              rows={rows}
              expanded={expanded}
              setExpanded={setExpanded}
              selected={selected}
              setSelected={setSelected}
              onGotoLine={setGotoLine}
              onCopyValue={(v) => void copy(v, 'data.copiedValue')}
              onCopyPath={(p) => void copy(p, 'data.copiedPath')}
            />
          )}
          {mode !== 'tree' && (
            <TextPane
              parsed={parsed}
              wrap={prefs.wrap}
              lineNumbers={prefs.lineNumbers}
              query={query}
              setQuery={setQuery}
              hits={hits}
              hitIndex={hitIndex}
              setHitIndex={setHitIndex}
              searchDisabled={searchDisabled}
              gotoLine={gotoLine}
              onPath={reveal}
            />
          )}
          {inspected !== null && (
            <section className="inspector" aria-label={t('data.inspectorValue')}>
              <div className="inspector__head">
                <h2 className="ui-section-heading">{t('data.inspectorValue')}</h2>
                <code className="mono">{inspected.path}</code>
                <span className="grow" />
                <Button onClick={() => void copy(inspected.raw, 'data.copiedValue')}>
                  {t('common.copy')}
                </Button>
                <Button onClick={() => void copy(inspected.path, 'data.copiedPath')}>
                  {t('data.copyPath')}
                </Button>
              </div>
              <p className="inspector__value mono">{inspected.raw}</p>
              {inspected.precisionNote !== null && (
                <p className="inspector__note">
                  <Badge severity="warn">⚠</Badge> {inspected.precisionNote}
                </p>
              )}
              {inspected.exactnessNote !== null && (
                <p className="fine">{inspected.exactnessNote}</p>
              )}
              {inspected.lengthNote !== null && <p className="fine">{inspected.lengthNote}</p>}
            </section>
          )}
        </div>
      )}
    </>
  );
}

/* --------------------------------- toolbar -------------------------------- */

function Toolbar({
  parsed,
  prefs,
  doc,
  busy,
  mode,
  setMode,
  onConvert,
  onBeautify,
  onCopy,
  onDownload,
}: {
  parsed: ParsedDoc;
  prefs: DevdataPrefs;
  doc: DocApi;
  busy: boolean;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  onConvert: (to: DocFormat) => void;
  onBeautify: (minify: boolean) => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [menu, setMenu] = useState(false);
  const jsonFamily =
    parsed.format === 'json' || parsed.format === 'jsonc' || parsed.format === 'json5';

  // Badge honesty (design §5.1): "Valid" asserts the WHOLE document parsed
  // cleanly. When the tree was cut short (truncated) or CSV rows disagreed with
  // the header (a field-count mismatch note), that assertion is false — the
  // document was merely *parsed*, not validated. Soften the label in that case.
  // NOTE: the CSV note is produced by the Worker (always Russian), so this string
  // check is language-independent and the invariant holds regardless of UI locale.
  const csvMismatch = parsed.notes.some((n) => n.includes('число полей не совпадает'));
  const clean = !parsed.truncated && !csvMismatch;

  const viewLabel = (m: ViewMode) =>
    m === 'tree' ? t('data.viewTree') : m === 'text' ? t('data.viewText') : t('data.viewBoth');

  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <label className="field">
          {t('data.formatLabel')}
          <select
            value={parsed.format}
            onChange={(e) => {
              const value = e.target.value as FormatPref;
              if (value === 'auto') doc.load(parsed.text);
              else doc.reparseAs(value);
            }}
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f === 'auto' ? t('data.formatAutoRecheck') : FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        {parsed.autodetected && (
          <span className="fine" title={t('data.autoBadgeTitle')}>
            {t('data.autoBadge')}
          </span>
        )}
        <span className="stats mono">
          {t('data.stats', {
            size: formatBytes(parsed.bytes, locale),
            lines: nfmt(locale, parsed.lines),
            nodes: nfmt(locale, parsed.tree.length),
          })}
        </span>
        <span className="grow" />
        {clean ? (
          <Badge severity="ok">{t('data.badgeValid')}</Badge>
        ) : (
          <Badge severity="warn">{t('data.badgeParsed')}</Badge>
        )}
      </div>

      <div className="toolbar__row">
        <div className="segmented" role="group" aria-label={t('data.viewAria')}>
          {(['tree', 'text', 'both'] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'seg seg--active' : 'seg'}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {viewLabel(m)}
            </button>
          ))}
        </div>

        <Button disabled={busy} onClick={() => onBeautify(false)}>
          Beautify
        </Button>
        <Button disabled={busy} onClick={() => onBeautify(true)}>
          Minify
        </Button>
        {!jsonFamily && <span className="fine">{t('data.beautifyNote')}</span>}

        <span className="grow" />

        <div className="convert">
          <Button onClick={() => setMenu((v) => !v)} disabled={busy}>
            {t('data.convertTo')}
          </Button>
          {menu && (
            <ul className="menu" role="menu">
              {CONVERT_TARGETS.filter((f) => f !== parsed.format).map((f) => (
                <li key={f} role="none">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      onConvert(f);
                    }}
                  >
                    {FORMAT_LABELS[f]}
                    {f === 'csv' && <span className="fine">{t('data.csvFlat')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button disabled={busy} onClick={onCopy}>
          {t('common.copy')}
        </Button>
        <Button disabled={busy} onClick={onDownload}>
          {t('common.download')}
        </Button>
        <Button onClick={doc.reset}>{t('data.closeDocument')}</Button>
      </div>
    </div>
  );
}

/* -------------------------------- tree pane ------------------------------- */

function TreePane({
  tree,
  rows,
  expanded,
  setExpanded,
  selected,
  setSelected,
  onGotoLine,
  onCopyValue,
  onCopyPath,
}: {
  tree: FlatNode[];
  rows: number[];
  expanded: Set<number>;
  setExpanded: (fn: (prev: Set<number>) => Set<number>) => void;
  selected: number;
  setSelected: (i: number) => void;
  onGotoLine: (line: number) => void;
  onCopyValue: (value: string) => void;
  onCopyPath: (path: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const count = Math.ceil(height / ROW_H) + OVERSCAN * 2;
  const windowRows = rows.slice(start, start + count);

  // `aria-setsize`/`aria-posinset` need the sibling list. Computing it per
  // rendered row would be O(children) × 200 rows — on an array with 100 000
  // elements that is a 20-million-step scroll handler. Cache it per parent
  // instead: the ~200 visible rows share a handful of parents.
  const siblingCache = useRef(new Map<number, number[]>());
  useEffect(() => {
    siblingCache.current = new Map();
  }, [tree]);
  const siblingsOf = useCallback(
    (parent: number): number[] => {
      const cached = siblingCache.current.get(parent);
      if (cached) return cached;
      const list = childrenOf(tree, parent);
      siblingCache.current.set(parent, list);
      return list;
    },
    [tree],
  );

  const cursor = rows.indexOf(selected);

  const move = (delta: number) => {
    const next = rows[Math.min(rows.length - 1, Math.max(0, cursor + delta))];
    if (next === undefined) return;
    setSelected(next);
    const at = rows.indexOf(next) * ROW_H;
    const el = scroller.current;
    if (!el) return;
    if (at < el.scrollTop) el.scrollTop = at;
    else if (at + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = at + ROW_H - el.clientHeight;
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const node = tree[selected];
    if (!node) return;
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      if (event.shiftKey) onCopyPath(pathOf(tree, selected));
      else onCopyValue(node.raw ?? node.preview);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Home':
        event.preventDefault();
        setSelected(rows[0] ?? 0);
        if (scroller.current) scroller.current.scrollTop = 0;
        return;
      case 'End': {
        event.preventDefault();
        const last = rows[rows.length - 1];
        if (last !== undefined) setSelected(last);
        if (scroller.current) scroller.current.scrollTop = rows.length * ROW_H;
        return;
      }
      case 'ArrowRight':
        event.preventDefault();
        if (node.subtree > 0 && !expanded.has(selected)) {
          setExpanded((prev) => new Set(prev).add(selected));
        } else {
          move(1);
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        // WAI-ARIA tree semantics: collapse, or step out to the parent.
        if (node.subtree > 0 && expanded.has(selected)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(selected);
            return next;
          });
        } else if (node.parent >= 0) {
          setSelected(node.parent);
        }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (node.line) onGotoLine(node.line);
        if (node.subtree > 0) {
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(selected)) next.delete(selected);
            else next.add(selected);
            return next;
          });
        }
        return;
      default:
    }
  };

  return (
    <section className="pane pane--tree" aria-label={t('data.viewTree')}>
      <div className="pane__head">
        <h2 className="ui-section-heading">{t('data.viewTree')}</h2>
        <span className="fine">{t('data.visibleNodes', { count: nfmt(locale, rows.length) })}</span>
      </div>
      {/* ONE tab stop for the whole tree (roving tabindex) — not 40 000. */}
      <div
        ref={scroller}
        className="tree"
        role="tree"
        aria-label={t('data.treeStructureAria')}
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div style={{ height: `${rows.length * ROW_H}px`, position: 'relative' }}>
          <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
            {windowRows.map((i) => {
              const node = tree[i];
              if (!node) return null;
              return (
                <TreeRow
                  key={i}
                  node={node}
                  index={i}
                  siblings={node.parent >= 0 ? siblingsOf(node.parent) : ROOT_SIBLINGS}
                  selected={i === selected}
                  expanded={expanded.has(i)}
                  onSelect={() => {
                    setSelected(i);
                    if (node.line) onGotoLine(node.line);
                  }}
                  onToggle={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      </div>
      <p className="fine">{t('data.treeControls')}</p>
    </section>
  );
}

const KIND_MARK: Record<FlatNode['kind'], string> = {
  object: '{}',
  array: '[]',
  string: '"',
  number: '#',
  bool: 'T/F',
  null: '∅',
};

const ROOT_SIBLINGS = [0];

function TreeRow({
  node,
  index,
  siblings,
  selected,
  expanded,
  onSelect,
  onToggle,
}: {
  node: FlatNode;
  index: number;
  /** Pre-computed and cached by TreePane — never derived per row (O(n²) trap). */
  siblings: number[];
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={node.subtree > 0 ? expanded : undefined}
      aria-selected={selected}
      aria-setsize={siblings.length}
      aria-posinset={Math.max(1, siblings.indexOf(index) + 1)}
      className={selected ? 'trow trow--sel' : 'trow'}
      style={{ paddingLeft: `${node.depth * 14 + 4}px`, height: `${ROW_H}px` }}
      onClick={onSelect}
    >
      <span
        className="trow__caret"
        aria-hidden="true"
        onClick={(e) => {
          if (node.subtree === 0) return;
          e.stopPropagation();
          onToggle();
        }}
      >
        {node.subtree > 0 ? (expanded ? '▾' : '▸') : '·'}
      </span>
      {/* Type is a TYPOGRAPHIC marker, not a colour (WCAG 1.4.1, design §9.2). */}
      <span className="trow__mark mono" aria-hidden="true">
        {KIND_MARK[node.kind]}
      </span>
      {node.key !== null && <span className="trow__key">{node.key}</span>}
      {node.index !== null && <span className="trow__key mono">[{node.index}]</span>}
      <span className="trow__preview mono">{node.preview}</span>
    </div>
  );
}

/* -------------------------------- text pane ------------------------------- */

function TextPane({
  parsed,
  wrap,
  lineNumbers,
  query,
  setQuery,
  hits,
  hitIndex,
  setHitIndex,
  searchDisabled,
  gotoLine,
  onPath,
}: {
  parsed: ParsedDoc;
  wrap: boolean;
  lineNumbers: boolean;
  query: string;
  setQuery: (q: string) => void;
  hits: { offset: number; line: number }[];
  hitIndex: number;
  setHitIndex: (i: number) => void;
  searchDisabled: boolean;
  gotoLine: number | null;
  onPath: (path: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);
  const supported = useMemo(() => highlightSupported(), []);

  // Wrapping breaks fixed-height virtualisation (a wrapped line is not one row
  // tall), so wrap only applies to documents small enough to render whole.
  const whole = wrap && parsed.text.length <= WRAP_LIMIT;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (gotoLine === null || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (gotoLine - 3) * LINE_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoLine]);

  useEffect(() => {
    const hit = hits[hitIndex];
    if (!hit || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (hit.line - 3) * LINE_H);
  }, [hits, hitIndex]);

  const totalLines = parsed.lines;
  const start = whole ? 0 : Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
  const count = whole
    ? totalLines
    : Math.min(totalLines - start, Math.ceil(height / LINE_H) + OVERSCAN * 2);

  const windowStart = parsed.lineStarts[start] ?? 0;
  const endLine = start + count;
  const windowEnd =
    endLine >= totalLines ? parsed.text.length : (parsed.lineStarts[endLine] ?? parsed.text.length);
  const windowText = parsed.text.slice(windowStart, windowEnd);

  const gutter = useMemo(() => {
    if (!lineNumbers) return '';
    const out: string[] = [];
    for (let i = start; i < endLine; i += 1) out.push(String(i + 1));
    return out.join('\n');
  }, [lineNumbers, start, endLine]);

  // Colouring: Highlight API over the ONE text node of the <pre>. No <span>s.
  useEffect(() => {
    if (!supported) return;
    const node = pre.current?.firstChild;
    if (!(node instanceof Text)) return;
    const windowHits = hits
      .map((h) => ({ start: h.offset - windowStart, end: h.offset - windowStart + query.length }))
      .filter((h) => h.start >= 0 && h.end <= windowText.length);
    const cur = hits[hitIndex];
    applyHighlights({
      node,
      text: windowText,
      format: parsed.format,
      hits: windowHits,
      current:
        cur && cur.offset >= windowStart && cur.offset + query.length <= windowEnd
          ? { start: cur.offset - windowStart, end: cur.offset - windowStart + query.length }
          : null,
    });
    return () => clearHighlights();
  }, [supported, windowText, windowStart, windowEnd, parsed.format, hits, hitIndex, query]);

  const isPath = query.startsWith('$');

  return (
    <section className="pane pane--text" aria-label={t('data.viewText')}>
      <div className="pane__head">
        <h2 className="ui-section-heading">{t('data.viewText')}</h2>
        <div className="searchbox">
          <input
            className="search"
            type="search"
            value={query}
            disabled={searchDisabled}
            placeholder={
              searchDisabled ? t('data.searchDisabledPlaceholder') : t('data.searchPlaceholder')
            }
            aria-label={t('data.searchAria')}
            onChange={(e) => {
              setQuery(e.target.value);
              setHitIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (isPath) onPath(query);
              else if (hits.length > 0) setHitIndex((hitIndex + 1) % hits.length);
            }}
          />
          <span className="fine" role="status" aria-live="polite">
            {searchDisabled
              ? `> ${formatBytes(MAX_SEARCH_BYTES, locale)}`
              : isPath
                ? t('data.searchEnterPath')
                : query === ''
                  ? ''
                  : hits.length === 0
                    ? t('data.searchNoMatches')
                    : t('data.searchCount', { index: hitIndex + 1, total: hits.length })}
          </span>
        </div>
      </div>

      <div
        ref={scroller}
        className="textpane"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div
          style={{
            height: whole ? undefined : `${totalLines * LINE_H}px`,
            position: 'relative',
          }}
        >
          <div
            className="textpane__win"
            style={{
              transform: whole ? undefined : `translateY(${start * LINE_H}px)`,
            }}
          >
            {lineNumbers && (
              <pre className="code__gutter mono" aria-hidden="true">
                {gutter}
              </pre>
            )}
            {/* ONE text node. Colour comes from ::highlight() ranges. */}
            <pre
              ref={pre}
              className={whole ? 'code__body code__body--wrap mono' : 'code__body mono'}
            >
              {windowText}
            </pre>
          </div>
        </div>
      </div>

      <p className="fine">
        {!supported && t('data.highlightUnavailable')}
        {!whole && t('data.windowedNote')}
        {wrap && !whole && t('data.wrapOffNote')}
      </p>
    </section>
  );
}

/* ------------------------------ conversion view --------------------------- */

function ConversionView({
  parsed,
  result,
  onBack,
  onAdopt,
  onConvertSubtree,
  onCopy,
}: {
  parsed: ParsedDoc;
  result: ConversionResult;
  onBack: () => void;
  onAdopt: (text: string, format: DocFormat) => void;
  onConvertSubtree: (path: string, to: DocFormat) => void;
  onCopy: (text: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);

  if (result.refusal !== null) {
    return (
      <div className="conversion">
        <div className="conversion__head">
          <strong>
            {FORMAT_LABELS[result.from]} → {FORMAT_LABELS[result.to]}
          </strong>
          <span className="grow" />
          <Button onClick={onBack}>{t('data.backTo', { format: FORMAT_LABELS[result.from] })}</Button>
        </div>
        <Callout tone="poor" title={t('data.conversionRefusalTitle')}>
          {result.refusal}
          {result.candidates.length > 0 && (
            <>
              <p className="fine">{t('data.arraysFound')}</p>
              <div className="row row--gap">
                {result.candidates.map((path) => (
                  <Button key={path} onClick={() => onConvertSubtree(path, result.to)}>
                    {path}
                  </Button>
                ))}
              </div>
            </>
          )}
          {result.candidates.length === 0 && <p className="fine">{t('data.noArrays')}</p>}
        </Callout>
      </div>
    );
  }

  return (
    <div className="conversion">
      <div className="conversion__head">
        <strong>
          {FORMAT_LABELS[result.from]} → {FORMAT_LABELS[result.to]}
        </strong>
        <span className="grow" />
        <Button onClick={onBack}>{t('data.backTo', { format: FORMAT_LABELS[result.from] })}</Button>
        <Button onClick={() => onCopy(result.text)}>{t('common.copy')}</Button>
        <Button onClick={() => download(result.text, `document.${result.to}`)}>
          {t('common.download')}
        </Button>
        <Button variant="primary" onClick={() => onAdopt(result.text, result.to)}>
          {t('data.makeDocument', { format: FORMAT_LABELS[result.to] })}
        </Button>
      </div>

      <div className="conversion__panes">
        <pre className="code mono">{parsed.text.slice(0, 100_000)}</pre>
        <pre className="code mono">{result.text.slice(0, 100_000)}</pre>
      </div>

      {/* The lossy-conversion panel is MANDATORY (design §2.5). */}
      <div className="warns">
        <button
          type="button"
          className="warns__head"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {result.warnings.length === 0 ? (
            <Badge severity="ok">{t('data.noLossDetected')}</Badge>
          ) : (
            <Badge severity="warn">
              {t('data.conversionWarnings', { count: result.warnings.length })}
            </Badge>
          )}
          <span className="fine">{expanded ? t('data.collapse') : t('data.expand')}</span>
        </button>
        {expanded && result.warnings.length > 0 && (
          <ul className="warns__list">
            {result.warnings.map((w, i) => (
              <li key={i} className={`warns__item warns__item--${w.severity}`}>
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- download ------------------------------- */

function download(text: string, name: string): void {
  // `<a download>` + object URL. No `downloads` permission is taken — it is not
  // needed, and taking a permission we do not need is a store rejection waiting
  // to happen (design §8, §11).
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
