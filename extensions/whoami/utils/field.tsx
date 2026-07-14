import { useId, useState, type ReactNode } from 'react';

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
// enum of chip + explanation. Copy is RU-primary (the product's audience). Each
// entry says WHY the value is missing and, crucially, that it is not a bug.
interface ReasonCopy {
  chip: string;
  title: string;
  body: string;
}

export const REASONS: Record<ReasonCode, ReasonCopy> = {
  'not-implemented': {
    chip: 'Недоступно в этом браузере',
    title: 'API не реализован',
    body: 'Это API не реализовано в вашем браузере (обычно Firefox или Safari). Значение узнать невозможно — это не ошибка расширения и не сбой настройки.',
  },
  'chromium-only': {
    chip: 'Только в Chromium',
    title: 'Только Chromium',
    body: 'Это API есть лишь в браузерах на Chromium (Chrome, Edge, Opera). Firefox и Safari его не реализовали — во многом именно потому, что оно помогает отслеживать пользователей. Отсутствие значения здесь — норма.',
  },
  'mobile-only': {
    chip: 'Только на мобильных',
    title: 'Только на мобильных',
    body: 'Это поле физически относится к телефону (модель устройства, тип сотовой сети). На настольном браузере его не существует.',
  },
  'empty-by-design': {
    chip: 'Браузер отдаёт пусто',
    title: 'Пустая строка — намеренно',
    body: '⚠️ Chrome намеренно возвращает пустую строку для этого поля (например, точную модель GPU). Это не ошибка, и мы 🔴 не подставляем вместо неё соседнее значение.',
  },
  'blocked-by-privacy': {
    chip: 'Скрыто настройкой приватности',
    title: 'Замаскировано приватностью',
    body: 'Значение скрыто вашей настройкой приватности (Firefox privacy.resistFingerprinting или ETP strict). Браузер намеренно не отдаёт его — и это хорошо.',
  },
  'removed-by-vendor': {
    chip: 'Убрано из браузера',
    title: 'Удалено вендором',
    body: 'Это поле убрано из браузера (например, doNotTrack удалён из Chrome). Его больше нельзя прочитать.',
  },
  'not-requested': {
    chip: 'Не запрошено',
    title: 'Ещё не запрашивалось',
    body: 'Это сетевое поле. Оно неизвестно локально и запрашивается только по вашему явному клику — до этого момента расширение не отправило ни одного запроса.',
  },
  'permission-denied': {
    chip: 'Доступ не выдан',
    title: 'Разрешение отклонено',
    body: 'Вы не выдали доступ к внешнему сервису. IP никуда не ушёл. Остальное работает как работало.',
  },
  'request-failed': {
    chip: 'Запрос не удался',
    title: 'Запрос не удался',
    body: 'Внешний сервер не ответил (нет сети, таймаут, лимит запросов или блокировка). Данные об устройстве от этого не зависят и остаются на месте.',
  },
  'unsupported-here': {
    chip: 'Недоступно в этом контексте',
    title: 'Недоступно в этом контексте',
    body: 'API есть, но недоступно в текущем контексте (не защищённое соединение, приватное окно и т. п.).',
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
  const popId = useId().replace(/:/g, '_');

  if (field.kind === 'unavailable') {
    const r = REASONS[field.reason];
    return (
      <div className="frow" data-kind="unavailable">
        <span className="frow__label">{label}</span>
        <span className="frow__value frow__value--na">
          <button
            type="button"
            className="chip"
            popoverTarget={popId}
            aria-label={`${r.chip}: ${r.title}`}
          >
            ⓘ {r.chip}
          </button>
          <div id={popId} popover="auto" className="popover" role="note">
            <p className="popover__title">{r.title}</p>
            <p className="popover__body">{r.body}</p>
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
              aria-label="Приблизительное значение"
              title={field.note ? undefined : 'Приблизительно'}
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
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="frow__copy copybtn"
      aria-live="polite"
      aria-label={`Скопировать значение поля «${label}»`}
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
