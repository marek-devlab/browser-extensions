import { useId, useState, type ReactNode } from 'react';
import { useT, type MsgKey } from './i18n';

// 🔴 THE FIELD MODEL (design §7, §5). Every fact in this product is a `Field`, not
// a `string`. The type makes it IMPOSSIBLE to render an empty cell: a field is
// either a concrete value or an EXPLAINED unavailability. `<FieldRow>` is the one
// place a field becomes pixels, and it literally cannot print a bare "—".
//
// The reviewer test (design §5): a snapshot of the report under Firefox must not
// contain a single "—" in the value column. This model is how that holds.

export type ReasonCode =
  | 'not-implemented' // API absent from this engine (deviceMemory, HEV, connection.*)
  | 'chromium-only' // same fact, framed as "by design, not a bug" (userAgentData)
  | 'mobile-only' // field is physically about a phone (HEV.model, connection.type)
  | 'empty-by-design' // ⚠️ the browser returns "" on purpose (GPUAdapterInfo.device)
  | 'blocked-by-privacy' // resistFingerprinting / ETP strict masks it
  | 'removed-by-vendor' // dropped from the browser (doNotTrack in Chrome)
  | 'not-requested' // network field, before the user clicked
  | 'permission-denied' // the user declined the host permission
  | 'request-failed' // network / timeout / 429
  | 'provider-omitted' // ⚠️ the third party answered, but had no value for this field
  | 'unsupported-here'; // not a secure context, private window, etc.

export type Field =
  | { kind: 'value'; value: string; approx?: boolean; note?: string; ltr?: boolean }
  | { kind: 'unavailable'; reason: ReasonCode };

/** Construct a present value. `approx` renders the `~` marker (design §7); `note`
 *  is a popover explanation; `ltr` forces LTR for UA/IP/ASN so RTL locales don't
 *  reverse `AS16019`. */
export function val(
  value: string,
  opts?: { approx?: boolean; note?: string; ltr?: boolean },
): Field {
  return { kind: 'value', value, ...opts };
}

/** Construct an explained absence. Never renders as "—". */
export function na(reason: ReasonCode): Field {
  return { kind: 'unavailable', reason };
}

/** Read a possibly-missing string into a Field, using `reason` when it's absent
 *  (empty string counts as absent unless `emptyMeans` says otherwise). */
export function fromMaybe(
  value: string | null | undefined,
  reason: ReasonCode,
  opts?: { approx?: boolean; note?: string; ltr?: boolean; emptyMeans?: ReasonCode },
): Field {
  if (value === null || value === undefined) return na(reason);
  if (value === '') return na(opts?.emptyMeans ?? reason);
  return val(value, opts);
}

// The CLOSED reason catalog (design §2.8). 🔴 No free text at runtime — a fixed
// enum of chip + explanation, now resolved through the i18n catalog so every reason
// follows the selected locale. This map is the only place ReasonCode meets its copy
// keys; both FieldRow and the export layer read the copy through it.
interface ReasonKeys {
  chip: MsgKey;
  title: MsgKey;
  body: MsgKey;
}

export const REASON_KEYS: Record<ReasonCode, ReasonKeys> = {
  'not-implemented': {
    chip: 'reason_notImplemented_chip',
    title: 'reason_notImplemented_title',
    body: 'reason_notImplemented_body',
  },
  'chromium-only': {
    chip: 'reason_chromiumOnly_chip',
    title: 'reason_chromiumOnly_title',
    body: 'reason_chromiumOnly_body',
  },
  'mobile-only': {
    chip: 'reason_mobileOnly_chip',
    title: 'reason_mobileOnly_title',
    body: 'reason_mobileOnly_body',
  },
  'empty-by-design': {
    chip: 'reason_emptyByDesign_chip',
    title: 'reason_emptyByDesign_title',
    body: 'reason_emptyByDesign_body',
  },
  'blocked-by-privacy': {
    chip: 'reason_blockedByPrivacy_chip',
    title: 'reason_blockedByPrivacy_title',
    body: 'reason_blockedByPrivacy_body',
  },
  'removed-by-vendor': {
    chip: 'reason_removedByVendor_chip',
    title: 'reason_removedByVendor_title',
    body: 'reason_removedByVendor_body',
  },
  'not-requested': {
    chip: 'reason_notRequested_chip',
    title: 'reason_notRequested_title',
    body: 'reason_notRequested_body',
  },
  'permission-denied': {
    chip: 'reason_permissionDenied_chip',
    title: 'reason_permissionDenied_title',
    body: 'reason_permissionDenied_body',
  },
  'request-failed': {
    chip: 'reason_requestFailed_chip',
    title: 'reason_requestFailed_title',
    body: 'reason_requestFailed_body',
  },
  // ⚠️ Added when the network half became real: a third party can answer 200 OK and
  // still have no value for a given field (Cloudflare never returns an ISP; ipinfo
  // may omit `hostname`). That is neither an error nor an empty cell — it is the
  // recipient having nothing to say, and we say exactly that. 🔴 We never fill the
  // gap from another source without a fresh disclosure.
  'provider-omitted': {
    chip: 'reason_providerOmitted_chip',
    title: 'reason_providerOmitted_title',
    body: 'reason_providerOmitted_body',
  },
  'unsupported-here': {
    chip: 'reason_unsupportedHere_chip',
    title: 'reason_unsupportedHere_title',
    body: 'reason_unsupportedHere_body',
  },
};

/**
 * The ONLY place a Field turns into pixels. Renders a labelled row:
 *  - a value: text (LTR-forced when asked), an optional `~` approx marker with a
 *    popover note, and a copy button;
 *  - an unavailability: a keyboard-operable chip (`<button popovertarget>`) whose
 *    popover explains why — 🔴 never a "—", never an empty cell.
 *
 * The popover uses the native Popover API (Esc + light-dismiss + focus return for
 * free); positioning is plain `position:absolute` inside the row, since CSS Anchor
 * Positioning is Chromium-only and not Baseline (design §12).
 */
export function FieldRow({
  label,
  field,
  copyable = true,
}: {
  label: string;
  field: Field;
  copyable?: boolean;
}) {
  const t = useT();
  const popId = useId().replace(/:/g, '_');

  if (field.kind === 'unavailable') {
    const keys = REASON_KEYS[field.reason];
    const chip = t(keys.chip);
    const title = t(keys.title);
    return (
      <div className="frow" data-kind="unavailable">
        <span className="frow__label">{label}</span>
        <span className="frow__value frow__value--na">
          <button
            type="button"
            className="chip"
            popoverTarget={popId}
            aria-label={`${chip}: ${title}`}
          >
            ⓘ {chip}
          </button>
          <div id={popId} popover="auto" className="popover" role="note">
            <p className="popover__title">{title}</p>
            <p className="popover__body">{t(keys.body)}</p>
          </div>
        </span>
        {/* No copy button: there is nothing to copy, and that is honest. */}
        <span className="frow__copy" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="frow" data-kind="value">
      <span className="frow__label">{label}</span>
      <span
        className={`frow__value${field.ltr ? ' frow__value--ltr' : ''}`}
        dir={field.ltr ? 'ltr' : undefined}
      >
        <span className="frow__text">{field.value}</span>
        {field.approx && (
          <>
            <button
              type="button"
              className="approx"
              popoverTarget={field.note ? popId : undefined}
              aria-label={t('approxAria')}
              title={field.note ? undefined : t('approxTitle')}
            >
              ~
            </button>
            {field.note && (
              <div id={popId} popover="auto" className="popover" role="note">
                <p className="popover__body">{field.note}</p>
              </div>
            )}
          </>
        )}
      </span>
      {copyable ? (
        <CopyIcon value={field.value} label={label} />
      ) : (
        <span className="frow__copy" aria-hidden="true" />
      )}
    </div>
  );
}

/** Icon copy button [⧉] with a transient "Скопировано" acknowledgement, always
 *  focus-visible and labelled (design §11). Uses the async Clipboard API; a real
 *  failure surfaces rather than faking success. */
export function CopyIcon({ value, label }: { value: string; label: string }): ReactNode {
  const t = useT();
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="frow__copy copybtn"
      aria-live="polite"
      aria-label={t('copyFieldAria', { label })}
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
      {state === 'ok' ? '✓' : state === 'fail' ? '✕' : '⧉'}
    </button>
  );
}
