import { todoLogic } from '@blur/ui';
import type { Draft, Target } from './types';

// Platform CONVERSION on copy (design §6.2, §6.3). 🔴 STUBBED.
//
// 🔴 INVARIANT (design §4.5): the stored Markdown is NEVER rewritten by a
// converter. `convert()` runs ONLY at the moment of copy and produces a fresh
// string; switching target back and forth is lossless.
//
// The converter also NEVER silently drops content (design §6.3): anything the
// target can't express DEGRADES with the text preserved (table → aligned code
// block, <details> → expanded text) and the degradation is reported BEFORE copy.

export interface ConversionResult {
  /** The text placed on the clipboard for this target. */
  text: string;
  /** For `html`, also a text/html payload (design §6.2). */
  html?: string;
  /** Human notes about lossy degradations, shown before/at copy (design §6.4). */
  degradations: string[];
}

/**
 * TODO_LOGIC (compose): implement per-target conversion from the internal GFM
 * superset. GitHub/GitLab = identity; Jira/Slack/Telegram/Plain = syntax
 * rewrite; HTML = sanitized DOM → serialize. Escaping rules per §6.1 (Telegram
 * MarkdownV2 is the big one). Reuse the markdown-it token stream so we don't
 * write five raw-text regex transformers.
 */
export function convert(_draft: Draft, _target: Target): ConversionResult {
  throw todoLogic('convert: GFM → target syntax (6 converters + escaping)');
}

/**
 * Scaffold stand-in: fabricated compatibility notes per target so the
 * CounterStrip status line and the §6.4 compatibility dialog have realistic
 * content to render. NOT a real conversion.
 */
export function mockDegradations(target: Target): string[] {
  switch (target) {
    case 'slack':
      return ['Таблица (5 строк) → блок кода с выравниванием', '<details> «Логи консоли» → развёрнутый текст'];
    case 'telegram':
      return ['Экранируются спецсимволы MarkdownV2', 'Заголовки → *жирный*', 'Таблица → блок кода'];
    case 'jira':
      return ['Чекбоксы → (x)/( )', '<details> → {expand}', 'Шорткоды :tada: → символ'];
    case 'plain':
      return ['Разметка снята, структура — отступами', 'Таблица → ASCII-таблица'];
    default:
      return [];
  }
}
