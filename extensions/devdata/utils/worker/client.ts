// The Worker client: one disposable worker per job.
//
// Why one-per-job rather than a long-lived pool: `terminate()` is the only way
// to interrupt a JavaScript loop (design §8). A schema with a catastrophic
// `pattern`, a 200 MB CSV, a document that OOMs — none of them can be asked
// nicely to stop. So every job gets a worker it is allowed to kill, and the
// worker holds no state that killing it would lose (protocol.ts).
//
// Every failure mode returns a typed error the UI can explain:
//   - timeout       → "took longer than Ns and was cancelled" + the likely cause
//   - cancelled     → the user pressed Cancel; not an error
//   - worker-died   → OOM / `onerror`; offers the "open as text" fallback (§5.3)
//   - worker-failed → the job threw; carries the real message

import type { JobRequest, JobResponse, WorkerMessage } from './protocol';

export type JobFailure =
  | 'timeout'
  | 'cancelled'
  | 'worker-died'
  | 'worker-failed'
  | 'worker-unavailable';

export class JobError extends Error {
  readonly reason: JobFailure;
  constructor(reason: JobFailure, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'JobError';
  }
}

export interface RunningJob<T> {
  promise: Promise<T>;
  /** Really terminates the worker. Not a flag someone forgot to check. */
  cancel: () => void;
}

let nextId = 1;

/** Budgets from the design (§8): parse 30 s, convert 30 s, validate 5 s. */
export const TIMEOUTS: Record<JobRequest['op'], number> = {
  parse: 30_000,
  convert: 30_000,
  validate: 5_000,
};

export const TIMEOUT_CAUSE: Record<JobRequest['op'], string> = {
  parse:
    'Разбор не завершился за 30 секунд и был прерван. Обычно причина — документ, который больше, чем вкладка может удержать.',
  convert:
    'Преобразование не завершилось за 30 секунд и было прервано.',
  validate:
    'Валидация не завершилась за 5 секунд и была прервана. Обычно причина — тяжёлый pattern в схеме (катастрофический бэктрекинг регулярного выражения).',
};

export function runJob<T extends JobResponse>(job: JobRequest): RunningJob<T> {
  const id = nextId;
  nextId += 1;

  let worker: Worker;
  try {
    worker = new Worker(new URL('./data.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      promise: Promise.reject(
        new JobError(
          'worker-unavailable',
          `Не удалось запустить фоновый поток: ${message}. Разбор в основном потоке заморозил бы вкладку, поэтому мы этого не делаем.`,
        ),
      ),
      cancel: () => undefined,
    };
  }

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Assigned synchronously inside the executor below, so `cancel` can reject.
  let fail: (error: JobError) => void = () => undefined;

  const dispose = () => {
    if (timer !== undefined) clearTimeout(timer);
    worker.terminate();
  };

  const promise = new Promise<T>((resolve, reject) => {
    fail = (error: JobError) => {
      if (settled) return;
      settled = true;
      dispose();
      reject(error);
    };

    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'result') {
        if (settled) return;
        settled = true;
        dispose();
        resolve(message.payload as T);
        return;
      }
      if (message.type === 'error') {
        fail(new JobError('worker-failed', message.message));
      }
    });

    // A worker can simply die (OOM, `RangeError: Invalid string length` on a
    // half-gigabyte string). Without this handler that would be an unhandled
    // rejection and a blank screen (design §5.3).
    worker.addEventListener('error', (event: ErrorEvent) => {
      fail(
        new JobError(
          'worker-died',
          event.message ||
            'Фоновый поток был остановлен браузером — скорее всего, не хватило памяти.',
        ),
      );
    });
    worker.addEventListener('messageerror', () => {
      fail(
        new JobError(
          'worker-failed',
          'Результат не удалось передать из фонового потока (слишком большая структура).',
        ),
      );
    });

    timer = setTimeout(() => {
      fail(new JobError('timeout', TIMEOUT_CAUSE[job.op]));
    }, TIMEOUTS[job.op]);

    worker.postMessage({ id, job });
  });

  return {
    promise,
    // Cancel REJECTS (with reason 'cancelled') rather than leaving the promise
    // dangling forever — a never-settling promise is a leak and, worse, a UI
    // stuck on a spinner.
    cancel: () => fail(new JobError('cancelled', 'Операция отменена.')),
  };
}

/** True for the one "failure" that is not a failure: the user pressed Cancel. */
export function isCancelled(err: unknown): boolean {
  return err instanceof JobError && err.reason === 'cancelled';
}
