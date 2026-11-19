import { mask } from './scan';

/**
 * `int (*log)[3]` as a parameter, written as the array parameter it is the
 * same type as: `int log[][3]` (C11 6.7.6.3p7).
 *
 * unicoen.ts's parser has no rule for a parenthesized declarator that is not
 * a function's, and a program with one lost every function it defined. In a
 * parameter list the two spellings declare one type, a pointer to an array,
 * and the engine binds the second as that (`adjustedParameters`). The new
 * spelling is padded to the width of the old, so nothing else on the line
 * moves.
 *
 * Only a parameter is rewritten: one followed by `,` or `)`. A pointer to an
 * array declared as an object, `int (*p)[3] = log;`, has no array spelling.
 */
export function arrayPointerParameters(code: string): string {
  const masked = mask(code);
  const pattern =
    /([A-Za-z0-9_]\s*)\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*((?:\[[^\]\n]*\]\s*)+)(?=[,)])/g;
  let text = code;
  let found = pattern.exec(masked);
  while (found !== null) {
    const start = found.index + found[1].length;
    const end = found.index + found[0].length;
    const dimensions = found[3].replace(/\s+/g, '');
    const spelled = `${found[2]}[]${dimensions}`;
    text =
      text.slice(0, start) + spelled.padEnd(end - start, ' ') + text.slice(end);
    found = pattern.exec(masked);
  }
  return text;
}
