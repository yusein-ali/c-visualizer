import { mask } from './scan';

/**
 * `_Noreturn void stop(void)` - C11's function specifier, which gcc accepts
 * under `-std=c99` too - read as the declaration without it.
 *
 * Neither grammar behind this interpreter knows the word, and the whole
 * program was refused at it ("expected ';' before 'void'"). It promises the
 * compiler that the function does not return and changes nothing about how
 * the program runs, so it is blanked where it is written, which keeps every
 * column. Inside a string or a comment it is left alone.
 */
export function withoutNoreturn(code: string): string {
  const masked = mask(code);
  let text = code;
  const pattern = /\b_Noreturn\b/g;
  for (let found = pattern.exec(masked); found !== null; ) {
    text =
      text.slice(0, found.index) +
      ' '.repeat(found[0].length) +
      text.slice(found.index + found[0].length);
    found = pattern.exec(masked);
  }
  return text;
}
