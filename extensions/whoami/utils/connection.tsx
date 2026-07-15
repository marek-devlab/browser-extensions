import { useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import { Callout, useLocale } from '@blur/ui';
import { FieldRow, val, na, type Field } from './field';
import { useT, type MsgKey, type TT } from './i18n';
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
  const t = useT();
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

  function publish(tl: Load<TraceResult>, il: Load<IspResult>) {
    onSnapshot?.({
      trace: tl.status === 'done' && tl.outcome.ok ? tl.outcome.value : null,
      isp: il.status === 'done' && il.outcome.ok ? il.outcome.value : null,
    });
  }

  async function runTrace() {
    // 🔴 Not just a UI nicety: two clicks would be two disclosures of the IP where
    // the user consented to one (design §10).
    if (trace.status === 'loading') return;
    // A consent flag — a boolean about the USER'S CHOICE. Not data about the user.
    if (settings.cfConsent !== 'granted') update({ cfConsent: 'granted' });
    setTrace({ status: 'loading' });
    setAnnounce(t('conn_fetchingCf'));

    const outcome = await fetchTrace(t, abortRef.current?.signal);
    const next: Load<TraceResult> = { status: 'done', outcome };
    setTrace(next);
    publish(next, isp);
    setAnnounce(
      outcome.ok
        ? `${t('conn_annIpGot', { ip: outcome.value.ip })}${outcome.value.countryCode ? `, ${outcome.value.countryCode}` : ''}`
        : t('conn_annIpFail', { message: outcome.message }),
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
      setAnnounce(t('conn_annIspDenied'));
      return;
    }
    update({ ispConsent: 'granted' });
    setIsp({ status: 'loading' });
    setAnnounce(t('conn_fetchingIsp'));

    const outcome = await fetchIsp(settings.ipinfoToken, t, abortRef.current?.signal);
    const next: Load<IspResult> = { status: 'done', outcome };
    setIsp(next);
    publish(trace, next);
    setAnnounce(outcome.ok ? t('conn_annIspGot') : outcome.message);
  }

  // Setting #4: the user can hide the whole IP feature. Then there is not even a
  // button that could start a request.
  if (!settings.allowCloudflare) {
    return (
      <Callout tone="info" title={t('connectionTitle')}>
        {t('conn_disabledBody')}
      </Callout>
    );
  }

  const traceOutcome = trace.status === 'done' ? trace.outcome : null;
  const ipValue = traceOutcome?.ok ? traceOutcome.value : null;
  const offline = !navigator.onLine;

  return (
    <div className="conn">
      {/* Local, no-network connection facts — present with or without any request. */}
      {localConnRows(t).map((r) => (
        <FieldRow key={r.key} label={t(r.key)} field={r.field} copyable={r.copyable} />
      ))}

      {/* PLACE A — the prominent in-UI disclosure (design §6.1). It is rendered
          UNCONDITIONALLY and physically above the button, so the first request is
          impossible without it having been on screen. It also STAYS after consent
          (the fix over `perf`, where the disclosure disappeared once accepted). */}
      <Callout tone="info" title={t('conn_beforeIpTitle')}>
        {t('conn_beforeIpBody')}
        {ipValue ? t('conn_beforeIpClose') : ''}
      </Callout>

      {!ipValue && trace.status !== 'loading' && (
        <>
          <FieldRow label={t('lbl_myIpAddress')} field={na('not-requested')} copyable={false} />
          <FieldRow label={t('lbl_countryByIp')} field={na('not-requested')} copyable={false} />
          {traceOutcome && !traceOutcome.ok && (
            <TraceError outcome={traceOutcome} onRetry={() => void runTrace()} />
          )}
          <button
            type="button"
            className="ui-btn ui-btn--primary conn__cta"
            onClick={() => void runTrace()}
            disabled={offline}
          >
            {traceOutcome ? t('conn_retry') : t('conn_showIp')}
          </button>
          {offline && <p className="conn__note">{t('conn_offlineNote')}</p>}
        </>
      )}

      {trace.status === 'loading' && (
        <p className="conn__status" aria-busy="true">
          <span className="ui-spinner" aria-hidden="true" /> {t('conn_fetchingCf')}
        </p>
      )}

      {ipValue && (
        <>
          <IpBlock trace={ipValue} onRefresh={() => void runTrace()} busy={trace.status === 'loading'} />
          <VpnSignals trace={ipValue} />

          {/* T2 · ISP / ASN — only ever offered once an IP exists (otherwise the
              disclosure could not name the address that the recipient will see). */}
          <div className="conn__isp">
            <p className="conn__divider">{t('conn_ispDivider')}</p>
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
  const t = useT();
  // The feature is switched off entirely — no button, no host permission, nothing.
  if (settings.ispProvider === 'off') {
    return (
      <>
        <FieldRow label={t('lbl_isp')} field={na('not-requested')} copyable={false} />
        <p className="conn__note">{t('conn_ispOffNote')}</p>
      </>
    );
  }

  if (isp.status === 'loading') {
    return (
      <p className="conn__status" aria-busy="true">
        <span className="ui-spinner" aria-hidden="true" /> {t('conn_fetchingIsp')}
      </p>
    );
  }

  if (isp.status === 'done' && isp.outcome.ok) {
    return <IspBlock isp={isp.outcome.value} />;
  }

  // The user (or the browser) declined the host permission. 🔴 The most important
  // sentence on the screen is "your IP went nowhere" — it confirms the refusal WORKED.
  if (denied) {
    return (
      <Callout tone="info" title={t('conn_ispDeniedTitle')}>
        <p>{t('conn_ispDeniedBody')}</p>
        <div className="conn__row">
          <button type="button" className="ui-btn ui-btn--sm" onClick={onRun}>
            {t('conn_retry')}
          </button>
          <button type="button" className="ui-btn ui-btn--sm" onClick={onNever}>
            {t('conn_never')}
          </button>
        </div>
        <p className="conn__note">{t('conn_ispDeniedNote')}</p>
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
        <FieldRow label={t('lbl_isp')} field={na('not-requested')} copyable={false} />
        <p className="conn__note">{t('conn_ispNeverNote')}</p>
      </>
    );
  }

  // The token is missing → the button leads to Settings and 🔴 makes NO request.
  if (settings.ipinfoToken.trim() === '') {
    return (
      <>
        <FieldRow label={t('lbl_isp')} field={na('not-requested')} copyable={false} />
        <Callout tone="info">{t('conn_ispTokenMissing')}</Callout>
        <button
          type="button"
          className="ui-btn conn__cta"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          {t('conn_ispAddToken')}
        </button>
      </>
    );
  }

  // The offer. `…` = "this opens a dialog, it does not act immediately" (house
  // convention, design §2.3b).
  return (
    <>
      <FieldRow label={t('lbl_isp')} field={na('not-requested')} copyable={false} />
      <Callout tone="info">{t('conn_ispOffer')}</Callout>
      <button
        type="button"
        className="ui-btn conn__cta"
        onClick={settings.ispConsent === 'granted' ? onRun : onOpenDialog}
      >
        {settings.ispConsent === 'granted' ? t('conn_ispLookup') : `${t('conn_ispLookup')}…`}
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

function localConnRows(t: TT): { key: MsgKey; field: Field; copyable?: boolean }[] {
  const c = connection();
  return [
    {
      key: 'lbl_connType',
      // ⚠️ NOT a speed. The browser classifies recent RTTs; "4g" on Wi-Fi is normal.
      // 🔴 We never draw a speedometer and never print Mbit/s as a fact (design §7).
      field: c?.effectiveType
        ? val(t('val_browserEstimate', { type: c.effectiveType }), {
            approx: true,
            note: t('note_effectiveType'),
          })
        : na('chromium-only'),
    },
    {
      key: 'lbl_downlink',
      field:
        typeof c?.downlink === 'number'
          ? val(`${c.downlink} ${t('unit_mbps')}`, {
              approx: true,
              note: t('note_downlink'),
            })
          : na('chromium-only'),
    },
    {
      key: 'lbl_saveData',
      field: typeof c?.saveData === 'boolean' ? val(c.saveData ? t('val_saveOn') : t('val_saveOff')) : na('chromium-only'),
    },
    {
      // ⚠️ `connection.type` (wifi/cellular) exists on Android only.
      key: 'lbl_netType',
      field: c?.type ? val(c.type) : na('mobile-only'),
    },
    {
      key: 'lbl_online',
      // ⚠️ `onLine === true` only means "a network interface exists" — it does NOT
      // mean the internet is reachable. We say precisely that (design §7).
      field: val(navigator.onLine ? t('val_onlineYes') : t('val_onlineNo')),
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
  const t = useT();
  const locale = useLocale();
  const [at] = useState(() => new Date().toLocaleTimeString());
  const name = trace.countryCode ? countryName(trace.countryCode, locale) : null;

  return (
    <div className="ipblock">
      <FieldRow label={t('lbl_myIp')} field={val(trace.ip, { ltr: true })} />
      <FieldRow label={t('lbl_ipVersion')} field={val(trace.ipVersion)} />
      <FieldRow
        label={t('lbl_countryByIp')}
        field={
          trace.countryCode
            ? val(
                `${flag(trace.countryCode)} ${name ?? ''} (${trace.countryCode})`.replace(/\s+/g, ' ').trim(),
                { note: t('note_countryByIp') },
              )
            : na('provider-omitted')
        }
      />
      <FieldRow
        label={t('lbl_cfNode')}
        field={
          trace.colo
            ? val(trace.colo, { note: t('note_cfNode'), ltr: true })
            : na('provider-omitted')
        }
      />
      <FieldRow label={t('lbl_tls')} field={trace.tls ? val(trace.tls, { ltr: true }) : na('provider-omitted')} />
      <FieldRow label={t('lbl_protocol')} field={trace.http ? val(trace.http, { ltr: true }) : na('provider-omitted')} />
      <FieldRow label={t('lbl_warp')} field={trace.warp ? val(trace.warp) : na('provider-omitted')} />
      <FieldRow
        label={t('lbl_uaServer')}
        field={
          trace.uag === null
            ? na('provider-omitted')
            : // 🔴 Compare against an equally-clamped local UA: the server value was
              // truncated to 256 chars on the wire, so a legit UA longer than that
              // must not be flagged as a spoof (design §2.3).
              trace.uag === clampField(navigator.userAgent)
              ? val(t('val_uaMatches'))
              : val(t('val_uaDiffers'))
        }
        copyable={false}
      />

      {/* PLACE C — source + time + "not saved", right next to the value (§6.1). */}
      <p className="ipblock__source">
        {t('conn_receivedFrom', { at, source: 'Cloudflare' })}
        <strong>{t('conn_notSaved')}</strong>.{' '}
        <button type="button" className="linkbtn" onClick={onRefresh} disabled={busy}>
          {t('conn_refresh')}
        </button>
      </p>
    </div>
  );
}

function IspBlock({ isp }: { isp: IspResult }) {
  const t = useT();
  const [at] = useState(() => new Date().toLocaleTimeString());
  const place = [isp.city, isp.region].filter(Boolean).join(', ');
  return (
    <div className="ipblock">
      <FieldRow
        label={t('lbl_isp')}
        field={isp.isp ? val(isp.isp, { ltr: true }) : na('provider-omitted')}
      />
      <FieldRow label={t('lbl_asn')} field={isp.asn ? val(isp.asn, { ltr: true }) : na('provider-omitted')} />
      <FieldRow
        label={t('lbl_reverseDns')}
        field={isp.hostname ? val(isp.hostname, { ltr: true }) : na('provider-omitted')}
      />
      <FieldRow
        label={t('lbl_countryIpinfo')}
        field={isp.countryCode ? val(isp.countryCode, { ltr: true }) : na('provider-omitted')}
      />
      <FieldRow
        label={t('lbl_cityRegion')}
        field={
          place
            ? val(place, { approx: true, note: t('note_cityRegion') })
            : na('provider-omitted')
        }
      />
      <p className="ipblock__source">
        {t('conn_receivedFrom', { at, source: 'ipinfo.io' })}
        <strong>{t('conn_notSaved')}</strong>.
      </p>
    </div>
  );
}

/** §8.1 — VPN/proxy SIGNALS, not a verdict. 🔴 We never print "VPN detected": we do
 *  not have the data for that. We compare three numbers the user can see for
 *  themselves and list the ordinary explanations. Zero extra network, zero storage. */
function VpnSignals({ trace }: { trace: TraceResult }) {
  const t = useT();
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
    <Callout tone="info" title={t('conn_vpnTitle')}>
      <p>
        {t('conn_vpnP1', { tz: tz ?? '?', cc: trace.countryCode })}
        {warp ? ` ${t('conn_vpnWarp')}` : ''}
      </p>
      <p>{t('conn_vpnP2')}</p>
    </Callout>
  );
}

/* --------------------------------------------------------------------------- */
/* Errors — every one of them is a real, reachable state (design §5)             */
/* --------------------------------------------------------------------------- */

function TraceError({ outcome, onRetry }: { outcome: NetFailure; onRetry: () => void }) {
  const t = useT();
  return (
    <Callout tone="warn" title={t('conn_traceErrTitle')}>
      {/* aria-live=assertive: a failed network request is worth interrupting for. */}
      <p role="alert">{outcome.message}</p>
      {outcome.kind !== 'offline' && (
        <ul className="conn__causes">
          <li>{t('conn_cause_noInternet')}</li>
          <li>{t('conn_cause_firewall')}</li>
          <li>{t('conn_cause_blocked')}</li>
        </ul>
      )}
      {/* ⚠️ Without this sentence a network error reads as "the extension is broken",
          when in fact 90% of the product — everything above — is untouched. */}
      <p>
        <strong>{t('conn_traceDeviceIntact')}</strong>
      </p>
      <button type="button" className="ui-btn ui-btn--sm" onClick={onRetry}>
        {t('conn_retry')}
      </button>
    </Callout>
  );
}

function IspError({ outcome, onRetry }: { outcome: NetFailure; onRetry: () => void }) {
  const t = useT();
  const title =
    outcome.kind === 'rate-limited'
      ? t('conn_ispErrRateLimited')
      : outcome.kind === 'unauthorized'
        ? t('conn_ispErrTokenRejected')
        : outcome.kind === 'timeout'
          ? t('conn_ispErrNoAnswer')
          : t('conn_ispErrGeneric');

  return (
    <Callout tone="warn" title={title}>
      <p role="alert">{outcome.message}</p>
      {outcome.kind === 'rate-limited' && outcome.retryAfterSec ? (
        <p>{t('conn_ispRetryAfter', { min: Math.ceil(outcome.retryAfterSec / 60) })}</p>
      ) : null}
      {outcome.kind === 'unauthorized' ? (
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          {t('conn_openSettings')}
        </button>
      ) : (
        <button type="button" className="ui-btn ui-btn--sm" onClick={onRetry}>
          {t('conn_retry')}
        </button>
      )}
      <p className="conn__note">{t('conn_ispErrNote')}</p>
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
  const t = useT();
  const locale = useLocale();
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
          {t('dlg_title')}
        </h2>
        <p>{t('dlg_p1')}</p>
        <p className="consent__what">
          <strong>{t('dlg_whatLabel')}</strong>
          {t('dlg_whatBody', { ip })}
        </p>
        <p>
          <strong>{t('dlg_whoLabel')}</strong>
          {t('dlg_whoBody')}
          <strong>{t('dlg_whyLabel')}</strong>
          {t('dlg_whyBody')}
          <strong>{t('dlg_retentionLabel')}</strong>
          {t('dlg_retentionBody')}
        </p>
        <p>{t('dlg_p4')}</p>
        <p className="consent__links">
          <a href="https://ipinfo.io/privacy-policy" target="_blank" rel="noreferrer noopener">
            {t('dlg_privacyIpinfo')}
          </a>
          {' · '}
          <a href="https://blockaly.com/privacy" target="_blank" rel="noreferrer noopener">
            {t('dlg_privacyOurs')}
          </a>
        </p>

        {/* The EN mirror is the copy store reviewers read (design §2.4). Shown only
            when the UI is NOT already English, to avoid duplicating the copy. */}
        {locale !== 'en' && (
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
        )}

        <label className="consent__never">
          <input
            type="checkbox"
            checked={neverAgain}
            onChange={(e) => setNeverAgain(e.target.checked)}
          />
          {t('dlg_never')}
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
            {t('dlg_cancel')}
          </button>
          <button type="submit" className="ui-btn ui-btn--primary">
            {t('dlg_send')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
