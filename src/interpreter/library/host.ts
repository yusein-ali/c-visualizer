import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';

/**
 * What a library function may ask of the engine it runs in.
 *
 * The functions under `library/` are plain closures registered with
 * `setTop`; they never reach into the engine's private state. Everything
 * that has to go through the engine - a write the canvas and the
 * uninitialised-read check must see, a diagnostic on the line that made the
 * call, `errno` - goes through here, and `PlivetCPP14Engine` is the one
 * implementation.
 */
export interface LibraryHost {
  /** The global scope: every scope shares its memory maps. */
  readonly global: Scope;
  /** Stops the program with a fatal runtime diagnostic on the current line. */
  refuse(rule: string, message: string): never;
  /** Records a runtime warning on the current line; the program goes on. */
  warn(rule: string, message: string): void;
  /**
   * Stores one value at an address the way an assignment would, minus the
   * assignment's bookkeeping: the object counts as written from now on, and
   * a `const` object or a string literal refuses the write.
   */
  write(address: number, value: unknown, fn: string): void;
  /** Whether nothing has been stored at the address since its declaration. */
  isUnwritten(address: number): boolean;
  /** The call being executed, for its source text and its position. */
  currentCall(): UniMethodCall | null;
  /** The source a node covers, as the reader wrote it. */
  sourceText(node: unknown): string;
  /** The 1-based line the current statement starts on, if known. */
  currentLine(): number | null;
  /**
   * The file a line of the executed source belongs to, and the line within
   * it. The engine runs every file as one translation unit, so its own line
   * numbers count from the top of the first file.
   */
  sourceLocation(line: number): SourceLine;
  /** Appends to the program's output. */
  stdout(text: string): void;
  /**
   * Ends the program the way `abort` or `exit` does, from any depth of
   * calls, after writing `line` to the output and, when `rule` is given,
   * recording a fatal diagnostic on the current statement.
   */
  terminate(
    status: number,
    line: string,
    rule?: string,
    message?: string
  ): never;
  /** C's truth of a value the engine produced. */
  truthy(value: unknown): boolean;
  getErrno(): number;
  setErrno(value: number): void;
  /** Whether a type names a structure or union the engine lays out. */
  isRecordType(type: string): boolean;
  /** `sizeof` of a record, as the program sees it. */
  recordSize(type: string): number;
  /** Bytes from one record descriptor to the next in an array of them. */
  recordStride(type: string): number;
  /** The scalar members of the record whose descriptor is at an address. */
  recordCells(type: string, descriptor: number): RecordCell[];
  /**
   * Where a member sits in a structure as C lays it out (the offsets the
   * canvas draws), or null when the type has no such member.
   */
  recordOffset(type: string, member: string): number | null;
  /**
   * Lays out the heap block at an address as the records of a type it has
   * room for, keeping the records it already holds, and returns their
   * descriptors in order: `malloc(n * sizeof(struct P))` holds n of them.
   */
  recordBlock(type: string, block: number): number[];
  /**
   * Where the cells of the heap block at `start` end. A block of records
   * spans a descriptor word more per record than the `size` it was asked
   * for, which C does not count; any other block ends at `start + size`.
   */
  blockEnd(start: number, size: number): number;
  /**
   * Where a string literal lives in read-only memory, writing it there if no
   * identical literal is there already. `bytes` includes the terminator.
   */
  literalAddress(bytes: number[]): number;
  /**
   * Adds one row to the mutation view for the call being executed, for a
   * change no single store describes: `realloc` moving a block.
   */
  note(target: string, before: string, after: string): void;
  /**
   * A program function reached through a pointer argument, ready to be
   * called as interpreted code from a library generator (`qsort`'s
   * comparator): stepping enters it, and its frame is drawn. Resolved and
   * bound to the caller's scope now, while the library call is starting; a
   * value that is not a function stops the program.
   */
  callback(
    fn: unknown,
    caller: string,
    what: string
  ): (args: unknown[]) => Generator<unknown, unknown, unknown>;
  /**
   * The unnamed arguments of the function being executed, or null when it
   * was not declared with `...`.
   */
  variadicFrame(): VariadicFrame | null;
  /** The live variadic frame an address in a `va_list` points into. */
  variadicFrameAt(address: number): VariadicFrame | null;
}

/** The unnamed arguments one call of a `...` function was given. */
export interface VariadicFrame {
  /** The function, as its frame is named. */
  function: string;
  /** Its last named parameter, which `va_start` names. */
  last: string | null;
  /** Each unnamed argument: its row's name, address and promoted type. */
  args: { name: string; address: number; type: string }[];
  /** One past the last of them: where a `va_list` that has read them all points. */
  end: number;
}

/** A line in the file the reader wrote it in. */
export interface SourceLine {
  file: string;
  line: number;
}

/** One scalar member of a record object, at its engine address. */
export interface RecordCell {
  address: number;
  type: string;
}
