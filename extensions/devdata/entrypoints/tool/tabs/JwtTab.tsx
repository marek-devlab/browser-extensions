import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Callout, Spinner } from '@blur/ui';
import { decodeJwt, JwtError, MAX_JWT_LEN, verifyJwt } from '../../../utils/jwt';
import { applyJwtSegments, clearJwtSegments } from '../../../utils/highlight';
import { EXAMPLE_JWT } from '../../../utils/examples';
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
        message: `Слишком длинно для JWT: ${trimmed.length} символов (предел ${MAX_JWT_LEN}). Настоящий токен — несколько КБ.`,
      };
    }
    try {
      return { ok: true as const, value: decodeJwt(trimmed) };
    } catch (err) {
      return {
        ok: false as const,
        message:
          err instanceof JwtError
            ? err.message
            : `Не удалось разобрать токен: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }, [token]);

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
      });
      setVerify(result);
    } catch (err) {
      setVerify({
        status: 'error',
        detail: `Проверка не выполнена: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  return (
    <div className="jwt">
      {/* Final copy, not a draft (design §7.1). */}
      <Callout
        tone="poor"
        title="🔒 JWT — это учётные данные. Токен даёт доступ к вашему аккаунту."
      >
        Расширение работает на 100% офлайн: токен не покидает браузер, не сохраняется на диск и
        никуда не отправляется. Сети у расширения нет вообще — ни аналитики, ни телеметрии, ни
        отчётов об ошибках. И всё же: относитесь к токенам как к паролям. Прежде чем вставить
        чужой токен в любой онлайн-инструмент — подумайте, куда он уедет.
      </Callout>

      <div className="jwt__tokenhead">
        <h2 className="ui-section-heading">Токен</h2>
        <span className="grow" />
        <Button
          onClick={() => {
            setToken('');
            setSecret('');
            setKey('');
            setVerify(null);
          }}
        >
          Очистить
        </Button>
        <Button onClick={() => setToken(EXAMPLE_JWT)}>Вставить пример</Button>
      </div>

      <textarea
        className="jwt__token mono"
        value={token}
        spellCheck={false}
        autoComplete="off"
        aria-label="JWT токен"
        onChange={(e) => {
          setToken(e.target.value);
          setVerify(null);
        }}
        placeholder="eyJhbGciOi… (вставьте JWT — декод произойдёт сразу)"
      />

      {decoded?.ok && (
        <pre ref={mirror} className="jwt__mirror mono" aria-hidden="true">
          {token.trim()}
        </pre>
      )}

      {decoded === null && (
        <Callout tone="info">
          Вставьте токен — декод мгновенный и локальный (atob + JSON.parse, без библиотек и без
          сети). Кнопка «Вставить пример» подставляет <strong>фейковый</strong> токен: его подпись
          не настоящая, поэтому проверка на нём честно провалится. Так можно попробовать
          инструмент, не вставляя в него настоящий токен.
        </Callout>
      )}

      {decoded !== null && !decoded.ok && (
        <Callout tone="poor" title="✗ Это не разбирается как JWT">
          {decoded.message}
        </Callout>
      )}

      {decoded?.ok && (
        <>
          {decoded.value.algNone && (
            <Callout tone="poor" title="⛔ Токен заявляет alg: none — подписи нет">
              Такой токен может подделать кто угодно: подпись не проверяется по определению. Если
              ваш сервер его принимает — это уязвимость, а не особенность.
            </Callout>
          )}

          {decoded.value.problems.map((p) => (
            <Callout key={p} tone="warn">
              {p}
            </Callout>
          ))}

          <div className="jwt__grid">
            <section className="jwt__cell">
              <h3 className="ui-section-heading">Header</h3>
              <pre className="code mono">{decoded.value.headerText}</pre>
              <h3 className="ui-section-heading">
                Payload {!decoded.value.payloadIsJson && '(не JSON — показан как есть)'}
              </h3>
              <pre className="code mono">{decoded.value.payloadText}</pre>
            </section>

            <section className="jwt__cell">
              <h3 className="ui-section-heading">Подпись</h3>
              <p className="fine">
                Алгоритм: <strong>{alg}</strong> (из header)
                {symmetric ? ' — симметричный' : ''}
              </p>

              {symmetric ? (
                <>
                  <Callout tone="warn" title="⚠ HS256 проверяется общим секретом.">
                    Секрет — это ключ, которым подписываются все ваши токены; кто его знает, тот
                    выпускает токены от вашего имени. Мы держим его <strong>только в оперативной
                    памяти</strong>: он не пишется в хранилище расширения, не попадает в
                    автосохранение документа и исчезает, когда вы закрываете вкладку. Поле не
                    автозаполняется и не проверяется орфографией.
                  </Callout>
                  <div className="jwt__secretrow">
                    <input
                      className="jwt__secret mono"
                      type={showSecret ? 'text' : 'password'}
                      value={secret}
                      autoComplete="off"
                      spellCheck={false}
                      data-1p-ignore=""
                      aria-label="Секрет HS256"
                      onChange={(e) => {
                        setSecret(e.target.value);
                        setVerify(null);
                      }}
                      placeholder="общий секрет"
                    />
                    {/* Non-sticky reveal: held, not toggled. */}
                    <button
                      type="button"
                      className="ui-btn ui-btn--sm"
                      aria-label="Показать секрет, пока кнопка нажата"
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
                    Секрет в base64
                  </label>
                </>
              ) : (
                <>
                  <label className="ui-section-heading" htmlFor="jwt-key">
                    Публичный ключ (JWK или PEM)
                  </label>
                  <p className="fine">
                    Вставьте <strong>публичный</strong> ключ. Приватный здесь не нужен — и вставлять
                    его не следует ни сюда, ни куда-либо ещё.
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
                    placeholder={'-----BEGIN PUBLIC KEY-----\n… или {"kty":"RSA", …}'}
                  />
                </>
              )}

              <Button
                variant="primary"
                onClick={() => void runVerify()}
                disabled={verify === 'loading' || decoded.value.algNone}
              >
                Проверить подпись
              </Button>

              <div aria-live="polite" className="jwt__verify">
                {verify === 'loading' && <Spinner label="Проверяем локально через WebCrypto…" />}
                {verify !== null && verify !== 'loading' && <VerifyResult result={verify} />}
              </div>
            </section>
          </div>

          {decoded.value.claims.length > 0 && (
            <section className="claims" aria-label="Претензии">
              <h3 className="ui-section-heading">Претензии (расшифровка)</h3>
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
              <Callout tone="warn">
                ⚠ Срок действия проверен по часам ВАШЕГО компьютера. Если они врут — врёт и этот
                вывод.
              </Callout>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function VerifyResult({ result }: { result: JwtVerifyResult }) {
  if (result.status === 'valid') {
    return (
      <Callout tone="ok" title="✓ ПОДПИСЬ ВЕРНА">
        <Badge severity="ok">Проверено</Badge> {result.detail}
      </Callout>
    );
  }
  if (result.status === 'invalid') {
    return (
      <Callout tone="poor" title="✗ ПОДПИСЬ НЕ СОВПАДАЕТ">
        Токен подделан, повреждён или ключ не тот. <strong>Отличить эти случаи нельзя</strong> —
        криптографически они неразличимы. {result.detail}
      </Callout>
    );
  }
  return (
    <Callout tone="warn" title="Не удалось проверить">
      {result.detail}
    </Callout>
  );
}
