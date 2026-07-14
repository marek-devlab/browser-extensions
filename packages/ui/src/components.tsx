import { useState, type ReactNode } from 'react';
import { MOCK_NOTICE } from './mock';

// A small set of presentational primitives shared by the family, so six
// scaffolds don't each reinvent a spinner, an empty state and a severity badge.
// All styling comes from tokens.css variables + a handful of `.ui-*` classes
// each consuming stylesheet is expected to define (documented per component).
//
// House rules baked in:
//  - Nothing here uses innerHTML / dangerouslySetInnerHTML — children are React
//    nodes, auto-escaped. The repo already carries AMO UNSAFE_VAR_ASSIGNMENT
//    warnings (STORE.md); these primitives never add to them.
//  - Status is never colour-only (WCAG 1.4.1): Severity/Badge render TEXT.

export type Severity = 'ok' | 'warn' | 'poor' | 'info';

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: 'OK',
  warn: 'Warning',
  poor: 'Error',
  info: 'Info',
};

/** Spinner + optional label. Uses `.ui-spinner` from tokens.css. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="ui-state" role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

/** Neutral empty/zero state. `action` is an optional call-to-action node. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__title">{title}</p>
      {hint ? <p className="ui-empty__hint">{hint}</p> : null}
      {action}
    </div>
  );
}

/** Inline error row. `retry` renders a retry button when provided. */
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="ui-state ui-state--error" role="alert">
      <span>{message}</span>
      {retry ? (
        <button type="button" className="ui-btn ui-btn--sm" onClick={retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * A status pill that always carries a text label — never colour alone. Pass
 * `children` to override the default word (e.g. a count).
 */
export function Badge({
  severity = 'info',
  children,
}: {
  severity?: Severity;
  children?: ReactNode;
}) {
  return (
    <span
      className={`ui-badge ui-badge--${severity}`}
      data-severity={severity}
    >
      {children ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

/** Uppercase section heading, matching the family's `section h2` look. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="ui-section-heading">{children}</h2>;
}

/** Primary/secondary button. `variant='ghost'` for low-emphasis actions. */
export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'ghost';
  type?: 'button' | 'submit';
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      className={`ui-btn ui-btn--${variant}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/**
 * Copy-to-clipboard button with a transient "Copied" acknowledgement. Uses the
 * async Clipboard API; on failure it surfaces the failure rather than pretending
 * (house rule: don't fake success). Requires `clipboardWrite` only if the
 * surrounding context isn't already a user-gesture extension page.
 */
export function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="ui-btn ui-btn--sm"
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('ok');
        } catch {
          setState('fail');
        }
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : label}
    </button>
  );
}

/**
 * A callout/disclosure box for notes, warnings and — importantly — the in-UI
 * data-collection disclosures the 2026-08-01 CWS policy requires (whoami, perf).
 * `tone` picks the accent; content is plain React children (never raw HTML).
 */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'poor';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`ui-callout ui-callout--${tone}`} role="note">
      {title ? <p className="ui-callout__title">{title}</p> : null}
      <div className="ui-callout__body">{children}</div>
    </div>
  );
}

/**
 * The visible "running on mock data" banner for the scaffold phase. Render it on
 * any surface with fabricated content; remove per surface as its logic lands.
 */
export function MockBadge({ note = MOCK_NOTICE }: { note?: string }) {
  return (
    <div className="ui-mock" role="note" data-mock="true">
      {note}
    </div>
  );
}
