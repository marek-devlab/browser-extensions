import { useState } from 'react';
import { Button, Callout, MockBadge, Spinner } from '@blur/ui';
import { decodeJwt, verifyJwt } from '../../../utils/jwt';
import { MOCK_JWT_TOKEN } from '../../../utils/mock-data';
import type { JwtVerifyResult } from '../../../utils/types';

// The JWT tab (design §2.6, §2.7, §7.1). It is a SEPARATE tab — not a separate
// entry point — precisely because a JWT is a CREDENTIAL and needs its own frame.
//
// SECURITY INVARIANTS (design §7.2), enforced by construction here:
//   - token / secret / public key live ONLY in component state (RAM). There is
//     NO storage item for them; they are never persisted, never in local:document.
//   - the secret field is type=password, autocomplete=off, spellcheck=false,
//     data-1p-ignore (password managers must not grab it).
// Decode + verify are STUBBED (utils/jwt.ts → mock + todoLogic).

type Alg = 'RS256' | 'HS256';

export function JwtTab() {
  const [token, setToken] = useState<string>(MOCK_JWT_TOKEN);
  const [alg, setAlg] = useState<Alg>('RS256'); // scaffold preview of both frames
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [secretB64, setSecretB64] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [verify, setVerify] = useState<JwtVerifyResult | 'loading' | null>(null);

  const decoded = token.trim() === '' ? null : decodeJwt(token);

  const runVerify = async () => {
    setVerify('loading');
    const material = alg === 'HS256' ? secret : key;
    const result = await verifyJwt(token, material);
    setVerify(result);
  };

  return (
    <div className="jwt">
      <MockBadge />

      {/* The credential framing is MANDATORY and its copy is final (design §7.1). */}
      <Callout tone="poor" title="🔒 JWT — это учётные данные. Токен даёт доступ к вашему аккаунту.">
        Расширение работает на 100% офлайн: токен не покидает браузер, не сохраняется на диск и
        никуда не отправляется. Сети нет вообще. Но подумайте, кому вы вставляете чужие токены —
        в любой инструмент.
      </Callout>

      <div className="jwt__tokenhead">
        <h2 className="ui-section-heading">Токен</h2>
        <span className="grow" />
        <Button onClick={() => setToken('')}>Очистить</Button>
        <Button onClick={() => setToken(MOCK_JWT_TOKEN)}>Вставить пример</Button>
      </div>
      <textarea
        className="jwt__token mono"
        value={token}
        spellCheck={false}
        autoComplete="off"
        aria-label="JWT токен"
        onChange={(e) => setToken(e.target.value)}
        placeholder="eyJhbGciOi… (вставьте JWT — декод произойдёт сразу)"
      />

      {decoded === null ? (
        <Callout tone="info">
          Вставьте токен. Декод — мгновенный и локальный (atob + JSON.parse). Пример выше —
          <strong> фейковый</strong> токен, чтобы попробовать инструмент, не вставляя настоящий.
        </Callout>
      ) : (
        <>
          <div className="jwt__grid">
            <section className="jwt__cell">
              <h3 className="ui-section-heading">Header</h3>
              <pre className="code mono">{decoded.headerText}</pre>
              <h3 className="ui-section-heading">Payload</h3>
              <pre className="code mono">{decoded.payloadText}</pre>
            </section>

            <section className="jwt__cell">
              <h3 className="ui-section-heading">Подпись</h3>
              {/* Scaffold-only: preview both signature frames. */}
              <div className="statepick" role="group" aria-label="Алгоритм (демо)">
                <span className="statepick__label">Алгоритм (демо):</span>
                {(['RS256', 'HS256'] as Alg[]).map((a) => (
                  <button key={a} type="button" className={alg === a ? 'chip chip--active' : 'chip'} aria-pressed={alg === a} onClick={() => { setAlg(a); setVerify(null); }}>{a}</button>
                ))}
              </div>

              {alg === 'RS256' ? (
                <>
                  <p className="fine">Алгоритм: RS256 (из header)</p>
                  <label className="ui-section-heading" htmlFor="jwt-key">Публичный ключ (JWK или PEM)</label>
                  <textarea
                    id="jwt-key"
                    className="jwt__key mono"
                    value={key}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="-----BEGIN PUBLIC KEY-----"
                  />
                </>
              ) : (
                <>
                  <p className="fine">Алгоритм: HS256 (симметричный)</p>
                  <Callout tone="warn" title="⚠ HS256 проверяется общим секретом.">
                    Секрет — это ключ от подписи всех ваших токенов. Мы держим его ТОЛЬКО в
                    оперативной памяти: он не пишется в storage, не попадает в автосохранение и
                    исчезает при закрытии вкладки.
                  </Callout>
                  <div className="jwt__secretrow">
                    <input
                      className="jwt__secret mono"
                      type={showSecret ? 'text' : 'password'}
                      value={secret}
                      autoComplete="off"
                      spellCheck={false}
                      data-1p-ignore
                      aria-label="Секрет HS256"
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="секрет"
                    />
                    <button
                      type="button"
                      className="ui-btn ui-btn--sm"
                      aria-label="Показать секрет"
                      onMouseDown={() => setShowSecret(true)}
                      onMouseUp={() => setShowSecret(false)}
                      onMouseLeave={() => setShowSecret(false)}
                    >
                      👁
                    </button>
                  </div>
                  <label className="check check--inline">
                    <input type="checkbox" checked={secretB64} onChange={(e) => setSecretB64(e.target.checked)} />
                    Секрет в base64
                  </label>
                </>
              )}

              <Button variant="primary" onClick={() => void runVerify()} disabled={verify === 'loading'}>
                Проверить подпись
              </Button>

              <div aria-live="polite" className="jwt__verify">
                {verify === 'loading' && <Spinner label="Проверяем через WebCrypto…" />}
                {verify !== null && verify !== 'loading' && <VerifyResult result={verify} />}
              </div>
            </section>
          </div>

          <section className="claims" aria-label="Претензии">
            <h3 className="ui-section-heading">Претензии (расшифровка)</h3>
            <table className="claims__table">
              <tbody>
                {decoded.claims.map((c) => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td>{c.label}</td>
                    <td className="mono">{c.value}</td>
                    <td className={c.status === 'poor' ? 'claims__note claims__note--poor' : 'claims__note'}>
                      {c.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Callout tone="warn">
              ⚠ Срок действия проверен по часам ВАШЕГО компьютера. Если они врут — врёт и этот вывод.
            </Callout>
          </section>
        </>
      )}
    </div>
  );
}

function VerifyResult({ result }: { result: JwtVerifyResult }) {
  if (result.status === 'valid') {
    return (
      <Callout tone="info" title="✓ ПОДПИСЬ ВЕРНА">
        {result.detail}
      </Callout>
    );
  }
  if (result.status === 'invalid') {
    return (
      <Callout tone="poor" title="✗ ПОДПИСЬ НЕ СОВПАДАЕТ">
        Токен подделан, повреждён или секрет не тот. Отличить эти случаи нельзя. {result.detail}
      </Callout>
    );
  }
  return (
    <Callout tone="warn" title="Не удалось проверить">
      {result.detail}
    </Callout>
  );
}
