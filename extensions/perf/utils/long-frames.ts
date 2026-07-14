import type { LongFrameEntry, LongFrameSummary, ScriptAttribution } from './perf-types';

// Long Animation Frames (LoAF, Chrome 123+) + Long Tasks collection (PLAN.md §7.2).
// Both are Chromium-only; this collector degrades cleanly elsewhere by reporting
// `loafSupported`/`longTaskSupported` = false and an empty frame list, so the panel
// says "not available in this browser" instead of implying zero main-thread work.
//
// Runs in the MAIN world (a PerformanceObserver, no extension APIs), pushing a
// debounced summary to the ISOLATED relay via the nonce-guarded LoAF bridge.

// LoAF/Long-Task entry shapes aren't in lib.dom yet, so model the fields we read.
interface PerfScriptTiming {
  sourceURL?: unknown;
  sourceFunctionName?: unknown;
  duration?: unknown;
  forcedStyleAndLayoutDuration?: unknown;
}
interface LoafEntryShape {
  startTime: number;
  duration: number;
  blockingDuration?: unknown;
  scripts?: unknown;
}
interface TaskAttributionShape {
  containerSrc?: unknown;
  containerName?: unknown;
  name?: unknown;
}
interface LongTaskEntryShape {
  startTime: number;
  duration: number;
  attribution?: unknown;
}

const MAX_FRAMES = 100;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function loafScripts(raw: unknown): ScriptAttribution[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s): ScriptAttribution => {
    const t = s as PerfScriptTiming;
    return {
      sourceURL: str(t.sourceURL),
      sourceFunctionName: str(t.sourceFunctionName),
      duration: num(t.duration),
      forcedStyleAndLayoutDuration: num(t.forcedStyleAndLayoutDuration),
    };
  });
}

function taskScripts(raw: unknown): ScriptAttribution[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a): ScriptAttribution => {
    const t = a as TaskAttributionShape;
    return {
      sourceURL: str(t.containerSrc),
      sourceFunctionName: str(t.containerName) || str(t.name),
      duration: 0,
      forcedStyleAndLayoutDuration: 0,
    };
  });
}

export class LongFrameCollector {
  private readonly frames: LongFrameEntry[] = [];
  private readonly observers: PerformanceObserver[] = [];
  private readonly loafSupported: boolean;
  private readonly longTaskSupported: boolean;
  /** LoAF is preferred; Long Tasks are a fallback so the two never double-count. */
  private readonly primaryKind: 'loaf' | 'longtask' | null;
  private flushHandle: ReturnType<typeof setTimeout> | null = null;
  /** Guards against double-observe when start() is called again (bfcache restore). */
  private started = false;

  constructor(private readonly onUpdate: (summary: LongFrameSummary) => void) {
    const types: readonly string[] = PerformanceObserver.supportedEntryTypes ?? [];
    this.loafSupported = types.includes('long-animation-frame');
    this.longTaskSupported = types.includes('longtask');
    this.primaryKind = this.loafSupported
      ? 'loaf'
      : this.longTaskSupported
        ? 'longtask'
        : null;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.primaryKind === 'loaf') {
      this.observe('long-animation-frame', (entries) => {
        for (const e of entries) this.addLoaf(e as unknown as LoafEntryShape);
      });
    } else if (this.primaryKind === 'longtask') {
      this.observe('longtask', (entries) => {
        for (const e of entries) this.addLongTask(e as unknown as LongTaskEntryShape);
      });
    } else {
      // Neither supported — emit one summary so the panel can show the notice.
      this.emit();
    }
  }

  stop(): void {
    this.started = false;
    for (const o of this.observers) o.disconnect();
    this.observers.length = 0;
  }

  private observe(
    type: string,
    handle: (entries: PerformanceEntryList) => void,
  ): void {
    try {
      const observer = new PerformanceObserver((list) => {
        handle(list.getEntries());
        this.scheduleFlush();
      });
      // `buffered` replays frames dispatched before observe() (the load spike).
      observer.observe({ type, buffered: true } as PerformanceObserverInit);
      this.observers.push(observer);
      this.scheduleFlush();
    } catch {
      // A browser that lists the type but rejects observe() — ignore, stay empty.
    }
  }

  private addLoaf(e: LoafEntryShape): void {
    const blockingDuration = num(e.blockingDuration);
    this.push({
      kind: 'loaf',
      startTime: e.startTime,
      duration: e.duration,
      blockingDuration,
      scripts: loafScripts(e.scripts),
    });
  }

  private addLongTask(e: LongTaskEntryShape): void {
    // A Long Task blocks for the portion of its run over the 50ms threshold.
    this.push({
      kind: 'longtask',
      startTime: e.startTime,
      duration: e.duration,
      blockingDuration: Math.max(0, e.duration - 50),
      scripts: taskScripts(e.attribution),
    });
  }

  private push(frame: LongFrameEntry): void {
    this.frames.push(frame);
    // Keep the worst frames if we overflow (they matter most for blocking).
    if (this.frames.length > MAX_FRAMES) {
      this.frames.sort((a, b) => b.blockingDuration - a.blockingDuration);
      this.frames.length = MAX_FRAMES;
    }
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = globalThis.setTimeout(() => {
      this.flushHandle = null;
      this.emit();
    }, 300);
  }

  private emit(): void {
    const totalBlockingDuration = this.frames.reduce(
      (sum, f) => sum + f.blockingDuration,
      0,
    );
    const frames = [...this.frames].sort((a, b) => a.startTime - b.startTime);
    this.onUpdate({
      loafSupported: this.loafSupported,
      longTaskSupported: this.longTaskSupported,
      totalBlockingDuration,
      frames,
    });
  }
}
