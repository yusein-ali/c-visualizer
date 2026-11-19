import { LIBRARY_TYPEDEFS } from './library/types';
import {
  IDENT_CHAR,
  columnAt,
  lineAt,
  mask,
  matchBracket,
  matchParen,
} from './scan';
import { typedefNamesIn } from './TypedefNames';

/**
 * An array's length written as a constant expression: `char line[LEN + 1];`,
 * `unsigned char buf[sizeof a];`, `int counts[sizeof table / sizeof table[0]];`.
 *
 * unicoen.ts's mapper reads a declarator's length only when it is an integer
 * literal. Any other expression made the whole declaration collapse into an
 * empty node, so the array was never declared, and the run was refused
 * because the next statement named it ("buf is not declared"). A macro gave a
 * literal (`[N]`) and was fine; `[N + 1]` was not.
 *
 * Where the expression can be worked out from the source - integer constants,
 * `+ - * / % << >>`, parentheses, and `sizeof` of a type or of an object whose
 * declaration is above it - the expression is replaced by its value, padded
 * with spaces to the expression's width, so every column on the line stays
 * where the reader put it. Anything else is left as it was written.
 */

/** C's sizes of the basic types, as this interpreter's ILP32 model has them. */
const BASIC_SIZES: Record<string, number> = {
  char: 1,
  'signed char': 1,
  'unsigned char': 1,
  _Bool: 1,
  bool: 1,
  short: 2,
  'short int': 2,
  'signed short': 2,
  'unsigned short': 2,
  'unsigned short int': 2,
  int: 4,
  signed: 4,
  unsigned: 4,
  'signed int': 4,
  'unsigned int': 4,
  long: 4,
  'long int': 4,
  'signed long': 4,
  'unsigned long': 4,
  'unsigned long int': 4,
  'long long': 8,
  'long long int': 8,
  'signed long long': 8,
  'unsigned long long': 8,
  float: 4,
  double: 8,
};

const BASE_WORDS = new Set([
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'signed',
  'unsigned',
  '_Bool',
  'bool',
  'void',
]);

const QUALIFIERS = /\b(const|volatile|restrict|static|extern|register|auto)\b/g;

/** A declared object, as far as `sizeof` needs it. */
interface Declared {
  base: string;
  stars: number;
  /** Array lengths, outermost first; null for one given by its initializer. */
  lengths: (number | null)[];
  /** How many elements the initializer gives, for `T a[] = {...}`. */
  initialized: number | null;
}

/**
 * The source with every array length that is a constant expression it can
 * evaluate written as its value. `recordSize` gives a structure's or union's
 * size in C by tag or typedef name, or null.
 */
export function constantArrayLengths(
  code: string,
  recordSize: (name: string) => number | null
): string {
  let work = code;
  let masked = mask(code);
  const typedefs = scalarTypedefs(masked);
  const typeNames = typedefNamesIn(code);
  for (let open = masked.indexOf('['); open !== -1; ) {
    const close = matchBracket(masked, open);
    if (close === -1) {
      break;
    }
    const inner = masked.slice(open + 1, close);
    if (
      !/^\s*\d+[uUlL]*\s*$/.test(inner) &&
      inner.trim() !== '' &&
      declaresArray(masked, open, typeNames)
    ) {
      const value = new Evaluator(
        inner,
        (text) => typeSize(text, typedefs, typeNames, recordSize),
        (name) => declarationOf(work, masked, name, open),
        constants(work, masked, open, typedefs, typeNames, recordSize)
      ).value();
      const spelled = value === null ? '' : String(value);
      if (
        value !== null &&
        Number.isInteger(value) &&
        value > 0 &&
        spelled.length <= inner.length
      ) {
        const text = spelled.padEnd(inner.length, ' ');
        work = work.slice(0, open + 1) + text + work.slice(close);
        masked = masked.slice(0, open + 1) + text + masked.slice(close);
      }
    }
    open = masked.indexOf('[', open + 1);
  }
  return work;
}

/** `typedef unsigned char byte;`: each scalar typedef's type. */
function scalarTypedefs(masked: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /\btypedef\s+([^;{}()[\]]*?)\s*([A-Za-z_]\w*)\s*;/g;
  let match = pattern.exec(masked);
  while (match !== null) {
    found.set(match[2], match[1].replace(QUALIFIERS, ' ').trim());
    match = pattern.exec(masked);
  }
  return found;
}

/** The identifier ending just before `end`, or null. */
function wordBefore(
  masked: string,
  end: number
): { word: string; start: number } | null {
  let at = end;
  while (at > 0 && /\s/.test(masked[at - 1])) {
    at -= 1;
  }
  const stop = at;
  while (at > 0 && IDENT_CHAR.test(masked[at - 1])) {
    at -= 1;
  }
  return at === stop ? null : { word: masked.slice(at, stop), start: at };
}

/**
 * Whether the `[` at `open` follows a declarator's name in a declaration:
 * `int counts[`, `char *names[`, `struct row rows[`, `Book shelf[`, and a
 * second dimension after a first.
 */
function declaresArray(
  masked: string,
  open: number,
  typeNames: Set<string>
): boolean {
  let at = open;
  while (at > 0 && /\s/.test(masked[at - 1])) {
    at -= 1;
  }
  while (at > 0 && masked[at - 1] === ']') {
    let depth = 0;
    let back = at - 1;
    for (; back >= 0; back -= 1) {
      if (masked[back] === ']') {
        depth += 1;
      } else if (masked[back] === '[') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    at = back;
    while (at > 0 && /\s/.test(masked[at - 1])) {
      at -= 1;
    }
  }
  const name = wordBefore(masked, at);
  if (name === null) {
    return false;
  }
  at = name.start;
  while (at > 0 && /[\s*]/.test(masked[at - 1])) {
    at -= 1;
  }
  const type = wordBefore(masked, at);
  if (type === null) {
    return false;
  }
  const tag = wordBefore(masked, type.start);
  return (
    BASE_WORDS.has(type.word) ||
    typeNames.has(type.word) ||
    Object.prototype.hasOwnProperty.call(LIBRARY_TYPEDEFS, type.word) ||
    (tag !== null && /^(struct|union|enum)$/.test(tag.word))
  );
}

/**
 * The values of the names a constant expression above `before` may use: the
 * enumeration constants, and the `const` integers initialized with a
 * constant expression. A `const int` is no constant expression in C, and an
 * array it sizes is a variable length array; one sized by it is the same
 * array, and this interpreter has no variable length arrays.
 */
function constants(
  work: string,
  masked: string,
  before: number,
  typedefs: Map<string, string>,
  typeNames: Set<string>,
  recordSize: (name: string) => number | null,
  depth = 0
): (name: string) => number | null {
  const text = masked.slice(0, before);
  const evaluate = (expression: string, at: number): number | null =>
    depth > 8
      ? null
      : new Evaluator(
          expression,
          (type) => typeSize(type, typedefs, typeNames, recordSize),
          (name) => declarationOf(work, masked, name, at),
          constants(
            work,
            masked,
            at,
            typedefs,
            typeNames,
            recordSize,
            depth + 1
          )
        ).value();
  return (name) => {
    const enums = /\benum\b[^{;()]*\{([^}]*)\}/g;
    for (let found = enums.exec(text); found !== null; ) {
      let next = 0;
      for (const item of found[1].split(',')) {
        const parts = /^\s*([A-Za-z_]\w*)\s*(?:=\s*([^]*?))?\s*$/.exec(item);
        if (parts === null) {
          continue;
        }
        const value =
          typeof parts[2] === 'string' ? evaluate(parts[2], found.index) : next;
        if (value === null) {
          break;
        }
        if (parts[1] === name) {
          return value;
        }
        next = value + 1;
      }
      found = enums.exec(text);
    }
    const declared = new RegExp(
      `\\bconst\\s+(?:(?:unsigned|signed|short|long|int|char|size_t)\\s+)*${name}\\s*=\\s*([^;,{}]+)[;,]`,
      'g'
    );
    let last: RegExpExecArray | null = null;
    for (let found = declared.exec(text); found !== null; ) {
      last = found;
      found = declared.exec(text);
    }
    return last === null ? null : evaluate(last[1], last.index);
  };
}

/** C's size of a type as written - `int`, `struct book`, `Book *`, `byte`. */
function typeSize(
  text: string,
  typedefs: Map<string, string>,
  typeNames: Set<string>,
  recordSize: (name: string) => number | null,
  depth = 0
): number | null {
  const spelled = text.replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
  const lengths: number[] = [];
  let base = spelled.replace(/\[\s*(\d+)\s*\]/g, (_, length) => {
    lengths.push(Number(length));
    return '';
  });
  if (/\[/.test(base)) {
    return null;
  }
  base = base.trim();
  const count = lengths.reduce((total, length) => total * length, 1);
  if (base.endsWith('*')) {
    return 4 * count;
  }
  const record = /^(struct|union)\s+([A-Za-z_]\w*)$/.exec(base);
  if (record !== null) {
    const size = recordSize(record[2]);
    return size === null ? null : size * count;
  }
  if (/^enum\s+[A-Za-z_]\w*$/.test(base)) {
    return 4 * count;
  }
  const basic = BASIC_SIZES[base];
  if (typeof basic === 'number') {
    return basic * count;
  }
  const library = LIBRARY_TYPEDEFS[base];
  if (typeof library !== 'undefined') {
    return library.bytes * count;
  }
  const aliased = typedefs.get(base);
  if (typeof aliased === 'string' && depth < 8) {
    const size = typeSize(aliased, typedefs, typeNames, recordSize, depth + 1);
    return size === null ? null : size * count;
  }
  if (typeNames.has(base)) {
    const size = recordSize(base);
    return size === null ? null : size * count;
  }
  return null;
}

/**
 * The declaration of `name` nearest above `before`, when it is one this pass
 * can read: specifiers, `*`s, the name, literal lengths, and `=`, `;` or `,`.
 */
function declarationOf(
  work: string,
  masked: string,
  name: string,
  before: number
): (Declared & { typeText: string }) | null {
  const pattern = new RegExp(
    `(^|[;{}(])\\s*([A-Za-z_][\\w\\s]*?)\\s*(\\**)\\s*\\b${name}\\s*((?:\\[\\s*\\d*\\s*\\])*)\\s*([=;,)])`,
    'g'
  );
  const text = masked.slice(0, before);
  let found: RegExpExecArray | null = null;
  for (let match = pattern.exec(text); match !== null; ) {
    found = match;
    match = pattern.exec(text);
  }
  if (found === null) {
    return null;
  }
  const base = found[2].replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
  const lengths = Array.from(found[4].matchAll(/\[\s*(\d*)\s*\]/g), (match) =>
    match[1] === '' ? null : Number(match[1])
  );
  let initialized: number | null = null;
  if (found[5] === '=' && lengths[0] === null) {
    const at = found.index + found[0].length;
    const start = masked.slice(at).search(/\S/) + at;
    if (masked[start] === '{') {
      const end = matchBraceIn(masked, start);
      initialized =
        end === -1 ? null : topLevelItems(masked.slice(start + 1, end));
    } else if (work[start] === '"') {
      initialized = stringLength(work, start);
    }
  }
  return {
    base,
    stars: found[3].length,
    lengths,
    initialized,
    typeText: base,
  };
}

function matchBraceIn(masked: string, open: number): number {
  let depth = 0;
  for (let at = open; at < masked.length; at += 1) {
    if (masked[at] === '{') {
      depth += 1;
    } else if (masked[at] === '}') {
      depth -= 1;
      if (depth === 0) {
        return at;
      }
    }
  }
  return -1;
}

/** How many items a brace list holds at its own level. */
function topLevelItems(text: string): number | null {
  if (/[.[]\s*\w*\s*\]?\s*=/.test(text)) {
    // A designated initializer decides the length by its largest index.
    return null;
  }
  let depth = 0;
  let items = 0;
  let pending = false;
  for (const char of text) {
    if (char === '{' || char === '(') {
      depth += 1;
    } else if (char === '}' || char === ')') {
      depth -= 1;
    }
    if (depth === 0 && char === ',') {
      items += pending ? 1 : 0;
      pending = false;
    } else if (!/\s/.test(char)) {
      pending = true;
    }
  }
  return items + (pending ? 1 : 0);
}

/** The bytes of a string literal at `start`, terminator included. */
function stringLength(work: string, start: number): number | null {
  let length = 0;
  for (let at = start + 1; at < work.length; at += 1) {
    if (work[at] === '"') {
      return length + 1;
    }
    if (work[at] === '\\') {
      at += /[0-7]/.test(work[at + 1] ?? '')
        ? (/^[0-7]{1,3}/.exec(work.slice(at + 1))?.[0].length ?? 1)
        : work[at + 1] === 'x'
          ? 1 + (/^[0-9a-fA-F]+/.exec(work.slice(at + 2))?.[0].length ?? 0)
          : 1;
    }
    length += 1;
  }
  return null;
}

/** A constant expression's value, by recursive descent over its text. */
class Evaluator {
  private at = 0;

  constructor(
    private readonly text: string,
    private readonly sizeOfType: (text: string) => number | null,
    private readonly declaration: (
      name: string
    ) => (Declared & { typeText: string }) | null,
    private readonly constant: (name: string) => number | null = () => null
  ) {}

  value(): number | null {
    const result = this.logicalOr();
    this.space();
    return result !== null && this.at === this.text.length ? result : null;
  }

  private space(): void {
    while (this.at < this.text.length && /\s/.test(this.text[this.at])) {
      this.at += 1;
    }
  }

  private take(token: string): boolean {
    this.space();
    if (this.text.startsWith(token, this.at)) {
      this.at += token.length;
      return true;
    }
    return false;
  }

  /** `token`, where it is not the start of a longer operator (`<` of `<<`). */
  private takeAlone(token: string, longer: string[]): boolean {
    this.space();
    if (longer.some((other) => this.text.startsWith(other, this.at))) {
      return false;
    }
    return this.take(token);
  }

  /**
   * One level of left-associative binary operators: `operators` maps each
   * spelling to what it computes, tried longest first.
   */
  private binary(
    next: () => number | null,
    operators: [string, (left: number, right: number) => number | null][],
    longer: string[] = []
  ): number | null {
    let left = next();
    for (;;) {
      if (left === null) {
        return null;
      }
      const operator = operators.find(([spelled]) =>
        this.takeAlone(
          spelled,
          longer.filter((one) => one !== spelled)
        )
      );
      if (typeof operator === 'undefined') {
        return left;
      }
      const right = next();
      left = right === null ? null : operator[1](left, right);
    }
  }

  private logicalOr(): number | null {
    return this.binary(
      () => this.logicalAnd(),
      [['||', (l, r) => (l !== 0 || r !== 0 ? 1 : 0)]]
    );
  }

  private logicalAnd(): number | null {
    return this.binary(
      () => this.equality(),
      [['&&', (l, r) => (l !== 0 && r !== 0 ? 1 : 0)]]
    );
  }

  private equality(): number | null {
    return this.binary(
      () => this.relational(),
      [
        ['==', (l, r) => (l === r ? 1 : 0)],
        ['!=', (l, r) => (l !== r ? 1 : 0)],
      ]
    );
  }

  private relational(): number | null {
    return this.binary(
      () => this.shift(),
      [
        ['<=', (l, r) => (l <= r ? 1 : 0)],
        ['>=', (l, r) => (l >= r ? 1 : 0)],
        ['<', (l, r) => (l < r ? 1 : 0)],
        ['>', (l, r) => (l > r ? 1 : 0)],
      ],
      ['<<', '>>', '<=', '>=']
    );
  }

  private shift(): number | null {
    return this.binary(
      () => this.additive(),
      [
        ['<<', (l, r) => l * 2 ** r],
        ['>>', (l, r) => Math.floor(l / 2 ** r)],
      ]
    );
  }

  private additive(): number | null {
    return this.binary(
      () => this.multiplicative(),
      [
        ['+', (l, r) => l + r],
        ['-', (l, r) => l - r],
      ],
      ['->']
    );
  }

  private peekMinus(): boolean {
    this.space();
    if (this.text[this.at] === '-' && this.text[this.at + 1] !== '>') {
      this.at += 1;
      return true;
    }
    return false;
  }

  private multiplicative(): number | null {
    return this.binary(
      () => this.unary(),
      [
        ['*', (l, r) => l * r],
        ['/', (l, r) => (r === 0 ? null : Math.trunc(l / r))],
        ['%', (l, r) => (r === 0 ? null : l % r)],
      ]
    );
  }

  private unary(): number | null {
    this.space();
    if (this.text.startsWith('sizeof', this.at)) {
      this.at += 'sizeof'.length;
      return this.sizeOf();
    }
    if (this.take('(')) {
      const inner = this.logicalOr();
      return this.take(')') ? inner : null;
    }
    if (this.peekMinus()) {
      const operand = this.unary();
      return operand === null ? null : -operand;
    }
    if (this.take('+')) {
      return this.unary();
    }
    if (this.takeAlone('!', ['!='])) {
      const operand = this.unary();
      return operand === null ? null : operand === 0 ? 1 : 0;
    }
    const number = /^(0[xX][0-9a-fA-F]+|\d+)[uUlL]*/.exec(
      this.text.slice(this.at)
    );
    if (number === null) {
      // An enumeration constant, or a `const` integer whose initializer is
      // a constant: `int local[limit]` with `const int limit = 2;`.
      const name = /^[A-Za-z_]\w*/.exec(this.text.slice(this.at));
      const known = name === null ? null : this.constant(name[0]);
      if (name === null || known === null) {
        return null;
      }
      this.at += name[0].length;
      return known;
    }
    this.at += number[0].length;
    return Number(number[1]);
  }

  /** `sizeof (type)`, `sizeof (expr)` or `sizeof expr`. */
  private sizeOf(): number | null {
    this.space();
    if (this.text[this.at] === '(') {
      const close = matchParen(this.text, this.at);
      if (close === -1) {
        return null;
      }
      const inner = this.text.slice(this.at + 1, close);
      this.at = close + 1;
      return this.sizeOfType(inner) ?? this.sizeOfObject(inner);
    }
    const operand = /^\s*\**\s*[A-Za-z_]\w*(\s*\[[^\]]*\])*/.exec(
      this.text.slice(this.at)
    );
    if (operand === null) {
      return null;
    }
    this.at += operand[0].length;
    return this.sizeOfObject(operand[0]);
  }

  /** `sizeof` of `name`, `name[i]...` or `*name`. */
  private sizeOfObject(text: string): number | null {
    const parsed = /^\s*(\**)\s*([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)$/.exec(
      text
    );
    if (parsed === null) {
      return null;
    }
    const declared = this.declaration(parsed[2]);
    if (declared === null) {
      return null;
    }
    let dropped = parsed[1].length + (parsed[3].match(/\[/g) ?? []).length;
    const lengths = declared.lengths.slice();
    let stars = declared.stars;
    while (dropped > 0 && lengths.length > 0) {
      lengths.shift();
      dropped -= 1;
    }
    stars -= dropped;
    if (stars < 0) {
      return null;
    }
    const element = this.sizeOfType(`${declared.typeText}${'*'.repeat(stars)}`);
    if (element === null) {
      return null;
    }
    let count = 1;
    for (const length of lengths) {
      const known = length ?? declared.initialized;
      if (known === null) {
        return null;
      }
      count *= known;
    }
    return element * count;
  }
}

/** A `_Static_assert` whose condition is false, where gcc stops the build. */
export interface FailedAssertion {
  /** 1-based, as the editor's diagnostics count lines. */
  line: number;
  /** 0-based, at the keyword. */
  column: number;
  message: string;
}

/**
 * `_Static_assert(condition, "message");` - C11's, which gcc accepts under
 * `-std=c99` as well - checked as the build checks it and taken out of the
 * source, which the grammars behind this interpreter do not read: the whole
 * program was refused at `sizeof` ("unexpected 'sizeof'"). A condition this
 * pass can evaluate and finds false refuses the program with gcc's message;
 * one it cannot evaluate is let through, as the declaration it is.
 */
export function staticAssertions(
  code: string,
  recordSize: (name: string) => number | null
): { code: string; failed: FailedAssertion[] } {
  let work = code;
  const masked = mask(code);
  const typedefs = scalarTypedefs(masked);
  const typeNames = typedefNamesIn(code);
  const failed: FailedAssertion[] = [];
  const keyword = /\b_Static_assert\b/g;
  for (let found = keyword.exec(masked); found !== null; ) {
    const start = found.index;
    let open = start + found[0].length;
    while (open < masked.length && /\s/.test(masked[open])) {
      open += 1;
    }
    const close = masked[open] === '(' ? matchParen(masked, open) : -1;
    if (close === -1) {
      found = keyword.exec(masked);
      continue;
    }
    const inner = masked.slice(open + 1, close);
    const comma = inner.lastIndexOf(',');
    const condition = comma === -1 ? inner : inner.slice(0, comma);
    const value = new Evaluator(
      condition,
      (text) => typeSize(text, typedefs, typeNames, recordSize),
      (name) => declarationOf(work, masked, name, start),
      constants(work, masked, start, typedefs, typeNames, recordSize)
    ).value();
    if (value === 0) {
      const text =
        comma === -1 ? '' : code.slice(open + 1 + comma + 1, close).trim();
      failed.push({
        line: lineAt(code, start),
        column: columnAt(code, start),
        message: `static assertion failed${text === '' ? '' : `: ${text}`}`,
      });
    }
    let end = close + 1;
    while (end < masked.length && /[ \t]/.test(masked[end])) {
      end += 1;
    }
    if (masked[end] === ';') {
      end += 1;
    }
    work =
      work.slice(0, start) +
      work.slice(start, end).replace(/[^\n]/g, ' ') +
      work.slice(end);
    found = keyword.exec(masked);
  }
  return { code: work, failed };
}

/**
 * `_Alignof(type)` - C11's, which gcc accepts under `-std=c99` - written as
 * its value, padded to the expression's width. Neither grammar behind this
 * interpreter reads the keyword, and the whole program was refused at it.
 * An alignment is the one this interpreter lays objects out with: a scalar's
 * own size up to 8, a pointer's 4, a structure's its widest member's, an
 * array's its element's. A type this pass cannot measure is left as written.
 */
export function alignofExpressions(
  code: string,
  recordSize: (name: string) => number | null,
  recordAlignment: (name: string) => number | null
): string {
  const masked = mask(code);
  const typedefs = scalarTypedefs(masked);
  const typeNames = typedefNamesIn(code);
  const alignment = (text: string, depth = 0): number | null => {
    const spelled = text
      .replace(QUALIFIERS, ' ')
      .replace(/\[\s*\d*\s*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (spelled.endsWith('*')) {
      return 4;
    }
    const record = /^(struct|union)\s+([A-Za-z_]\w*)$/.exec(spelled);
    if (record !== null || typeNames.has(spelled)) {
      const found = recordAlignment(record === null ? spelled : record[2]);
      if (found !== null) {
        return found;
      }
    }
    const aliased = typedefs.get(spelled);
    if (typeof aliased === 'string' && depth < 8) {
      return alignment(aliased, depth + 1);
    }
    const size = typeSize(spelled, typedefs, typeNames, recordSize);
    return size === null ? null : Math.max(1, Math.min(size, 8));
  };
  let text = code;
  const pattern = /\b(?:_Alignof|__alignof__)\s*\(/g;
  for (let found = pattern.exec(masked); found !== null; ) {
    const open = found.index + found[0].length - 1;
    const close = matchParen(masked, open);
    const value =
      close === -1 ? null : alignment(masked.slice(open + 1, close));
    const width = close + 1 - found.index;
    if (value !== null && String(value).length <= width) {
      text =
        text.slice(0, found.index) +
        String(value).padEnd(width, ' ') +
        text.slice(close + 1);
    }
    found = pattern.exec(masked);
  }
  return text;
}
