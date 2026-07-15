import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Callout, useLocale } from '@blur/ui';
import {
  computeBudget,
  isExportBlocked,
  suggestionsFor,
  VERDICT_LABEL_KEY,
  VERDICT_NOTE_KEY,
  type BudgetInput,
} from '../../utils/budget';
import { clipBlob, deleteClip, getBlob } from '../../utils/db';
import { useT } from '../../utils/i18n';
// The export reads the edit state from the SAME store the editor writes to. A
// second copy of it here is exactly how a redaction region gets "forgotten" and a
// password ships in the file (design §7.6).
import { useEdit } from '../../utils/edit-store';
import {
  canEncodeH264,
  loadLogo,
  runTargetEncode,
  RAM_EXPORT_WARN_BYTES,
  type Composite,
  type EncodeProgress,
} from '../../utils/encode';
import { expandTemplate, formatBytes, formatDuration } from '../../utils/format';
import { extensionFor, saveBlob } from '../../utils/save';
import { LOGO_BLOB_KEY } from '../../utils/storage';
import { usePrefs } from '../../utils/use-prefs';
import type { Clip, ExportSettings, PassResult, VideoFormat } from '../../utils/types';

// EXPORT — the heart of the product (design capture.md §2.7–§2.10, §6).
//
// 🔴 The value is the ARITHMETIC BEFORE THE ENCODE, not a progress bar after it.
// The user learns that 4 minutes of 1080p in 10 MB is mush in 200 µs of maths,
// not after three minutes of burning CPU. That is the whole point of §6.
//
// 🔴 Nobody can promise "exactly 10.00 MB": there is no two-pass rate control in
// any browser, and `VideoEncoder`'s bitrate is approximate on hard content. So we
// never promise it. We promise "no more than 10 MB — and here is what it costs",
// every number carries "≈", and the result is reported as "9.2 MB", never "10 MB".

type Phase = 'config' | 'encoding' | 'done' | 'failed';

interface Res {
  label: string;
  width: number;
  height: number;
  asRecorded?: boolean;
}

export function ExportDialog({
  clip,
  onClose,
  onTrim,
}: {
  clip: Clip;
  onClose: () => void;
  onTrim: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { prefs, update } = usePrefs();
  const edit = useEdit(clip.id, clip.durationMs);

  const [phase, setPhase] = useState<Phase>('config');
  const [h264, setH264] = useState<boolean | null>(null);
  const [format, setFormat] = useState<VideoFormat>('mp4');
  const [keepAsRecorded, setKeepAsRecorded] = useState(false);
  const [resIdx, setResIdx] = useState(0);
  const [fps, setFps] = useState<number | 'as-recorded'>('as-recorded');
  const [keepAudio, setKeepAudio] = useState(true);
  const [audioKbps, setAudioKbps] = useState(128);
  const [targetId, setTargetId] = useState<string>('none');
  const [customMb, setCustomMb] = useState(10);
  const [overridden, setOverridden] = useState(false);
  const [passes, setPasses] = useState<PassResult[]>([]);
  const [progress, setProgress] = useState<EncodeProgress | null>(null);
  const [result, setResult] = useState<{ bytes: number; missed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteSource, setDeleteSource] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const durationMs = Math.max(1, edit.trimOutMs - edit.trimInMs);
  const durationSec = durationMs / 1000;

  const resolutions: Res[] = useMemo(() => {
    const src: Res = {
      label: t('res_as_is_label', {
        w: clip.resolution.width,
        h: clip.resolution.height,
      }),
      width: clip.resolution.width,
      height: clip.resolution.height,
      asRecorded: true,
    };
    // ⚠️ Only DOWNSCALE is ever offered. Upscaling is a lie about quality (§13).
    const lower = [
      { label: '1280×720', width: 1280, height: 720 },
      { label: '854×480', width: 854, height: 480 },
      { label: '640×360', width: 640, height: 360 },
    ].filter((r) => r.height < clip.resolution.height);
    return [src, ...lower];
  }, [clip.resolution.width, clip.resolution.height, t]);

  const res = resolutions[Math.min(resIdx, resolutions.length - 1)]!;

  // ⚠️ THE PROBE (design §4.4, §8, §12.1, PLAN.md (Часть II) §11): does THIS browser's
  // VideoEncoder actually do H.264? Chrome: yes. Firefox: unconfirmed by any
  // primary source, so we ask the machine, BEFORE offering MP4 — never "offer MP4,
  // then fail after three minutes of encoding". If the answer is no, MP4 simply is
  // not on the menu and the reason is written out. We do NOT drag in 30 MB of
  // GPL-tainted ffmpeg.wasm to paper over it (design §12.2).
  useEffect(() => {
    void canEncodeH264(res.width, res.height).then((ok) => {
      setH264(ok);
      setFormat(ok ? 'mp4' : 'webm');
    });
  }, [res.width, res.height]);

  const hasRedaction = edit.regions.length > 0;
  const hasCosmetic = edit.regions.some((r) => r.mode !== 'fill');
  const fillCount = edit.regions.filter((r) => r.mode === 'fill').length;
  const trimmed = edit.trimInMs > 0 || edit.trimOutMs < clip.durationMs;
  const resized = !res.asRecorded;

  const target = useMemo(() => {
    if (targetId === 'none') return null;
    if (targetId === 'custom') return { bytes: customMb * 1024 * 1024, hard: false };
    const p = prefs.sizePresets.find((x) => x.id === targetId);
    return p ? { bytes: p.bytes, hard: p.hard } : null;
  }, [targetId, customMb, prefs.sizePresets]);

  // 🔴 Stream copy CANNOT bake pixels. If there is a redaction region, a watermark,
  // a resize or a size target, "как записано" is impossible — and silently
  // ignoring the redaction and handing over the clean file would be the single
  // worst bug this product could ship (design §7.6).
  //
  // 🔴 `needsRemux` is the SAME class of bug (audit C1). A recovered clip was never
  // finalised, so its container header carries a bogus duration and a truncated
  // index; a raw stream-copy hands over exactly that broken file — in the recovery
  // scenario the whole feature exists for. The Library promises "восстановленная
  // запись — при экспорте будет пересобрана", so re-mux is mandatory and
  // stream-copy must be off the table, not merely off by default.
  const copyImpossible =
    hasRedaction ||
    !!edit.watermark ||
    resized ||
    !!target ||
    format !== clipFormat(clip) ||
    !!clip.needsRemux;
  const effectiveCopy = keepAsRecorded && !copyImpossible;

  const budgetInput: BudgetInput | null = target
    ? {
        targetBytes: target.bytes,
        durationSec,
        width: res.width,
        height: res.height,
        fps: fps === 'as-recorded' ? 30 : fps,
        audioBps: keepAudio ? audioKbps * 1000 : 0,
      }
    : null;
  const budget = budgetInput ? computeBudget(budgetInput) : null;
  const blocked = budget ? isExportBlocked(budget) && !overridden : false;

  const filename = expandTemplate(prefs.filenameTemplate, {
    host: clip.host || 'capture',
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 5).replace(':', ''),
  });

  async function runExport() {
    setPhase('encoding');
    setError(null);
    setPasses([]);
    setProgress(null);
    const ac = new AbortController();
    abortRef.current = ac;

    // ⚠️ WATCHDOG (design §10.4). A WebCodecs pipeline that runs out of buffers
    // does not throw — it just STOPS MOVING, forever, with a progress bar frozen
    // at 47%. So: if no progress event arrives for 45 s, we call it wedged, abort
    // the pass, and say so. The source recording is untouched either way.
    let lastTick = Date.now();
    let wedged = false;
    const watchdog = globalThis.setInterval(() => {
      if (Date.now() - lastTick > 45_000 && !ac.signal.aborted) {
        wedged = true;
        ac.abort();
      }
    }, 5000);

    try {
      const source = await clipBlob(clip);

      // ── Stream copy: no re-encode at all. Instant, and it never touches RAM.
      if (effectiveCopy) {
        await saveBlob({
          blob: source,
          basename: filename,
          extension: extensionFor(clip.mimeType),
          askWhereToSave: prefs.askWhereToSave,
        });
        setResult({ bytes: source.size, missed: false });
        setPhase('done');
        await maybeDeleteSource();
        return;
      }

      const logoBlob = await getBlob(LOGO_BLOB_KEY);
      const composite: Composite = {
        regions: edit.regions,
        watermark: edit.watermark,
        logo: await loadLogo(logoBlob ?? null),
      };

      const settings: ExportSettings = {
        format,
        keepAsRecorded: false,
        resolution: res.asRecorded
          ? { width: res.width, height: res.height, asRecorded: true }
          : { width: res.width, height: res.height },
        fps,
        keepAudio,
        audioBps: audioKbps * 1000,
        trimInMs: edit.trimInMs,
        trimOutMs: edit.trimOutMs,
        targetBytes: target?.bytes ?? null,
        targetHard: target?.hard ?? false,
        maxPasses: prefs.maxPasses,
        filename,
        askWhereToSave: prefs.askWhereToSave,
        deleteSourceAfter: deleteSource,
      };

      const out = await runTargetEncode({
        source,
        settings,
        composite,
        sourceWidth: clip.resolution.width,
        sourceHeight: clip.resolution.height,
        sourceDurationMs: clip.durationMs,
        onProgress: (p) => {
          lastTick = Date.now();
          setProgress(p);
        },
        onPass: (p) => {
          lastTick = Date.now();
          setPasses((ps) => [...ps, p]);
        },
        signal: ac.signal,
      });
      composite.logo?.close();

      await saveBlob({
        blob: out.blob,
        basename: filename,
        extension: format,
        askWhereToSave: prefs.askWhereToSave,
      });
      setResult({ bytes: out.blob.size, missed: out.missedTarget });
      setPhase('done');
      await maybeDeleteSource();
    } catch (err) {
      // 🔴 The SOURCE IS NEVER TOUCHED before a successful export. Any failure here
      // leaves the user with a working recording (design §5.7).
      if (wedged) {
        setError(t('exp_wedged'));
      } else if (ac.signal.aborted) {
        setPhase('config');
        return;
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setPhase('failed');
    } finally {
      globalThis.clearInterval(watchdog);
      abortRef.current = null;
    }
  }

  async function maybeDeleteSource() {
    if (deleteSource) await deleteClip(clip.id);
  }

  // ── Encoding ──────────────────────────────────────────────────────────────
  if (phase === 'encoding') {
    return (
      <div className="export">
        <h2>
          {target
            ? t('exp_fitting', { size: formatBytes(target.bytes, locale) })
            : t('exp_encoding')}
        </h2>
        {/* Two levels of progress and not one lie. There is deliberately NO single
            overall percentage: it would run BACKWARDS when a new pass starts
            (design §2.9). "Pass N of M" + an honest percentage inside the pass. */}
        <p className="mono">
          {t('exp_pass_of', { pass: progress?.pass ?? 1, max: prefs.maxPasses })}
        </p>
        <progress
          value={progress?.progress ?? 0}
          max={1}
          aria-describedby="pass-note"
          aria-valuenow={Math.round((progress?.progress ?? 0) * 100)}
        />
        <p id="pass-note" className="mono">
          {t('exp_pct_written', {
            pct: Math.round((progress?.progress ?? 0) * 100),
            size: formatBytes(progress?.bytesSoFar ?? 0, locale),
          })}
          {progress?.projectedBytes != null &&
            t('exp_projected', { size: formatBytes(progress.projectedBytes, locale) })}
        </p>

        <h3>{t('exp_log')}</h3>
        <ul className="pass-log mono">
          {passes.map((p) => (
            <li key={p.pass}>
              {p.aborted ? '✕' : p.hit ? '✓' : '·'}{' '}
              {t('exp_pass_line', {
                pass: p.pass,
                kbps: Math.round(p.bitrate / 1000),
                size: formatBytes(p.actualBytes, locale),
              })}
              {p.note ? ` — ${p.note}` : ''}
            </li>
          ))}
          {passes.length === 0 && <li className="muted">{t('exp_first_pass')}</li>}
        </ul>

        <p className="muted">{t('exp_pass_note')}</p>

        <Button
          variant="ghost"
          onClick={() => {
            abortRef.current?.abort();
            setPhase('config');
          }}
        >
          {t('stop')}
        </Button>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="export">
        <Callout tone="warn" title={t('exp_fail_title')}>
          {error}
          <br />
          <strong>{t('exp_source_safe_strong')}</strong>
          {t('exp_fail_tail')}
        </Callout>
        <div className="ed-foot">
          <Button
            onClick={() => {
              setKeepAsRecorded(true);
              setTargetId('none');
              setPhase('config');
            }}
          >
            {t('exp_download_asis')}
          </Button>
          <Button variant="ghost" onClick={() => setPhase('config')}>
            {t('back')}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'done' && result) {
    return (
      <div className="export">
        <Callout
          tone={result.missed ? 'warn' : 'info'}
          title={result.missed ? t('exp_missed_title') : t('exp_done_title')}
        >
          {result.missed && target ? (
            <>
              {t('exp_missed_body', {
                target: formatBytes(target.bytes, locale),
                got: formatBytes(result.bytes, locale),
                n: passes.length,
              })}
              {target.hard && (
                <>
                  <br />
                  <strong>{t('exp_hard_limit_strong')}</strong>
                  {t('exp_hard_limit_tail', {
                    size: formatBytes(budget?.audioBytes ?? 0, locale),
                  })}
                </>
              )}
            </>
          ) : (
            <>{t('exp_saved', { size: formatBytes(result.bytes, locale) })}</>
          )}
          {(fillCount > 0 || hasCosmetic) && !deleteSource && (
            <>
              <br />
              {t('exp_source_left_1')}
              <strong>{t('exp_source_left_strong')}</strong>
              {t('exp_source_left_2')}
              <button
                type="button"
                className="ui-btn ui-btn--sm"
                onClick={() => void deleteClip(clip.id).then(onClose)}
              >
                {t('exp_delete_source')}
              </button>
            </>
          )}
        </Callout>
        <div className="ed-foot">
          <Button variant="ghost" onClick={() => setPhase('config')}>
            {t('exp_again')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('exp_to_library')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Config ────────────────────────────────────────────────────────────────
  const bigRam = clip.sizeBytes > RAM_EXPORT_WARN_BYTES && !effectiveCopy;

  return (
    <div className="export">
      <h2>{t('exp_title')}</h2>

      <section>
        <h3>{t('exp_format')}</h3>
        <label className="radio-inline">
          <input
            type="radio"
            checked={format === 'mp4'}
            disabled={h264 === false}
            onChange={() => setFormat('mp4')}
          />
          {t('exp_mp4_compat')}
        </label>
        <label className="radio-inline">
          <input type="radio" checked={format === 'webm'} onChange={() => setFormat('webm')} />
          {t('exp_webm')}
        </label>
        {h264 === false && (
          <Callout tone="warn">
            <strong>{t('exp_no_h264_strong')}</strong>
            {t('exp_no_h264_dash')}
            <code>VideoEncoder.isConfigSupported(&#39;avc1.42001f&#39;)</code>
            {t('exp_no_h264_tail')}
          </Callout>
        )}

        <label className="check-inline">
          <input
            type="checkbox"
            checked={effectiveCopy}
            disabled={copyImpossible}
            onChange={(e) => setKeepAsRecorded(e.target.checked)}
          />
          {t('exp_as_recorded')}
        </label>
        {copyImpossible && keepAsRecorded && (
          <Callout tone="warn">
            <strong>{t('exp_cant_strong')}</strong>
            {t('exp_cant_1')}
            {hasRedaction && t('exp_cant_redaction')}
            {edit.watermark && t('exp_cant_watermark')}
            {resized && t('exp_cant_resize')}
            {target && t('exp_cant_target')}
            {format !== clipFormat(clip) && t('exp_cant_container')}
            {clip.needsRemux && t('exp_cant_remux')}
            {t('exp_cant_2')}
          </Callout>
        )}
      </section>

      {!effectiveCopy && (
        <>
          <section>
            <h3>{t('exp_picture')}</h3>
            <div className="field">
              <label htmlFor="x-res">{t('exp_resolution')}</label>
              <select
                id="x-res"
                value={resIdx}
                onChange={(e) => setResIdx(Number(e.target.value))}
              >
                {resolutions.map((r, i) => (
                  <option key={r.label} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="x-fps">{t('exp_frame_rate')}</label>
              <select
                id="x-fps"
                value={String(fps)}
                onChange={(e) =>
                  setFps(e.target.value === 'as-recorded' ? 'as-recorded' : Number(e.target.value))
                }
              >
                <option value="as-recorded">{t('res_as_is')}</option>
                <option value="30">{t('fps_value', { n: 30 })}</option>
                <option value="25">{t('fps_value', { n: 25 })}</option>
                <option value="15">{t('fps_value', { n: 15 })}</option>
              </select>
            </div>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={keepAudio}
                onChange={(e) => setKeepAudio(e.target.checked)}
              />
              {t('exp_keep_audio')}
              {/* ⚠️ The audio WEIGHT is shown right on the label. On a short clip
                  with a 10 MB target it eats a third to half of the budget, and
                  every competitor hides this (design §6.3). */}
              {budget && keepAudio &&
                t('exp_audio_of_budget', { size: formatBytes(budget.audioBytes, locale) })}
            </label>
            {keepAudio && (
              <div className="field">
                <label htmlFor="x-ab">{t('exp_audio_quality')}</label>
                <select
                  id="x-ab"
                  value={audioKbps}
                  onChange={(e) => setAudioKbps(Number(e.target.value))}
                >
                  <option value={128}>{t('exp_audio_128')}</option>
                  <option value={96}>{t('exp_audio_96')}</option>
                  <option value={64}>{t('exp_audio_64')}</option>
                </select>
              </div>
            )}
            <p className="muted mono">
              {t('exp_duration', { dur: formatDuration(durationMs) })}
              {trimmed && t('exp_trimmed_from', { dur: formatDuration(clip.durationMs) })}
            </p>
          </section>

          <section>
            <h3>{t('exp_filesize')}</h3>
            <label className="radio-inline">
              <input
                type="radio"
                checked={targetId === 'none'}
                onChange={() => setTargetId('none')}
              />
              {t('exp_no_limit')}
            </label>
            <div className="chips">
              {prefs.sizePresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={targetId === p.id ? 'chip chip--on' : 'chip'}
                  onClick={() => setTargetId(p.id)}
                >
                  {p.label} · {formatBytes(p.bytes, locale)}
                </button>
              ))}
              <button
                type="button"
                className={targetId === 'custom' ? 'chip chip--on' : 'chip'}
                onClick={() => setTargetId('custom')}
              >
                {t('exp_chip_custom')}
              </button>
              {targetId === 'custom' && (
                <input
                  type="number"
                  min={1}
                  value={customMb}
                  aria-label={t('exp_custom_aria')}
                  onChange={(e) => setCustomMb(Math.max(1, Number(e.target.value)))}
                />
              )}
            </div>
            <p className="muted">{t('exp_limits_note')}</p>
          </section>
        </>
      )}

      {/* 🔴 THE BUDGET — computed BEFORE a single frame is encoded (design §6.3). */}
      {budget && budgetInput && (
        <section className={budget.verdict === 'mush' ? 'budget budget--bad' : 'budget'}>
          <h3>{t('exp_budget_h')}</h3>
          <p className="mono">
            {t('exp_budget_line1', {
              target: formatBytes(target!.bytes, locale),
              audio: formatBytes(budget.audioBytes, locale),
              video: formatBytes(Math.max(0, budget.videoBytes), locale),
            })}
          </p>
          <p className="mono">
            {t('exp_budget_line2', {
              kbps: Math.round(budget.videoBps / 1000),
              w: res.width,
              h: res.height,
              fps: fps === 'as-recorded' ? 30 : fps,
              bpp: budget.bpp.toFixed(4),
            })}
          </p>
          <p>
            {t('exp_expected_quality')}
            <strong>{t(VERDICT_LABEL_KEY[budget.verdict])}</strong>{' '}
            <span aria-hidden="true">
              {'●'.repeat(budget.dots)}
              {'○'.repeat(5 - budget.dots)}
            </span>
            {' — '}
            {t(VERDICT_NOTE_KEY[budget.verdict])}
          </p>

          {blocked && (
            <Callout tone="warn" title={t('exp_blocked_title')}>
              {t('exp_blocked_body')}
              <ul>
                {suggestionsFor(budgetInput).map((s) => (
                  <li key={s.id}>
                    {t(s.labelKey, {
                      ...(s.fps != null ? { fps: s.fps } : {}),
                      ...(s.mb != null ? { mb: s.mb } : {}),
                      ...(s.verdict ? { verdict: t(VERDICT_LABEL_KEY[s.verdict]) } : {}),
                    })}{' '}
                    {s.toTrim ? (
                      <button type="button" className="ui-btn ui-btn--sm" onClick={onTrim}>
                        {t('exp_to_trim')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ui-btn ui-btn--sm"
                        onClick={() => applySuggestion(s.id)}
                      >
                        {t('apply')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <details>
                <summary>{t('exp_export_anyway')}</summary>
                <p>
                  {t('exp_export_anyway_body')}
                  <button
                    type="button"
                    className="ui-btn ui-btn--sm"
                    onClick={() => setOverridden(true)}
                  >
                    {t('exp_unblock')}
                  </button>
                </p>
              </details>
            </Callout>
          )}
          <p className="muted">{t('exp_iter_note', { max: prefs.maxPasses })}</p>
        </section>
      )}

      {/* The permanent redaction summary — not a popup, not a blocker (§7.3). */}
      {(fillCount > 0 || hasCosmetic) && (
        <section>
          <p>{t('exp_hidden_fill', { n: fillCount })}</p>
          {hasCosmetic && (
            <p className="warn-text">
              {t('exp_cosmetic_summary', { n: edit.regions.length - fillCount })}
            </p>
          )}
        </section>
      )}

      {bigRam && <Callout tone="warn">{t('exp_big_ram')}</Callout>}

      <section>
        <h3>{t('exp_file')}</h3>
        <p className="mono">
          {filename}.{effectiveCopy ? extensionFor(clip.mimeType) : format}
        </p>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={prefs.askWhereToSave}
            onChange={(e) => update({ askWhereToSave: e.target.checked })}
          />
          {t('exp_ask_where')}
        </label>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={deleteSource}
            onChange={(e) => setDeleteSource(e.target.checked)}
          />
          {t('exp_delete_after')}
          {/* Default OFF, always: silently deleting the user's data is not a
              feature. But we must OFFER it — the un-redacted original is exactly
              the thing that leaks the password (design §7.6). */}
        </label>
      </section>

      <div className="ed-foot">
        <Button variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={blocked} onClick={() => void runExport()}>
          {t('exp_export_btn')}
        </Button>
      </div>
    </div>
  );

  function applySuggestion(id: string) {
    if (id === 'downscale-480') {
      const i = resolutions.findIndex((r) => r.height === 480);
      if (i >= 0) setResIdx(i);
      setFps(15);
    } else if (id === 'fps-15') {
      setFps(15);
    } else if (id === 'drop-audio') {
      setKeepAudio(false);
    }
  }
}

function clipFormat(clip: Clip): VideoFormat {
  return clip.mimeType.includes('mp4') ? 'mp4' : 'webm';
}
