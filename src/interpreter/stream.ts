/**
 * The `FILE` object, as the library functions of `<stdio.h>` see it.
 *
 * Pure TypeScript with no engine import, like `printf.ts` and `scanf.ts`:
 * what a stream holds - its mode, its position, its end-of-file and error
 * indicators, the characters `ungetc` pushed back - and what reading and
 * writing do to it. `library/stdio.ts` is the half that knows the program: it
 * files each object in the engine's memory so a `FILE *` can point at it,
 * waits on the console for standard input, and moves a file's bytes in and
 * out of the virtual file system.
 *
 * A file's writes are buffered as C buffers them: the file system sees them
 * at `fflush`, at `fclose`, and when the program ends, not before. Reading a
 * file that another stream is still writing therefore reads what was there
 * when it was last flushed, which is the lesson C has in store for a program
 * that forgets to close its output.
 */

import type { LibraryConstant } from './library/constants';

/** What `fgetc` returns at the end of the input, and `EOF` in a program. */
export const EOF = -1;

/** `fseek`'s three origins, by the values `<stdio.h>` gives them. */
export const SEEK_SET = 0;
export const SEEK_CUR = 1;
export const SEEK_END = 2;

/**
 * The object-like macros `<stdio.h>` defines, in the shape of
 * `LIBRARY_CONSTANTS`: the engine installs them beside `NULL`, and
 * `libraryHelp` documents them from this table - which is why they are here,
 * in a module the editor can load without the interpreter.
 */
export const STDIO_CONSTANTS: Record<string, LibraryConstant> = {
  EOF: {
    header: 'stdio.h',
    value: EOF,
    type: 'int',
    spelling: '(-1)',
    description:
      'the negative int a character read returns at the end of the input, and scanf returns when input ends before the first conversion',
  },
  SEEK_SET: {
    header: 'stdio.h',
    value: SEEK_SET,
    type: 'int',
    spelling: '0',
    description: 'fseek origin: the offset counts from the start of the file',
  },
  SEEK_CUR: {
    header: 'stdio.h',
    value: SEEK_CUR,
    type: 'int',
    spelling: '1',
    description:
      'fseek origin: the offset counts from the current position in the file',
  },
  SEEK_END: {
    header: 'stdio.h',
    value: SEEK_END,
    type: 'int',
    spelling: '2',
    description: 'fseek origin: the offset counts from the end of the file',
  },
};

export type StreamKind = 'stdin' | 'stdout' | 'stderr' | 'file';

/**
 * A stretch of the console transcript, as offsets into it: `start` up to but
 * not including `end`. The program's output is one string - what it wrote to
 * `stdout` and to `stderr`, in the order it wrote it - and the spans say
 * which parts came from `stderr`, for the console to colour.
 */
export interface OutputSpan {
  start: number;
  end: number;
}

/** `fopen`'s mode argument, read. */
export interface OpenMode {
  /** As the program wrote it, for a message to quote. */
  text: string;
  read: boolean;
  write: boolean;
  /** `a`: every write goes to the end of the file, wherever the position is. */
  append: boolean;
  /** `b`: no newline translation on reading. */
  binary: boolean;
  /** `w`: an existing file is emptied when it is opened. */
  truncate: boolean;
  /** `w` and `a`: a missing file is created; `r` fails on one instead. */
  create: boolean;
}

/**
 * The mode string `fopen` was given, or null for one C does not define: one
 * of `r`, `w`, `a`, optionally followed by `+`, with `b` before or after it.
 */
export function parseMode(mode: string): OpenMode | null {
  const match = /^([rwa])(\+?)(b?)(\+?)$/.exec(mode);
  if (match === null || (match[2] === '+' && match[4] === '+')) {
    return null;
  }
  const plus = match[2] === '+' || match[4] === '+';
  const kind = match[1];
  return {
    text: mode,
    read: kind === 'r' || plus,
    write: kind !== 'r' || plus,
    append: kind === 'a',
    binary: match[3] === 'b',
    truncate: kind === 'w',
    create: kind !== 'r',
  };
}

const CONSOLE_INPUT: OpenMode = {
  text: 'r',
  read: true,
  write: false,
  append: false,
  binary: false,
  truncate: false,
  create: false,
};

const CONSOLE_OUTPUT: OpenMode = {
  text: 'w',
  read: false,
  write: true,
  append: true,
  binary: false,
  truncate: false,
  create: false,
};

/** What every stream has: the two indicators and the pushed-back characters. */
export abstract class CStream {
  /** What `feof` reports. Set by a read that found the end; cleared by `clearerr`, `rewind`, `fseek` and `ungetc`. */
  eof = false;
  /** What `ferror` reports. Set by a read or write the stream's mode forbids. */
  error = false;
  /** After `fclose`: any further use of the stream has undefined behavior. */
  closed = false;
  /** What `ungetc` pushed back, the next character to read last. */
  readonly pushback: number[] = [];

  constructor(
    readonly kind: StreamKind,
    /** The file's name, or the stream's own: `stdin`. */
    public name: string,
    readonly mode: OpenMode
  ) {}

  /** How a message names the stream: `stdin`, `the stream for "data.txt"`. */
  get label(): string {
    return this.kind === 'file' ? `the stream for "${this.name}"` : this.name;
  }

  /** Pushes a character back; the next read returns it. */
  unget(byte: number): void {
    this.pushback.push(byte);
    this.eof = false;
  }
}

/**
 * Standard input. Its characters arrive a line at a time from the console:
 * `buffer` is what has arrived and not been read, and `endPending` says the
 * reader ended the input after it, so the read that finds the buffer empty
 * returns `EOF` instead of waiting.
 */
export class ConsoleInput extends CStream {
  buffer = '';
  endPending = false;

  constructor() {
    super('stdin', 'stdin', CONSOLE_INPUT);
  }

  /**
   * The next character already here, or null when a read would have to wait
   * (or, with `endPending`, end).
   */
  take(): number | null {
    const pushed = this.pushback.pop();
    if (typeof pushed !== 'undefined') {
      return pushed;
    }
    if (this.buffer === '') {
      return null;
    }
    const code = this.buffer.charCodeAt(0);
    this.buffer = this.buffer.slice(1);
    return code;
  }

  /** Everything here, pushed-back characters first, emptying the stream. */
  takeAll(): string {
    const pushed = String.fromCharCode(...this.pushback.slice().reverse());
    this.pushback.length = 0;
    const text = pushed + this.buffer;
    this.buffer = '';
    return text;
  }

  /** Consumes the end of input the reader gave, setting the indicator. */
  takeEnd(): boolean {
    if (!this.endPending) {
      return false;
    }
    this.endPending = false;
    this.eof = true;
    return true;
  }
}

/** Standard output or standard error: what is written goes to the console. */
export class ConsoleOutput extends CStream {
  constructor(kind: 'stdout' | 'stderr') {
    super(kind, kind, CONSOLE_OUTPUT);
  }
}

/** A stream `fopen` opened on a file in the program's file system. */
export class FileStream extends CStream {
  private bytes: Uint8Array;
  /** How many of `bytes` the file holds. */
  private size: number;
  /** The byte the next read or write is at. */
  position = 0;
  /** Writes the file system has not been given yet. */
  dirty = false;
  /**
   * `remove` took the file's name away while the stream was open. The stream
   * still works, as it does on a POSIX system, but what it writes no longer
   * lands in any file a program or a reader can see.
   */
  detached = false;

  constructor(name: string, mode: OpenMode, contents: Uint8Array) {
    super('file', name, mode);
    this.bytes = new Uint8Array(Math.max(16, contents.length));
    this.bytes.set(contents);
    this.size = contents.length;
    if (mode.append) {
      this.position = this.size;
    }
  }

  /** The file's length in bytes, including what is not flushed yet. */
  get length(): number {
    return this.size;
  }

  /**
   * The next character, or `EOF` (setting the indicator) at the end. In text
   * mode a carriage return before a line feed is part of the line ending, as
   * it is in a file saved on Windows, and reads as the `\n` alone.
   */
  getc(): number {
    const pushed = this.pushback.pop();
    if (typeof pushed !== 'undefined') {
      return pushed;
    }
    if (this.size <= this.position) {
      this.eof = true;
      return EOF;
    }
    const byte = this.bytes[this.position];
    this.position += 1;
    if (
      !this.mode.binary &&
      byte === 0x0d &&
      this.position < this.size &&
      this.bytes[this.position] === 0x0a
    ) {
      this.position += 1;
      return 0x0a;
    }
    return byte;
  }

  /**
   * Up to `limit` characters from here as text, without reading them:
   * pushed-back characters first, line endings as `getc` reads them, and
   * whether the text reaches the end of the file.
   */
  peek(limit: number): { text: string; whole: boolean } {
    let text = String.fromCharCode(...this.pushback.slice().reverse());
    let at = this.position;
    while (at < this.size && text.length < limit) {
      const byte = this.bytes[at];
      at += 1;
      if (
        !this.mode.binary &&
        byte === 0x0d &&
        at < this.size &&
        this.bytes[at] === 0x0a
      ) {
        continue;
      }
      text += String.fromCharCode(byte);
    }
    return { text, whole: this.size <= at };
  }

  /** Writes bytes at the position, or at the end for a stream opened with `a`. */
  write(bytes: number[]): void {
    if (this.mode.append) {
      this.position = this.size;
    }
    this.pushback.length = 0;
    const end = this.position + bytes.length;
    if (this.bytes.length < end) {
      const grown = new Uint8Array(Math.max(end, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.size));
      this.bytes = grown;
    }
    // Past the end after an `fseek`: the gap reads as zero bytes, which is
    // what the fresh part of the buffer already holds.
    this.bytes.set(
      bytes.map((byte) => byte & 0xff),
      this.position
    );
    this.position = end;
    this.size = Math.max(this.size, end);
    this.dirty = true;
  }

  /** Moves the position; false for a target before the start of the file. */
  seek(offset: number, whence: number): boolean {
    const base =
      whence === SEEK_SET
        ? 0
        : whence === SEEK_CUR
          ? this.tell()
          : whence === SEEK_END
            ? this.size
            : NaN;
    const target = base + offset;
    if (!Number.isInteger(target) || target < 0) {
      return false;
    }
    this.position = target;
    this.pushback.length = 0;
    this.eof = false;
    return true;
  }

  /** What `ftell` reports: the position, less what was pushed back. */
  tell(): number {
    return Math.max(0, this.position - this.pushback.length);
  }

  /** The file's bytes, as the file system keeps them. */
  contents(): ArrayBuffer {
    return this.bytes.slice(0, this.size).buffer;
  }
}

/**
 * The bytes a string of the engine's characters is written to a file as. The
 * engine keeps a `char` as a number from 0 to 255 - a byte read from a file
 * stays the byte it was - so those are written as themselves, and anything
 * wider, which only a string literal can hold, as its UTF-8 bytes.
 */
export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (code < 0x100) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}
