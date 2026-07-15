import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Spinner } from '@blur/ui';
import {
  applyReplacements,
  disposeRegex,
  runRegex,
  type RegexMatch,
  type RegexOutcome,
} from '../utils/regex-client';
import {
  DEFAULT_SLUG_OPTIONS,
  TRANSLIT_STANDARDS,
  TRANSLIT_SAMPLE,
  transliterate,
  translitExample,
  type SlugOptions,
} from '../utils/translit';
import { LIMITS } from '../utils/targets';
import { countText, type Counts } from '../utils/counter';
import { useT, type MsgKey } from '../utils/i18n';
import type { Settings, Target, TranslitStandard } from '../utils/types';

// The ToolDrawer (design §1.3, §2.5–2.7). ONE drawer, three tabs, always ABOVE
// the draft that is open right now.
//
// 🔴 SINGLE PURPOSE LIVES OR DIES HERE. None of these three has an icon, a popup,
// a command or a context-menu item of its own — the drawer cannot even be opened
// without the editor, and every tab reads and writes THE CURRENT DRAFT and
// nothing else. There is no "paste text here to test your regex" box: the input
// field IS the editor. That is the whole difference between us and regex101 in a
// wrapper (design §1.1, §1.3).

export type DrawerTab = 'find' | 'translit' | 'stats';

const TABS: { id: DrawerTab; label: MsgKey; glyph: string }[] = [
  { id: 'find', label: 'tab_find', glyph: '🔎' },
  { id: 'translit', label: 'tab_translit', glyph: '⇄' },
  { id: 'stats', label: 'tab_stats', glyph: '📊' },
];

/** Standard id → its translated label key (drop the hyphen: gost-b → gostb). */
function stdLabelKey(id: TranslitStandard): MsgKey {
  return `translit_${id.replace('-', '')}_label` as MsgKey;
}

export interface DrawerProps {
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  body: string;
  selection: { start: number; end: number };
  counts: Counts;
  settings: Settings;
  target: Target;
  /** Highlighted matches, lifted so EditorPane can paint them. */
  onMatches: (m: RegexMatch[], current: number) => void;
  onScrollTo: (offset: number) => void;
  /** One undo transaction: Replace All / translit apply. */
  onReplaceAll: (body: string, label: string) => void;
  onReplaceRange: (start: number, end: number, value: string) => void;
}

export function ToolDrawer(props: DrawerProps) {
  const { tab, onTab } = props;
  const t = useT();

  const onKeyNav = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((tb) => tb.id === tab);
    if (e.key === 'ArrowRight') onTab(TABS[(i + 1) % TABS.length].id);
    if (e.key === 'ArrowLeft') onTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
  };

  return (
    <section id="cw-drawer" className="cw-drawer" aria-label={t('drawer_aria')}>
      <div className="cw-tablist" role="tablist" aria-label={t('drawer_tools')} onKeyDown={onKeyNav}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            type="button"
            id={`cw-tab-${tb.id}`}
            aria-selected={tab === tb.id}
            aria-controls={tab === tb.id ? `cw-panel-${tb.id}` : undefined}
            tabIndex={tab === tb.id ? 0 : -1}
            className={tab === tb.id ? 'cw-tab cw-tab--active' : 'cw-tab'}
            onClick={() => onTab(tb.id)}
          >
            {tb.glyph} {t(tb.label)}
          </button>
        ))}
      </div>

      <div
        id={`cw-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`cw-tab-${tab}`}
        className="cw-panel"
      >
        {tab === 'find' && <FindReplace {...props} />}
        {tab === 'translit' && <Translit {...props} />}
        {tab === 'stats' && <Stats {...props} />}
      </div>
    </section>
  );
}

/* ── Find & Replace (design §2.5, §5.3, §5.4) ──────────────────────────────*/

function FindReplace({
  body,
  settings,
  onMatches,
  onScrollTo,
  onReplaceAll,
}: DrawerProps) {
  const t = useT();
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [useRegex, setUseRegex] = useState(true);
  const [flags, setFlags] = useState(settings.regexFlags);
  const [outcome, setOutcome] = useState<RegexOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);
  const [retry, setRetry] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findRef.current?.focus();
    return () => {
      onMatches([], 0);
      disposeRegex();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search. EVERY compile and match happens in the worker — the main
  // thread never touches `new RegExp` (design §8.1).
  useEffect(() => {
    if (pattern === '') {
      setOutcome(null);
      onMatches([], 0);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void runRegex(
        { pattern, flags, text: body, replacement, regex: useRegex },
        settings.regexTimeoutMs,
      ).then((o) => {
        setBusy(false);
        setOutcome(o);
        setCurrent(0);
        onMatches(o.status === 'ok' ? o.result.matches : [], 0);
      });
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, replacement, flags, useRegex, body, settings.regexTimeoutMs, retry]);

  const matches = outcome?.status === 'ok' ? outcome.result.matches : [];

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (current + delta + matches.length) % matches.length;
    setCurrent(next);
    onMatches(matches, next);
    onScrollTo(matches[next].start);
  };

  const replaceOne = () => {
    const m = matches[current];
    if (!m) return;
    onReplaceAll(applyReplacements(body, [m]), t('snap_before_replace'));
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    onReplaceAll(applyReplacements(body, matches), t('snap_before_replace_all', { n: matches.length }));
  };

  const lineOf = (offset: number) => body.slice(0, offset).split('\n').length;

  return (
    <div className="cw-find">
      <label className="cw-field">
        {t('find_label')}
        <input
          ref={findRef}
          className="cw-input mono"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          aria-label={t('find_pattern_aria')}
          aria-invalid={outcome?.status === 'invalid'}
          aria-describedby={outcome?.status === 'invalid' ? 'cw-regex-error' : undefined}
          placeholder={useRegex ? '(\\d{4})-(\\d{2})-(\\d{2})' : t('find_placeholder_text')}
        />
      </label>
      <label className="cw-field">
        {t('replace_label')}
        <input
          className="cw-input mono"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          aria-label={t('find_replace_aria')}
          placeholder="$3.$2.$1"
        />
      </label>

      <div className="cw-flags">
        <label>
          <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />{' '}
          Regex
        </label>
        {useRegex && (
          <>
            <span>{t('find_flags')}</span>
            {['g', 'i', 'm', 's', 'u', 'v'].map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={flags.includes(f)}
                  onChange={(e) =>
                    setFlags(e.target.checked ? flags + f : flags.split(f).join(''))
                  }
                />{' '}
                {f}
              </label>
            ))}
          </>
        )}
      </div>

      {busy && <Spinner label={t('find_searching')} />}

      {!busy && outcome?.status === 'ok' && (
        <>
          <p role="status">
            <Badge severity={matches.length > 0 ? 'ok' : 'info'}>
              {t('find_matches', { n: matches.length })}
            </Badge>
            {outcome.result.groupNames.length > 0 && (
              <span className="cw-hint"> {t('find_groups', { names: outcome.result.groupNames.join(', ') })}</span>
            )}
            {outcome.result.truncated && <span className="cw-hint"> · {t('find_truncated')}</span>}
          </p>

          {matches.length > 0 && replacement !== '' && (
            <>
              <p className="cw-hint">{t('find_preview_intro', { n: matches.length })}</p>
              <ul className="cw-preview-list mono">
                {matches.slice(0, 5).map((m, i) => (
                  <li key={i}>
                    {t('find_line_prefix')} {lineOf(m.start)} · {body.slice(m.start, m.end)} → {m.replaced}
                  </li>
                ))}
                {matches.length > 5 && <li>{t('find_more', { n: matches.length - 5 })}</li>}
              </ul>
            </>
          )}

          <div className="cw-actions">
            <Button onClick={() => step(-1)} disabled={matches.length === 0}>{t('btn_prev')}</Button>
            <Button onClick={() => step(1)} disabled={matches.length === 0}>{t('btn_next')}</Button>
            <Button onClick={replaceOne} disabled={matches.length === 0}>{t('btn_replace')}</Button>
            <Button variant="primary" onClick={replaceAll} disabled={matches.length === 0}>
              {t('btn_replace_all', { n: matches.length })}
            </Button>
          </div>
        </>
      )}

      {!busy && outcome?.status === 'invalid' && (
        <div role="alert" className="cw-invalid" id="cw-regex-error">
          <p>⚠️ {t(outcome.message as MsgKey)}</p>
          <p className="cw-hint">{t('find_literal_hint')}</p>
          <details>
            <summary>{t('find_error_original')}</summary>
            <pre className="mono">{outcome.original}</pre>
          </details>
        </div>
      )}

      {!busy && outcome?.status === 'timeout' && (
        <div role="alert" className="cw-invalid">
          <p>⚠️ {t('find_timeout', { ms: outcome.timeoutMs })}</p>
          <p className="cw-hint">{t('find_timeout_body')}</p>
          <ul className="cw-hint">
            <li>{t('find_timeout_li1')}</li>
            <li>{t('find_timeout_li2')}</li>
            <li>{t('find_timeout_li3')}</li>
          </ul>
          <div className="cw-actions">
            <Button onClick={() => findRef.current?.focus()}>{t('btn_edit_pattern')}</Button>
            <Button onClick={() => setRetry((n) => n + 1)}>{t('btn_retry')}</Button>
          </div>
        </div>
      )}

      {!busy && outcome?.status === 'error' && (
        <div role="alert" className="cw-invalid">
          <p>⚠️ {t(outcome.message as MsgKey)}</p>
        </div>
      )}
    </div>
  );
}

/* ── Transliteration (design §2.6) ─────────────────────────────────────────*/

function Translit({ body, selection, settings, onReplaceAll, onReplaceRange }: DrawerProps) {
  const t = useT();
  const [standard, setStandard] = useState<TranslitStandard>(settings.translitStandard);
  const hasSelection = selection.end > selection.start;
  const [scope, setScope] = useState<'selection' | 'draft'>(hasSelection ? 'selection' : 'draft');
  const [copied, setCopied] = useState(false);

  const slug: SlugOptions = {
    ...DEFAULT_SLUG_OPTIONS,
    separator: settings.slugSeparator,
    lowercase: settings.slugLowercase,
    maxLen: settings.slugMaxLen,
  };

  useEffect(() => {
    if (hasSelection) setScope('selection');
  }, [hasSelection]);

  const source =
    scope === 'selection' && hasSelection ? body.slice(selection.start, selection.end) : body;
  const result = useMemo(() => {
    try {
      return transliterate(source, standard, slug);
    } catch {
      return '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, standard, settings.slugSeparator, settings.slugLowercase, settings.slugMaxLen]);

  const sample = hasSelection ? body.slice(selection.start, selection.end) : TRANSLIT_SAMPLE;

  const apply = () => {
    if (scope === 'selection' && hasSelection) {
      onReplaceRange(selection.start, selection.end, result);
    } else {
      onReplaceAll(result, t('snap_before_translit_draft'));
    }
  };

  const insertBeside = () => {
    const at = scope === 'selection' && hasSelection ? selection.end : body.length;
    onReplaceRange(at, at, ` ${result}`);
  };

  return (
    <div className="cw-translit">
      <div className="cw-field">
        {t('translit_source')}
        <label>
          <input
            type="radio"
            name="cw-src"
            checked={scope === 'selection'}
            disabled={!hasSelection}
            onChange={() => setScope('selection')}
          />{' '}
          {t('translit_selection', { n: countText(body.slice(selection.start, selection.end)).graphemes })}
        </label>
        <label>
          <input
            type="radio"
            name="cw-src"
            checked={scope === 'draft'}
            onChange={() => setScope('draft')}
          />{' '}
          {t('translit_whole')}
        </label>
      </div>

      <div className="cw-field">
        {t('translit_lang_label')}
        <select value={settings.translitLang} disabled aria-label={t('translit_lang_aria')}>
          <option value="ru">{t('translit_lang_ru')}</option>
        </select>
        <span className="cw-hint">{t('translit_lang_next')}</span>
      </div>

      <fieldset className="cw-std">
        <legend>{t('translit_std_legend')}</legend>
        {TRANSLIT_STANDARDS.map((s) => (
          <label key={s.id} className="cw-std__row">
            <input
              type="radio"
              name="cw-std"
              checked={standard === s.id}
              onChange={() => setStandard(s.id)}
            />
            <span>
              {t(stdLabelKey(s.id))}
              {s.reversible ? ` ${t('translit_reversible')}` : ''}
            </span>
            <span className="mono cw-std__ex">{translitExample(s.id, sample, slug)}</span>
          </label>
        ))}
      </fieldset>

      <p className="cw-hint">{t('translit_explain')}</p>

      <p className="cw-hint">{t('translit_result')}</p>
      <div className="cw-result mono">{result || '—'}</div>

      <div className="cw-actions">
        <Button variant="primary" onClick={apply} disabled={result === ''}>
          {scope === 'selection' && hasSelection ? t('btn_replace_selection') : t('btn_replace_draft')}
        </Button>
        <Button onClick={insertBeside} disabled={result === ''}>{t('btn_insert_beside')}</Button>
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(result)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          disabled={result === ''}
        >
          {copied ? t('btn_copied') : t('btn_copy')}
        </Button>
      </div>
    </div>
  );
}

/* ── Stats (design §2.7) ───────────────────────────────────────────────────*/

function Stats({ body, selection, counts, settings, target }: DrawerProps) {
  const t = useT();
  const selText = body.slice(selection.start, selection.end);
  const sel = selText ? countText(selText) : null;

  const rows: [MsgKey, MsgKey | null, number, number | undefined][] = [
    ['stat_graphemes', 'stat_graphemes_note', counts.graphemes, sel?.graphemes],
    ['stat_utf16', 'stat_utf16_note', counts.utf16, sel?.utf16],
    ['stat_bytes', 'stat_bytes_note', counts.bytes, sel?.bytes],
    ['stat_words', null, counts.words, sel?.words],
    ['stat_lines', null, counts.lines, sel?.lines],
    ['stat_paragraphs', null, counts.paragraphs, sel?.paragraphs],
  ];

  const longestLine = useMemo(
    () => body.split('\n').reduce((max, l) => Math.max(max, countText(l).graphemes), 0),
    [body],
  );

  const limits = LIMITS.filter((l) => {
    if (settings.limitsFollowTarget) {
      const forTarget: Record<string, string[]> = {
        github: ['commitTitle', 'commitBody', 'branch'],
        gitlab: ['commitTitle', 'commitBody', 'branch'],
      };
      const allowed = forTarget[target];
      if (allowed) return allowed.includes(l.id);
    }
    return settings.counterLimits[limitPrefKey(l.id)] ?? true;
  });

  const unitLabel = (unit: string) => (unit === 'utf16' ? 'UTF-16' : t(`unit_${unit}` as MsgKey));

  return (
    <div className="cw-stats">
      <table className="cw-stats__table">
        <thead>
          <tr>
            <th scope="col">{t('stats_metric')}</th>
            <th scope="col">{t('stats_whole')}</th>
            <th scope="col">{t('stats_selection')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, note, all, s]) => (
            <tr key={label}>
              <td>
                {t(label)}
                {note && <span className="cw-hint"> — {t(note)}</span>}
              </td>
              <td className="mono">{all}</td>
              <td className="mono">{s ?? '—'}</td>
            </tr>
          ))}
          <tr>
            <td>{t('stat_reading')}</td>
            <td className="mono">~{counts.readingMinutes} {t('unit_min_short')}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <p className="cw-hint">
        {t('stats_emoji_note')}
        {counts.approximate && t('stats_approx_note')}
      </p>

      <p className="cw-hint">{t('stats_limits_intro')}</p>
      <ul className="cw-limits">
        {limits.map((l) => {
          const used =
            l.id === 'commitBody'
              ? longestLine
              : l.unit === 'bytes'
                ? counts.bytes
                : l.unit === 'codepoints'
                  ? counts.codepoints
                  : counts.graphemes;
          const over = used > l.max;
          const pct = Math.min(100, Math.round((used / l.max) * 100));
          return (
            <li key={l.id} className="cw-limit">
              <span>
                {t(`limit_${l.id}` as MsgKey)} ({l.max} {unitLabel(l.unit)})
              </span>
              <span className="cw-bar" aria-hidden="true">
                <span
                  className={over ? 'cw-bar__fill cw-bar__fill--over' : 'cw-bar__fill'}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="mono">
                {used}/{l.max} {over ? t('limit_over') : '✓'}
              </span>
            </li>
          );
        })}
      </ul>
      {settings.limitsFollowTarget && (
        <p className="cw-hint">
          {t('stats_limits_target', { label: t(`target_${target}` as MsgKey) })}
        </p>
      )}
    </div>
  );
}

function limitPrefKey(id: string): string {
  if (id === 'commitTitle' || id === 'commitBody') return 'commit';
  if (id === 'branch') return 'branch';
  return id;
}
