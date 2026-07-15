import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from '#imports';
import { Button, Callout, LanguageSwitcher, ThemeToggle, useLocale, type Theme } from '@blur/ui';
import { deleteClip, listClips, putBlob, pruneOlderThan, storageEstimate } from '../../utils/db';
import { formatBytes } from '../../utils/format';
import { useT } from '../../utils/i18n';
import { capabilities } from '../../utils/platform';
import { DEFAULT_SIZE_PRESETS, LOGO_BLOB_KEY } from '../../utils/storage';
import { usePrefs } from '../../utils/use-prefs';
import { useSetLocale } from '../../utils/use-locale';
import { useCaptureTheme } from '../../utils/use-theme';

// SETTINGS (design capture.md §2.12). Shared by the Studio tab AND the standalone
// options page — one component, one source of truth, so the two can never drift.
//
// Degradations are shown by EXPLAINING, never by a disabled control (design §8):
// a greyed-out checkbox reads as "I configured something wrong", an explanation
// reads as "the browser cannot do this". So on Firefox the tab-audio and MP4 rows
// carry a sentence, not a dead switch.

const caps = capabilities();

export function Settings() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const { prefs, update, error } = usePrefs();
  const { theme, setTheme } = useCaptureTheme();
  const [used, setUsed] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    void Promise.all([storageEstimate(), listClips()]).then(([est, clips]) => {
      setUsed(est.used);
      setCount(clips.length);
    });

  useEffect(refresh, []);

  return (
    <div className="settings">
      {error && (
        <Callout tone="poor" title={t('set_not_saved')}>
          {t('prefs_save_fail')}
        </Callout>
      )}
      {note && <Callout tone="info">{note}</Callout>}

      <section className="set-group">
        <h3>{t('set_rec')}</h3>

        <Row label={t('set_default_res')}>
          <select
            value={prefs.defaultResolution?.height ?? 0}
            onChange={(e) => {
              const h = Number(e.target.value);
              update({
                defaultResolution: h ? { width: Math.round((h * 16) / 9), height: h } : null,
              });
            }}
          >
            <option value={0}>{t('res_as_is_cap')}</option>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
            <option value={480}>480p</option>
          </select>
        </Row>

        <Row label={t('set_fps')}>
          <select
            value={prefs.defaultFps}
            onChange={(e) => update({ defaultFps: Number(e.target.value) })}
          >
            <option value={60}>{t('fps_value', { n: 60 })}</option>
            <option value={30}>{t('fps_value', { n: 30 })}</option>
            <option value={25}>{t('fps_value', { n: 25 })}</option>
            <option value={15}>{t('fps_value', { n: 15 })}</option>
          </select>
          {prefs.defaultFps === 60 && (
            <span className="warn-text">{t('set_fps_60_warn')}</span>
          )}
        </Row>

        <Row label={t('set_rec_format')}>
          {caps.canRecordMp4 ? (
            <select
              value={prefs.defaultVideoFormat}
              onChange={(e) =>
                update({ defaultVideoFormat: e.target.value === 'mp4' ? 'mp4' : 'webm' })
              }
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          ) : (
            <span className="warn-text">{t('set_webm_only')}</span>
          )}
        </Row>

        <Row label={t('set_rec_quality')}>
          <select
            value={prefs.defaultQuality}
            onChange={(e) =>
              update({ defaultQuality: e.target.value as 'high' | 'medium' | 'low' })
            }
          >
            <option value="high">{t('quality_high')}</option>
            <option value="medium">{t('quality_medium')}</option>
            <option value="low">{t('quality_low')}</option>
          </select>
          <span className="muted">{t('set_quality_note')}</span>
        </Row>

        <Row label={t('set_tab_audio')}>
          {caps.canRecordTabAudio ? (
            <input
              type="checkbox"
              checked={prefs.tabAudio}
              onChange={(e) => update({ tabAudio: e.target.checked })}
            />
          ) : (
            <span className="warn-text">
              {t('set_tab_audio_ff_1')}
              <code>getDisplayMedia</code>
              {t('set_tab_audio_ff_2')}
            </span>
          )}
        </Row>

        <Row label={t('set_mic')}>
          <input
            type="checkbox"
            checked={prefs.mic}
            onChange={(e) => update({ mic: e.target.checked })}
          />
          <span className="muted">{t('set_mic_note')}</span>
        </Row>

        <Row label={t('set_open_rec_window')}>
          <input
            type="checkbox"
            checked={caps.pipeline === 'firefox-window' ? true : prefs.openRecorderWindow}
            disabled={caps.pipeline === 'firefox-window'}
            onChange={(e) => update({ openRecorderWindow: e.target.checked })}
          />
          {caps.pipeline === 'firefox-window' && (
            <span className="muted">{t('set_ff_window_required')}</span>
          )}
        </Row>
      </section>

      <section className="set-group">
        <h3>{t('set_export')}</h3>

        <Row label={t('set_max_passes')}>
          <select
            value={prefs.maxPasses}
            onChange={(e) => update({ maxPasses: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="muted">{t('set_max_passes_note')}</span>
        </Row>

        <Row label={t('set_where_save')}>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={prefs.askWhereToSave}
              onChange={(e) => update({ askWhereToSave: e.target.checked })}
            />
            {t('set_ask')}
          </label>
        </Row>

        <Row label={t('set_name_template')}>
          <input
            type="text"
            value={prefs.filenameTemplate}
            onChange={(e) => update({ filenameTemplate: e.target.value })}
          />
          <span className="muted">{t('set_name_template_note')}</span>
        </Row>

        <div className="set-section">
          <h4>{t('set_platform_limits')}</h4>
          <p className="muted">{t('set_platform_limits_note')}</p>
          <div className="preset-grid">
          {prefs.sizePresets.map((p) => (
            <div key={p.id} className="preset-row">
              <span>{p.label}</span>
              <input
                type="number"
                min={1}
                value={Math.round(p.bytes / 1024 / 1024)}
                aria-label={t('set_mb_aria', { label: p.label })}
                onChange={(e) =>
                  update({
                    sizePresets: prefs.sizePresets.map((x) =>
                      x.id === p.id
                        ? { ...x, bytes: Math.max(1, Number(e.target.value)) * 1024 * 1024 }
                        : x,
                    ),
                  })
                }
              />
              <span className="muted">{t('mb')}</span>
            </div>
          ))}
          </div>
          <Button variant="ghost" onClick={() => update({ sizePresets: DEFAULT_SIZE_PRESETS })}>
            {t('set_reset_defaults')}
          </Button>
        </div>
      </section>

      <section className="set-group">
        <h3>Watermark</h3>
        <Row label={t('set_text')}>
          <input
            type="text"
            value={prefs.watermarkText}
            onChange={(e) => update({ watermarkText: e.target.value })}
          />
        </Row>
        <Row label={t('set_logo')}>
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void putBlob(LOGO_BLOB_KEY, f).then(() => setLogoName(f.name));
            }}
          />
          {logoName && <span className="muted"> {logoName}</span>}
          <p className="muted">
            {t('set_logo_note_1')}
            <code>convertToBlob()</code>
            {t('set_logo_note_2')}
          </p>
        </Row>
        <Row label={t('set_position')}>
          <select
            value={prefs.watermarkPosition}
            onChange={(e) =>
              update({ watermarkPosition: e.target.value as typeof prefs.watermarkPosition })
            }
          >
            <option value="bottom-right">{t('pos_br')}</option>
            <option value="bottom-left">{t('pos_bl')}</option>
            <option value="top-right">{t('pos_tr')}</option>
            <option value="top-left">{t('pos_tl')}</option>
            <option value="center">{t('pos_center')}</option>
          </select>
        </Row>
        <Row label={t('set_opacity')}>
          <input
            type="range"
            min={10}
            max={100}
            value={prefs.watermarkOpacity}
            onChange={(e) => update({ watermarkOpacity: Number(e.target.value) })}
          />
          <span className="mono"> {prefs.watermarkOpacity}%</span>
        </Row>
        <Row label={t('set_size_pct')}>
          <input
            type="range"
            min={2}
            max={20}
            value={prefs.watermarkSizePct}
            onChange={(e) => update({ watermarkSizePct: Number(e.target.value) })}
          />
          <span className="mono"> {prefs.watermarkSizePct}%</span>
        </Row>
      </section>

      <section className="set-group">
        <h3>{t('set_storage')}</h3>
        <p className="mono">
          {t('set_used_line', {
            used: used != null ? formatBytes(used, locale) : '—',
            count,
          })}
        </p>
        <p className="muted">{t('set_storage_note')}</p>
        <Row label={t('set_autodelete')}>
          <select
            value={prefs.autoDeleteDays ?? 0}
            onChange={(e) => {
              const d = Number(e.target.value);
              update({ autoDeleteDays: d || null });
              if (d) void pruneOlderThan(d).then((n) => {
                setNote(n ? t('set_deleted_n', { n }) : t('set_nothing_delete'));
                refresh();
              });
            }}
          >
            {/* Default is NEVER, deliberately: silently erasing someone's screencast
                is worse than using disk (design §3.4). */}
            <option value={0}>{t('never')}</option>
            <option value={7}>{t('days_7')}</option>
            <option value={30}>{t('days_30')}</option>
          </select>
        </Row>
        {/* Two-step, and it disarms on blur: deleting every recording the user has
            must never be one careless click (house rule, PLAN.md §18c). */}
        <button
          type="button"
          className={wipeArmed ? 'ui-btn ui-btn--primary' : 'ui-btn ui-btn--ghost'}
          onClick={() => {
            if (!wipeArmed) {
              setWipeArmed(true);
              return;
            }
            void listClips()
              .then((cs) => Promise.all(cs.map((c) => deleteClip(c.id))))
              .then(() => {
                setWipeArmed(false);
                setNote(t('set_all_deleted'));
                refresh();
              });
          }}
          onBlur={() => setWipeArmed(false)}
        >
          {wipeArmed ? t('set_wipe_confirm', { count }) : t('set_wipe')}
        </button>
      </section>

      <section className="set-group">
        <h3>{t('set_shortcuts')}</h3>
        <p className="mono">{t('set_shortcuts_line')}</p>
        <p className="muted">{t('set_shortcuts_note')}</p>
        <Button
          variant="ghost"
          onClick={() =>
            void browser.tabs
              .create({
                url: import.meta.env.FIREFOX
                  ? 'about:addons'
                  : 'chrome://extensions/shortcuts',
              })
              .catch(() => setNote(t('set_open_ext_manual')))
          }
        >
          {t('set_change_in_browser')}
        </Button>
      </section>

      <section className="set-group">
        <h3>{t('set_theme')}</h3>
        {theme && <ThemeToggle theme={theme} onChange={(th: Theme) => setTheme(th)} />}
      </section>

      <section className="set-group">
        <h3>{t('language')}</h3>
        <LanguageSwitcher locale={locale} onChange={setLocale} label={t('language')} />
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      <span className="set-ctl">{children}</span>
    </div>
  );
}
