/**
 * Escape sequences in character constants and string literals, C11 6.4.4.4.
 *
 * unicoen.ts's `CPP14Engine.escapeText` decodes them with a chain of global
 * replacements whose last two steps turn `\\` into one backslash and then
 * every remaining backslash into `/`: `"a\\nb"` came out as `a/`, a newline
 * and `b`, and `'\\'` as `'/'`. The chain also decodes an escape that an
 * earlier step produced. Reading the literal once, left to right, is the only
 * way to get every sequence right.
 *
 * The result is one character per `char` the literal holds, which is how the
 * engine keeps a `char` sequence.
 */

const SIMPLE: Record<string, number> = {
  "'": 0x27,
  '"': 0x22,
  '?': 0x3f,
  '\\': 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
};

/** One escape sequence C does not define, as `decodeEscapes` found it. */
export interface UnknownEscape {
  /** The sequence as written: `\q`. */
  text: string;
  /** Offset of its backslash in the literal's body. */
  offset: number;
}

export interface DecodedLiteral {
  /** One character per byte. */
  text: string;
  unknown: UnknownEscape[];
}

/**
 * The bytes a literal's body (the text between its quotes) stands for.
 *
 * An unknown escape (`\q`) stands for the character after the backslash, as
 * gcc and clang both read it while warning; it is reported so the editor can
 * say so too. A hexadecimal or octal value too wide for a `char` keeps its
 * low eight bits, which is what those compilers store after their warning.
 */
export function decodeEscapes(body: string): DecodedLiteral {
  const bytes: number[] = [];
  const unknown: UnknownEscape[] = [];
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (char !== '\\' || i + 1 >= body.length) {
      // A character typed as itself is kept as the engine has always kept
      // one: its own code, whatever the console makes of it.
      bytes.push(body.charCodeAt(i));
      i += 1;
      continue;
    }
    const next = body[i + 1];
    const simple = SIMPLE[next];
    if (typeof simple !== 'undefined') {
      bytes.push(simple);
      i += 2;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1));
    if (octal !== null) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += 1 + octal[0].length;
      continue;
    }
    if (next === 'x') {
      const hex = /^[0-9a-fA-F]+/.exec(body.slice(i + 2));
      if (hex !== null) {
        bytes.push(parseInt(hex[0].slice(-2), 16) & 0xff);
        i += 2 + hex[0].length;
        continue;
      }
    }
    if (next === 'u' || next === 'U') {
      const digits = next === 'u' ? 4 : 8;
      const hex = body.slice(i + 2, i + 2 + digits);
      if (hex.length === digits && /^[0-9a-fA-F]+$/.test(hex)) {
        // The character it names, kept as a typed one would be.
        bytes.push(parseInt(hex, 16));
        i += 2 + digits;
        continue;
      }
    }
    unknown.push({ text: `\\${next}`, offset: i });
    bytes.push(body.charCodeAt(i + 1));
    i += 2;
  }
  return { text: String.fromCharCode(...bytes), unknown };
}

/** The bytes alone, for the engine. */
export const decodedText = (body: string): string => decodeEscapes(body).text;
