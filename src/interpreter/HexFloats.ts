import { mask } from './scan';

/**
 * Hexadecimal floating constants - `0x1.8p1`, `0x1p-3f` - written in decimal.
 *
 * C99 has them (6.4.4.2), and `%a` prints them, but the grammar behind this
 * interpreter does not lex them: `double d = 0x1.8p1;` lost its declaration,
 * and the run was refused because `d` was not declared. Each one is replaced
 * by the shortest decimal that reads back as the same double - the value is
 * a binary fraction, so one exists - with its suffix, padded with spaces to
 * the constant's width so nothing else on the line moves. A decimal wider
 * than the constant (`0x1p-10` is `0.0009765625`) moves what follows it on
 * its line, which only the columns of that line's later marks notice.
 */
export function hexFloatLiterals(code: string): string {
  const masked = mask(code);
  const pattern =
    /\b0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?\d+)([fFlL]?)(?![\w.])/g;
  let text = code;
  const edits: { at: number; length: number; text: string }[] = [];
  for (let found = pattern.exec(masked); found !== null; ) {
    const [whole, integer, fraction = '', exponent, suffix] = found;
    if (integer !== '' || fraction !== '') {
      const digits = integer + fraction;
      const value =
        Number.parseInt(digits === '' ? '0' : digits, 16) *
        2 ** (Number(exponent) - 4 * fraction.length);
      let spelled = String(value);
      if (!/[.e]/.test(spelled)) {
        spelled += '.';
      }
      spelled += suffix;
      if (Number.isFinite(value)) {
        edits.push({
          at: found.index,
          length: whole.length,
          text: spelled.padEnd(whole.length, ' '),
        });
      }
    }
    found = pattern.exec(masked);
  }
  for (const edit of edits.reverse()) {
    text =
      text.slice(0, edit.at) + edit.text + text.slice(edit.at + edit.length);
  }
  return text;
}
