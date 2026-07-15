import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Callout, Spinner, useLocale } from '@blur/ui';
import { decodeJwt, JwtError, MAX_JWT_LEN, verifyJwt } from '../../../utils/jwt';
import { applyJwtSegments, clearJwtSegments } from '../../../utils/highlight';
import { EXAMPLE_JWT } from '../../../utils/examples';
import { useT } from '../../../utils/i18n';
import type { JwtVerifyResult } from '../../../utils/types';

// The JWT tab (design §2.6, §2.7, §7.1). A separate TAB — never a separate entry
// point (§1.1) — because a JWT is a CREDENTIAL and needs its own frame.
//
// SECURITY INVARIANTS, enforced by construction:
//   - the token, the HS256 secret and the public key live ONLY in this
//     component's state. There is NO storage item anywhere in this extension
//     that can hold them, they never reach `local:document`, and they die with
//     the tab (design §7.2).
//   - the secret field is type=password, autocomplete=off, spellcheck=false,
//     data-1p-ignore — password managers must not grab it.
//   - verification runs in this tab on WebCrypto. The extension has no network
//     at all, so the token cannot leave even by accident.

export function JwtTab({ initialToken }: { initialToken?: string | null }) {
  const t = useT();
  const locale = useLocale();
  const [token, setToken] = useState<string>(initialToken ?? '');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [secretB64, setSecretB64] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [verify, setVerify] = useState<JwtVerifyResult | 'loading' | null>(null);
  const mirror = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (initialToken) setToken(initialToken);
  }, [initialToken]);

  const decoded = useMemo(() => {
    const trimmed = token.trim();
    if (trimmed === '') return null;
    // Guard before decoding: this memo re-runs on every keystroke, and a
    // multi-MB paste is never a token. Refuse cleanly instead of parsing it.
    if (trimmed.length > MAX_JWT_LEN) {
      return {
        ok: false as const,
        message: t('jwt.tooLong', { len: trimmed.length, max: MAX_JWT_LEN }),
      };
    }
    try {
      return { ok: true as const, value: decodeJwt(trimmed, locale) };
    } catch (err) {
      return {
        ok: false as const,
        message:
          err instanceof JwtError
            ? err.message
            : `${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }, [token, locale, t]);

  // Segment colouring (header / payload / signature) via the Highlight API over
  // the mirrored <pre> — same mechanism as the document text pane, zero markup.
  useEffect(() => {
    const node = mirror.current?.firstChild;
    if (!(node instanceof Text) || !decoded?.ok) {
      clearJwtSegments();
      return;
    }
    applyJwtSegments(node, decoded.value.segments);
    return () => clearJwtSegments();
  }, [decoded, token]);

  const symmetric = decoded?.ok ? decoded.value.symmetric : false;
  const alg = decoded?.ok ? decoded.value.alg : '';

  const runVerify = async () => {
    if (!decoded?.ok) return;
    setVerify('loading');
    try {
      const result = await verifyJwt({
        token: token.trim(),
        alg,
        keyMaterial: symmetric ? secret : key,
        secretIsBase64: secretB64,
        locale,
      });
      setVerify(result);
    } catch (err) {
      setVerify({
        status: 'error',
        detail: t('jwt.verifyErrorTitle') + ': ' + (err instanceof Error ? err.message : String(err)),
      });
    }
  };

  return (
    <div className="jwt">
      {/* Final copy, not a draft (design §7.1). */}
      <Callout tone="poor" title={t('jwt.credentialTitle')}>
        {t('jwt.credentialBody')}
      </Callout>

      <div className="jwt__tokenhead">
        <h2 className="ui-section-heading">{t('jwt.token')}</h2>
        <span className="grow" />
        <Button
          onClick={() => {
            setToken('');
            setSecret('');
            setKey('');
            setVerify(null);
          }}
        >
          {t('jwt.clear')}
        </Button>
        <Button onClick={() => setToken(EXAMPLE_JWT)}>{t('jwt.pasteExample')}</Button>
      </div>

      <textarea
        className="jwt__token mono"
        value={token}
        spellCheck={false}
        autoComplete="off"
        aria-label={t('jwt.tokenAria')}
        onChange={(e) => {
          setToken(e.target.value);
          setVerify(null);
        }}
        placeholder={t('jwt.tokenPlaceholder')}
      />

      {decoded?.ok && (
        <pre ref={mirror} className="jwt__mirror mono" aria-hidden="true">
          {token.trim()}
        </pre>
      )}

      {decoded === null && (
        <Callout tone="info">
          {t('jwt.decodeHint1')}
          <strong>{t('jwt.decodeHintFake')}</strong>
          {t('jwt.decodeHint2')}
        </Callout>
      )}

      {decoded !== null && !decoded.ok && (
        <Callout tone="poor" title={t('jwt.notJwtTitle')}>
          {decoded.message}
        </Callout>
      )}

      {decoded?.ok && (
        <>
          {decoded.value.algNone && (
            <Callout tone="poor" title={t('jwt.algNoneTitle')}>
              {t('jwt.algNoneBody')}
            </Callout>
          )}

          {decoded.value.problems.map((p) => (
            <Callout key={p} tone="warn">
              {p}
            </Callout>
          ))}

          <div className="jwt__grid">
            <section className="jwt__cell">
              <h3 className="ui-section-heading">{t('jwt.header')}</h3>
              <pre className="code mono">{decoded.value.headerText}</pre>
              <h3 className="ui-section-heading">
                {t('jwt.payload')}
                {!decoded.value.payloadIsJson && t('jwt.payloadNotJson')}
              </h3>
              <pre className="code mono">{decoded.value.payloadText}</pre>
            </section>

            <section className="jwt__cell">
              <h3 className="ui-section-heading">{t('jwt.signature')}</h3>
              <p className="fine">
                {t('jwt.algorithmLabel')}
                <strong>{alg}</strong>
                {t('jwt.fromHeader')}
                {symmetric ? t('jwt.symmetricSuffix') : ''}
              </p>

              {symmetric ? (
                <>
                  <Callout tone="warn" title={t('jwt.hs256Title')}>
                    {t('jwt.hs256Body1')}
                    <strong>{t('jwt.hs256BodyStrong')}</strong>
                    {t('jwt.hs256Body2')}
                  </Callout>
                  <div className="jwt__secretrow">
                    <input
                      className="jwt__secret mono"
                      type={showSecret ? 'text' : 'password'}
                      value={secret}
                      autoComplete="off"
                      spellCheck={false}
                      data-1p-ignore=""
                      aria-label={t('jwt.secretAria')}
                      onChange={(e) => {
                        setSecret(e.target.value);
                        setVerify(null);
                      }}
                      placeholder={t('jwt.secretPlaceholder')}
                    />
                    {/* Non-sticky reveal: held, not toggled. */}
                    <button
                      type="button"
                      className="ui-btn ui-btn--sm"
                      aria-label={t('jwt.revealSecretAria')}
                      onPointerDown={() => setShowSecret(true)}
                      onPointerUp={() => setShowSecret(false)}
                      onPointerLeave={() => setShowSecret(false)}
                      onBlur={() => setShowSecret(false)}
                    >
                      👁
                    </button>
                  </div>
                  <label className="check check--inline">
                    <input
                      type="checkbox"
                      checked={secretB64}
                      onChange={(e) => setSecretB64(e.target.checked)}
                    />
                    {t('jwt.secretBase64')}
                  </label>
                </>
              ) : (
                <>
                  <label className="ui-section-heading" htmlFor="jwt-key">
                    {t('jwt.publicKeyLabel')}
                  </label>
                  <p className="fine">
                    {t('jwt.publicKeyNote1')}
                    <strong>{t('jwt.publicKeyNoteStrong')}</strong>
                    {t('jwt.publicKeyNote2')}
                  </p>
                  <textarea
                    id="jwt-key"
                    className="jwt__key mono"
                    value={key}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => {
                      setKey(e.target.value);
                      setVerify(null);
                    }}
                    placeholder={t('jwt.keyPlaceholder')}
                  />
                </>
              )}

              <Button
                variant="primary"
                onClick={() => void runVerify()}
                disabled={verify === 'loading' || decoded.value.algNone}
              >
                {t('jwt.verifySignature')}
              </Button>

              <div aria-live="polite" className="jwt__verify">
                {verify === 'loading' && <Spinner label={t('jwt.verifyingSpinner')} />}
                {verify !== null && verify !== 'loading' && <VerifyResult result={verify} />}
              </div>
            </section>
          </div>

          {decoded.value.claims.length > 0 && (
            <section className="claims" aria-label={t('jwt.claimsAria')}>
              <h3 className="ui-section-heading">{t('jwt.claimsHeading')}</h3>
              <table className="claims__table">
                <tbody>
                  {decoded.value.claims.map((c) => (
                    <tr key={c.name}>
                      <td className="mono">{c.name}</td>
                      <td>{c.label}</td>
                      <td className="mono">{c.value}</td>
                      <td
                        className={
                          c.status === 'poor'
                            ? 'claims__note claims__note--poor'
                            : 'claims__note'
                        }
                      >
                        {c.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Callout tone="warn">{t('jwt.clockNote')}</Callout>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function VerifyResult({ result }: { result: JwtVerifyResult }) {
  const t = useT();
  if (result.status === 'valid') {
    return (
      <Callout tone="ok" title={t('jwt.verifyValidTitle')}>
        <Badge severity="ok">{t('jwt.verified')}</Badge> {result.detail}
      </Callout>
    );
  }
  if (result.status === 'invalid') {
    return (
      <Callout tone="poor" title={t('jwt.verifyInvalidTitle')}>
        {t('jwt.verifyInvalidBody1')}
        <strong>{t('jwt.verifyInvalidStrong')}</strong>
        {t('jwt.verifyInvalidBody2')}
        {result.detail}
      </Callout>
    );
  }
  return (
    <Callout tone="warn" title={t('jwt.verifyErrorTitle')}>
      {result.detail}
    </Callout>
  );
}
