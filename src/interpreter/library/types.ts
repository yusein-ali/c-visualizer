/**
 * The type names the C library declares, and the data model they are drawn
 * from.
 *
 * Pure data with no engine import, so the canvas (`core/variables.ts`), the
 * lint and the syntax-error heuristics can ask "is this word a type?" without
 * pulling the interpreter into their bundle.
 *
 * The data model is the engine's, not a real machine's. unicoen.ts gives
 * `int`, `long` and every pointer four bytes (`Engine.sizeof`), reduces
 * `long long` to `long`, and reads every integer constant through `v | 0`: it
 * is an ILP32 implementation. The library's widths follow it, so that
 * `sizeof(size_t) == sizeof(void *)` and `LONG_MAX` is what a `long` on the
 * canvas can actually hold. Moving the engine to LP64 is a change to all of
 * those at once; when it happens, `DATA_MODEL` is the one line to flip here.
 */

import type { RuntimeRecordTypes } from '../RecordTable';
import { mask } from '../scan';

export type DataModel = 'ILP32' | 'LP64';

export const DATA_MODEL = 'ILP32' as DataModel;

/** Bytes in a `long`, a pointer, and therefore a `size_t`. */
export const LONG_BYTES = DATA_MODEL === 'LP64' ? 8 : 4;

/** One type a library header declares with `typedef`. */
export interface LibraryTypedef {
  header: string;
  /** What it is a name for, spelled as C spells it. */
  underlying: string;
  /** Whether arithmetic on it is unsigned. */
  unsigned: boolean;
  /** Whether it is a pointer type rather than an integer one (`va_list`). */
  pointer?: boolean;
  /** Bytes, in this engine's data model. */
  bytes: number;
  /** The one-line description the editor shows. */
  description: string;
}

/**
 * The scalar typedefs a program may use without declaring them. The two
 * structure types, `div_t` and `ldiv_t`, are records rather than scalars and
 * are listed in `RECORD_TYPEDEFS`.
 */
export const LIBRARY_TYPEDEFS: Record<string, LibraryTypedef> = {
  size_t: {
    header: 'stddef.h',
    underlying: 'unsigned long',
    unsigned: true,
    bytes: LONG_BYTES,
    description:
      'the unsigned integer type of the result of sizeof, and of every object size and count the library takes or returns',
  },
  ptrdiff_t: {
    header: 'stddef.h',
    underlying: 'long',
    unsigned: false,
    bytes: LONG_BYTES,
    description:
      'the signed integer type of the result of subtracting two pointers',
  },
  time_t: {
    header: 'time.h',
    underlying: 'long',
    unsigned: false,
    bytes: LONG_BYTES,
    description:
      'an arithmetic type holding a calendar time, here the number of seconds since 1970-01-01 00:00 UTC',
  },
  clock_t: {
    header: 'time.h',
    underlying: 'long',
    unsigned: false,
    bytes: LONG_BYTES,
    description:
      'an arithmetic type holding processor time, in units of CLOCKS_PER_SEC per second',
  },
  va_list: {
    header: 'stdarg.h',
    underlying: 'char *',
    unsigned: true,
    pointer: true,
    bytes: LONG_BYTES,
    description:
      'the type of the object va_start, va_arg and va_end work through; here a pointer to the next unnamed argument in the frame of the function declared with ...',
  },
};

/** The structure types the library returns by value. */
export const RECORD_TYPEDEFS: Record<
  string,
  { header: string; members: string[]; memberType: string }
> = {
  div_t: { header: 'stdlib.h', members: ['quot', 'rem'], memberType: 'int' },
  ldiv_t: { header: 'stdlib.h', members: ['quot', 'rem'], memberType: 'long' },
};

/** Every type name the library declares, scalar and record. */
export const LIBRARY_TYPE_NAMES: string[] = Object.keys(
  LIBRARY_TYPEDEFS
).concat(Object.keys(RECORD_TYPEDEFS));

/** A regular-expression alternation of the names, for the source patterns. */
export const LIBRARY_TYPE_PATTERN = LIBRARY_TYPE_NAMES.join('|');

/** Built once: the canvas asks about every variable at every step. */
const LIBRARY_TYPEDEF_WORD = new RegExp(
  `\\b(${Object.keys(LIBRARY_TYPEDEFS).join('|')})\\b`
);

/** The scalar library typedef a type spelling names, or null. */
export function libraryTypedefIn(type: string): LibraryTypedef | null {
  const found = LIBRARY_TYPEDEF_WORD.exec(type);
  return found === null ? null : LIBRARY_TYPEDEFS[found[1]];
}

/**
 * `div_t` and `ldiv_t` as the canvas's record table describes a structure,
 * so a variable of either is drawn with its two members.
 */
export function libraryRecordTypes(): RuntimeRecordTypes {
  const types: RuntimeRecordTypes = {};
  for (const [name, record] of Object.entries(RECORD_TYPEDEFS)) {
    const width = record.memberType === 'long' ? LONG_BYTES : 4;
    const fields: RuntimeRecordTypes[string]['fields'] = {};
    record.members.forEach((member, i) => {
      fields[member] = {
        offset: i * width,
        engineOffset: i * 4,
        type: record.memberType,
        size: width,
        alignment: width,
        baseQualifiers: [],
        pointerQualifiers: [],
      };
    });
    types[name] = {
      displayType: name,
      kind: 'struct',
      size: record.members.length * width,
      alignment: width,
      fields,
    };
  }
  return types;
}

/**
 * The source the syntax check reads, with each library typedef name spelled
 * as the keyword it stands for, padded to the same width.
 *
 * The check's grammar takes any identifier for a typedef name, and in a cast
 * that loses: `(size_t)n` is read as the parenthesised expression `(size_t)`
 * followed by a stray `n`, and the program is refused. A keyword cannot be
 * read that way. Execution never sees this text - the engine keeps the name,
 * which is what the canvas draws - and a program that declares the name
 * itself keeps its own spelling.
 */
export function typedefsForSyntaxCheck(code: string): string {
  const masked = mask(code);
  const chars = code.split('');
  for (const name of Object.keys(LIBRARY_TYPEDEFS)) {
    if (new RegExp(`\\btypedef\\b[^;]*\\b${name}\\s*;`).test(masked)) {
      continue;
    }
    const keyword = 'long'.padEnd(name.length, ' ');
    const word = new RegExp(`\\b${name}\\b`, 'g');
    let found = word.exec(masked);
    while (found !== null) {
      for (let i = 0; i < name.length; i += 1) {
        chars[found.index + i] = keyword[i];
      }
      found = word.exec(masked);
    }
  }
  return chars.join('');
}
