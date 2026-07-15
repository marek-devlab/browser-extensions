import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Callout, Spinner, useLocale } from '@blur/ui';
import { validateSchema, type SchemaValidation } from '../../../utils/schema';
import { isCancelled, type RunningJob } from '../../../utils/worker/client';
import { EXAMPLE_SCHEMA } from '../../../utils/examples';
import { MAX_SCHEMA_BYTES, saveSchema, schemaItem } from '../../../utils/storage';
import { formatBytes, type DocApi } from '../../../utils/document';
import { useT } from '../../../utils/i18n';
import type { DevdataPrefs } from '../../../utils/storage';

// The Schema tab (design §2.8, §4.5). Two inputs (document + schema) do not fit
// the Data tab, so validation is its own tab. The document comes from the Data
// tab — there is only ever one document (§4.2).
//
// Validator: @cfworker/json-schema, in the Worker, with a 5 s budget. A schema
// is user-supplied and a `pattern` can be a ReDoS bomb; `terminate()` is the
// only cure (utils/worker/client.ts). ajv is impossible under MV3's CSP.

export function SchemaTab({
  prefs,
  doc,
  onOpenData,
}: {
  prefs: DevdataPrefs | null;
  doc: DocApi;
  onOpenData: (path?: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [schemaText, setSchemaText] = useState('');
  const [result, setResult] = useState<SchemaValidation | 'loading' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const job = useRef<RunningJob<SchemaValidation> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!prefs?.restore) return;
    void schemaItem
      .getValue()
      .then((cached) => {
        if (cached) setSchemaText(cached);
      })
      // A corrupt/unavailable cache must not take the tab down — start empty.
      .catch(() => undefined);
  }, [prefs?.restore]);

  useEffect(() => () => job.current?.cancel(), []);

  const ready = doc.state.phase === 'ready' ? doc.state.doc : null;

  const run = useCallback(() => {
    if (!ready || !prefs) return;
    setError(null);
    setResult('loading');
    job.current?.cancel();
    const running = validateSchema(ready, schemaText, prefs);
    job.current = running;
    running.promise.then(
      (r) => {
        job.current = null;
        setResult(r);
        void saveSchema(schemaText, prefs.restore).then((outcome) => {
          setSaveNote(
            outcome.status === 'skipped-too-big'
              ? t('schema.saveTooBig', {
                  size: formatBytes(outcome.bytes, locale),
                  max: formatBytes(MAX_SCHEMA_BYTES, locale),
                })
              : outcome.status === 'failed'
                ? t('schema.saveFailed', { message: outcome.message })
                : null,
          );
        });
      },
      (err: unknown) => {
        job.current = null;
        if (isCancelled(err)) {
          setResult(null);
          return;
        }
        setResult(null);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  }, [ready, prefs, schemaText, locale, t]);

  if (!ready) {
    return (
      <div className="schema">
        <Callout tone="info" title={t('schema.noDocTitle')}>
          {t('schema.noDocBody')}
          <div className="row row--gap">
            <Button variant="primary" onClick={() => onOpenData()}>
              {t('schema.openData')}
            </Button>
          </div>
        </Callout>
      </div>
    );
  }

  return (
    <div className="schema">
      <div className="schema__head">
        <span>
          {t('schema.documentLabel')}
          <strong>{ready.name ?? t('schema.noName')}</strong>{' '}
          <span className="fine">({formatBytes(ready.bytes, locale)})</span>
        </span>
        <span className="grow" />
        <span className="fine">
          {t('schema.draftLabel')}
          <strong>{prefs?.schemaDraft ?? '2020-12'}</strong>
          {' · format: '}
          <strong>
            {prefs?.schemaFormats ? t('schema.formatChecked') : t('schema.formatNotChecked')}
          </strong>
          {t('schema.changedInSettings')}
        </span>
      </div>

      <div className="schema__grid">
        <section className="schema__cell">
          <div className="schema__cellhead">
            <h3 className="ui-section-heading">{t('tab.schema')}</h3>
            <span className="grow" />
            <Button onClick={() => fileInput.current?.click()}>{t('schema.fileBtn')}</Button>
            <Button onClick={() => setSchemaText(EXAMPLE_SCHEMA)}>{t('schema.exampleBtn')}</Button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  setSchemaText(await file.text());
                } catch (err) {
                  setError(
                    t('schema.fileReadFail', {
                      message: err instanceof Error ? err.message : String(err),
                    }),
                  );
                }
              }}
            />
          </div>
          <textarea
            className="schema__input mono"
            value={schemaText}
            spellCheck={false}
            aria-label="JSON Schema"
            placeholder={t('schema.inputPlaceholder')}
            onChange={(e) => setSchemaText(e.target.value)}
          />
          <Button
            variant="primary"
            onClick={run}
            disabled={result === 'loading' || schemaText.trim() === ''}
          >
            {t('schema.validateBtn')}
          </Button>
          {saveNote !== null && <p className="fine">{saveNote}</p>}
        </section>

        <section className="schema__cell">
          <div className="schema__cellhead">
            <h3 className="ui-section-heading">{t('schema.resultHeading')}</h3>
            <span className="grow" />
            {result !== null &&
              result !== 'loading' &&
              (result.valid ? (
                <Badge severity="ok">{t('schema.conforms')}</Badge>
              ) : (
                <Badge severity="poor">
                  {t('schema.errorsCount', { count: result.errors.length })}
                </Badge>
              ))}
          </div>

          <div aria-live="polite">
            {result === null && error === null && (
              <Callout tone="info">{t('schema.intro')}</Callout>
            )}

            {error !== null && (
              <Callout tone="poor" title={t('schema.validationFailedTitle')}>
                {error}
                <div className="row row--gap">
                  <Button onClick={run}>{t('common.retry')}</Button>
                </div>
              </Callout>
            )}

            {result === 'loading' && (
              <div className="loading">
                <Spinner label={t('schema.validatingSpinner')} />
                <p className="fine">
                  {t('schema.timeoutNote1')}
                  <span className="mono">pattern</span>
                  {t('schema.timeoutNote2')}
                </p>
                <Button onClick={() => job.current?.cancel()}>{t('data.cancelParse')}</Button>
              </div>
            )}

            {result !== null && result !== 'loading' && result.valid && (
              <Callout tone="ok" title={t('schema.conformsTitle')}>
                <ul className="warns__list">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Callout>
            )}

            {result !== null && result !== 'loading' && !result.valid && (
              <>
                <ul className="serrors">
                  {result.errors.map((e, i) => (
                    <li key={i} className="serror">
                      <div className="serror__head">
                        <Badge severity="poor">{t('schema.errorBadge')}</Badge>
                        <code className="mono">{e.instancePath}</code>
                      </div>
                      <p className="serror__msg">{e.message}</p>
                      <p className="fine mono">{t('schema.schemaPathLabel', { path: e.schemaPath })}</p>
                      <Button onClick={() => onOpenData(e.instancePath)}>
                        {t('schema.showInData')}
                      </Button>
                    </li>
                  ))}
                </ul>
                <ul className="warns__list">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>

      <Callout tone="warn">
        {t('schema.validatorNote1')}
        <span className="mono">@cfworker/json-schema</span>
        {t('schema.validatorNote2')}
        <span className="mono">eval</span>
        {t('schema.validatorNote3')}
        <span className="mono">new Function</span>
        {t('schema.validatorNote4')}
        <span className="mono">$ref</span>
        {t('schema.validatorNote5')}
      </Callout>
    </div>
  );
}
