import { useEffect, useRef, useState } from 'react';
import { Callout, MockBadge } from '@blur/ui';
import { FieldRow, val, na, type Field } from './field';
import {
  fetchTrace,
  fetchIsp,
  requestIspPermission,
  hasIspPermission,
  flag,
  type TraceResult,
  type IspResult,
  type NetOutcome,
} from './network';
import type { WhoamiSettings } from './storage';

// The Connection (T1/T2) section — shared by the popup and the report. It owns the
// THREE real IP states (not-requested → granted+loaded → failed), the always-on
// inline disclosure (place A, design §6.1), the ISP opt-in `<dialog>` (place B) and
// the per-value source line (place C). The values it shows are MOCK (MockBadge),
// but the disclosure, the timeouts and the `permissions.request()` flow are real.

type Load<T> = { status: 'idle' } | { status: 'loading' } | { status: 'done'; outcome: NetOutcome<T> };

export function ConnectionSection({
  settings,
  update,
}: {
  settings: WhoamiSettings;
  update: (patch: Partial<WhoamiSettings>) => void;
}) {
  const [trace, setTrace] = useState<Load<TraceResult>>({ status: 'idle' });
  const [isp, setIsp] = useState<Load<IspResult>>({ status: 'idle' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ispDenied, setIspDenied] = useState(false);

  // 🔴 Reconcile our ISP consent flag against the browser on every mount: the user
  // may have revoked the host permission in chrome://extensions (design §6.2).
  useEffect(() => {
    void hasIspPermission().then((held) => {
      if (!held && settings.ispConsent === 'granted') update({ ispConsent: 'unset' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⚠️ The ONLY branch that touches the network on open — gated behind an explicit
  // prior consent, off by default, which is what keeps the manifest at
  // required:['none'] (design §4.1, §6.3).
  useEffect(() => {
    if (settings.autoFetchIp && settings.cfConsent === 'granted' && trace.status === 'idle') {
      void runTrace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runTrace() {
    if (trace.status === 'loading') return; // 🔴 no double request → no double reveal
    update({ cfConsent: 'granted' }); // boolean flag, NOT data
    setTrace({ status: 'loading' });
    const outcome = await fetchTrace();
    setTrace({ status: 'done', outcome });
  }

  async function runIsp() {
    // `provider` is captured as a local const so its narrowing survives across the
    // awaits below (a property access on `settings` would be re-widened).
    const provider = settings.ispProvider;
    if (provider === 'off') return;
    // permissions.request must be the FIRST call in the gesture handler (§4.3).
    setIspDenied(false);
    const granted = await requestIspPermission(provider);
    if (!granted) {
      setIspDenied(true);
      update({ ispConsent: 'unset' });
      return;
    }
    update({ ispConsent: 'granted' });
    setIsp({ status: 'loading' });
    const outcome = await fetchIsp(provider, settings.ipinfoToken);
    setIsp({ status: 'done', outcome });
  }

  function onIspClick() {
    if (settings.ispConsent === 'granted') {
      void runIsp();
    } else {
      setDialogOpen(true);
    }
  }

  // ---- state (a): not requested ------------------------------------------------
  if (!settings.allowCloudflare) {
    return (
      <Callout tone="info" title="Соединение">
        Кнопка «Показать мой IP» отключена в настройках. Данные об устройстве выше
        не зависят от сети.
      </Callout>
    );
  }

  const traceOutcome = trace.status === 'done' ? trace.outcome : null;
  const hasIp = traceOutcome?.ok === true;

  return (
    <div className="conn">
      {/* Local, no-network connection fields are always present (§2.1). */}
      {localConnRows().map((r) => (
        <FieldRow key={r.label} label={r.label} field={r.field} />
      ))}

      {!hasIp && trace.status !== 'loading' && (
        <>
          <FieldRow label="Мой IP-адрес" field={na('not-requested')} copyable={false} />
          <FieldRow label="Страна" field={na('not-requested')} copyable={false} />
          {/* PLACE A — always-on inline disclosure, physically above the button. */}
          <Callout tone="info">
            Чтобы узнать свой публичный IP, браузер должен спросить у внешнего
            сервера — локально он неизвестен. Мы отправим запрос в{' '}
            <strong>Cloudflare</strong>; он увидит ваш IP. Ничего не сохраняется.
          </Callout>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => void runTrace()}>
            Показать мой IP и страну
          </button>
        </>
      )}

      {trace.status === 'loading' && (
        <p className="conn__status" role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> Запрашиваем IP у Cloudflare…
        </p>
      )}

      {traceOutcome && traceOutcome.ok === false && (
        <TraceError outcome={traceOutcome} onRetry={() => void runTrace()} />
      )}

      {hasIp && (
        <>
          <MockBadge />
          <IpBlock trace={traceOutcome!.value} onRefresh={() => void runTrace()} />

          {/* T2 · ISP subsection */}
          <div className="conn__isp">
            <p className="conn__divider">ISP и ASN</p>
            {settings.ispProvider === 'off' ? (
              <FieldRow label="Провайдер" field={na('not-requested')} copyable={false} />
            ) : isp.status === 'done' && isp.outcome.ok ? (
              <>
                <MockBadge />
                <IspBlock isp={isp.outcome.value} provider={settings.ispProvider} />
              </>
            ) : isp.status === 'loading' ? (
              <p className="conn__status" role="status" aria-live="polite">
                <span className="ui-spinner" aria-hidden="true" /> Запрашиваем провайдера…
              </p>
            ) : ispDenied ? (
              <Callout tone="info" title="Доступ к ipinfo.io не выдан">
                IP никуда не ушёл. Остальное работает как работало.{' '}
                <button type="button" className="linkbtn" onClick={() => void runIsp()}>
                  Попробовать снова
                </button>
              </Callout>
            ) : isp.status === 'done' && !isp.outcome.ok ? (
              <IspError outcome={isp.outcome} onRetry={() => void runIsp()} />
            ) : settings.ispConsent === 'never' ? (
              // 🔴 The user chose "don't ask again" — the button is gone for good.
              // It can be brought back in Options (design §3 #9).
              <FieldRow label="Провайдер" field={na('not-requested')} copyable={false} />
            ) : (
              <>
                <FieldRow label="Провайдер" field={na('not-requested')} copyable={false} />
                <Callout tone="info">
                  Cloudflare не отдаёт ISP. Для этого нужен второй сервис —{' '}
                  {settings.ispProvider === 'ipinfo' ? 'ipinfo.io' : 'ipapi.co'}.
                </Callout>
                <button type="button" className="ui-btn" onClick={onIspClick}>
                  Узнать провайдера (ISP / ASN)…
                </button>
              </>
            )}
          </div>
        </>
      )}

      {dialogOpen && (
        <IpConsentDialog
          ip={hasIp ? traceOutcome!.value.ip : '203.0.113.42'}
          onCancel={(neverAgain) => {
            setDialogOpen(false);
            if (neverAgain) update({ ispConsent: 'never' });
          }}
          onConfirm={() => {
            setDialogOpen(false);
            void runIsp();
          }}
        />
      )}
    </div>
  );
}

function localConnRows(): { label: string; field: Field }[] {
  const conn = 'connection' in navigator
    ? (navigator as unknown as { connection?: { effectiveType?: string } }).connection
    : undefined;
  return [
    {
      label: 'Тип соединения',
      field: conn?.effectiveType
        ? val(`${conn.effectiveType} (оценка браузера)`, { approx: true })
        : na('not-implemented'),
    },
    {
      label: 'Онлайн',
      field: val(navigator.onLine ? 'да (есть интерфейс)' : 'нет'),
    },
  ];
}

function IpBlock({ trace, onRefresh }: { trace: TraceResult; onRefresh: () => void }) {
  const uaMatches = trace.uag === navigator.userAgent;
  const now = new Date().toLocaleTimeString();
  return (
    <div className="ipblock">
      <FieldRow label="Мой IP" field={val(trace.ip, { ltr: true })} />
      <FieldRow label="Версия" field={val(trace.ipVersion)} />
      <FieldRow
        label="Страна (по IP)"
        field={val(
          `${flag(trace.countryCode)} ${trace.countryName} (${trace.countryCode})`.trim(),
          { note: 'Геолокация по IP приблизительна и часто указывает на город провайдера, а не на ваш.' },
        )}
      />
      <FieldRow label="Ближайший узел Cloudflare" field={val(trace.colo)} />
      <FieldRow label="TLS" field={val(trace.tls)} />
      <FieldRow label="Протокол" field={val(trace.http)} />
      <FieldRow label="WARP" field={val(trace.warp)} />
      <FieldRow
        label="UA глазами сервера"
        field={val(uaMatches ? 'совпадает с локальным' : '⚠ отличается — возможна подмена UA')}
        copyable={false}
      />
      {/* PLACE C — source + timestamp + "not saved", always beside the value. */}
      <p className="ipblock__source">
        Получено {now} · Cloudflare · не сохранено.{' '}
        <button type="button" className="linkbtn" onClick={onRefresh}>
          Обновить ⟳
        </button>
      </p>
    </div>
  );
}

function IspBlock({ isp, provider }: { isp: IspResult; provider: 'ipinfo' | 'ipapi' }) {
  const now = new Date().toLocaleTimeString();
  return (
    <div className="ipblock">
      <FieldRow label="Провайдер (ISP)" field={val(isp.isp, { ltr: true })} />
      <FieldRow label="ASN" field={val(isp.asn, { ltr: true })} />
      <FieldRow label="Домен" field={val(isp.domain, { ltr: true })} />
      <FieldRow label="Континент" field={val(isp.continent)} />
      <p className="ipblock__source">
        Источник {provider === 'ipinfo' ? 'ipinfo.io' : 'ipapi.co'} · {now} · не сохранено.
      </p>
    </div>
  );
}

function TraceError({ outcome, onRetry }: { outcome: Extract<NetOutcome<TraceResult>, { ok: false }>; onRetry: () => void }) {
  return (
    <Callout tone="warn" title="Не удалось узнать IP">
      <p>{outcome.message}</p>
      <p>Возможные причины: нет интернета; запрос режет файрвол или другое расширение; 1.1.1.1 заблокирован провайдером.</p>
      <p>Данные об устройстве выше — на месте: они не зависят от сети.</p>
      <button type="button" className="ui-btn ui-btn--sm" onClick={onRetry}>
        Попробовать снова
      </button>
    </Callout>
  );
}

function IspError({ outcome, onRetry }: { outcome: Extract<NetOutcome<IspResult>, { ok: false }>; onRetry: () => void }) {
  const rate = outcome.kind === 'rate-limited';
  return (
    <Callout tone="warn" title={rate ? 'Лимит запросов исчерпан' : outcome.kind === 'unauthorized' ? 'Токен не принят' : 'Не удалось узнать провайдера'}>
      <p>{outcome.message}</p>
      {rate && outcome.retryAfterSec ? <p>Попробуйте через ~{Math.ceil(outcome.retryAfterSec / 60)} мин.</p> : null}
      <button type="button" className="ui-btn ui-btn--sm" onClick={onRetry}>
        Попробовать снова
      </button>
    </Callout>
  );
}

/**
 * PLACE B — the modal disclosure `<dialog>` shown before the FIRST ipinfo call
 * (design §2.4). Copy is FINAL (RU + EN), not placeholder. 🔴 The confirm button is
 * the VERB "Отправить IP / Send my IP", never "OK". Default focus is on Cancel,
 * Esc = refusal (native `<dialog>` gives the focus-trap and Esc for free).
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

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  // Esc / backdrop → cancel (design §2.4, §11). `close` fires for both.
  function handleClose() {
    onCancel(neverAgain);
  }

  return (
    <dialog ref={ref} className="consent" onCancel={handleClose} onClose={handleClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          // Prevent the native close so we run the gesture ourselves (permission
          // request must fire from this exact submit — see network.runIsp caller).
          e.preventDefault();
          onConfirm();
        }}
      >
        <h2 className="consent__title">Отправить ваш IP-адрес на ipinfo.io?</h2>
        <p>
          Название провайдера (ISP) и номер сети (ASN) нельзя вычислить в браузере —
          их знает только внешняя база. Чтобы её спросить, расширение отправит{' '}
          <strong>ОДИН HTTPS-запрос на ipinfo.io</strong>.
        </p>
        <p className="consent__what">
          <strong>Что уйдёт:</strong> ваш публичный IP-адрес (<span dir="ltr">{ip}</span>). Ничего
          больше — ни страниц, ни истории, ни данных об устройстве.
        </p>
        <p>
          <strong>Кто получит:</strong> ipinfo.io (США). <strong>Зачем:</strong> только чтобы
          показать ответ вам. <strong>Хранение:</strong> ответ живёт в этом окне. Мы не пишем его
          ни в файл, ни в хранилище браузера, ни на наш сервер — у нас его нет. Аналитики нет.
        </p>
        <p>
          Дальше браузер спросит разрешение на доступ к ipinfo.io. Это второе, независимое от нас
          подтверждение — и вы сможете отозвать его в настройках браузера в любой момент.
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

        {/* EN mirror for the `en` locale and store reviewers (design §2.4). */}
        <details className="consent__en">
          <summary>English</summary>
          <p>
            <strong>Send your IP address to ipinfo.io?</strong> Your ISP name and network number
            (ASN) cannot be worked out inside the browser — only an external database knows them.
            To ask it, this extension will make <strong>one HTTPS request to ipinfo.io</strong>.
          </p>
          <p>
            <strong>What leaves your browser:</strong> your public IP address ({ip}). Nothing else —
            no page URLs, no browsing history, no device data. <strong>Who receives it:</strong>{' '}
            ipinfo.io (USA). <strong>Why:</strong> solely to show you the answer.{' '}
            <strong>Retention:</strong> the answer lives in this window only. It is not written to a
            file, to browser storage, or to any server of ours — we do not operate one. There is no
            analytics. Next, your browser will ask you to grant access to ipinfo.io. That is a
            second, independent confirmation, and you can revoke it at any time.
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
          {/* Default focus → Cancel. Both buttons secondary weight; no dark pattern. */}
          <button type="button" className="ui-btn" autoFocus onClick={() => onCancel(neverAgain)}>
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
