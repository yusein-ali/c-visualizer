/**
 * Program arguments as a line of text, and back.
 *
 * The `args` option and the configuration element take the arguments as an
 * array of strings or as one string written as on a command line; the
 * control bar's field holds the string. The string is split the way a POSIX
 * shell (and Python's `shlex.split`, which a course build uses for the same
 * option) splits a line, without expansions:
 *
 *   - whitespace separates arguments;
 *   - `'...'` keeps everything inside as it is;
 *   - `"..."` keeps everything inside except that `\"`, `\\`, `` \` `` and
 *     `\$` stand for the character after the backslash;
 *   - outside quotes a backslash makes the next character ordinary, a space
 *     included;
 *   - quoted and unquoted parts written together are one argument, and `""`
 *     is an empty one.
 *
 * Where `shlex` refuses a quote that is never closed, this closes it at the
 * end of the line: the reader is typing, and half a line is not an error
 * worth stopping a run for.
 */

const SPACE = /\s/;
/** What a backslash escapes inside double quotes. */
const DOUBLE_QUOTED_ESCAPES = '"\\$`';

export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  /** Whether an argument has started: `""` is one, empty. */
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (
        character === '\\' &&
        i + 1 < line.length &&
        DOUBLE_QUOTED_ESCAPES.includes(line[i + 1])
      ) {
        current += line[i + 1];
        i += 1;
      } else {
        current += character;
      }
      continue;
    }
    if (SPACE.test(character)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    started = true;
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '\\' && i + 1 < line.length) {
      current += line[i + 1];
      i += 1;
    } else {
      current += character;
    }
  }
  if (started) {
    args.push(current);
  }
  return args;
}

/**
 * Arguments as a line `splitArgs` reads back into the same arguments: plain
 * ones as they are, anything else in single quotes.
 */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((arg) =>
      /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)
        ? arg
        : `'${arg.replace(/'/g, `'"'"'`)}'`
    )
    .join(' ');
}

/**
 * The `args` option, if it is one: an array of strings, or a line to split.
 * Anything else - including an array holding something other than a string -
 * is dropped, with `warn` told why.
 */
export function programArgsOption(
  value: unknown,
  warn: (message: string) => void
): string[] | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value === 'string') {
    return splitArgs(value);
  }
  if (Array.isArray(value) && value.every((arg) => typeof arg === 'string')) {
    return [...value];
  }
  warn('args must be an array of strings or one string of arguments');
  return undefined;
}
