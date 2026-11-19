/**
 * Adjacent string literals as one: `"pages" " = %d\n"` is `"pages = %d\n"`
 * (C11 5.1.1.2, translation phase 6).
 *
 * unicoen.ts's parser has no rule for two literals in a row: the call
 * `printf("a" "b")` ran as nothing, and `const char *s = "a" "b";` dropped
 * the declaration. Stringizing makes them all the time - `#define SHOW(x)
 * printf(#x " = %d\n", x)` - so they are joined in the source before it is
 * parsed. The joined literal takes the first one's place, and what it
 * replaces is blanked, newlines kept: every line keeps its number, and the
 * text after the last literal keeps its column.
 *
 * An escape at the end of a literal is written out in full first, where
 * the next literal's first character could otherwise extend it (`closed`).
 */
export function joinAdjacentStrings(code: string): string {
  const literals = stringLiteralsIn(code);
  const runs: { start: number; end: number; joined: string }[] = [];
  let at = 0;
  while (at < literals.length) {
    let last = at;
    while (
      last + 1 < literals.length &&
      /^\s*$/.test(code.slice(literals[last].end, literals[last + 1].start))
    ) {
      last += 1;
    }
    if (last > at) {
      const run = literals.slice(at, last + 1);
      runs.push({
        start: run[0].start,
        end: run[run.length - 1].end,
        joined: `"${run
          .map((literal, index) =>
            index === run.length - 1 ? literal.body : closed(literal.body)
          )
          .join('')}"`,
      });
    }
    at = last + 1;
  }
  // From the last run back, so a run that lengthens its first line does not
  // move the ones before it.
  let text = code;
  for (const { start, end, joined } of runs.reverse()) {
    const span = text.slice(start, end);
    const lineEnd = span.indexOf('\n');
    const blanked = span.replace(/[^\n]/g, ' ');
    // The joined text goes where the first literal starts, onto the end of
    // its line: anything that followed it there was only blanks.
    const replaced =
      lineEnd === -1
        ? padded(joined, span.length)
        : padded(joined, lineEnd) + blanked.slice(lineEnd);
    text = text.slice(0, start) + replaced + text.slice(end);
  }
  return text;
}

/** `text`, padded with blanks to `width` when it is shorter. */
const padded = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length);

/**
 * A literal's spelling with an escape at its end written out in full, so
 * that the next literal's text cannot extend it: `"\x41" "1"` is `A1`, and
 * `\x411` would be one character. An octal escape takes at most three
 * digits, so both kinds end as three.
 */
function closed(body: string): string {
  const escape = /\\(x[0-9A-Fa-f]+|[0-7]{1,2})$/.exec(body);
  if (escape === null) {
    return body;
  }
  // A backslash that is itself escaped starts no escape.
  const backslashes = /\\*$/.exec(body.slice(0, escape.index))![0].length;
  if (backslashes % 2 === 1) {
    return body;
  }
  const value = escape[1].startsWith('x')
    ? parseInt(escape[1].slice(1), 16) & 0xff
    : parseInt(escape[1], 8);
  return `${body.slice(0, escape.index)}\\${value.toString(8).padStart(3, '0')}`;
}

/**
 * Every string literal outside comments and character constants: where it
 * starts (its opening quote), where it ends (past its closing quote), and
 * what is between the quotes. A literal with an encoding prefix is left out,
 * and so is one its line ends inside.
 */
function stringLiteralsIn(
  code: string
): { start: number; end: number; body: string }[] {
  const found: { start: number; end: number; body: string }[] = [];
  let i = 0;
  while (i < code.length) {
    const char = code[i];
    if (char === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      i = end === -1 ? code.length : end;
      continue;
    }
    if (char === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      let end = i + 1;
      while (end < code.length && code[end] !== char && code[end] !== '\n') {
        end += code[end] === '\\' ? 2 : 1;
      }
      const closed = end < code.length && code[end] === char;
      const prefixed = i > 0 && /[A-Za-z0-9_]/.test(code[i - 1]);
      if (char === '"' && closed && !prefixed) {
        found.push({ start: i, end: end + 1, body: code.slice(i + 1, end) });
      }
      i = closed ? end + 1 : end;
      continue;
    }
    i += 1;
  }
  return found;
}
