import { useState } from 'react';
import { Badge, Button, Callout, MockBadge, Spinner } from '@blur/ui';
import { validateSchema, type SchemaValidation } from '../../../utils/schema';
import { MOCK_SCHEMA_TEXT } from '../../../utils/mock-data';
import type { DevdataPrefs, SchemaDraftPref } from '../../../utils/storage';

// The Schema tab (design §2.8, §4.5). Two inputs (document + schema) don't fit
// the Data tab, so JSON Schema validation is its own tab. It validates the
// document already parsed on the Data tab.
//
// Validator = @cfworker/json-schema, NOT ajv (MV3 CSP forbids ajv's new
// Function). Validation is STUBBED (utils/schema.ts → mock + todoLogic) and runs
// (will run) in a Worker with a 5s timeout → terminate() on a runaway pattern.

const DRAFTS: SchemaDraftPref[] = ['2020-12', '2019-09', '7', '4'];

export function SchemaTab({ prefs }: { prefs: DevdataPrefs | null }) {
  const [schemaText, setSchemaText] = useState(MOCK_SCHEMA_TEXT);
  const [result, setResult] = useState<SchemaValidation | 'loading' | null>(null);
  const draft = prefs?.schemaDraft ?? '2020-12';

  const run = async () => {
    setResult('loading');
    // TODO_LOGIC path lives in validateSchema; here we exercise loading + result.
    const r = await validateSchema('{}', schemaText, draft);
    setResult(r);
  };

  return (
    <div className="schema">
      <MockBadge />

      <div className="schema__head">
        <span>
          Документ: <strong>users.json</strong> <span className="fine">(1,2 МБ)</span>
        </span>
        <span className="grow" />
        <label className="field">
          Драфт:
          <select value={draft} disabled title="Меняется в Настройках">
            {DRAFTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="schema__grid">
        <section className="schema__cell">
          <div className="schema__cellhead">
            <h3 className="ui-section-heading">Схема</h3>
            <span className="grow" />
            <Button>Файл…</Button>
            <Button onClick={() => setSchemaText(MOCK_SCHEMA_TEXT)}>Пример</Button>
          </div>
          <textarea
            className="schema__input mono"
            value={schemaText}
            spellCheck={false}
            aria-label="JSON Schema"
            onChange={(e) => setSchemaText(e.target.value)}
          />
          <Button variant="primary" onClick={() => void run()} disabled={result === 'loading'}>
            Проверить
          </Button>
        </section>

        <section className="schema__cell">
          <div className="schema__cellhead">
            <h3 className="ui-section-heading">Результат</h3>
            <span className="grow" />
            {result !== null && result !== 'loading' && (
              result.valid ? (
                <Badge severity="ok">✓ Соответствует</Badge>
              ) : (
                <Badge severity="poor">✗ {result.errors.length} ошибки</Badge>
              )
            )}
          </div>

          <div aria-live="polite">
            {result === null && (
              <Callout tone="info">
                Вставьте схему и нажмите «Проверить». Документ берётся из таба «Данные».
              </Callout>
            )}
            {result === 'loading' && (
              <div className="loading">
                <Spinner label="Валидируем…" />
                <p className="fine">Таймаут 5 с → прерывание (защита от ReDoS в pattern).</p>
                <Button>Отменить</Button>
              </div>
            )}
            {result !== null && result !== 'loading' && result.valid && (
              <Callout tone="info" title="✓ Документ соответствует схеме">
                Проверены: типы, required, enum, pattern, диапазоны. НЕ проверены: внешние $ref
                (сети нет), format (выключен).
              </Callout>
            )}
            {result !== null && result !== 'loading' && !result.valid && (
              <ul className="serrors">
                {result.errors.map((e, i) => (
                  <li key={i} className="serror">
                    <div className="serror__head">
                      <Badge severity="poor">ОШИБКА</Badge>
                      <code className="mono">{e.instancePath}</code>
                    </div>
                    <p className="serror__msg">{e.message}</p>
                    <p className="fine mono">схема: {e.schemaPath}</p>
                    <Button>Показать в данных</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <Callout tone="warn">
        ⚠ Валидатор: <span className="mono">@cfworker/json-schema</span>. Он не выполняет код
        (MV3 CSP запрещает eval), поэтому НЕ поддерживает: <span className="mono">$ref</span> на
        внешние URL (сети нет), <span className="mono">format: "email"/"uri"</span> проверяется
        только при включённой опции, custom keywords.
      </Callout>
    </div>
  );
}
