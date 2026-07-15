import { useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle, Callout } from '@blur/ui';
import { useSettings, useThemeSetter } from '../../utils/settings';
import { hasIspPermission, revokeIspPermission } from '../../utils/network';
import type { CopyFormat, IspProvider, Units } from '../../utils/storage';

// OPTIONS (design §2.7): the things a user needs exactly once — appearance, the
// network opt-ins and their REVOCATION, and the honest "what this extension never
// does" list. Nothing here stores data about the user; it stores prefs and consent
// flags only (utils/storage.ts).

export function App() {
  const { settings, update, reset } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);
  const [confirmReset, setConfirmReset] = useState(false);

  // 🔴 The browser is the source of truth for host access (design §6.2). We show
  // what it actually holds — not what our flag believes — and the revoke button is
  // live whenever there is anything real to revoke.
  const [permHeld, setPermHeld] = useState<boolean | null>(null);
  useEffect(() => {
    void hasIspPermission().then(setPermHeld);
  }, []);

  if (!settings) {
    return (
      <main className="opts">
        <p role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> Загрузка…
        </p>
      </main>
    );
  }

  function revokeCf() {
    // Revoking Cloudflare consent also disables auto-fetch (design §3 #11).
    update({ cfConsent: 'unset', autoFetchIp: false });
  }

  async function revokeIsp() {
    // 🔴 A REAL revoke (design §3 #12): it drops the browser's host permission via
    // `permissions.remove` AND resets our flag to `unset`, so the full disclosure
    // dialog is shown again from scratch next time. Not a write-once boolean.
    await revokeIspPermission();
    update({ ispConsent: 'unset' });
    setPermHeld(await hasIspPermission());
  }

  return (
    <main className="opts">
      <h1>Кто я · Настройки</h1>

      <section className="opts__section">
        <h2>Внешний вид</h2>
        <Row label="Тема">
          <ThemeToggle theme={theme} onChange={setTheme} />
        </Row>
        <Row label="Единицы">
          <Segmented<Units>
            value={settings.units}
            options={[
              ['GB', 'ГБ / МБ'],
              ['GiB', 'ГиБ / МиБ'],
            ]}
            onChange={(units) => update({ units })}
          />
        </Row>
        <Row label="Копировать как">
          <Segmented<CopyFormat>
            value={settings.copyFormat}
            options={[
              ['md', 'Markdown'],
              ['json', 'JSON'],
              ['kv', 'key=value'],
            ]}
            onChange={(copyFormat) => update({ copyFormat })}
          />
        </Row>
      </section>

      <section className="opts__section">
        <h2>Сеть</h2>
        <Callout tone="info">
          По умолчанию расширение не делает НИ ОДНОГО сетевого запроса. Всё ниже
          включается вами.
        </Callout>

        <label className="opts__check">
          <input
            type="checkbox"
            checked={settings.allowCloudflare}
            onChange={(e) => update({ allowCloudflare: e.target.checked })}
          />
          <span>
            Разрешить кнопку «Показать мой IP»
            <small>
              Источник: Cloudflare (one.one.one.one/cdn-cgi/trace). Без ключа. Отдаёт IP, страну,
              PoP, TLS. ISP — нет.
            </small>
          </span>
        </label>

        <label className={`opts__check${settings.cfConsent !== 'granted' ? ' opts__check--disabled' : ''}`}>
          <input
            type="checkbox"
            checked={settings.autoFetchIp}
            disabled={settings.cfConsent !== 'granted'}
            onChange={(e) => update({ autoFetchIp: e.target.checked })}
          />
          <span>
            Автоматически показывать IP при открытии попапа
            <small>
              ⚠ Тогда каждый раз при открытии попапа будет сетевой запрос. По умолчанию выключено
              намеренно. Доступно только после первого явного согласия на запрос к Cloudflare.
            </small>
          </span>
        </label>

        <fieldset className="opts__fieldset">
          <legend>Сервис для ISP / ASN</legend>
          <IspRadio
            value={settings.ispProvider}
            onChange={(ispProvider) => update({ ispProvider })}
          />
          {settings.ispProvider === 'ipinfo' && (
            <label className="opts__token">
              Токен ipinfo.io
              <input
                type="password"
                value={settings.ipinfoToken}
                placeholder="Бесплатный Lite-токен"
                onChange={(e) => update({ ipinfoToken: e.target.value })}
              />
              <small>
                ⓘ Хранится только на этом компьютере (storage.local), не синхронизируется, не
                покидает браузер, кроме запросов к ipinfo.io. 🔴 В экспорт и копирование не
                включается никогда.
              </small>
            </label>
          )}
          <Callout tone="info">
            ⓘ Раньше здесь планировался второй, беcтокенный сервис (ipapi.co). Он{' '}
            <strong>не подключён</strong>: его бесплатный тариф, судя по условиям, не допускает
            коммерческого использования — пока это не выяснено юридически, расширение к нему не
            обращается, и его нет ни в манифесте, ни в CSP. 🔴 Ни при какой ошибке ipinfo.io мы не
            переключаемся на другой сервис молча.
          </Callout>
        </fieldset>

        <div className="opts__consents">
          <h3>Состояние согласий</h3>
          <div className="opts__consentrow">
            <span>Cloudflare: {consentLabel(settings.cfConsent)}</span>
            <button type="button" className="ui-btn ui-btn--sm" onClick={revokeCf} disabled={settings.cfConsent === 'unset'}>
              Отозвать
            </button>
          </div>
          <div className="opts__consentrow">
            <span>
              ipinfo.io: {consentLabel(settings.ispConsent)}
              {permHeld === null
                ? ''
                : permHeld
                  ? ' · доступ к хосту выдан браузером'
                  : ' · доступа к хосту нет'}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn--sm"
              onClick={() => void revokeIsp()}
              disabled={settings.ispConsent === 'unset' && permHeld !== true}
            >
              Отозвать
            </button>
          </div>
          <small className="opts__hint">
            ⓘ «Отозвать» для ipinfo — настоящий отзыв: снимает host-доступ через
            permissions.remove и сбрасывает флаг согласия, поэтому в следующий раз диалог
            раскрытия покажется заново. Отозвать доступ можно и в настройках самого браузера —
            расширение это заметит и откатит свой флаг.
          </small>
        </div>
      </section>

      <section className="opts__section">
        <h2>Чего это расширение не делает — никогда</h2>
        <ul className="opts__never">
          <li>не считает и не хранит отпечаток (fingerprint-хеш)</li>
          <li>не хранит историю IP-адресов</li>
          <li>не имеет аналитики и телеметрии</li>
          <li>не может обратиться ни к одному хосту, кроме перечисленных выше (зафиксировано в CSP манифеста)</li>
          <li>
            не подменяет User-Agent —{' '}
            <button type="button" className="linkbtn" popoverTarget="why-no-ua">
              Почему?
            </button>
            <div id="why-no-ua" popover="auto" className="popover" role="note">
              <p className="popover__body">
                Это другой продукт. Подмена UA потребовала бы доступа ко всем сайтам и всё равно
                детектится тривиально (Sec-CH-UA выдаёт настоящий бренд). «Показать» ≠ «подменить».
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section className="opts__section opts__reset">
        {!confirmReset ? (
          <button type="button" className="ui-btn" onClick={() => setConfirmReset(true)}>
            Сбросить все настройки
          </button>
        ) : (
          <div className="opts__confirm">
            <span>Точно сбросить всё и снять host-доступ?</span>
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => setConfirmReset(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--primary"
              onClick={async () => {
                // `reset()` itself drops the ipinfo host permission (utils/settings.tsx),
                // so it is not repeated here.
                await reset();
                setConfirmReset(false);
              }}
            >
              Сбросить
            </button>
          </div>
        )}
        <span className="opts__version">Версия 1.0.0</span>
      </section>
    </main>
  );
}

function consentLabel(c: 'unset' | 'granted' | 'never'): string {
  return c === 'granted' ? 'согласие дано' : c === 'never' ? 'больше не предлагать' : 'не запрошено';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="opts__row">
      <span className="opts__rowlabel">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="theme-toggle" role="group">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={value === v ? 'theme-toggle__btn theme-toggle__btn--active' : 'theme-toggle__btn'}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function IspRadio({ value, onChange }: { value: IspProvider; onChange: (v: IspProvider) => void }) {
  const options: [IspProvider, string][] = [
    ['ipinfo', 'ipinfo.io — нужен ваш токен (бесплатный)'],
    ['off', 'Выключено — кнопка ISP не показывается вообще'],
  ];
  return (
    <div className="opts__radios">
      {options.map(([v, label]) => (
        <label key={v} className="opts__radio">
          <input type="radio" name="ispProvider" checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}
