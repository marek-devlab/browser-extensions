import { useEffect, useState, type ReactNode } from 'react';
import { Callout, LanguageSwitcher, LocaleProvider, ThemeToggle, type Locale } from '@blur/ui';
import { useSettings, useThemeSetter, useWhoamiLocale } from '../../utils/settings';
import { useT, type TT } from '../../utils/i18n';
import { hasIspPermission, revokeIspPermission } from '../../utils/network';
import type { CopyFormat, IspProvider, Units } from '../../utils/storage';

// OPTIONS (design §2.7): the things a user needs exactly once — appearance, the
// network opt-ins and their REVOCATION, and the honest "what this extension never
// does" list. Nothing here stores data about the user; it stores prefs and consent
// flags only (utils/storage.ts). This surface also owns the runtime language switch.

export function App() {
  const { locale, setLocale } = useWhoamiLocale();
  return (
    <LocaleProvider locale={locale}>
      <OptionsApp locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function OptionsApp({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const t = useT();
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
          <span className="ui-spinner" aria-hidden="true" /> {t('loading')}
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
      <h1>{t('opt_title')}</h1>

      <section className="opts__section">
        <h2>{t('opt_appearance')}</h2>
        <Row label={t('opt_theme')}>
          <ThemeToggle theme={theme} onChange={setTheme} />
        </Row>
        <Row label={t('language')}>
          <LanguageSwitcher locale={locale} onChange={setLocale} label={t('langSwitcherLabel')} />
        </Row>
        <Row label={t('opt_units')}>
          <Segmented<Units>
            value={settings.units}
            options={[
              ['GB', t('opt_unitsGb')],
              ['GiB', t('opt_unitsGib')],
            ]}
            onChange={(units) => update({ units })}
          />
        </Row>
        <Row label={t('opt_copyAs')}>
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
        <h2>{t('opt_network')}</h2>
        <Callout tone="info">{t('opt_networkCallout')}</Callout>

        <label className="opts__check">
          <input
            type="checkbox"
            checked={settings.allowCloudflare}
            onChange={(e) => update({ allowCloudflare: e.target.checked })}
          />
          <span>
            {t('opt_allowIpBtn')}
            <small>{t('opt_allowIpSmall')}</small>
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
            {t('opt_autoFetch')}
            <small>{t('opt_autoFetchSmall')}</small>
          </span>
        </label>

        <fieldset className="opts__fieldset">
          <legend>{t('opt_ispLegend')}</legend>
          <IspRadio
            value={settings.ispProvider}
            onChange={(ispProvider) => update({ ispProvider })}
          />
          {settings.ispProvider === 'ipinfo' && (
            <label className="opts__token">
              {t('opt_ipinfoTokenLabel')}
              <input
                type="password"
                value={settings.ipinfoToken}
                placeholder={t('opt_ipinfoTokenPlaceholder')}
                onChange={(e) => update({ ipinfoToken: e.target.value })}
              />
              <small>{t('opt_ipinfoTokenSmall')}</small>
            </label>
          )}
          <Callout tone="info">{t('opt_ipapiCallout')}</Callout>
        </fieldset>

        <div className="opts__consents">
          <h3>{t('opt_consentsTitle')}</h3>
          <div className="opts__consentrow">
            <span>Cloudflare: {consentLabel(settings.cfConsent, t)}</span>
            <button type="button" className="ui-btn ui-btn--sm" onClick={revokeCf} disabled={settings.cfConsent === 'unset'}>
              {t('opt_revoke')}
            </button>
          </div>
          <div className="opts__consentrow">
            <span>
              ipinfo.io: {consentLabel(settings.ispConsent, t)}
              {permHeld === null ? '' : permHeld ? t('opt_hostGranted') : t('opt_hostNone')}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn--sm"
              onClick={() => void revokeIsp()}
              disabled={settings.ispConsent === 'unset' && permHeld !== true}
            >
              {t('opt_revoke')}
            </button>
          </div>
          <small className="opts__hint">{t('opt_ipinfoRevokeHint')}</small>
        </div>
      </section>

      <section className="opts__section">
        <h2>{t('opt_neverTitle')}</h2>
        <ul className="opts__never">
          <li>{t('opt_never1')}</li>
          <li>{t('opt_never2')}</li>
          <li>{t('opt_never3')}</li>
          <li>{t('opt_never4')}</li>
          <li>
            {t('opt_never5Pre')}
            <button type="button" className="linkbtn" popoverTarget="why-no-ua">
              {t('opt_whyBtn')}
            </button>
            <div id="why-no-ua" popover="auto" className="popover" role="note">
              <p className="popover__body">{t('opt_whyBody')}</p>
            </div>
          </li>
        </ul>
      </section>

      <section className="opts__section opts__reset">
        {!confirmReset ? (
          <button type="button" className="ui-btn" onClick={() => setConfirmReset(true)}>
            {t('opt_resetBtn')}
          </button>
        ) : (
          <div className="opts__confirm">
            <span>{t('opt_resetConfirmQ')}</span>
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => setConfirmReset(false)}>
              {t('opt_cancel')}
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
              {t('opt_resetDo')}
            </button>
          </div>
        )}
        <span className="opts__version">{t('opt_version')}</span>
      </section>
    </main>
  );
}

function consentLabel(c: 'unset' | 'granted' | 'never', t: TT): string {
  return c === 'granted' ? t('consent_granted') : c === 'never' ? t('consent_never') : t('consent_unset');
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
  const t = useT();
  const options: [IspProvider, string][] = [
    ['ipinfo', t('opt_ispRadioIpinfo')],
    ['off', t('opt_ispRadioOff')],
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
