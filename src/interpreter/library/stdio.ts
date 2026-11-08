import { Int } from 'unicoen.ts/dist/interpreter/CPP14/Int';
import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import {
  argumentKindFor,
  argumentSlots,
  countStoredBy,
  directivesOf,
  formatPrintf,
  parseFormat,
  PrintfArgument,
  PrintfDiagnostic,
  PrintfResult,
} from '../printf';
import {
  ScanFailure,
  ScanResult,
  ScanValue,
  scan,
  scanReturnValue,
  scanString,
} from '../scanf';
import {
  CStream,
  ConsoleInput,
  ConsoleOutput,
  EOF,
  FileStream,
  SEEK_SET,
  encodeText,
  parseMode,
} from '../stream';
import { LIBRARY_CONSTANTS } from './constants';
import { LibraryHost } from './host';
import { Memory, sizeArg } from './memory';
import { variadicValues } from './stdarg';
import { strerrorText } from './string';

/**
 * The functions of `<stdio.h>`: formatted output and input, the standard
 * streams, character and block I/O, positioning, and the operations on files.
 *
 * `printf.ts`, `scanf.ts` and `stream.ts` do the formatting, the matching and
 * the bookkeeping of a `FILE`, and know nothing about the program. This is the
 * half that does: it reads the arguments out of the engine's memory by the
 * conversion that consumes them - only `%s` reads a `char` array, `%p` prints
 * the address it is given, `%n` stores through its pointer - writes results
 * where the program asked, and raises a runtime diagnostic where C leaves the
 * call undefined instead of writing a plausible wrong answer.
 *
 * Every `FILE` is an object in the engine's memory, so a `FILE *` is an
 * ordinary pointer: `stdin`, `stdout` and `stderr` are filed once per run,
 * and `fopen` files one more per call. Standard input comes from the console
 * a line at a time, and a read that finds nothing parks the program until the
 * console sends a line or ends the input. Files live in the program's file
 * system - the uploaded ones and those the program creates - which `remove`
 * and `rename` change and the files panel shows.
 *
 * `CPP14Engine.includeStdio` installs these with a `StdioHost` that lends
 * them the engine's private diagnostics, write tracking and stdin mailbox.
 */

/** What the engine lends the library functions. */
export interface StdioHost {
  /** The program's global scope. Every scope shares its memory maps. */
  readonly global: Scope;
  stdout(text: string): void;
  getStdout(): string;
  /** Writes to the console as standard error: the same transcript, marked. */
  stderr(text: string): void;
  /** Writes the reason to the console, records a fatal diagnostic, throws. */
  refuse(rule: string, message: string): never;
  /** Records a diagnostic on the current statement without stopping. */
  report(diagnostic: PrintfDiagnostic): void;
  /** Tells the engine an address has been written. */
  wrote(address: number): void;
  /** Where the engine wrote a string literal with this text, if it did. */
  literalAddress(text: string): number | null;
  /**
   * Parks the program on a read, or lets it go: the engine's waiting flag,
   * which is what stops a step and turns the console's input on.
   */
  setWaiting(waiting: boolean): void;
  /**
   * What the console sent since the last read - one line, without the
   * newline its Enter stands for - and whether the reader ended the input
   * after it.
   */
  takeInput(): { text: string; ended: boolean };
  /** The program's file system: the uploaded files and the ones it made. */
  files(): Map<string, ArrayBuffer>;
  /** The rest of the library's host: byte-level memory, writes, `errno`. */
  readonly library: LibraryHost;
}

const ENOENT = LIBRARY_CONSTANTS.ENOENT.value;
const EINVAL = LIBRARY_CONSTANTS.EINVAL.value;

/** Where the engine's static area begins; below it is read-only code. */
const STATIC_AREA_BASE = 10000;

/** A cap on reading a string with no terminator in sight. */
const STRING_LIMIT = 65536;

/** An object a pointer can point into, and its size in bytes. */
export interface MemoryBlock {
  start: number;
  size: number;
  /** How a message names it: `buf`, `m[1]`, `the block malloc returned at 0x4e20`. */
  label: string;
  /** What a message calls it. */
  noun: 'array' | 'object';
}

/** Types whose variables are not objects a pointer can address here. */
const NOT_OBJECTS = ['FUNCTION', 'CLASS', 'SYSTEM'];

/** The number an engine value stands for, or null for one that is not. */
const numeric = (raw: unknown): number | null => {
  if (typeof raw === 'number') {
    return raw;
  }
  if (raw instanceof Number) {
    return raw.valueOf();
  }
  if (typeof raw === 'boolean') {
    return raw ? 1 : 0;
  }
  return null;
};

const hex = (address: number): string => `0x${address.toString(16)}`;

const byteText = (count: number): string =>
  `${count} byte${count === 1 ? '' : 's'}`;

/**
 * The object an address falls inside: a block `malloc` returned, or an array
 * a live scope declares. Arrays of arrays are their rows. A member array of a
 * record, and anything else this cannot see, is null - the caller then checks
 * only that the bytes it writes exist.
 */
export function blockAt(
  global: Scope,
  address: number,
  endOf: (start: number, size: number) => number = (start, size) => start + size
): MemoryBlock | null {
  for (const [start, size] of global.mallocData) {
    // A block of records spans more cells than its size; see `blockEnd`.
    const end = endOf(start, size);
    if (start <= address && address < end && global.objectOnMemory.has(start)) {
      return {
        start,
        size: end - start,
        label: `the block malloc returned at ${hex(start)}`,
        noun: 'object',
      };
    }
  }
  let found: MemoryBlock | null = null;
  const visit = (scope: Scope): void => {
    for (const [name, type] of scope.variableTypes) {
      if (found !== null) {
        return;
      }
      const handle = scope.variableAddress.get(name);
      if (
        typeof type !== 'string' ||
        typeof handle === 'undefined' ||
        NOT_OBJECTS.indexOf(type) !== -1
      ) {
        continue;
      }
      if (type.indexOf('[') === -1) {
        // A scalar is its own one-element block, so a `%s` given `&c` stops
        // at the end of `c`. A record's members are laid out apart from it,
        // and are left to the existence check.
        const size = Scope.sizeof(type);
        if (
          !scope.isStructType(type) &&
          handle <= address &&
          address < handle + size
        ) {
          found = { start: handle, size, label: name, noun: 'object' };
        }
        continue;
      }
      const base = numeric(scope.objectOnMemory.get(handle));
      const element = type.slice(0, type.indexOf('['));
      const dimensions = scope.getArrayDims(type);
      if (
        base === null ||
        dimensions.length === 0 ||
        dimensions.length > 2 ||
        dimensions.some((length) => !(length > 0))
      ) {
        continue;
      }
      const elementSize = Scope.sizeof(element);
      if (dimensions.length === 1) {
        const size = dimensions[0] * elementSize;
        if (base <= address && address < base + size) {
          found = { start: base, size, label: name, noun: 'array' };
        }
        continue;
      }
      // A two-dimensional array is a table of row addresses in the code area,
      // each row an array of its own.
      const rowSize = dimensions[1] * elementSize;
      const stride = Scope.sizeof(`${element}[${dimensions[1]}]`);
      for (let row = 0; row < dimensions[0] && found === null; row += 1) {
        const start = numeric(scope.objectOnMemory.get(base + row * stride));
        if (start !== null && start <= address && address < start + rowSize) {
          found = {
            start,
            size: rowSize,
            label: `${name}[${row}]`,
            noun: 'array',
          };
        }
      }
    }
    for (const child of scope.children) {
      if (found === null) {
        visit(child);
      }
    }
  };
  visit(global);
  return found;
}

/** A string read out of memory, with where it lay. */
interface StringRead {
  text: string;
  /** The address of its first character, or null for a literal's bytes. */
  start: number | null;
  /** One past its terminator. */
  end: number | null;
}

/** A character as JavaScript holds it, from a byte as the engine does. */
const characterOf = (byte: number): string =>
  String.fromCharCode(byte < 0 ? byte & 0xff : byte);

/**
 * The string an argument stands for: the bytes of a literal passed straight
 * to the call, or the characters at an address up to the terminator.
 */
function readString(host: StdioHost, raw: unknown, what: string): StringRead {
  if (Array.isArray(raw)) {
    return { text: Engine.bytesToStr(raw), start: null, end: null };
  }
  if (raw instanceof String || typeof raw === 'string') {
    return { text: String(raw), start: null, end: null };
  }
  const address = numeric(raw);
  if (address === null) {
    host.refuse(
      'argument-mismatch',
      `${what} must be a pointer to a string, and the argument given is not one`
    );
  }
  if (address === 0) {
    host.refuse(
      'null-dereference',
      `${what} is a null pointer, which does not point to a string`
    );
  }
  const memory = host.global.objectOnMemory;
  if (!memory.has(address)) {
    host.refuse(
      'invalid-pointer',
      `${what} points to ${hex(address)}, where there is no object`
    );
  }
  const block = blockAt(host.global, address, host.library.blockEnd);
  const limit = block === null ? Infinity : block.start + block.size;
  let text = '';
  let at = address;
  for (;;) {
    if (limit <= at || !memory.has(at) || text.length >= STRING_LIMIT) {
      host.report({
        rule: 'unterminated-string',
        severity: 'warning',
        message:
          `${what} has no terminating null character` +
          (block === null
            ? ''
            : ` within ${block.label} (${byteText(block.size)})`) +
          `; reading past the end of an object has undefined behavior`,
      });
      break;
    }
    const byte = numeric(memory.get(at));
    // Only the empty value a fresh `malloc` block holds is known to be
    // unwritten here: not every writer reports to the engine's own record.
    if (byte === null) {
      host.report({
        rule: 'uninitialized-read',
        severity: 'warning',
        message:
          `${what} reaches a character nothing has written before its ` +
          `terminating null character; its value is indeterminate`,
      });
      break;
    }
    if (byte === 0) {
      break;
    }
    text += characterOf(byte);
    at += 1;
  }
  return { text, start: address, end: at + 1 };
}

/** The address a function writes its result to. */
function destination(host: StdioHost, caller: string, raw: unknown): number {
  if (Array.isArray(raw) || raw instanceof String) {
    host.refuse(
      'read-only-write',
      `${caller} cannot write into a string literal, which is read-only`
    );
  }
  const address = numeric(raw);
  if (address === null) {
    host.refuse(
      'argument-mismatch',
      `the destination of ${caller} must be a pointer to a char array`
    );
  }
  if (address === 0) {
    host.refuse(
      'null-dereference',
      `the destination of ${caller} is a null pointer, which does not point to an array`
    );
  }
  return address;
}

/**
 * Writes `text` and its terminator at `address`, after checking that every
 * byte lands inside one object. Nothing is written when one would not: the
 * canvas shows the memory as it was, and the diagnostic says why.
 */
function writeString(
  host: StdioHost,
  caller: string,
  address: number,
  text: string,
  note = ''
): void {
  const count = text.length + 1;
  const what =
    `${caller} writes ${count} byte${count === 1 ? '' : 's'}` +
    (count === 1
      ? ' (the terminating null character)'
      : ` (${count - 1} character${count === 2 ? '' : 's'} and the terminating null character)`);
  if (address < STATIC_AREA_BASE) {
    host.refuse(
      'read-only-write',
      `${caller} writes to ${hex(address)}, which holds a string literal; ` +
        `modifying a string literal has undefined behavior`
    );
  }
  const block = blockAt(host.global, address, host.library.blockEnd);
  if (block !== null) {
    const room = block.start + block.size - address;
    if (count > room) {
      const offset = address - block.start;
      host.refuse(
        'buffer-overflow',
        `${what} into ${block.label}, which is ${byteText(block.size)} long` +
          (offset === 0
            ? ''
            : `; starting ${byteText(offset)} in, it has room for ${room}`) +
          `${note}; writing past the end of an ${block.noun} has undefined behavior`
      );
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      if (!host.global.objectOnMemory.has(address + i)) {
        host.refuse(
          'buffer-overflow',
          `${what} at ${hex(address)}, but only ${i} of them are inside ` +
            `an object${note}; writing past the end of an object has undefined behavior`
        );
      }
    }
  }
  const bytes = Array.from(text, (character) => character.charCodeAt(0));
  bytes.push(0);
  // Through the library's write, so the call is one mutation on the canvas
  // and a `const` array refuses it.
  bytes.forEach((byte, i) => host.library.write(address + i, byte, caller));
}

/** The arguments of one formatting call, typed by what consumes them. */
interface TypedArguments {
  args: PrintfArgument[];
  /** Where each `%s` read its string, to check against the destination. */
  reads: { source: string; start: number; end: number }[];
  /** Diagnostics this side knows better than the formatter, by argument. */
  overrides: Map<number, PrintfDiagnostic>;
}

/**
 * Turns the engine's raw argument values into typed arguments, looking at
 * the conversion each one meets rather than at the value. That is the fix for
 * the old wrapper, which turned any value that equalled the address of a
 * `char` into a string whatever was going to print it.
 */
function typeArguments(
  host: StdioHost,
  caller: string,
  format: string,
  raw: unknown[]
): TypedArguments {
  const typed: TypedArguments = {
    args: [],
    reads: [],
    overrides: new Map(),
  };
  let next = 0;
  for (const directive of directivesOf(parseFormat(format))) {
    for (const slot of argumentSlots(directive)) {
      if (raw.length <= next) {
        return typed;
      }
      const value = raw[next];
      const index = next;
      next += 1;
      if (slot !== 'value') {
        typed.args.push({ kind: 'int', value: numeric(value) ?? 0 });
        continue;
      }
      const kind = argumentKindFor(directive.conversion);
      if (kind === 'string') {
        const read = readString(
          host,
          value,
          `the argument of ${directive.source}`
        );
        typed.args.push({ kind, value: read.text });
        if (read.start !== null && read.end !== null) {
          typed.reads.push({
            source: directive.source,
            start: read.start,
            end: read.end,
          });
        }
        continue;
      }
      let number = numeric(value);
      if (Array.isArray(value)) {
        // A literal handed straight to the call is its bytes here, and has an
        // address only if the program also stored it somewhere.
        number = host.literalAddress(Engine.bytesToStr(value));
        if (number === null) {
          typed.overrides.set(index, {
            rule: 'literal-address',
            severity: 'warning',
            message:
              `${directive.source} would print the address of a string ` +
              `literal, and this interpreter gives a literal passed straight ` +
              `to ${caller} no address; nothing is written for it`,
          });
          typed.args.push({ kind: 'string', value: '' });
          continue;
        }
      }
      if (number === null) {
        typed.overrides.set(index, {
          rule: 'uninitialized-read',
          severity: 'warning',
          message:
            `the argument of ${directive.source} has no value; using an ` +
            `indeterminate value has undefined behavior`,
        });
        number = 0;
      }
      typed.args.push({ kind, value: number });
    }
  }
  return typed;
}

/** Reports what the formatter said, once per directive. */
function reportFormatting(
  host: StdioHost,
  result: PrintfResult,
  typed: TypedArguments
): void {
  for (const one of result.directives) {
    const override =
      one.argument === null ? undefined : typed.overrides.get(one.argument);
    const diagnostic = override ?? one.diagnostic;
    if (diagnostic !== null) {
      host.report(diagnostic);
    }
  }
}

/** Whether a directive actually performed its conversion. */
const performed = (
  one: PrintfResult['directives'][number],
  typed: TypedArguments
): boolean =>
  one.argument !== null &&
  !typed.overrides.has(one.argument) &&
  one.diagnostic?.severity !== 'error';

/**
 * Stores what each `%n` counted through its pointer, converted to the type its
 * length modifier names. `measure` is how the caller counts what it wrote.
 */
function storeCounts(
  host: StdioHost,
  result: PrintfResult,
  typed: TypedArguments,
  raw: unknown[],
  measure: (text: string) => number
): void {
  for (const one of result.directives) {
    if (one.directive.conversion !== 'n' || !performed(one, typed)) {
      continue;
    }
    const address = numeric(raw[one.argument as number]);
    if (address === 0) {
      host.refuse(
        'null-dereference',
        `${one.directive.source} stores through a null pointer, which does not point to an object`
      );
    }
    if (address === null || !host.global.objectOnMemory.has(address)) {
      host.refuse(
        'invalid-pointer',
        `${one.directive.source} stores through a pointer that does not point to an object`
      );
    }
    const count = measure(result.text.slice(0, one.offset));
    host.global.set(address, countStoredBy(one.directive, count));
    host.wrote(address);
  }
}

/**
 * The bytes the text occupies once it is encoded as UTF-8, which is what a C
 * program's source - and so its output - is in. This is the count `printf`
 * has always returned here.
 */
export const byteCount = (text: string): number => {
  let count = 0;
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    count += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return count;
};

/** Refuses a `%s` whose string overlaps the bytes being written. */
function checkOverlap(
  host: StdioHost,
  caller: string,
  typed: TypedArguments,
  start: number,
  end: number
): void {
  for (const read of typed.reads) {
    if (read.start < end && start < read.end) {
      host.refuse(
        'overlapping-objects',
        `${caller} reads the string for ${read.source} from the array it is ` +
          `writing into; copying between overlapping objects has undefined behavior`
      );
    }
  }
}

/** The format and its result, shared by the three output functions. */
function format(
  host: StdioHost,
  caller: string,
  rawFormat: unknown,
  raw: unknown[]
): { result: PrintfResult; typed: TypedArguments } {
  const text = readString(host, rawFormat, `the format of ${caller}`).text;
  const typed = typeArguments(host, caller, text, raw);
  const result = formatPrintf(text, typed.args, { caller });
  reportFormatting(host, result, typed);
  return { result, typed };
}

/**
 * A scanned number as the object it is stored in holds one: the engine's
 * `Int` for an `int`-sized integer, which keeps C's integer division, and the
 * plain number for a `char`, a pointer, a floating object or a wider integer.
 */
function scannedNumber(host: StdioHost, address: number, value: number) {
  const type = host.global.typeOnMemory.get(address) ?? '';
  if (
    type === '' ||
    type.indexOf('*') !== -1 ||
    /\b(float|double)\b/.test(type) ||
    Scope.sizeof(type) === 1 ||
    !Number.isInteger(value) ||
    value < -2147483648 ||
    2147483647 < value
  ) {
    return value;
  }
  return new Int(value);
}

/** Stores one scanned value where its argument points. */
function storeScanned(
  host: StdioHost,
  caller: string,
  address: number,
  value: ScanValue
): void {
  if (value.kind === 'int' || value.kind === 'float') {
    if (!host.global.objectOnMemory.has(address)) {
      host.refuse(
        'invalid-pointer',
        `${caller} stores through a pointer that does not point to an object`
      );
    }
    host.library.write(
      address,
      scannedNumber(host, address, value.value),
      caller
    );
    return;
  }
  if (value.kind === 'string') {
    writeString(host, caller, address, value.text);
    return;
  }
  // `%c` stores the characters and no terminator.
  Array.from(value.text).forEach((character, i) => {
    if (!host.global.objectOnMemory.has(address + i)) {
      host.refuse(
        'buffer-overflow',
        `${caller} stores ${value.text.length} characters at ${hex(address)}, ` +
          `but only ${i} of them are inside an object`
      );
    }
    host.library.write(address + i, character.charCodeAt(0), caller);
  });
}

/**
 * Stores what a scan converted through the pointers the call was given, the
 * first of them its argument number `first`.
 */
function storeValues(
  host: StdioHost,
  caller: string,
  result: ScanResult,
  addresses: unknown[],
  first: number
): void {
  if (addresses.length < result.values.length) {
    host.report({
      rule: 'missing-argument',
      severity: 'error',
      message:
        `${caller} converted ${result.values.length} values but was given ` +
        `${addresses.length} pointers to store them through; storing ` +
        `through an argument that was never passed has undefined ` +
        `behavior, so the rest are not stored`,
    });
  }
  result.values.forEach((value, i) => {
    if (addresses.length <= i) {
      return;
    }
    const address = numeric(addresses[i]);
    if (address === 0) {
      host.refuse(
        'null-dereference',
        `${caller} stores through a null pointer, which does not point to an object`
      );
    }
    if (address === null) {
      host.refuse(
        'argument-mismatch',
        `${caller} stores through its arguments, and argument ${i + first} is not a pointer`
      );
    }
    storeScanned(host, caller, address, value);
  });
}

/** What a failed `sscanf` directive says for itself, in the program's output. */
export const sscanfFailureNote = (result: ScanResult): string => {
  const failure = result.failure;
  if (typeof failure === 'undefined') {
    return '';
  }
  return (
    `[sscanf] ${failure.directive} did not match ${failure.found} - sscanf ` +
    `stops at the first directive that fails and returns ` +
    `${scanReturnValue(result)}.\n`
  );
};

/**
 * What a failed `scanf` or `fscanf` directive says for itself.
 *
 * The text is here rather than in `strings.ts` because it is not interface
 * chrome: it is written into the program's own output, where the `printf`s
 * around it are, which is the only place it makes sense of what just
 * happened.
 */
const streamFailureNote = (caller: string, failure: ScanFailure): string =>
  `[${caller}] ${failure.directive} did not match ${failure.found} - it stays in` +
  ` the input, so the next read starts there.\n`;

/**
 * Says why a scan stopped, unless the input ended (which `EOF` says) or the
 * directive was a deliberate discard. `while (scanf("%d", &n) != 1);` fails
 * identically on every turn, and one note per turn would bury the program's
 * own output, so it is said again only once something else has been printed.
 */
function noteFailure(host: StdioHost, note: string, result: ScanResult) {
  const failure = result.failure;
  if (
    typeof failure === 'undefined' ||
    failure.suppressed ||
    failure.endOfInput === true
  ) {
    return;
  }
  if (!host.getStdout().endsWith(note)) {
    host.stdout(note);
  }
}

/** The library functions of `<stdio.h>`, in the order the engine registers them. */
export const STDIO_FUNCTIONS = [
  'printf',
  'sprintf',
  'snprintf',
  'sscanf',
  'scanf',
  'fprintf',
  'fscanf',
  'puts',
  'putchar',
  'getchar',
  'gets',
  'fopen',
  'fclose',
  'fflush',
  'fgetc',
  'fgets',
  'fputc',
  'fputs',
  'ungetc',
  'fread',
  'fwrite',
  'fseek',
  'ftell',
  'rewind',
  'feof',
  'ferror',
  'clearerr',
  'perror',
  'remove',
  'rename',
  'vprintf',
  'vfprintf',
  'vsprintf',
  'vsnprintf',
] as const;

export type StdioFunctionName = (typeof STDIO_FUNCTIONS)[number];

/** One program run's `<stdio.h>`, as the engine installs it. */
export interface StdioRuntime {
  /** Every function, ready for `Scope.setTop`. */
  functions: Record<StdioFunctionName, (...args: any[]) => unknown>;
  /** The values of `stdin`, `stdout` and `stderr`: where each `FILE` is filed. */
  standard: Record<'stdin' | 'stdout' | 'stderr', number>;
  /**
   * What C does to every stream still open when the program ends: flushes
   * what it buffered into its file.
   */
  closeAll(): void;
}

/** A function's `int` result, as the engine computes with one. */
const cInt = (value: number): Int => new Int(value);

/** A file's contents as bytes, whichever form the file system holds them in. */
const bytesOf = (contents: ArrayBuffer | ArrayBufferView): Uint8Array =>
  ArrayBuffer.isView(contents)
    ? new Uint8Array(
        contents.buffer,
        contents.byteOffset,
        contents.byteLength
      ).slice()
    : new Uint8Array(contents.slice(0));

/**
 * Files `stdin`, `stdout` and `stderr` in the engine's memory and returns the
 * functions that work on them, on the files the program opens, and on the
 * program's memory. Called once per program run, so every run starts with
 * fresh streams and nothing open.
 */
export function installStdio(host: StdioHost): StdioRuntime {
  const memory = new Memory(host.library);
  const stdin = new ConsoleInput();
  const stdout = new ConsoleOutput('stdout');
  const stderr = new ConsoleOutput('stderr');
  const standard = {
    stdin: host.global.setCode(stdin, 'FILE'),
    stdout: host.global.setCode(stdout, 'FILE'),
    stderr: host.global.setCode(stderr, 'FILE'),
  };
  /** The files the program has open, which the end of the program flushes. */
  const open = new Set<FileStream>();

  const warn = (rule: string, message: string): void =>
    host.report({ rule, severity: 'warning', message });

  /** A stream that has not been closed. */
  const checkOpen = <S extends CStream>(stream: S, caller: string): S => {
    if (stream.closed) {
      host.refuse(
        'closed-stream',
        `${caller} uses ${stream.label}, which fclose has already closed; ` +
          `using a stream after closing it has undefined behavior`
      );
    }
    return stream;
  };

  /** The stream a `FILE *` argument points to, checked. */
  const streamArg = (raw: unknown, caller: string): CStream => {
    const address = numeric(raw);
    if (address === 0) {
      host.refuse(
        'null-stream',
        `${caller} was passed a null pointer as its stream; fopen returns a ` +
          `null pointer when it cannot open a file, so check what it ` +
          `returned before using it`
      );
    }
    const object =
      address === null ? undefined : host.global.objectOnMemory.get(address);
    if (!(object instanceof CStream)) {
      host.refuse(
        'invalid-stream',
        `${caller} was given a pointer that does not point to a FILE object; ` +
          `pass the FILE * that fopen returned, or stdin, stdout or stderr`
      );
    }
    return checkOpen(object, caller);
  };

  /** Hands a file's buffered writes to the file system. */
  const commit = (stream: FileStream): void => {
    if (stream.dirty && !stream.detached) {
      host.files().set(stream.name, stream.contents());
    }
    stream.dirty = false;
  };

  /** Whether the stream's mode lets it be written; says so when not. */
  const writable = (stream: CStream, caller: string): boolean => {
    if (stream.mode.write) {
      return true;
    }
    stream.error = true;
    warn(
      'stream-mode',
      `${caller} writes to ${stream.label}, which is open for reading only ` +
        `("${stream.mode.text}"); the write fails, sets the stream's error ` +
        `indicator and returns EOF`
    );
    return false;
  };

  /** Whether the stream's mode lets it be read; says so when not. */
  const readable = (stream: CStream, caller: string): boolean => {
    if (stream.mode.read) {
      return true;
    }
    stream.error = true;
    warn(
      'stream-mode',
      `${caller} reads from ${stream.label}, which is open for writing only ` +
        `("${stream.mode.text}"); the read fails, sets the stream's error ` +
        `indicator and returns EOF`
    );
    return false;
  };

  /**
   * Writes text to a stream: to the console for the two standard ones, into
   * the file's buffer otherwise. The bytes written, or null when the stream
   * cannot be written.
   */
  const put = (
    stream: CStream,
    text: string,
    caller: string
  ): number | null => {
    if (!writable(stream, caller)) {
      return null;
    }
    if (stream instanceof FileStream) {
      const bytes = encodeText(text);
      stream.write(bytes);
      return bytes.length;
    }
    if (stream.kind === 'stderr') {
      host.stderr(text);
    } else {
      host.stdout(text);
    }
    return byteCount(text);
  };

  /** Writes bytes, as `fputc` and `fwrite` do; false when it cannot. */
  const putBytes = (
    stream: CStream,
    bytes: number[],
    caller: string
  ): boolean => {
    if (!writable(stream, caller)) {
      return false;
    }
    if (stream instanceof FileStream) {
      stream.write(bytes);
      return true;
    }
    const text = String.fromCharCode(
      ...bytes.map((byte) => (byte < 0 ? byte & 0xff : byte))
    );
    if (stream.kind === 'stderr') {
      host.stderr(text);
    } else {
      host.stdout(text);
    }
    return true;
  };

  /**
   * Parks the program until the console answers. A terminal echoes what was
   * typed at it, and the console does not write the line into the transcript
   * itself; the newline is the Enter that sent it, and it is part of the
   * input too. Input the reader ended has no Enter after it.
   */
  function* awaitInput(): Generator<undefined, void, unknown> {
    host.setWaiting(true);
    yield;
    host.setWaiting(false);
    const { text, ended } = host.takeInput();
    const line = ended ? text : `${text}\n`;
    if (line !== '') {
      host.stdout(line);
    }
    stdin.buffer += line;
    stdin.endPending = stdin.endPending || ended;
  }

  /** The next character of a stream, or `EOF`; standard input may wait. */
  function* getByte(
    stream: CStream,
    caller: string
  ): Generator<undefined, number, unknown> {
    if (!readable(stream, caller)) {
      return EOF;
    }
    if (stream instanceof FileStream) {
      return stream.getc();
    }
    if (!(stream instanceof ConsoleInput)) {
      return EOF;
    }
    for (;;) {
      const code = stream.take();
      if (code !== null) {
        return code;
      }
      if (stream.takeEnd()) {
        return EOF;
      }
      yield* awaitInput();
    }
  }

  /**
   * Scans a stream. Standard input is scanned as it arrives, waiting for a
   * line whenever the scan wants more; a file is scanned from its position to
   * its end, and the position moves past what the scan consumed.
   */
  function* scanFrom(
    stream: CStream,
    format: string,
    caller: string
  ): Generator<undefined, ScanResult, unknown> {
    if (!readable(stream, caller)) {
      return scanString(format, '');
    }
    if (stream instanceof ConsoleInput) {
      const scanner = scan(format, stream.takeAll());
      let step = scanner.next('');
      while (!step.done) {
        if (stream.takeEnd()) {
          step = scanner.next(null);
          continue;
        }
        yield* awaitInput();
        const text = stream.buffer;
        stream.buffer = '';
        step = scanner.next(text);
      }
      // Whatever the conversions did not want is the next read's input,
      // including the character a failed conversion refused to convert.
      stream.buffer = step.value.rest + stream.buffer;
      return step.value;
    }
    if (!(stream instanceof FileStream)) {
      return scanString(format, '');
    }
    // A window rather than the whole file, widened only when the scan runs
    // off its end before the file's: a loop of `fscanf("%d")` over a long
    // file then costs what it reads.
    for (let limit = 4096; ; limit *= 4) {
      const { text, whole } = stream.peek(limit);
      const result = scanString(format, text);
      if (result.reachedEnd && !whole) {
        continue;
      }
      for (let i = text.length - result.rest.length; 0 < i; i -= 1) {
        stream.getc();
      }
      if (result.reachedEnd) {
        stream.eof = true;
      }
      return result;
    }
  }

  /** `scanf` and `fscanf`: scan a stream, store, report, return. */
  function* scanInto(
    caller: string,
    stream: CStream,
    rawFormat: unknown,
    addresses: unknown[],
    first: number
  ): Generator<undefined, Int, unknown> {
    const formatText = readString(
      host,
      rawFormat,
      `the format of ${caller}`
    ).text;
    const result = yield* scanFrom(stream, formatText, caller);
    if (typeof result.failure !== 'undefined') {
      noteFailure(host, streamFailureNote(caller, result.failure), result);
    }
    storeValues(host, caller, result, addresses, first);
    return cInt(scanReturnValue(result));
  }

  /** Reads characters up to a newline or a count, as `fgets` and `gets` do. */
  function* readLine(
    stream: CStream,
    limit: number,
    caller: string
  ): Generator<undefined, { text: string; ended: boolean }, unknown> {
    let text = '';
    while (text.length < limit) {
      const code = yield* getByte(stream, caller);
      if (code === EOF) {
        return { text, ended: true };
      }
      text += String.fromCharCode(code);
      if (code === 0x0a) {
        break;
      }
    }
    return { text, ended: false };
  }

  /** A file name argument, as text. */
  const nameArg = (raw: unknown, caller: string, what: string): string =>
    readString(host, raw, `the ${what} given to ${caller}`).text;

  // Each formatted-output function is written once, for its own name and
  // for its `v` twin, which formats the arguments a `va_list` stands for.
  const printfAs = (
    caller: string,
    rawFormat: unknown,
    args: unknown[]
  ): number => {
    checkOpen(stdout, caller);
    const { result, typed } = format(host, caller, rawFormat, args);
    host.stdout(result.text);
    storeCounts(host, result, typed, args, byteCount);
    return byteCount(result.text);
  };

  const printf = (...raw: unknown[]): number =>
    raw.length === 0 ? 0 : printfAs('printf', raw[0], raw.slice(1));

  const sprintfAs = (
    caller: string,
    buffer: unknown,
    rawFormat: unknown,
    args: unknown[]
  ): number => {
    const address = destination(host, caller, buffer);
    const { result, typed } = format(host, caller, rawFormat, args);
    checkOverlap(
      host,
      caller,
      typed,
      address,
      address + result.text.length + 1
    );
    writeString(host, caller, address, result.text);
    storeCounts(host, result, typed, args, (text) => text.length);
    return result.text.length;
  };

  const sprintf = (...raw: unknown[]): number =>
    sprintfAs('sprintf', raw[0], raw[1], raw.slice(2));

  const snprintfAs = (
    caller: string,
    buffer: unknown,
    rawSize: unknown,
    rawFormat: unknown,
    args: unknown[]
  ): number => {
    const given = numeric(rawSize) ?? 0;
    // `size_t`: a negative int argument arrives as a huge size.
    const size =
      given < 0 || !Number.isFinite(given) ? Infinity : Math.trunc(given);
    const { result, typed } = format(host, caller, rawFormat, args);
    if (size > 0) {
      const address = destination(host, caller, buffer);
      const kept = result.text.slice(0, Math.min(result.text.length, size - 1));
      checkOverlap(host, caller, typed, address, address + kept.length + 1);
      writeString(
        host,
        caller,
        address,
        kept,
        Number.isFinite(size)
          ? `, because the size argument (${size}) is larger than the array`
          : `, because the size argument is negative and so converts to a huge size_t`
      );
    }
    storeCounts(host, result, typed, args, (text) => text.length);
    return result.text.length;
  };

  const snprintf = (...raw: unknown[]): number =>
    snprintfAs('snprintf', raw[0], raw[1], raw[2], raw.slice(3));

  const sscanf = (...raw: unknown[]): number => {
    const input = readString(host, raw[0], 'the input string of sscanf').text;
    const formatText = readString(host, raw[1], 'the format of sscanf').text;
    const result = scanString(formatText, input);
    noteFailure(host, sscanfFailureNote(result), result);
    storeValues(host, 'sscanf', result, raw.slice(2), 3);
    return scanReturnValue(result);
  };

  /**
   * `scanf`, as C defines it: the conversions in `scanf.ts` over an input
   * that arrives a line at a time. The scan yields whenever it wants a
   * character that has not been typed yet, so one call can park more than
   * once - `scanf("%d %d", &a, &b)` answered one number at a time parks
   * twice - and the end of input the reader gives makes it return `EOF` when
   * nothing has been converted yet.
   */
  function* scanf(...raw: unknown[]): Generator<undefined, Int, unknown> {
    if (raw.length === 0) {
      return cInt(0);
    }
    return yield* scanInto(
      'scanf',
      checkOpen(stdin, 'scanf'),
      raw[0],
      raw.slice(1),
      2
    );
  }

  function* fscanf(...raw: unknown[]): Generator<undefined, Int, unknown> {
    const stream = streamArg(raw[0], 'fscanf');
    return yield* scanInto('fscanf', stream, raw[1], raw.slice(2), 3);
  }

  const fprintfAs = (
    caller: string,
    rawStream: unknown,
    rawFormat: unknown,
    args: unknown[]
  ): Int => {
    const stream = streamArg(rawStream, caller);
    const { result, typed } = format(host, caller, rawFormat, args);
    const measure =
      stream instanceof FileStream
        ? (text: string) => encodeText(text).length
        : byteCount;
    const written = put(stream, result.text, caller);
    storeCounts(host, result, typed, args, measure);
    return cInt(written === null ? -1 : written);
  };

  const fprintf = (...raw: unknown[]): Int =>
    fprintfAs('fprintf', raw[0], raw[1], raw.slice(2));

  // `<stdarg.h>`'s twins: the arguments are the ones the `va_list` points
  // at, from the next one on, read out of the caller's frame.
  const vprintf = (rawFormat: unknown, list: unknown): number =>
    printfAs(
      'vprintf',
      rawFormat,
      variadicValues(host.library, list, 'vprintf')
    );

  const vfprintf = (rawStream: unknown, rawFormat: unknown, list: unknown) =>
    fprintfAs(
      'vfprintf',
      rawStream,
      rawFormat,
      variadicValues(host.library, list, 'vfprintf')
    );

  const vsprintf = (buffer: unknown, rawFormat: unknown, list: unknown) =>
    sprintfAs(
      'vsprintf',
      buffer,
      rawFormat,
      variadicValues(host.library, list, 'vsprintf')
    );

  const vsnprintf = (
    buffer: unknown,
    rawSize: unknown,
    rawFormat: unknown,
    list: unknown
  ) =>
    snprintfAs(
      'vsnprintf',
      buffer,
      rawSize,
      rawFormat,
      variadicValues(host.library, list, 'vsnprintf')
    );

  const puts = (text: unknown): Int => {
    const line = `${readString(host, text, 'the argument of puts').text}\n`;
    const written = put(checkOpen(stdout, 'puts'), line, 'puts');
    return cInt(written === null ? EOF : written);
  };

  /** A character argument as `fputc` writes it: converted to unsigned char. */
  const characterArg = (raw: unknown): number => {
    const code = Math.trunc(numeric(raw) ?? 0);
    return code < 0 ? code & 0xff : code;
  };

  const putchar = (c: unknown): Int => {
    const code = characterArg(c);
    return cInt(
      putBytes(checkOpen(stdout, 'putchar'), [code], 'putchar')
        ? code & 0xff
        : EOF
    );
  };

  const fputc = (c: unknown, raw: unknown): Int => {
    const stream = streamArg(raw, 'fputc');
    const code = characterArg(c);
    return cInt(putBytes(stream, [code], 'fputc') ? code & 0xff : EOF);
  };

  const fputs = (text: unknown, raw: unknown): Int => {
    const stream = streamArg(raw, 'fputs');
    const value = readString(host, text, 'the string given to fputs').text;
    return cInt(put(stream, value, 'fputs') === null ? EOF : 1);
  };

  function* getchar(): Generator<undefined, Int, unknown> {
    return cInt(yield* getByte(checkOpen(stdin, 'getchar'), 'getchar'));
  }

  function* fgetc(raw: unknown): Generator<undefined, Int, unknown> {
    return cInt(yield* getByte(streamArg(raw, 'fgetc'), 'fgetc'));
  }

  function* fgets(
    buffer: unknown,
    size: unknown,
    raw: unknown
  ): Generator<undefined, number, unknown> {
    const address = destination(host, 'fgets', buffer);
    const limit = Math.trunc(numeric(size) ?? 0);
    const stream = streamArg(raw, 'fgets');
    if (limit <= 0) {
      return 0;
    }
    const { text, ended } = yield* readLine(stream, limit - 1, 'fgets');
    // Nothing read before the end: the array is left as it was, and the
    // null pointer is what ends `while (fgets(buf, n, stdin))`.
    if (ended && text === '') {
      return 0;
    }
    writeString(
      host,
      'fgets',
      address,
      text,
      `, because the size argument (${limit}) is larger than the array`
    );
    return address;
  }

  function* gets(buffer: unknown): Generator<undefined, number, unknown> {
    const address = destination(host, 'gets', buffer);
    const { text, ended } = yield* readLine(
      checkOpen(stdin, 'gets'),
      Infinity,
      'gets'
    );
    if (ended && text === '') {
      return 0;
    }
    writeString(
      host,
      'gets',
      address,
      text.endsWith('\n') ? text.slice(0, -1) : text,
      `, and gets has no way to know how long the array is - which is why ` +
        `C11 removed it; fgets takes the size`
    );
    return address;
  }

  const ungetc = (c: unknown, raw: unknown): Int => {
    const stream = streamArg(raw, 'ungetc');
    const code = Math.trunc(numeric(c) ?? EOF);
    if (code === EOF) {
      return cInt(EOF);
    }
    stream.unget(code & 0xff);
    return cInt(code & 0xff);
  };

  const fopen = (rawName: unknown, rawMode: unknown): number => {
    const name = nameArg(rawName, 'fopen', 'file name');
    const modeText = nameArg(rawMode, 'fopen', 'mode');
    const mode = parseMode(modeText);
    if (mode === null) {
      warn(
        'invalid-mode',
        `"${modeText}" is not a mode fopen accepts: use "r", "w" or "a", ` +
          `optionally followed by + and b; fopen fails and returns a null pointer`
      );
      host.library.setErrno(EINVAL);
      return 0;
    }
    const files = host.files();
    const existing = files.get(name);
    if (name === '' || (typeof existing === 'undefined' && !mode.create)) {
      host.library.setErrno(ENOENT);
      return 0;
    }
    const fresh = typeof existing === 'undefined' || mode.truncate;
    // Opening for writing creates the file, or empties it, there and then.
    if (fresh) {
      files.set(name, new ArrayBuffer(0));
    }
    const stream = new FileStream(
      name,
      mode,
      fresh ? new Uint8Array(0) : bytesOf(existing as ArrayBuffer)
    );
    open.add(stream);
    return host.global.setCode(stream, 'FILE');
  };

  const fclose = (raw: unknown): Int => {
    const stream = streamArg(raw, 'fclose');
    if (stream instanceof FileStream) {
      commit(stream);
      open.delete(stream);
    }
    stream.closed = true;
    return cInt(0);
  };

  const fflush = (raw: unknown): Int => {
    if (numeric(raw) === 0) {
      open.forEach(commit);
      return cInt(0);
    }
    const stream = streamArg(raw, 'fflush');
    if (!stream.mode.write) {
      warn(
        'flush-input',
        `fflush(${stream.kind === 'stdin' ? 'stdin' : 'a stream open only for reading'}) ` +
          `has undefined behavior in C, and does nothing here; to discard the ` +
          `rest of an input line, read it: ` +
          `while ((c = getchar()) != '\\n' && c != EOF);`
      );
      return cInt(0);
    }
    if (stream instanceof FileStream) {
      commit(stream);
    }
    return cInt(0);
  };

  function* fread(
    pointer: unknown,
    size: unknown,
    count: unknown,
    raw: unknown
  ): Generator<undefined, Int, unknown> {
    const width = sizeArg(size);
    const wanted = width * sizeArg(count);
    const stream = streamArg(raw, 'fread');
    if (wanted === 0) {
      return cInt(0);
    }
    const address = memory.pointer(pointer, 'fread', 'its destination');
    const bytes: number[] = [];
    while (bytes.length < wanted) {
      const code = yield* getByte(stream, 'fread');
      if (code === EOF) {
        break;
      }
      bytes.push(code & 0xff);
    }
    if (bytes.length > 0) {
      memory.region(address, bytes.length, 'fread', 'its destination', true);
      memory.writeBytes(address, bytes, 'fread');
    }
    return cInt(Math.floor(bytes.length / width));
  }

  const fwrite = (
    pointer: unknown,
    size: unknown,
    count: unknown,
    raw: unknown
  ): Int => {
    const width = sizeArg(size);
    const elements = sizeArg(count);
    const stream = streamArg(raw, 'fwrite');
    if (width * elements === 0) {
      return cInt(0);
    }
    const read = memory.bytes(
      pointer,
      width * elements,
      'fwrite',
      'its source'
    );
    if (read.bytes.some((byte) => byte === null)) {
      warn(
        'uninitialized-read',
        `fwrite writes bytes of its source that nothing has stored yet; ` +
          `their values are indeterminate, and are written here as 0`
      );
    }
    const bytes = read.bytes.map((byte) => byte ?? 0);
    return cInt(putBytes(stream, bytes, 'fwrite') ? elements : 0);
  };

  const fseek = (raw: unknown, offset: unknown, whence: unknown): Int => {
    const stream = streamArg(raw, 'fseek');
    // The console has no position to move. A terminal answers ESPIPE, which
    // `strerror` has no text for here, so the error is the nearest it has.
    if (!(stream instanceof FileStream)) {
      host.library.setErrno(EINVAL);
      return cInt(-1);
    }
    const origin = Math.trunc(numeric(whence) ?? NaN);
    if (!stream.seek(Math.trunc(numeric(offset) ?? 0), origin)) {
      host.library.setErrno(EINVAL);
      return cInt(-1);
    }
    return cInt(0);
  };

  const ftell = (raw: unknown): Int | number => {
    const stream = streamArg(raw, 'ftell');
    if (!(stream instanceof FileStream)) {
      host.library.setErrno(EINVAL);
      return cInt(-1);
    }
    const position = stream.tell();
    return position <= 2147483647 ? cInt(position) : position;
  };

  const rewind = (raw: unknown): void => {
    const stream = streamArg(raw, 'rewind');
    if (stream instanceof FileStream) {
      stream.seek(0, SEEK_SET);
    }
    stream.eof = false;
    stream.error = false;
  };

  const feof = (raw: unknown): Int => cInt(streamArg(raw, 'feof').eof ? 1 : 0);

  const ferror = (raw: unknown): Int =>
    cInt(streamArg(raw, 'ferror').error ? 1 : 0);

  const clearerr = (raw: unknown): void => {
    const stream = streamArg(raw, 'clearerr');
    stream.eof = false;
    stream.error = false;
  };

  const perror = (prefix: unknown): void => {
    const message = strerrorText(host.library.getErrno());
    const given =
      numeric(prefix) === 0
        ? ''
        : readString(host, prefix, 'the argument of perror').text;
    host.stderr(given === '' ? `${message}\n` : `${given}: ${message}\n`);
  };

  const remove = (rawName: unknown): Int => {
    const name = nameArg(rawName, 'remove', 'file name');
    const files = host.files();
    if (!files.has(name)) {
      host.library.setErrno(ENOENT);
      return cInt(-1);
    }
    files.delete(name);
    open.forEach((stream) => {
      if (stream.name === name) {
        stream.detached = true;
      }
    });
    return cInt(0);
  };

  const rename = (rawOld: unknown, rawNew: unknown): Int => {
    const from = nameArg(rawOld, 'rename', 'old file name');
    const to = nameArg(rawNew, 'rename', 'new file name');
    const files = host.files();
    const contents = files.get(from);
    if (typeof contents === 'undefined' || to === '') {
      host.library.setErrno(ENOENT);
      return cInt(-1);
    }
    if (from === to) {
      return cInt(0);
    }
    files.delete(from);
    files.set(to, contents);
    // An open stream follows its file to the new name, as it does on a POSIX
    // system; one open on the file the rename replaced loses its name.
    open.forEach((stream) => {
      if (stream.name === to) {
        stream.detached = true;
      } else if (stream.name === from) {
        stream.name = to;
      }
    });
    return cInt(0);
  };

  return {
    functions: {
      printf,
      sprintf,
      snprintf,
      sscanf,
      scanf,
      fprintf,
      fscanf,
      puts,
      putchar,
      getchar,
      gets,
      fopen,
      fclose,
      fflush,
      fgetc,
      fgets,
      fputc,
      fputs,
      ungetc,
      fread,
      fwrite,
      fseek,
      ftell,
      rewind,
      feof,
      ferror,
      clearerr,
      perror,
      remove,
      rename,
      vprintf,
      vfprintf,
      vsprintf,
      vsnprintf,
    },
    standard,
    closeAll: () => {
      open.forEach(commit);
    },
  };
}
