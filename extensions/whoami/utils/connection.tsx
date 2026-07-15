import { useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import { Callout } from '@blur/ui';
import { FieldRow, val, na, type Field } from './field';
import {
  fetchTrace,
  fetchIsp,
  requestIspPermission,
  hasIspPermission,
  countryName,
  clampField,
  flag,
  type TraceResult,
  type IspResult,
  type NetOutcome,
  type NetFailure,
} from './network';
import type { WhoamiSettings } from './storage';

// The Connection section (T1/T2) — shared by the popup and the report. It owns the
// three IP states (not-requested → loaded → failed), the ALWAYS-ON inline
// disclosure (place A, design §6.1), the modal `<dialog>` before the first ipinfo
// call (place B), and the per-value source line (place C).
//
// 🔴 WHERE THE PRIVACY BOUNDARY IS, IN CODE:
//   - Not a single fetch can start except from `runTrace` / `runIsp`, and both are
//     only reachable from an onClick (or from `autoFetchIp`, which storage.ts
//     refuses to leave `true` unless `cfConsent === 'granted'` — i.e. unless the
//     user has already clicked through the disclosure at least once).
//   - The disclosure text is rendered ABOVE the button, unconditionally, and is
//     never collapsed or hidden — including after consent, so it is still on screen
//     next to the value.
//   - Results live in `useState` here. They are never written anywhere. Closing the
//     popup destroys the document, the state and any in-flight request with it; on
//     the report page an AbortController does the same on unmount.

type Load<T> = { status: 'idle' } | { status: 'loading' } | { status: 'done'; outcome: NetOutcome<T> };

/** What the report needs in order to include (or redact) the network block in an
 *  export. 🔴 Passed UP as a value, never persisted on the way. */
export interface ConnectionSnapshot {
  trace: TraceResult | null;
  isp: IspResult | null;
}

export function ConnectionSection({
  settings,
  update,
  onSnapshot,
}: {
  settings: WhoamiSettings;
  update: (patch: Partial<WhoamiSettings>) => void;
  onSnapshot?: (snap: ConnectionSnapshot) => void;
}) {
  const [trace, setTrace] = useState<Load<TraceResult>>({ status: 'idle' });
  const [isp, setIsp] = useState<Load<IspResult>>({ status: 'idle' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ispDenied, setIspDenied] = useState(false);
  const [announce, setAnnounce] = useState('');

  // One controller for the lifetime of the mount: on unmount (report tab closed,
  // popup torn down) every in-flight request is aborted. No dangling promise ever
  // resolves into a dead component.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    return () => ac.abort();
  }, []);

  // 🔴 The BROWSER is the source of truth for the ISP consent, not our flag
  // (design §6.2): the user may have revoked the host access in chrome://extensions
  // since last time. Reconcile on every mount and roll our flag back if so.
  useEffect(() => {
    void hasIspPermission().then((held) => {
      if (!held && settings.ispConsent === 'granted') update({ ispConsent: 'unset' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⚠️ The ONLY branch that can touch the network on open. `autoFetchIp` is false by
  // default AND is forced back to false on read whenever `cfConsent !== 'granted'`
  // (storage.normalizeSettings), so this is unreachable until the user has clicked
  // through the disclosure at least once. That default is literally what keeps the
  // AMO manifest at `data_collection_permissions.required: ['none']` (design §6.3).
  useEffect(() => {
    if (
      settings.allowCloudflare &&
      settings.autoFetchIp &&
      settings.cfConsent === 'granted' &&
      trace.status === 'idle'
    ) {
      void runTrace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function publish(t: Load<TraceResult>, i: Load<IspResult>) {
    onSnapshot?.({
      trace: t.status === 'done' && t.outcome.ok ? t.outcome.value : null,
      isp: i.status === 'done' && i.outcome.ok ? i.outcome.value : null,
    });
  }

  async function runTrace() {
    // 🔴 Not just a UI nicety: two clicks would be two disclosures of the IP where
    // the user consented to one (design §10).
    if (trace.status === 'loading') return;
    // A consent flag — a boolean about the USER'S CHOICE. Not data about the user.
    if (settings.cfConsent !== 'granted') update({ cfConsent: 'granted' });
    setTrace({ status: 'loading' });
    setAnnounce('Запрашиваем IP у Cloudflare…');

    const outcome = await fetchTrace(abortRef.current?.signal);
    const next: Load<TraceResult> = { status: 'done', outcome };
    setTrace(next);
    publish(next, isp);
    setAnnounce(
      outcome.ok
        ? `IP получен: ${outcome.value.ip}${outcome.value.countryCode ? `, ${outcome.value.countryCode}` : ''}`
        : `Не удалось узнать IP. ${outcome.message}`,
    );
  }

  /**
   * 🔴 THE ORDER IN THIS FUNCTION IS LOAD-BEARING (design §4.3):
   * `permissions.request()` is the FIRST thing that happens, synchronously, inside
   * the gesture that submitted the dialog. Any `await` before it consumes the user
   * activation and Firefox throws "may only be called from a user input handler".
   */
  async function runIsp() {
    if (settings.ispProvider === 'off' || isp.status === 'loading') return;
    setIspDenied(false);

    const granted = await requestIspPermission();
    if (!granted) {
      // The refusal is a real outcome, not an error: nothing was sent.
      setIspDenied(true);
      update({ ispConsent: 'unset' });
      setAnnounce('Доступ к ipinfo.io не выдан. IP никуда не ушёл.');
      return;
    }
    update({ ispConsent: 'granted' });
    setIsp({ status: 'loading' });
    setAnnounce('Запрашиваем провайдера у ipinfo.io…');

    const outcome = await fetchIsp(settings.ipinfoToken, abortRef.current?.signal);
    const next: Load<IspResult> = { status: 'done', outcome };
    setIsp(next);
    publish(trace, next);
    setAnnounce(outcome.ok ? 'Данные о провайдере получены.' : outcome.message);
  }

  // Setting #4: the user can hide the whole IP feature. Then there is not even a
  // button that could start a request.
  if (!settings.allowCloudflare) {
    return (
      <Callout tone="info" title="Соединение">
        Кнопка «Показать мой IP» отключена в настройках. Данные об устройстве выше не
        зависят от сети и показаны полностью.
      </Callout>
    );
  }

  const traceOutcome = trace.status === 'done' ? trace.outcome : null;
  const ipValue = traceOutcome?.ok ? traceOutcome.value : null;
  const offline = !navigator.onLine;

  return (
    <div className="conn">
      {/* Local, no-network connection facts — present with or without any request. */}
      {localConnRows().map((r) => (
        <FieldRow key={r.label} label={r.label} field={r.field} copyable={r.copyable} />
      ))}

      {/* PLACE A — the prominent in-UI disclosure (design §6.1). It is rendered
          UNCONDITIONALLY and physically above the button, so the first request is
          impossible without it having been on screen. It also STAYS after consent
          (the fix over `perf`, where the disclosure disappeared once accepted). */}
      <Callout tone="info" title="Прежде чем узнать IP">
        Свой публичный IP браузер не знает — его можно узнать только у внешнего
        сервера. По кнопке ниже расширение отправит <strong>один HTTPS-запрос</strong>{' '}
        в <strong>Cloudflare</strong> (<span dir="ltr">one.one.one.one/cdn-cgi/trace</span>).
        Cloudflare увидит ваш IP-адрес — так работает любой сетевой запрос. Ответ
        показывается здесь и <strong>нигде не сохраняется</strong>: ни в файле, ни в
        хранилище браузера, ни на нашем сервере — у нас его нет. Аналитики нет.
        {ipValue ? ' Закройте это окно — значение исчезнет.' : ''}
      </Callout>

      {!ipValue && trace.status !== 'loading' && (
        <>
          <FieldRow label="Мой IP-адрес" field={na('not-requested')} copyable={false} />
          <FieldRow label="Страна (по IP)" field={na('not-requested')} copyable={false} />
          {traceOutcome && !traceOutcome.ok && (
            <TraceError outcome={traceOutcome} onRetry={() => void runTrace()} />
          )}
          <button
            type="button"
            className="ui-btn ui-btn--primary conn__cta"
            onClick={() => void runTrace()}
            disabled={offline}
          >
            {traceOutcome ? 'Попробовать снова' : 'Показать мой IP и страну'}
          </button>
          {offline && (
            <p className="conn__note">
              Нет подключения к сети. IP можно узнать только у внешнего сервера — поэтому
              кнопка недоступна. Всё остальное на этом экране работает.
            </p>
          )}
        </>
      )}

      {trace.status === 'loading' && (
        <p className="conn__status" aria-busy="true">
          <span className="ui-spinner" aria-hidden="true" /> Запрашиваем IP у Cloudflare…
        </p>
      )}

      {ipValue && (
        <>
          <IpBlock trace={ipValue} onRefresh={() => void runTrace()} busy={trace.status === 'loading'} />
          <VpnSignals trace={ipValue} />

          {/* T2 · ISP / ASN — only ever offered once an IP exists (otherwise the
              disclosure could not name the address that the recipient will see). */}
          <div className="conn__isp">
            <p className="conn__divider">ISP и ASN</p>
            <IspArea
              settings={settings}
              isp={isp}
              denied={ispDenied}
              onOpenDialog={() => setDialogOpen(true)}
              onRun={() => void runIsp()}
              onNever={() => update({ ispConsent: 'never' })}
            />
          </div>
        </>
      )}

      {dialogOpen && ipValue && (
        <IpConsentDialog
          ip={ipValue.ip}
          onCancel={(neverAgain) => {
            setDialogOpen(false);
            // 🔴 Esc / Cancel / backdrop = REFUSAL. Nothing is requested, nothing is
            // sent, and the flag only moves if the user ticked "don't ask again".
            if (neverAgain) update({ ispConsent: 'never' });
          }}
          onConfirm={() => {
            setDialogOpen(false);
            // Still inside the submit gesture → `permissions.request()` (the first
            // statement of runIsp) keeps its user activation.
            void runIsp();
          }}
        />
      )}

      {/* Screen-reader announcements (design §11). Errors are assertive. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------- */
/* T2 sub-states                                                                 */
/* --------------------------------------------------------------------------- */

function IspArea({
  settings,
  isp,
  denied,
  onOpenDialog,
  onRun,
  onNever,
}: {
  settings: WhoamiSettings;
  isp: Load<IspResult>;
  denied: boolean;
  onOpenDialog: () => void;
  onRun: () => void;
  onNever: () => void;
}) {
  // The feature is switched off entirely — no button, no host permission, nothing.
  if (settings.ispProvider === 'off') {
    return (
      <>
        <FieldRow label="Провайдер (ISP)" field={na('not-requested')} copyable={false} />
        <p className="conn__note">
          Поиск провайдера выключен в настройках. Расширение не обращается к ipinfo.io.
        </p>
      </>
    );
  }

  if (isp.status === 'loading') {
    return (
      <p className="conn__status" aria-busy="true">
        <span className="ui-spinner" aria-hidden="true" /> Запрашиваем провайдера у ipinfo.io…
      </p>
    );
  }

  if (isp.status === 'done' && isp.outcome.ok) {
    return <IspBlock isp={isp.outcome.value} />;
  }

  // The user (or the browser) declined the host permission. 🔴 The most important
  // sentence on the screen is "IP никуда не ушёл" — it confirms the refusal WORKED.
  if (denied) {
    return (
      <Callout tone="info" title="Доступ к ipinfo.io не выдан">
        <p>IP никуда не ушёл. Всё остальное работает как работало.</p>
        <div className="conn__row">
          <button type="button" className="ui-btn ui-btn--sm" onClick={onRun}>
            Попробовать снова
          </button>
          <button type="button" className="ui-btn ui-btn--sm" onClick={onNever}>
            Больше не предлагать
          </button>
        </div>
        <p className="conn__note">
          ⚠ Браузер может не показать запрос повторно в этом же окне — тогда откройте
          страницу расширений браузера и выдайте доступ к ipinfo.io там.
        </p>
      </Callout>
    );
  }

  if (isp.status === 'done' && !isp.outcome.ok) {
    return <IspError outcome={isp.outcome} onRetry={onRun} />;
  }

  // "Don't ask again" — the button is gone for good. It can be brought back in
  // Options (design §3 #9); we say so instead of leaving a dead end.
  if (settings.ispConsent === 'never') {
    return (
      <>
        <FieldRow label="Провайдер (ISP)" field={na('not-requested')} copyable={false} />
        <p className="conn__note">
          Вы попросили больше не предлагать поиск провайдера. Вернуть предложение можно в
          Настройках.
        </p>
      </>
    );
  }

  // The token is missing → the button leads to Settings and 🔴 makes NO request.
  if (settings.ipinfoToken.trim() === '') {
    return (
      <>
        <FieldRow label="Провайдер (ISP)" field={na('not-requested')} copyable={false} />
        <Callout tone="info">
          Cloudflare не отдаёт название провайдера и номер сети (ASN) — это принципиально
          другой источник. Их знает ipinfo.io, и для запроса к нему нужен ваш собственный
          бесплатный токен: свой мы вшить не можем — в расширении он был бы публичным.
        </Callout>
        <button
          type="button"
          className="ui-btn conn__cta"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Добавить токен ipinfo.io в Настройках…
        </button>
      </>
    );
  }

  // The offer. `…` = "this opens a dialog, it does not act immediately" (house
  // convention, design §2.3b).
  return (
    <>
      <FieldRow label="Провайдер (ISP)" field={na('not-requested')} copyable={false} />
      <Callout tone="info">
        Cloudflare не отдаёт ISP и ASN. Чтобы их узнать, нужен второй сервис —{' '}
        <strong>ipinfo.io</strong>. Он увидит ваш IP-адрес. Ничего не будет сохранено.
      </Callout>
      <button
        type="button"
        className="ui-btn conn__cta"
        onClick={settings.ispConsent === 'granted' ? onRun : onOpenDialog}
      >
        {settings.ispConsent === 'granted'
          ? 'Узнать провайдера (ISP / ASN)'
          : 'Узнать провайдера (ISP / ASN)…'}
      </button>
    </>
  );
}

/* --------------------------------------------------------------------------- */
/* Local, zero-network connection facts                                          */
/* --------------------------------------------------------------------------- */

interface Conn {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

function connection(): Conn | undefined {
  return 'connection' in navigator
    ? (navigator as unknown as { connection?: Conn }).connection
    : undefined;
}

function localConnRows(): { label: string; field: Field; copyable?: boolean }[] {
  const c = connection();
  return [
    {
      label: 'Тип соединения',
      // ⚠️ NOT a speed. The browser classifies recent RTTs; "4g" on Wi-Fi is normal.
      // 🔴 We never draw a speedometer and never print Mbit/s as a fact (design §7).
      field: c?.effectiveType
        ? val(`${c.effectiveType} (оценка браузера)`, {
            approx: true,
            note: 'Браузер не измеряет скорость. Он классифицирует недавние запросы по задержке. «4g» на Wi-Fi — это норма, а не ошибка.',
          })
        : na('chromium-only'),
    },
    {
      label: 'Оценка канала',
      field:
        typeof c?.downlink === 'number'
          ? val(`${c.downlink} Мбит/с`, {
              approx: true,
              note: 'Грубая оценка браузера, округлённая и ограниченная сверху ~25 Мбит/с. Это не результат замера скорости.',
            })
          : na('chromium-only'),
    },
    {
      label: 'Экономия трафика',
      field: typeof c?.saveData === 'boolean' ? val(c.saveData ? 'включена' : 'выключена') : na('chromium-only'),
    },
    {
      // ⚠️ `connection.type` (wifi/cellular) exists on Android only.
      label: 'Тип сети',
      field: c?.type ? val(c.type) : na('mobile-only'),
    },
    {
      label: 'Онлайн',
      // ⚠️ `onLine === true` only means "a network interface exists" — it does NOT
      // mean the internet is reachable. We say precisely that (design §7).
      field: val(
        navigator.onLine
          ? 'да (есть подключение к сети — не проверено, что интернет доступен)'
          : 'нет (сеть недоступна)',
      ),
      copyable: false,
    },
  ];
}

/* --------------------------------------------------------------------------- */
/* Result blocks                                                                 */
/* --------------------------------------------------------------------------- */

function IpBlock({
  trace,
  onRefresh,
  busy,
}: {
  trace: TraceResult;
  onRefresh: () => void;
  busy: boolean;
}) {
  const [at] = useState(() => new Date().toLocaleTimeString());
  const name = trace.countryCode ? countryName(trace.countryCode) : null;

  return (
    <div className="ipblock">
      <FieldRow label="Мой IP" field={val(trace.ip, { ltr: true })} />
      <FieldRow label="Версия" field={val(trace.ipVersion)} />
      <FieldRow
        label="Страна (по IP)"
        field={
          trace.countryCode
            ? val(
                `${flag(trace.countryCode)} ${name ?? ''} (${trace.countryCode})`.replace(/\s+/g, ' ').trim(),
                {
                  note: 'Геолокация по IP приблизительна и часто указывает на город провайдера, а не на ваш. Это страна, а не адрес — карты здесь не будет, потому что такой точности у этих данных нет.',
                },
              )
            : na('provider-omitted')
        }
      />
      <FieldRow
        label="Ближайший узел Cloudflare"
        field={
          trace.colo
            ? val(trace.colo, {
                note: '⚠️ Это дата-центр Cloudflare (PoP), а НЕ ваш город.',
                ltr: true,
              })
            : na('provider-omitted')
        }
      />
      <FieldRow label="TLS" field={trace.tls ? val(trace.tls, { ltr: true }) : na('provider-omitted')} />
      <FieldRow label="Протокол" field={trace.http ? val(trace.http, { ltr: true }) : na('provider-omitted')} />
      <FieldRow label="Cloudflare WARP" field={trace.warp ? val(trace.warp) : na('provider-omitted')} />
      <FieldRow
        label="UA глазами сервера"
        field={
          trace.uag === null
            ? na('provider-omitted')
            : // 🔴 Compare against an equally-clamped local UA: the server value was
              // truncated to 256 chars on the wire, so a legit UA longer than that
              // must not be flagged as a spoof (design §2.3).
              trace.uag === clampField(navigator.userAgent)
              ? val('совпадает с локальным')
              : val('⚠ отличается от локального — возможна подмена User-Agent прокси или расширением')
        }
        copyable={false}
      />

      {/* PLACE C — source + time + "not saved", right next to the value (§6.1). */}
      <p className="ipblock__source">
        Получено {at} · источник: Cloudflare · <strong>не сохранено</strong>.{' '}
        <button type="button" className="linkbtn" onClick={onRefresh} disabled={busy}>
          Обновить ⟳
        </button>
      </p>
    </div>
  );
}

function IspBlock({ isp }: { isp: IspResult }) {
  const [at] = useState(() => new Date().toLocaleTimeString());
  const place = [isp.city, isp.region].filter(Boolean).join(', ');
  return (
    <div className="ipblock">
      <FieldRow
        label="Провайдер (ISP)"
        field={isp.isp ? val(isp.isp, { ltr: true }) : na('provider-omitted')}
      />
      <FieldRow label="ASN" field={isp.asn ? val(isp.asn, { ltr: true }) : na('provider-omitted')} />
      <FieldRow
        label="Обратное DNS-имя"
        field={isp.hostname ? val(isp.hostname, { ltr: true }) : na('provider-omitted')}
      />
      <FieldRow
        label="Страна (ipinfo)"
        field={isp.countryCode ? val(isp.countryCode, { ltr: true }) : na('provider-omitted')}
      />
      <FieldRow
        label="Город / регион (по IP)"
        field={
          place
            ? val(place, {
                approx: true,
                note: '⚠️ Геолокация по IP приблизительна: очень часто это город узла провайдера, а не ваш. Не используйте это как адрес.',
              })
            : na('provider-omitted')
        }
      />
      <p className="ipblock__source">
        Получено {at} · источник: ipinfo.io · <strong>не сохранено</strong>.
      </p>
    </div>
  );
}

/** §8.1 — VPN/proxy SIGNALS, not a verdict. 🔴 We never print "VPN detected": we do
 *  not have the data for that. We compare three numbers the user can see for
 *  themselves and list the ordinary explanations. Zero extra network, zero storage. */
function VpnSignals({ trace }: { trace: TraceResult }) {
  if (!trace.countryCode) return null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let tzRegion: string | null = null;
  try {
    // A cheap, honest heuristic: the timezone's own country list vs the IP country.
    const parts = tz?.split('/') ?? [];
    tzRegion = parts.length > 1 ? parts[1]!.replace(/_/g, ' ') : null;
  } catch {
    tzRegion = null;
  }
  const warp = trace.warp === 'on' || trace.warp === 'plus';
  if (!warp && !tzRegion) return null;

  return (
    <Callout tone="info" title="Сигналы VPN / прокси">
      <p>
        Таймзона вашего браузера — <strong>{tz}</strong>, а IP-адрес относится к стране{' '}
        <strong>{trace.countryCode}</strong>
        {warp ? '. Cloudflare сообщает, что вы за WARP.' : '.'}
      </p>
      <p>
        ⓘ Это <strong>эвристика, а не проверка</strong>. Расширение не знает, есть ли у вас
        VPN, — оно лишь сравнивает значения, которые вы видите выше. Расхождение обычно
        значит: вы за VPN/прокси; или вы в поездке и не меняли часы; или провайдер
        маршрутизирует трафик через соседнюю страну (обычное дело у мобильных операторов).
        Ничего никуда не отправлено и нигде не сохранено.
      </p>
    </Callout>
  );
}

/* --------------------------------------------------------------------------- */
/* Errors — every one of them is a real, reachable state (design §5)             */
/* --------------------------------------------------------------------------- */

function TraceError({ outcome, onRetry }: { outcome: NetFailure; onRetry: () => void }) {
  return (
    <Callout tone="warn" title="Не удалось узнать IP">
      {/* aria-live=assertive: a failed network request is worth interrupting for. */}
      <p role="alert">{outcome.message}</p>
      {outcome.kind !== 'offline' && (
        <ul className="conn__causes">
          <li>нет интернета;</li>
          <li>запрос режет корпоративный файрвол или другое расширение;</li>
          <li>1.1.1.1 заблокирован провайдером или изменил формат ответа.</li>
        </ul>
      )}
      {/* ⚠️ Without this sentence a network error reads as "the extension is broken",
          when in fact 90% of the product — everything above — is untouched. */}
      <p>
        <strong>Данные об устройстве выше — на месте:</strong> они не зависят от сети.
      </p>
      <button type="button" className="ui-btn ui-btn--sm" onClick={onRetry}>
        Попробовать снова
      </button>
    </Callout>
  );
}

function IspError({ outcome, onRetry }: { outcome: NetFailure; onRetry: () => void }) {
  const title =
    outcome.kind === 'rate-limited'
      ? 'Лимит запросов исчерпан'
      : outcome.kind === 'unauthorized'
        ? 'Токен не принят'
        : outcome.kind === 'timeout'
          ? 'ipinfo.io не ответил'
          : 'Не удалось узнать провайдера';

  return (
    <Callout tone="warn" title={title}>
      <p role="alert">{outcome.message}</p>
      {outcome.kind === 'rate-limited' && outcome.retryAfterSec ? (
        <p>Попробуйте через ~{Math.ceil(outcome.retryAfterSec / 60)} мин.</p>
      ) : null}
      {outcome.kind === 'unauthorized' ? (
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Открыть Настройки
        </button>
      ) : (
        <button type="button" className="ui-btn ui-btn--sm" onClick={onRetry}>
          Попробовать снова
        </button>
      )}
      <p className="conn__note">
        Ваш IP и страна выше уже получены и остаются на экране. 🔴 Мы не переключаемся
        молча на другой сервис — это был бы запрос, на который вы не соглашались.
      </p>
    </Callout>
  );
}

/* --------------------------------------------------------------------------- */
/* PLACE B — the modal disclosure before the FIRST ipinfo call (design §2.4)      */
/* --------------------------------------------------------------------------- */

/**
 * A native `<dialog>`: focus trap, `Esc` and backdrop inertness for free.
 * 🔴 `Esc` / backdrop / Cancel = REFUSAL, never "consent by default".
 * 🔴 The confirm button is the VERB — «Отправить IP» / "Send my IP" — never "OK",
 *    never "Continue". The user presses exactly the verb that describes the event.
 * 🔴 Default focus is on Cancel; both buttons carry the same visual weight. Any dark
 *    pattern inside a disclosure is itself grounds for store rejection.
 */
function IpConsentDialog({
  ip,
  onCancel,
  onConfirm,
}: {
  ip: string;
  onCancel: (neverAgain: boolean) => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [neverAgain, setNeverAgain] = useState(false);
  // The checkbox is read inside the native `close` handler, which can fire from Esc
  // — a ref keeps that read current without re-binding the listener.
  const neverRef = useRef(false);
  neverRef.current = neverAgain;
  const confirmed = useRef(false);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="consent"
      aria-labelledby="consent-title"
      onClose={() => {
        // Fires for Esc, for backdrop-dismiss and after our own close(). Only the
        // explicit submit path sets `confirmed`.
        if (!confirmed.current) onCancel(neverRef.current);
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          // Keep the gesture alive: we close and call the permission request
          // ourselves, in this same task (design §4.3).
          e.preventDefault();
          confirmed.current = true;
          onConfirm();
        }}
      >
        <h2 className="consent__title" id="consent-title">
          Отправить ваш IP-адрес на ipinfo.io?
        </h2>
        <p>
          Название провайдера (ISP) и номер сети (ASN) нельзя вычислить в браузере — их
          знает только внешняя база. Чтобы её спросить, расширение отправит{' '}
          <strong>ОДИН HTTPS-запрос на ipinfo.io</strong>.
        </p>
        <p className="consent__what">
          <strong>Что уйдёт:</strong> ваш публичный IP-адрес (<span dir="ltr">{ip}</span>) —
          ipinfo.io увидит его как источник запроса, и по нему же ответит. Ничего больше: ни
          адресов страниц, ни истории, ни данных об устройстве. Ваш токен уходит только в
          ipinfo.io и только для авторизации запроса.
        </p>
        <p>
          <strong>Кто получит:</strong> ipinfo.io (США). <strong>Зачем:</strong> только чтобы
          показать ответ вам. <strong>Хранение:</strong> ответ живёт в этом окне. Мы не пишем
          его ни в файл, ни в хранилище браузера, ни на наш сервер — у нас его нет. Аналитики
          нет.
        </p>
        <p>
          Дальше браузер спросит разрешение на доступ к ipinfo.io. Это второе, независимое от
          нас подтверждение — и вы сможете отозвать его в любой момент: в настройках браузера
          или кнопкой «Отозвать» в настройках расширения.
        </p>
        <p className="consent__links">
          <a href="https://ipinfo.io/privacy-policy" target="_blank" rel="noreferrer noopener">
            Политика приватности ipinfo.io ↗
          </a>
          {' · '}
          <a href="https://blockaly.com/privacy" target="_blank" rel="noreferrer noopener">
            Наша политика ↗
          </a>
        </p>

        {/* The EN mirror is the copy store reviewers read (design §2.4). */}
        <details className="consent__en">
          <summary>English</summary>
          <p>
            <strong>Send your IP address to ipinfo.io?</strong> Your ISP name and network
            number (ASN) cannot be worked out inside the browser — only an external database
            knows them. To ask it, this extension will make{' '}
            <strong>one HTTPS request to ipinfo.io</strong>.
          </p>
          <p>
            <strong>What leaves your browser:</strong> your public IP address (
            <span dir="ltr">{ip}</span>) — ipinfo.io sees it as the source of the request.
            Nothing else: no page URLs, no browsing history, no device data.{' '}
            <strong>Who receives it:</strong> ipinfo.io (USA). <strong>Why:</strong> solely to
            show you the answer. <strong>Retention:</strong> the answer lives in this window
            only. It is not written to a file, to browser storage, or to any server of ours —
            we do not operate one. There is no analytics. Next, your browser will ask you to
            grant access to ipinfo.io: a second, independent confirmation you can revoke at any
            time.
          </p>
        </details>

        <label className="consent__never">
          <input
            type="checkbox"
            checked={neverAgain}
            onChange={(e) => setNeverAgain(e.target.checked)}
          />
          Больше не спрашивать — просто не предлагать это (кнопка исчезнет)
        </label>

        <div className="consent__actions">
          <button
            type="button"
            className="ui-btn"
            autoFocus
            onClick={() => {
              confirmed.current = false;
              onCancel(neverAgain);
            }}
          >
            Отмена
          </button>
          <button type="submit" className="ui-btn ui-btn--primary">
            Отправить IP
          </button>
        </div>
      </form>
    </dialog>
  );
}
