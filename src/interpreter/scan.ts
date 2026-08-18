/**
 * Reading C source before the parser sees it.
 *
 * `preprocess.ts` already scans this way for macros: skip comments and string
 * literals, and never move a line. The passes that read `enum`, `struct` and
 * `union` declarations need the same discipline, so the primitives live here
 * instead of being written twice.
 *
 * These helpers assume they run on preprocessed source - directives are gone
 * and macros are expanded - which is where the aggregate passes sit in the
 * pipeline.
 */

export const IDENT_START = /[A-Za-z_]/;
export const IDENT_CHAR = /[A-Za-z0-9_]/;

/** Index just past the string or character literal starting at `start`. */
export function skipLiteral(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/**
 * The source with the inside of every comment and every literal replaced by
 * spaces. Same length and same line breaks as the input, so an index into the
 * mask is an index into the original: scan the mask to decide, slice the
 * original to read. Quotes are kept, so a literal is still visible as a pair of
 * quotes with nothing between them.
 */
export function mask(code: string): string {
  const out: string[] = [];
  let i = 0;
  const blankTo = (end: number) => {
    while (i < end && i < code.length) {
      out.push(code[i] === '\n' ? '\n' : ' ');
      i += 1;
    }
  };
  while (i < code.length) {
    const pair = code.substr(i, 2);
    if (pair === '/*') {
      const end = code.indexOf('*/', i + 2);
      blankTo(end === -1 ? code.length : end + 2);
      continue;
    }
    if (pair === '//') {
      const end = code.indexOf('\n', i);
      blankTo(end === -1 ? code.length : end);
      continue;
    }
    const char = code[i];
    if (char === '"' || char === "'") {
      const end = skipLiteral(code, i);
      out.push(char);
      i += 1;
      blankTo(end - 1);
      if (i < code.length) {
        out.push(code[i]);
        i += 1;
      }
      continue;
    }
    out.push(char);
    i += 1;
  }
  return out.join('');
}

/** Index of the `}` matching the `{` at `open`, or -1 when it is unclosed. */
export function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '{') {
      depth += 1;
    } else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * True when the span is a whole identifier rather than part of a longer one.
 * `SIZE` in `SIZEx` is the case this rules out - the same trap the macro pass
 * hit, which used to turn `int SIZEx` into `int 4x`.
 */
export function isWholeIdentifier(
  masked: string,
  start: number,
  length: number
): boolean {
  if (start > 0 && IDENT_CHAR.test(masked[start - 1])) {
    return false;
  }
  const after = start + length;
  return after >= masked.length || !IDENT_CHAR.test(masked[after]);
}

/** Index just past the identifier starting at `start`. */
export function identifierEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && IDENT_CHAR.test(text[i])) {
    i += 1;
  }
  return i;
}

/** Index of the first non-space character at or after `start`. */
export function skipSpace(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  return i;
}

/**
 * The span replaced by spaces, every newline kept. Blanking rather than cutting
 * is what keeps the editor's highlight and breakpoints on the lines the user
 * typed - the same rule the directive pass follows.
 */
export function blankSpan(code: string, start: number, end: number): string {
  const removed = code.slice(start, end).replace(/[^\n]/g, ' ');
  return code.slice(0, start) + removed + code.slice(end);
}

/** 1-based line number of an index, for reporting back to the editor. */
export function lineAt(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) {
    if (code[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

/** 0-based column of an index. */
export function columnAt(code: string, index: number): number {
  const start = code.lastIndexOf('\n', index - 1);
  return index - start - 1;
}

/** Splits on `separator`, ignoring any that sit inside brackets or braces. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
    } else if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
