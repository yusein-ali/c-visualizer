import { UniDoubleLiteral } from 'unicoen.ts/dist/node/UniDoubleLiteral';
import { UniIntLiteral } from 'unicoen.ts/dist/node/UniIntLiteral';

/**
 * Numeric constants as the source writes them.
 *
 * unicoen's mapper reads a constant with `Number(text)`, which knows neither
 * C's suffixes nor its octal: `0u`, `7L` and `1.5f` all became `NaN`, and
 * `017` became seventeen. The value is read here instead, and the spelling is
 * kept on the node, because the spelling is what says the type - `0u` is an
 * `unsigned int` and `2.0` a `double`, where the number alone says neither.
 */

interface SpelledLiteral {
  plivetSpelling?: string;
}

const INTEGER_SUFFIX = /[uUlL]+$/;
const FLOATING_SUFFIX = /[fFlL]$/;

/** The value of an integer constant, 6.4.4.1, in any of C's bases. */
export function integerValue(spelling: string): number {
  const digits = spelling.trim().replace(INTEGER_SUFFIX, '');
  if (/^0[xX][0-9a-fA-F]+$/.test(digits)) {
    return parseInt(digits.slice(2), 16);
  }
  if (/^0[bB][01]+$/.test(digits)) {
    return parseInt(digits.slice(2), 2);
  }
  if (/^0[0-7]+$/.test(digits)) {
    return parseInt(digits.slice(1), 8);
  }
  return Number(digits);
}

/** The value of a decimal floating constant, 6.4.4.2. */
export function floatingValue(spelling: string): number {
  const digits = spelling.trim().replace(FLOATING_SUFFIX, '');
  const value = Number(digits);
  return /[fF]$/.test(spelling.trim()) ? Math.fround(value) : value;
}

export function spelledInteger(
  literal: UniIntLiteral,
  spelling: string
): UniIntLiteral {
  literal.value = integerValue(spelling);
  const suffix = INTEGER_SUFFIX.exec(spelling.trim());
  literal.sufix = suffix === null ? '' : suffix[0];
  (literal as SpelledLiteral).plivetSpelling = spelling.trim();
  return literal;
}

export function spelledFloating(
  literal: UniDoubleLiteral,
  spelling: string
): UniDoubleLiteral {
  literal.value = floatingValue(spelling);
  const suffix = FLOATING_SUFFIX.exec(spelling.trim());
  literal.sufix = suffix === null ? '' : suffix[0];
  (literal as SpelledLiteral).plivetSpelling = spelling.trim();
  return literal;
}

/** How the source wrote a numeric constant, or null for any other node. */
export function literalSpelling(node: unknown): string | null {
  if (node === null || typeof node !== 'object') {
    return null;
  }
  const spelling = (node as SpelledLiteral).plivetSpelling;
  return typeof spelling === 'string' && spelling !== '' ? spelling : null;
}
