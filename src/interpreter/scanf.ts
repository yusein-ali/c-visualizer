/**
 * `scanf` the way C defines it.
 *
 * `unicoen.ts` delegates the whole read to the `scanf` npm package, whose `%d`
 * matches `[-]?[A-Za-z0-9]+` and hands whatever it matched to `parseInt`. On
 * the input `abc` that stores `NaN` in the variable, reports one successful
 * conversion, and swallows the input. C does none of those three: a directive
 * that cannot match assigns nothing, is not counted in the return value, and
 * leaves the offending character where the next read will find it.
 *
 * This module is the matching half of a C-conformant `scanf` - format string
 * in, values and leftover input out - with no dependency on the interpreter.
 * `CPP14Engine.includeStdio` is the other half: it owns the addresses the
 * values are stored at and the stdin buffer the leftovers go back into.
 *
 * Input arrives a line at a time from a console rather than from a file, so
 * the scan is a generator: it yields when it wants a character the program has
 * not been given yet, and is resumed with more text. That is what `scanf("%d
 * %d", &a, &b)` needs to read its second number from a second line. The input
 * ends only when the reader says so - the console's end-of-input action, Ctrl+D
 * - and the scan is then resumed with `null`: the directive waiting fails with
 * an input failure, and a call that had converted nothing yet returns `EOF`.
 *
 * End of input is a single event, as Ctrl+D at a terminal is: the read that
 * was waiting returns `EOF` and sets the stream's end-of-file indicator, and a
 * later read waits for new input rather than returning `EOF` again at once.
 * C11 has a read return `EOF` for as long as the indicator stays set, but a
 * console session that could never read again after one Ctrl+D would have to
 * be restarted to try the next input.
 *
 * Two deliberate departures from the standard, both in the direction of not
 * hanging a program on input no conversion will use:
 *
 *   - Whitespace in the format consumes the whitespace already buffered and
 *     never waits for more. In C `scanf("%d\n")` blocks until a non-blank
 *     character arrives, which in this application looks like a program that
 *     has stopped for no reason.
 *   - A numeric conversion keeps the longest genuinely valid prefix instead of
 *     failing over a partial match: `%f` on `1e` reads `1` and leaves `e`,
 *     where C reads `1e`, fails, and pushes both back.
 */

/** One value a conversion produced, in the order the arguments expect them. */
export type ScanValue = (
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  /** `%c`: exactly as many characters as the width asked for, unterminated. */
  | { kind: 'char'; text: string }
  /** `%s` and `%[`: a token, terminated when stored. */
  | { kind: 'string'; text: string }
) & {
  /**
   * Whether the value counts towards what `scanf` returns. `%n` reports how
   * much input was read rather than converting any of it, and C excludes it
   * from the count.
   */
  counted: boolean;
};

/**
 * Why a call stopped early. A matching failure is silent in C - the return
 * value is the only trace of it - and silence is what makes `scanf` hard to
 * teach: the read that follows trips over the same characters and returns 0
 * without stopping for input, which looks like a statement that never ran.
 * The caller says so out loud.
 */
export interface ScanFailure {
  /** The directive that could not match, written as it is in the format. */
  directive: string;
  /** The input it stopped at, ready to quote in a message. */
  found: string;
  /** `%*d`: a discard that found nothing to discard is not worth reporting. */
  suppressed: boolean;
  /**
   * Present, and true, when the directive failed because the input ended
   * rather than because a character did not match: C's input failure. Only a
   * scan over complete input (`scanString`) can end.
   */
  endOfInput?: true;
}

export interface ScanResult {
  /** The values to assign, one per argument the format did not suppress. */
  values: ScanValue[];
  /** The input the call did not consume. The next read starts here. */
  rest: string;
  /** Absent when every directive in the format matched. */
  failure?: ScanFailure;
  /**
   * How many conversions completed, suppressed ones included and `%n` not.
   * `sscanf` returns `EOF` for an input failure before the first of them.
   */
  conversions: number;
  /**
   * Whether the scan looked for a character past the end of input that has
   * ended - complete input, or a stream the reader ended. That look is what
   * sets a stream's end-of-file indicator: `%d` on a file holding `5` reads
   * past the `5` to see where the number stops, and `feof` is true after it.
   */
  reachedEnd: boolean;
}

type Directive =
  /** Whitespace in the format: skip whatever is buffered. */
  | { kind: 'space' }
  /** An ordinary character, which the input has to match exactly. */
  | { kind: 'literal'; text: string }
  | {
      kind: 'conversion';
      /** The whole directive as the format writes it, for a message to quote. */
      source: string;
      /** The conversion character, `%` included. */
      spec: string;
      /** The field width, or `Infinity` when the format gives none. */
      width: number;
      /** `%*d`: convert, then throw the value away. */
      suppress: boolean;
      /** `%[`: the characters the scanset admits. */
      accepts?: (character: string) => boolean;
    };

const SPACE = /\s/;
const DIGIT = /[0-9]/;
/** Length modifiers pick the destination's size, which is the caller's to know. */
const LENGTH = 'hlLjzt';

const patternFor = (spec: string): RegExp | null => {
  switch (spec) {
    case 'd':
    case 'u':
      return /^[+-]?[0-9]+/;
    case 'i':
      return /^[+-]?(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/;
    case 'o':
      return /^[+-]?[0-7]+/;
    case 'x':
    case 'X':
      return /^[+-]?(?:0[xX][0-9a-fA-F]+|[0-9a-fA-F]+)/;
    case 'p':
      // What `%p` prints: `0x` and hexadecimal, or `(nil)` for a null pointer.
      return /^(?:\(nil\)|[+-]?(?:0[xX][0-9a-fA-F]+|[0-9a-fA-F]+))/;
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
    case 'a':
    case 'A':
      return /^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[+-]?(?:inf(?:inity)?|nan))/i;
    default:
      return null;
  }
};

/** The base `strtol` would use for the text a numeric conversion matched. */
const baseFor = (spec: string, text: string): number => {
  switch (spec) {
    case 'o':
      return 8;
    case 'x':
    case 'X':
    case 'p':
      return 16;
    case 'i':
      if (/^[+-]?0[xX]/.test(text)) {
        return 16;
      }
      return /^[+-]?0[0-7]/.test(text) ? 8 : 10;
    default:
      return 10;
  }
};

const toFloat = (text: string): number => {
  const sign = text.startsWith('-') ? -1 : 1;
  if (/nan$/i.test(text)) {
    return NaN;
  }
  if (/inf(inity)?$/i.test(text)) {
    return sign * Infinity;
  }
  return Number.parseFloat(text);
};

/** Expands the ranges in a `%[a-z]` scanset into the characters it admits. */
const scansetMembers = (source: string): Set<string> => {
  const members = new Set<string>();
  let i = 0;
  while (i < source.length) {
    const isRange =
      source[i + 1] === '-' &&
      i + 2 < source.length &&
      source.charCodeAt(i) <= source.charCodeAt(i + 2);
    if (isRange) {
      for (let c = source.charCodeAt(i); c <= source.charCodeAt(i + 2); ++c) {
        members.add(String.fromCharCode(c));
      }
      i += 3;
      continue;
    }
    members.add(source[i]);
    i += 1;
  }
  return members;
};

/**
 * One directive of a `scanf` format, as a host shows it: where it is in the
 * format and what it asks for. `c-stdio.js` publishes these so a format
 * playground splits a format exactly where the scan does.
 */
export type ScanDirective =
  /** A run of whitespace: skips whatever whitespace is buffered. */
  | { kind: 'space'; source: string; start: number; end: number }
  /** Ordinary characters, which the input has to match one by one. */
  | { kind: 'literal'; source: string; start: number; end: number }
  /**
   * A `%` that starts no conversion C has (`%q`, or a `%` at the very end).
   * It is matched as an ordinary `%`, so a typo fails to match rather than
   * disappearing; `written` is the directive as far as it was written and
   * `spec` the character that is not a conversion, `''` at the end.
   */
  | {
      kind: 'invalid';
      source: '%';
      start: number;
      end: number;
      written: string;
      spec: string;
    }
  | {
      kind: 'conversion';
      /** The whole directive as the format writes it. */
      source: string;
      start: number;
      end: number;
      /** `%*d`: convert, then throw the value away. */
      suppress: boolean;
      /** The field width, or null when the format gives none (or `0`). */
      width: number | null;
      /** The length modifier as written, `''` for none; it is skipped here. */
      length: string;
      /** The conversion character, `%` and `[` included. */
      spec: string;
      /** `%[`: the set as written between the brackets, and whether `]` closed it. */
      scanset: { negated: boolean; members: string; closed: boolean } | null;
    };

/**
 * The format as directives, with offsets: `start` and `end` index the format.
 * Anything the parser cannot make sense of - a conversion character C does
 * not have, a `%` at the very end - is an `invalid` directive, matched as the
 * literal `%` it is written with, so a typo in the format fails to match
 * rather than disappearing.
 */
export function parseScanFormat(format: string): ScanDirective[] {
  const directives: ScanDirective[] = [];
  let i = 0;
  while (i < format.length) {
    const start = i;
    if (SPACE.test(format[i])) {
      while (i < format.length && SPACE.test(format[i])) {
        i += 1;
      }
      directives.push({
        kind: 'space',
        source: format.slice(start, i),
        start,
        end: i,
      });
      continue;
    }
    if (format[i] !== '%') {
      const last = directives[directives.length - 1];
      if (last?.kind === 'literal' && last.end === i) {
        last.source += format[i];
        last.end = i + 1;
      } else {
        directives.push({
          kind: 'literal',
          source: format[i],
          start,
          end: i + 1,
        });
      }
      i += 1;
      continue;
    }

    let j = i + 1;
    const suppress = format[j] === '*';
    if (suppress) {
      j += 1;
    }
    let digits = '';
    while (j < format.length && DIGIT.test(format[j])) {
      digits += format[j];
      j += 1;
    }
    const lengthStart = j;
    while (j < format.length && LENGTH.includes(format[j])) {
      j += 1;
    }
    const length = format.slice(lengthStart, j);
    const spec = format[j];
    if (spec === undefined || !'diuoxXpeEfFgGaAcsn%['.includes(spec)) {
      directives.push({
        kind: 'invalid',
        source: '%',
        start,
        end: start + 1,
        written: format.slice(start, Math.min(j + 1, format.length)),
        spec: spec ?? '',
      });
      i += 1;
      continue;
    }

    let scanset: { negated: boolean; members: string; closed: boolean } | null =
      null;
    if (spec === '[') {
      let k = j + 1;
      const negated = format[k] === '^';
      if (negated) {
        k += 1;
      }
      // A `]` first in the set is a member of it, not the end of it.
      const begin = format[k] === ']' ? k + 1 : k;
      const close = format.indexOf(']', begin);
      // An unterminated set takes the rest of the format, which is what a
      // beginner who forgot the `]` means by it.
      scanset = {
        negated,
        members: format.slice(k, close === -1 ? format.length : close),
        closed: close !== -1,
      };
      j = close === -1 ? format.length : close;
    }

    directives.push({
      kind: 'conversion',
      source: format.slice(i, j + 1),
      start,
      end: Math.min(j + 1, format.length),
      suppress,
      width: Number(digits) > 0 ? Number(digits) : null,
      length,
      spec,
      scanset,
    });
    i = j + 1;
  }
  return directives;
}

/** The directives as the scan below runs them: one literal per character. */
const parseFormat = (format: string): Directive[] =>
  parseScanFormat(format).flatMap((directive): Directive[] => {
    switch (directive.kind) {
      case 'space':
        return [{ kind: 'space' }];
      case 'literal':
        return Array.from(directive.source, (text) => ({
          kind: 'literal' as const,
          text,
        }));
      case 'invalid':
        return [{ kind: 'literal', text: '%' }];
      case 'conversion': {
        const { scanset } = directive;
        let accepts: ((character: string) => boolean) | undefined;
        if (scanset !== null) {
          const members = scansetMembers(scanset.members);
          accepts = (character: string) =>
            members.has(character) !== scanset.negated;
        }
        return [
          {
            kind: 'conversion',
            source: directive.source,
            spec: directive.spec,
            width: directive.width ?? Infinity,
            suppress: directive.suppress,
            accepts,
          },
        ];
      }
    }
  });

/**
 * Matches `format` against `input`, yielding whenever it needs more input than
 * it has. Resume it with the next line, terminated by the newline the user
 * pressed Enter for; a resume that adds nothing makes no progress and the scan
 * asks again. Resume it with `null` when the input has ended: from then on it
 * asks for nothing more, and the directive that wanted input fails with an
 * input failure.
 *
 * With `complete` set the input is all there will ever be - the string
 * `sscanf` reads - so the scan never yields: where it would wait, the input
 * has ended, and the directive fails with an input failure instead.
 */
export function* scan(
  format: string,
  input: string,
  complete = false
): Generator<void, ScanResult, string | null> {
  const directives = parseFormat(format);
  const values: ScanValue[] = [];
  let buffer = input;
  let position = 0;
  /** What `%n` reports: everything this call has read. */
  let read = 0;
  let conversions = 0;
  let failure: ScanFailure | undefined;
  /** Set once the input has ended: complete from the start, or resumed with null. */
  let ended = complete;
  let reachedEnd = false;

  const atEnd = () => buffer.length <= position;

  const take = (count: number): string => {
    const text = buffer.substr(position, count);
    position += text.length;
    read += text.length;
    return text;
  };

  /** Asks for more input; false when there is none to come. */
  function* need(): Generator<void, boolean, string | null> {
    if (!ended) {
      const text: string | null | undefined = yield;
      if (text !== null) {
        buffer += text ?? '';
        return true;
      }
      ended = true;
    }
    reachedEnd = true;
    return false;
  }

  /** Skips whitespace, waiting for input, the way every conversion but `%c`,
   * `%[` and `%n` begins. */
  function* skipSpace(): Generator<void, void, string | null> {
    for (;;) {
      while (!atEnd() && SPACE.test(buffer[position])) {
        take(1);
      }
      if (!atEnd() || !(yield* need())) {
        return;
      }
    }
  }

  /**
   * The longest run from here that `matches` admits, up to `width`. A run that
   * reaches the end of the buffer may continue into input that has not arrived
   * yet, so it waits for that input rather than reporting a short token.
   */
  function* matchRun(
    matches: (text: string) => number,
    width: number
  ): Generator<void, string, string | null> {
    for (;;) {
      const window = buffer.substr(position, width);
      const length = matches(window);
      if (
        position + length === buffer.length &&
        length < width &&
        (yield* need())
      ) {
        continue;
      }
      return take(length);
    }
  }

  const runOf = (pattern: RegExp) => (window: string) =>
    pattern.exec(window)?.[0].length ?? 0;

  const runWhile =
    (accepts: (character: string) => boolean) => (window: string) => {
      let length = 0;
      while (length < window.length && accepts(window[length])) {
        length += 1;
      }
      return length;
    };

  /** The input a directive stopped at, as a message would name it. */
  const found = (): string => {
    if (atEnd()) {
      return 'the end of the input';
    }
    if (buffer[position] === '\n') {
      return 'the end of the line';
    }
    if (SPACE.test(buffer[position])) {
      return 'a space';
    }
    const token = /^\S{1,16}/.exec(buffer.slice(position));
    return `"${token === null ? buffer[position] : token[0]}"`;
  };

  const fail = (directive: string, suppressed: boolean): void => {
    failure = atEnd()
      ? { directive, found: found(), suppressed, endOfInput: true }
      : { directive, found: found(), suppressed };
  };

  for (const directive of directives) {
    if (directive.kind === 'space') {
      // Never `skipSpace`: waiting here is waiting for input the format has no
      // conversion left to spend, which reads as a hang.
      while (!atEnd() && SPACE.test(buffer[position])) {
        take(1);
      }
      continue;
    }

    if (directive.kind === 'literal') {
      while (atEnd() && (yield* need())) {
        // waiting for the character to compare
      }
      if (atEnd() || buffer[position] !== directive.text) {
        // A matching failure ends the call and keeps the character.
        fail(`"${directive.text}"`, false);
        break;
      }
      take(1);
      continue;
    }

    const { source, spec, width, suppress, accepts } = directive;

    if (spec === 'n') {
      if (!suppress) {
        values.push({ kind: 'int', value: read, counted: false });
      }
      continue;
    }

    if (spec === 'c') {
      // One character unless the format asks for a field of them.
      const count = width === Infinity ? 1 : width;
      while (buffer.length - position < count && (yield* need())) {
        // waiting for the whole field
      }
      if (atEnd()) {
        fail(source, suppress);
        break;
      }
      // Input that ends inside the field: C stores nothing for it.
      if (buffer.length - position < count) {
        take(count);
        failure = {
          directive: source,
          found: found(),
          suppressed: suppress,
          endOfInput: true,
        };
        break;
      }
      const text = take(count);
      conversions += 1;
      if (!suppress) {
        values.push({ kind: 'char', text, counted: true });
      }
      continue;
    }

    if (spec === 's' || spec === '[') {
      if (spec === 's') {
        yield* skipSpace();
      }
      const admits =
        spec === 's'
          ? (character: string) => !SPACE.test(character)
          : (accepts ?? (() => false));
      const text = yield* matchRun(runWhile(admits), width);
      if (text === '') {
        // `%[` matched nothing, or the input ended before `%s` found a token.
        fail(source, suppress);
        break;
      }
      conversions += 1;
      if (!suppress) {
        values.push({ kind: 'string', text, counted: true });
      }
      continue;
    }

    yield* skipSpace();

    if (spec === '%') {
      if (atEnd() || buffer[position] !== '%') {
        fail(source, suppress);
        break;
      }
      take(1);
      continue;
    }

    const pattern = patternFor(spec);
    if (pattern === null) {
      fail(source, suppress);
      break;
    }
    const text = yield* matchRun(runOf(pattern), width);
    if (text === '') {
      // Nothing here is a number. C leaves the character that said so, which
      // is what makes `while (scanf("%d", &n) != 1)` spin on `abc` rather than
      // eat it.
      fail(source, suppress);
      break;
    }
    conversions += 1;
    if (suppress) {
      continue;
    }
    values.push(
      'eEfFgGaA'.includes(spec)
        ? { kind: 'float', value: toFloat(text), counted: true }
        : {
            kind: 'int',
            value:
              text === '(nil)' ? 0 : Number.parseInt(text, baseFor(spec, text)),
            counted: true,
          }
    );
  }

  return {
    values,
    rest: buffer.slice(position),
    failure,
    conversions,
    reachedEnd,
  };
}

/**
 * The scan of a string that is all the input there is, as `sscanf` reads it.
 * Nothing is waited for: input that runs out is an input failure.
 */
export function scanString(format: string, input: string): ScanResult {
  const step = scan(format, input, true).next('');
  if (!step.done) {
    // `complete` never yields; this is the type system's case, not a real one.
    throw new Error('a scan over complete input asked for more');
  }
  return step.value;
}

/** What `sscanf` returns for a scan: the assignments, or `EOF` (-1). */
export function scanReturnValue(result: ScanResult): number {
  if (result.failure?.endOfInput === true && result.conversions === 0) {
    return -1;
  }
  return result.values.filter((value) => value.counted).length;
}
