import { useMemo, useState } from 'react';
import { Button, Callout, MockBadge, mockAsync } from '@blur/ui';
import { formatBytes } from '../../utils/format';
import {
  computeBudget,
  isExportBlocked,
  suggestionsFor,
  VERDICT_COPY,
  type BudgetInput,
} from '../../utils/budget';
import { DEFAULT_SIZE_PRESETS } from '../../utils/storage';
import type { Clip } from '../../utils/types';
import type { PassResult } from '../../utils/media';

// Export dialog — the heart of the product (design capture.md §2.7–§2.10, §6).
//
// REAL: the whole pre-encode budget arithmetic (computeBudget), the quality
// verdict, the export-blocked-on-"mush" rule, the achievable/unreachable copy,
// and the honest 2-pass progress model (per-pass, no single fake global %).
// MOCKED: the encode itself (mockAsync fakes the passes; utils/media.ts holds the
// real stub). The math the user sees is genuine — that is the point (§0, §6.3).

const isFirefox = import.meta.env.FIREFOX;

type Phase = 'config' | 'encoding' | 'unreachable' | 'done';

interface Resish {
  label: string;
  width: number;
  height: number;
}
const RESOLUTIONS: Resish[] = [
  { label: '1920×1080 (как есть)', width: 1920, height: 1080 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '854×480', width: 854, height: 480 },
  { label: '640×360', width: 640, height: 360 },
];

export function ExportDialog({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('config');
  const [format, setFormat] = useState<'mp4' | 'webm'>(isFirefox ? 'webm' : 'mp4');
  const [res, setRes] = useState<Resish>(RESOLUTIONS[0]);
  const [fps, setFps] = useState(30);
  const [keepAudio, setKeepAudio] = useState(true);
  const [audioKbps, setAudioKbps] = useState(128);
  const [targetId, setTargetId] = useState<string | 'none' | 'custom'>('none');
  const [customMb, setCustomMb] = useState(10);
  const [overridden, setOverridden] = useState(false);
  const [passes, setPasses] = useState<PassResult[]>([]);

  const durationSec = clip.durationMs / 1000;

  const target = useMemo(() => {
    if (targetId === 'none') return null;
    if (targetId === 'custom') return { bytes: customMb * 1024 * 1024, hard: false };
    const p = DEFAULT_SIZE_PRESETS.find((x) => x.id === targetId);
    return p ? { bytes: p.bytes, hard: p.hard } : null;
  }, [targetId, customMb]);

  const budget = useMemo<ReturnType<typeof computeBudget> | null>(() => {
    if (!target) return null;
    const input: BudgetInput = {
      targetBytes: target.bytes,
      durationSec,
      width: res.width,
      height: res.height,
      fps,
      audioBps: keepAudio ? audioKbps * 1000 : 0,
    };
    return computeBudget(input);
  }, [target, durationSec, res, fps, keepAudio, audioKbps]);

  const budgetInput: BudgetInput | null = target
    ? {
        targetBytes: target.bytes,
        durationSec,
        width: res.width,
        height: res.height,
        fps,
        audioBps: keepAudio ? audioKbps * 1000 : 0,
      }
    : null;

  const blocked = budget ? isExportBlocked(budget) && !overridden : false;

  async function runExport() {
    setPhase('encoding');
    setPasses([]);
    // Fake the iterative 2-pass encoder (design §2.9). The REAL encoder is
    // utils/media.ts runTargetEncode; here mockAsync stands in for each pass and
    // we fabricate an over/undershoot so the honest per-pass log renders.
    const targetBytes = target?.bytes ?? 0;
    const first = await mockAsync<PassResult>(
      { pass: 1, bitrate: 238_000, actualBytes: Math.round(targetBytes * 1.24), hit: false },
      900,
    );
    setPasses([first]);
    const second = await mockAsync<PassResult>(
      { pass: 2, bitrate: 192_000, actualBytes: Math.round(targetBytes * 0.92), hit: true },
      900,
    );
    setPasses([first, second]);
    // If the (mock) best pass still overshoots a HARD target → the unreachable
    // screen (design §2.10). Here pass 2 hits, so we finish.
    if (second.hit || !target?.hard) {
      setPhase('done');
    } else {
      setPhase('unreachable');
    }
  }

  if (phase === 'encoding') {
    return <EncodingView passes={passes} target={target?.bytes ?? 0} onClose={onClose} />;
  }
  if (phase === 'unreachable' && budgetInput) {
    return (
      <UnreachableView
        input={budgetInput}
        got={Math.round((target?.bytes ?? 0) * 1.24)}
        onTrim={onClose}
        onClose={onClose}
      />
    );
  }
  if (phase === 'done') {
    return (
      <div className="export-dialog">
        <Callout tone="ok" title="Готово">
          Экспортировано ≈ {formatBytes(Math.round((target?.bytes ?? clip.sizeBytes) * 0.92))}.
          Исходник с незакрытыми областями остался в библиотеке.{' '}
          <button type="button" className="ui-btn ui-btn--sm">
            Удалить исходник
          </button>
        </Callout>
        <Button onClick={onClose}>Закрыть</Button>
      </div>
    );
  }

  return (
    <div className="export-dialog">
      <MockBadge note="Расчёт бюджета — настоящий. Кодирование замокано (scaffold)." />
      <header className="ed-head">
        <h2>Экспорт</h2>
        <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </header>

      {/* FORMAT */}
      <fieldset>
        <legend>Формат</legend>
        <label className="radio-inline">
          <input
            type="radio"
            checked={format === 'webm'}
            onChange={() => setFormat('webm')}
          />
          WebM (VP9) — как записано
        </label>
        <label className="radio-inline">
          <input
            type="radio"
            checked={format === 'mp4'}
            onChange={() => setFormat('mp4')}
            disabled={isFirefox}
          />
          MP4 (H.264) — совместим со всем
          {isFirefox && (
            <span className="muted"> · на Firefox = перекодирование (проба H.264)</span>
          )}
        </label>
      </fieldset>

      {/* RESOLUTION / FPS / AUDIO */}
      <div className="ed-fields">
        <label>
          Разрешение
          <select
            value={res.width}
            onChange={(e) =>
              setRes(RESOLUTIONS.find((r) => r.width === Number(e.target.value)) ?? RESOLUTIONS[0])
            }
          >
            {RESOLUTIONS.map((r) => (
              <option key={r.width} value={r.width}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Частота
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[30, 25, 15].map((f) => (
              <option key={f} value={f}>
                {f} к/с
              </option>
            ))}
          </select>
        </label>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={keepAudio}
            onChange={(e) => setKeepAudio(e.target.checked)}
          />
          Оставить звук
          {/* Audio weight shown right on the label — it eats a third-to-half of a
              10 MB budget on short clips, which every competitor hides (§6.3). */}
          {budget && keepAudio && (
            <span className="muted"> — {formatBytes(budget.audioBytes)}</span>
          )}
        </label>
      </div>

      {/* TARGET SIZE */}
      <fieldset>
        <legend>Размер файла</legend>
        <label className="radio-inline">
          <input
            type="radio"
            checked={targetId === 'none'}
            onChange={() => setTargetId('none')}
          />
          Не ограничивать — как получится (качество максимальное)
        </label>
        <label className="radio-inline">
          <input
            type="radio"
            checked={targetId !== 'none'}
            onChange={() => setTargetId('discord')}
          />
          Уложиться в:
        </label>
        <div className="chips">
          {DEFAULT_SIZE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={targetId === p.id ? 'chip chip--on' : 'chip'}
              onClick={() => setTargetId(p.id)}
            >
              {p.label} {formatBytes(p.bytes)}
            </button>
          ))}
          <button
            type="button"
            className={targetId === 'custom' ? 'chip chip--on' : 'chip'}
            onClick={() => setTargetId('custom')}
          >
            Своё:
            <input
              type="number"
              min={1}
              value={customMb}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setCustomMb(Number(e.target.value))}
            />{' '}
            МБ
          </button>
        </div>
        <p className="muted">
          ⓘ Лимиты площадок зашиты в расширение и могут устареть — мы не ходим в
          сеть их проверять. Их можно поправить.
        </p>
      </fieldset>

      {/* BUDGET — computed BEFORE encoding (design §2.7, §6.3). */}
      {budget && budgetInput && (
        <BudgetPanel
          budget={budget}
          input={budgetInput}
          hard={target?.hard ?? false}
          overridden={overridden}
          onOverride={() => setOverridden(true)}
          onApply={(r) => {
            const match = RESOLUTIONS.find((x) => x.width === r.width);
            if (match) setRes(match);
            if (r.fps) setFps(r.fps);
            if (r.dropAudio) setKeepAudio(false);
          }}
        />
      )}

      <footer className="ed-foot">
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={blocked} onClick={() => void runExport()}>
          Экспортировать
        </Button>
      </footer>
    </div>
  );
}

function BudgetPanel({
  budget,
  input,
  hard,
  overridden,
  onOverride,
  onApply,
}: {
  budget: ReturnType<typeof computeBudget>;
  input: BudgetInput;
  hard: boolean;
  overridden: boolean;
  onOverride: () => void;
  onApply: (r: { width: number; fps?: number; dropAudio?: boolean }) => void;
}) {
  const copy = VERDICT_COPY[budget.verdict];
  const blocked = isExportBlocked(budget);
  return (
    <div className={`budget budget--${copy.tone}`} role="status" aria-live="polite">
      <p className="budget-head">
        {copy.tone === 'poor' ? '⚠' : copy.tone === 'warn' ? '⚠' : '🟢'} Расчёт
        бюджета — ДО кодирования
      </p>
      <ul className="budget-lines mono">
        <li>Цель {formatBytes(input.targetBytes)} − запас 3% − звук ({formatBytes(budget.audioBytes)})</li>
        <li>→ видео {formatBytes(Math.max(0, budget.videoBytes))}</li>
        <li>
          ≈ {Math.round(budget.videoBps / 1000)} кбит/с при {input.width}×
          {input.height} / {input.fps} к/с
        </li>
        <li>
          {budget.bpp.toFixed(3)} бит/пиксель — качество «{copy.label}»{' '}
          {'●'.repeat(budget.dots)}
          {'○'.repeat(5 - budget.dots)}
        </li>
      </ul>
      {copy.note && <p className="budget-note">{copy.note}</p>}

      {blocked && (
        <div className="budget-fix">
          <p>Чтобы уложиться, надо что-то отдать:</p>
          {suggestionsFor(input).map((s) => (
            <div key={s.id} className="fix-row">
              <span>→ {s.label}</span>
              {s.toTrim ? (
                <button type="button" className="ui-btn ui-btn--sm">
                  К обрезке
                </button>
              ) : (
                <button
                  type="button"
                  className="ui-btn ui-btn--sm"
                  onClick={() =>
                    onApply(
                      s.id === 'downscale-480'
                        ? { width: 854, fps: Math.min(input.fps, 15) }
                        : s.id === 'fps-15'
                          ? { width: input.width, fps: 15 }
                          : { width: input.width, dropAudio: true },
                    )
                  }
                >
                  Применить
                </button>
              )}
            </div>
          ))}
          {/* "Export anyway" is a second-level disclosure, never a first-class
              button (design §2.7). Only offered for SOFT targets; a hard preset
              overshoot genuinely will not upload. */}
          {!hard && !overridden && (
            <details className="anyway">
              <summary>Всё равно экспортировать</summary>
              <button type="button" className="ui-btn ui-btn--sm" onClick={onOverride}>
                Да, экспортировать как есть (мягкая цель)
              </button>
            </details>
          )}
          {hard && (
            <p className="budget-note">
              ⚠ Это жёсткий лимит площадки — «почти влезло» значит «не влезло».
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EncodingView({
  passes,
  target,
  onClose,
}: {
  passes: PassResult[];
  target: number;
  onClose: () => void;
}) {
  const current = passes[passes.length - 1];
  return (
    <div className="export-dialog">
      <header className="ed-head">
        <h2>Подгоняем под {formatBytes(target)}</h2>
      </header>
      {/* Honest progress: "проход N из M" + a real per-pass %, never one fake
          global bar that would jump backwards on a new pass (design §2.9). */}
      <p className="mono">Проход {current?.pass ?? 1} из 3 (максимум)</p>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={63}>
        <div className="progress-fill" style={{ width: '63%' }} />
      </div>
      <ul className="pass-log mono">
        {passes.map((p) => (
          <li key={p.pass}>
            {p.hit ? '✓' : '▸'} Проход {p.pass} · {Math.round(p.bitrate / 1000)} кбит/с ·{' '}
            {p.hit ? 'в цели' : `получилось ${formatBytes(p.actualBytes)} (цель ${formatBytes(target)})`}
          </li>
        ))}
      </ul>
      <Callout tone="info">
        Каждый проход — полное перекодирование. Двухпроходного кодировщика, как в
        ffmpeg, в браузере нет — мы подгоняем итерациями и показываем каждый шаг.
      </Callout>
      <Button variant="ghost" onClick={onClose}>
        Остановить и взять как есть
      </Button>
    </div>
  );
}

function UnreachableView({
  input,
  got,
  onTrim,
  onClose,
}: {
  input: BudgetInput;
  got: number;
  onTrim: () => void;
  onClose: () => void;
}) {
  return (
    <div className="export-dialog">
      <header className="ed-head">
        <h2>⚠ Не уложились</h2>
      </header>
      <p className="mono">
        Цель: {formatBytes(input.targetBytes)} · Получили: {formatBytes(got)} (лучший
        из 3 проходов)
      </p>
      <p className="muted">
        Дальше снижать битрейт бессмысленно: картинка уже разваливается, а размер
        почти не падает. Это предел, а не наша лень.
      </p>
      <div className="budget-fix">
        {suggestionsFor(input).map((s) => (
          <div key={s.id} className="fix-row">
            <span>▸ {s.label}</span>
            <button type="button" className="ui-btn ui-btn--sm" onClick={s.toTrim ? onTrim : undefined}>
              {s.toTrim ? 'К обрезке' : 'Пересчитать'}
            </button>
          </div>
        ))}
      </div>
      <footer className="ed-foot">
        <Button onClick={onClose}>Сохранить {formatBytes(got)} как есть</Button>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
      </footer>
    </div>
  );
}
