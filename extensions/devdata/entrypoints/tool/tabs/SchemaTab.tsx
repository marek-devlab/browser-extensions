import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Callout, Spinner } from '@blur/ui';
import { validateSchema, type SchemaValidation } from '../../../utils/schema';
import { isCancelled, type RunningJob } from '../../../utils/worker/client';
import { EXAMPLE_SCHEMA } from '../../../utils/examples';
import { MAX_SCHEMA_BYTES, saveSchema, schemaItem } from '../../../utils/storage';
import { formatBytes, type DocApi } from '../../../utils/document';
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
              ? `Схема ${formatBytes(outcome.bytes)} — больше ${formatBytes(MAX_SCHEMA_BYTES)} мы не сохраняем.`
              : outcome.status === 'failed'
                ? `Схема не сохранена: ${outcome.message}`
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
  }, [ready, prefs, schemaText]);

  if (!ready) {
    return (
      <div className="schema">
        <Callout tone="info" title="Нет документа">
          Схема проверяет документ из таба «Данные», а он ещё не открыт.
          <div className="row row--gap">
            <Button variant="primary" onClick={() => onOpenData()}>
              Открыть данные
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
          Документ: <strong>{ready.name ?? 'без имени'}</strong>{' '}
          <span className="fine">({formatBytes(ready.bytes)})</span>
        </span>
        <span className="grow" />
        <span className="fine">
          Драфт: <strong>{prefs?.schemaDraft ?? '2020-12'}</strong> · format:{' '}
          <strong>{prefs?.schemaFormats ? 'проверяется' : 'не проверяется'}</strong> — меняется в
          Настройках
        </span>
      </div>

      <div className="schema__grid">
        <section className="schema__cell">
          <div className="schema__cellhead">
            <h3 className="ui-section-heading">Схема</h3>
            <span className="grow" />
            <Button onClick={() => fileInput.current?.click()}>Файл…</Button>
            <Button onClick={() => setSchemaText(EXAMPLE_SCHEMA)}>Пример</Button>
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
                    `Файл схемы не прочитан: ${err instanceof Error ? err.message : String(err)}`,
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
            placeholder="Вставьте JSON Schema"
            onChange={(e) => setSchemaText(e.target.value)}
          />
          <Button
            variant="primary"
            onClick={run}
            disabled={result === 'loading' || schemaText.trim() === ''}
          >
            Проверить
          </Button>
          {saveNote !== null && <p className="fine">{saveNote}</p>}
        </section>

        <section className="schema__cell">
          <div className="schema__cellhead">
            <h3 className="ui-section-heading">Результат</h3>
            <span className="grow" />
            {result !== null &&
              result !== 'loading' &&
              (result.valid ? (
                <Badge severity="ok">✓ Соответствует</Badge>
              ) : (
                <Badge severity="poor">✗ ошибок: {result.errors.length}</Badge>
              ))}
          </div>

          <div aria-live="polite">
            {result === null && error === null && (
              <Callout tone="info">
                Вставьте схему и нажмите «Проверить». Документ берётся из таба «Данные».
              </Callout>
            )}

            {error !== null && (
              <Callout tone="poor" title="Валидация не выполнена">
                {error}
                <div className="row row--gap">
                  <Button onClick={run}>Повторить</Button>
                </div>
              </Callout>
            )}

            {result === 'loading' && (
              <div className="loading">
                <Spinner label="Валидируем в фоновом потоке…" />
                <p className="fine">
                  Таймаут 5 с → поток будет прерван. Это защита от катастрофического бэктрекинга в
                  <span className="mono"> pattern</span>: остановить зациклившийся regex иначе
                  нельзя.
                </p>
                <Button onClick={() => job.current?.cancel()}>Отменить</Button>
              </div>
            )}

            {result !== null && result !== 'loading' && result.valid && (
              <Callout tone="ok" title="✓ Документ соответствует схеме">
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
                        <Badge severity="poor">ОШИБКА</Badge>
                        <code className="mono">{e.instancePath}</code>
                      </div>
                      <p className="serror__msg">{e.message}</p>
                      <p className="fine mono">схема: {e.schemaPath}</p>
                      <Button onClick={() => onOpenData(e.instancePath)}>Показать в данных</Button>
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
        ⚠ Валидатор: <span className="mono">@cfworker/json-schema</span>. Он не выполняет код (CSP
        MV3 запрещает <span className="mono">eval</span> и <span className="mono">new Function</span>,
        поэтому AJV здесь физически невозможен), а значит НЕ поддерживает:{' '}
        <span className="mono">$ref</span> на внешние URL (сети у расширения нет вообще — такая
        схема отклоняется с явной ошибкой, а не молча пропускается) и custom keywords.
      </Callout>
    </div>
  );
}
