import { Button, Callout, MockBadge } from '@blur/ui';
import { formatBytes, formatDuration } from '../../utils/format';
import {
  MOCK_LIBRARY,
  MOCK_LIBRARY_BYTES,
  MOCK_INTERRUPTED,
} from '../../utils/mock-data';
import type { Clip } from '../../utils/types';

// Library tab (design capture.md §2.13). Lists finished clips + the crash-recovery
// "interrupted recording" card (§5.11, §10.5), and is the home of "open your own
// file" — the same pipeline entry, with NO icon/menu of its own (design §4.3).
export function Library({ onOpen }: { onOpen: (clip: Clip) => void }) {
  return (
    <div className="library">
      <MockBadge />
      <header className="lib-head">
        <h2>Библиотека</h2>
        <span className="muted">Занято {formatBytes(MOCK_LIBRARY_BYTES)}</span>
      </header>

      {/* Recovered-after-crash card. Honest "last ~3 s may be lost" (§10.5). */}
      <Callout tone="warn" title="⚠ Прерванная запись">
        {MOCK_INTERRUPTED.when} · {MOCK_INTERRUPTED.host} ·{' '}
        {formatDuration(MOCK_INTERRUPTED.durationMs)} ·{' '}
        {formatBytes(MOCK_INTERRUPTED.bytes)}
        <br />
        Браузер закрылся во время записи. Мы нашли данные на диске. Последние ~3
        секунды могли не сохраниться. Перед сохранением запись надо пересобрать
        (это быстро).
        <div className="lib-actions">
          <Button variant="primary">Восстановить</Button>
          <Button variant="ghost">Удалить</Button>
        </div>
      </Callout>

      <ul className="clip-list">
        {MOCK_LIBRARY.map((clip) => (
          <li key={clip.id} className="clip">
            <div className="clip-thumb" aria-hidden="true">
              {clip.kind === 'screenshot' ? '🖼' : '🎬'}
            </div>
            <div className="clip-body">
              <p className="clip-title">{clip.title}</p>
              <p className="clip-meta muted mono">
                {new Date(clip.createdAt).toLocaleString('ru')} ·{' '}
                {clip.durationMs > 0 && `${formatDuration(clip.durationMs)} · `}
                {clip.resolution.width}×{clip.resolution.height}
                {clip.devicePixelRatio ? ` (экран ${clip.devicePixelRatio}×)` : ''} ·{' '}
                {clip.format.toUpperCase()} · {formatBytes(clip.sizeBytes)}
              </p>
              <div className="clip-actions">
                <Button variant="ghost" onClick={() => onOpen(clip)}>
                  Открыть
                </Button>
                <Button variant="ghost" onClick={() => onOpen(clip)}>
                  Экспорт
                </Button>
                <Button variant="ghost">Удалить</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* "Convert your own file" — inside Studio only, no separate entry (§4.3). */}
      <div className="dropzone">
        <p>Перетащите сюда видео или картинку, чтобы сжать, изменить размер или наложить watermark.</p>
        <p className="muted">Понимаем: MP4, MOV, WebM, MKV, PNG, JPEG, WebP.</p>
        <p className="muted">⚠ Файл никуда не отправляется — обрабатывается здесь.</p>
      </div>
    </div>
  );
}
