import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';
import { cInt, num } from './memory';

/**
 * `<ctype.h>` in the "C" locale.
 *
 * A true classification returns the bit glibc's table holds for the class
 * rather than 1, so `printf("%d", isdigit('5'))` prints 2048 here exactly as
 * it does on the Linux machine the course runs on - "nonzero" is all C
 * promises, and seeing a number other than 1 is the lesson.
 *
 * Every argument has to be `EOF` or a value an `unsigned char` can hold.
 * Anything else - typically a `char` above 127 on a machine where `char` is
 * signed - is undefined, and stops the program with a diagnostic that says
 * how to convert it.
 */

const EOF = -1;

type Classifier = (c: number) => boolean;

const between = (c: number, low: string, high: string): boolean =>
  low.charCodeAt(0) <= c && c <= high.charCodeAt(0);

const isUpper: Classifier = (c) => between(c, 'A', 'Z');
const isLower: Classifier = (c) => between(c, 'a', 'z');
const isAlpha: Classifier = (c) => isUpper(c) || isLower(c);
const isDigit: Classifier = (c) => between(c, '0', '9');
const isAlnum: Classifier = (c) => isAlpha(c) || isDigit(c);
const isXdigit: Classifier = (c) =>
  isDigit(c) || between(c, 'a', 'f') || between(c, 'A', 'F');
const isSpace: Classifier = (c) => c === 32 || (9 <= c && c <= 13);
const isBlank: Classifier = (c) => c === 32 || c === 9;
const isPrint: Classifier = (c) => 32 <= c && c <= 126;
const isGraph: Classifier = (c) => 33 <= c && c <= 126;
const isCntrl: Classifier = (c) => (0 <= c && c <= 31) || c === 127;
const isPunct: Classifier = (c) => isGraph(c) && !isAlnum(c);

/** Each classification, with the bit glibc returns for it. */
const CLASSES: Record<string, [Classifier, number]> = {
  isupper: [isUpper, 256],
  islower: [isLower, 512],
  isalpha: [isAlpha, 1024],
  isdigit: [isDigit, 2048],
  isxdigit: [isXdigit, 4096],
  isspace: [isSpace, 8192],
  isprint: [isPrint, 16384],
  isgraph: [isGraph, 32768],
  isblank: [isBlank, 1],
  iscntrl: [isCntrl, 2],
  ispunct: [isPunct, 4],
  isalnum: [isAlnum, 8],
};

export function installCtype(global: Scope, host: LibraryHost): void {
  /** The argument as C requires it, or a diagnostic. */
  const character = (fn: string, value: unknown): number => {
    const c = Math.trunc(num(value));
    if (c === EOF || (0 <= c && c <= 255)) {
      return c;
    }
    host.refuse(
      'ctype-argument',
      `${fn} was passed ${Number.isFinite(c) ? c : 'a value'}, which is ` +
        `neither EOF nor a value an unsigned char can hold, so the result ` +
        `is undefined; convert a char argument with (unsigned char) first`
    );
  };

  for (const [name, [classify, bit]] of Object.entries(CLASSES)) {
    global.setTop(
      name,
      (c: unknown) => {
        const code = character(name, c);
        return cInt(code !== EOF && classify(code) ? bit : 0);
      },
      'FUNCTION'
    );
  }
  global.setTop(
    'toupper',
    (c: unknown) => {
      const code = character('toupper', c);
      return cInt(isLower(code) ? code - 32 : code);
    },
    'FUNCTION'
  );
  global.setTop(
    'tolower',
    (c: unknown) => {
      const code = character('tolower', c);
      return cInt(isUpper(code) ? code + 32 : code);
    },
    'FUNCTION'
  );
}
