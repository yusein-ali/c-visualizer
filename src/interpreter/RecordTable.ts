import {
  IDENT_START,
  identifierEnd,
  isWholeIdentifier,
  lineAt,
  mask,
  matchBrace,
  skipSpace,
  splitTopLevel,
} from './scan';
import { TypeQualifier } from './DeclarationSpecifiers';
import { ENGINE_LONG_LONG_WORD } from './ExpressionTypes';
import { LIBRARY_TYPEDEFS } from './library/types';

/**
 * What `struct` and `union` declarations mean, read from the source rather than
 * from the parse tree.
 *
 * Reading the source looks like the wrong end to start from - unicoen.ts does
 * map a `struct` to a `UniClassDec` - but the tree loses exactly the things
 * these types need:
 *
 *   - a `union` maps to the same `UniClassDec` a `struct` does, so by the time
 *     the engine lays it out there is nothing left to say the members share
 *     storage, which costs the union its aliasing: `u.i = 65; u.c` reads 0.
 *   - `typedef struct { int x; } P;` maps to a `UniClassDec` whose `className`
 *     is undefined, so the layout is filed under no name at all and `P p;`
 *     fails with "variable P is not defined".
 *   - `struct S { char name[8]; };` does not survive the parse: the members
 *     leak into the enclosing block and `main` disappears with it.
 *
 * The source still has all of it. A table read here answers the layout
 * questions - what the members are, where each one sits, how wide the whole
 * thing is - independently of what the parser managed to keep.
 *
 * `layoutOf` returns the same `Map<name, [offset, type, size]>` shape that
 * `Engine.execClassDec` builds, so the engine can be handed this table's answer
 * in place of its own.
 *
 * Reads preprocessed source: macros expanded, directives gone.
 */

/** How wide a basic type is. Mirrors `Engine.sizeof` in unicoen.ts. */
export type Sizeof = (type: string) => number;

/** The library typedefs not four bytes wide, as one pattern. */
const NARROW_OR_WIDE_LIBRARY_TYPEDEF = new RegExp(
  `\\b(${Object.keys(LIBRARY_TYPEDEFS)
    .filter((name) => typeof LIBRARY_TYPEDEFS[name].engineType === 'string')
    .join('|')})\\b`,
  'g'
);

/**
 * `Engine.sizeof` in unicoen.ts, and eight bytes for `long long` - which the
 * engine is given as one word (`ExpressionTypes.ENGINE_LONG_LONG`) and which
 * upstream would size as four. `CPP14Engine` installs this as the engine's
 * own, so the two cannot disagree.
 *
 * A library typedef is sized as the type it names (`uint8_t` as `unsigned
 * char`), which is fixed data rather than anything a program declares.
 * Upstream sized every name it did not know as four bytes, so a `uint8_t`
 * array was laid out four bytes to an element, a `uint8_t *` stepped four
 * bytes - `((uint8_t *)&x)[1]` read the object after `x` - and `malloc(8)`
 * for a `uint8_t *` made two elements.
 */
export function basicSizeof(type: string): number {
  if (type.includes('*')) {
    return 4;
  }
  const spelled = type.replace(
    NARROW_OR_WIDE_LIBRARY_TYPEDEF,
    (name) => LIBRARY_TYPEDEFS[name].engineType!
  );
  return builtinSizeof(spelled);
}

/** `basicSizeof` of a type spelled with the engine's own words. */
function builtinSizeof(type: string): number {
  if (type.includes('*')) {
    return 4;
  }
  if (ENGINE_LONG_LONG_WORD.test(type) || /\blong\s+long\b/.test(type)) {
    return 8;
  }
  if (type.includes('char')) {
    return 1;
  }
  if (type.includes('short')) {
    return 2;
  }
  if (type.includes('double')) {
    return 8;
  }
  return 4;
}

/** One member, with its declarator taken apart. */
export interface Member {
  name: string;
  /** The type as written, pointer stars included: `int`, `struct Node *`. */
  type: string;
  /** Array lengths, outermost first. Empty for a scalar member. */
  lengths: number[];
  baseQualifiers: TypeQualifier[];
  pointerQualifiers: TypeQualifier[][];
  /** A bit-field's width in bits; absent for every other member. */
  bits?: number;
  /**
   * The bits an unnamed bit-field declared just before this member keeps
   * unused (`unsigned : 3`), or `'unit'` after one of width 0, which starts
   * the next bit-field in a new storage unit. Absent for every other member.
   */
  skippedBits?: number | 'unit';
}

/** The words a type can be spelled with, for telling an unnamed bit-field. */
const TYPE_WORDS =
  /^(?:(?:const|volatile|signed|unsigned|int|char|short|long|_Bool|bool)\b\s*)+$/;

/** Where each member sits: the shape `Engine.execClassDec` puts in scope. */
export type FieldOffset = Map<string, [number, string, number]>;

/** Where a member sits in C's own layout: aligned, padded, bit-fields packed. */
export interface DisplayField {
  offset: number;
  size: number;
  alignment: number;
  /**
   * For a bit-field, the bit its value starts at within the storage unit at
   * `offset`, counted from the least significant bit, as gcc allocates them
   * on a little-endian target.
   */
  bitOffset?: number;
}

export interface RuntimeRecordInfo {
  displayType: string;
  kind: 'struct' | 'union';
  size: number;
  alignment: number;
  fields: {
    [name: string]: {
      offset: number;
      engineOffset: number;
      type: string;
      size: number;
      alignment: number;
      baseQualifiers: TypeQualifier[];
      pointerQualifiers: TypeQualifier[][];
      /** A bit-field's width, which the row shows as `a : 3`. */
      bits?: number;
    };
  };
}

export interface RuntimeRecordTypes {
  [runtimeType: string]: RuntimeRecordInfo;
}

/**
 * The bytes unicoen.ts reserves in front of a nested record for its own
 * bookkeeping. Mirrors `Engine.structInfoSize`, which the engine adds to the
 * size of any member that is itself a record.
 */
export const STRUCT_INFO_SIZE = 4;

/** A leading tag keyword, which a lookup by name ignores. */
const TAG_KEYWORD: Record<'struct' | 'union', RegExp> = {
  struct: /^\s*struct\s+/,
  union: /^\s*union\s+/,
};

export abstract class RecordTable {
  /** `struct` or `union`: the keyword this table reads. */
  protected abstract readonly keyword: 'struct' | 'union';

  private readonly members = new Map<string, Member[]>();
  /** typedef name, or tagless alias, to the key it stands for. */
  private readonly aliases = new Map<string, string>();
  private readonly taglessKeys = new Set<string>();
  /**
   * The keys made up for a definition without a tag that is the type of a
   * member (`union { ... } value;`), which has no name at all.
   */
  private readonly anonymousKeys = new Set<string>();
  private readonly lines = new Map<string, number>();
  /** Where each definition's body opens and closes, by key. */
  private readonly spans = new Map<string, [number, number]>();
  /** The source the table was read from, masked, for `incompleteMembers`. */
  private masked = '';
  private readonly peers: RecordTable[] = [];
  private readonly bodies: Array<[number, number]> = [];
  /**
   * The program's typedefs of scalar types, name to the type it stands for:
   * `typedef unsigned char byte;` is `byte` to `unsigned char`. The engine
   * sizes a name it does not know as four bytes, which a C layout cannot.
   */
  private readonly scalarTypedefs = new Map<string, string>();

  constructor(
    private readonly sizeof: Sizeof = basicSizeof,
    private readonly infoSize: number = STRUCT_INFO_SIZE
  ) {}

  /**
   * Consult `other` for member types this table does not know, so a struct can
   * contain a union and the other way round.
   */
  link(other: RecordTable): this {
    this.peers.push(other);
    return this;
  }

  /** Reads every declaration of this kind out of the source. */
  read(code: string): this {
    const masked = mask(code);
    this.masked = masked;
    // The bodies of every structure and union: a definition inside one is
    // the type of a member, not a declaration of its own.
    const bodies = recordBodies(masked);
    let i = 0;
    while (i < masked.length) {
      const at = masked.indexOf(this.keyword, i);
      if (at === -1) {
        break;
      }
      i = at + this.keyword.length;
      if (!isWholeIdentifier(masked, at, this.keyword.length)) {
        continue;
      }
      this.readOne(
        masked,
        at,
        bodies.some(([open, close]) => open < at && at < close)
      );
    }
    this.readAliasUses(masked);
    this.readScalarTypedefs(masked);
    return this;
  }

  names(): string[] {
    return Array.from(this.members.keys());
  }

  /**
   * The members whose type is a structure or union not complete where they
   * are declared (6.7.2.1p3): one defined after the record that holds them,
   * one never defined, or the record itself. A pointer to one is fine; so is
   * a record defined inline as the member's type. `library` names the
   * records the library declares, which are complete.
   */
  incompleteMembers(
    library: (name: string) => boolean
  ): { line: number; column: number; message: string }[] {
    const found: { line: number; column: number; message: string }[] = [];
    for (const [key, members] of this.members) {
      const span = this.spans.get(key);
      if (typeof span === 'undefined') {
        continue;
      }
      for (const member of members) {
        const spelled = /^(?:(struct|union)\s+)?([A-Za-z_]\w*)$/.exec(
          member.type.trim()
        );
        if (spelled === null) {
          continue;
        }
        const name = spelled[2];
        const owner = this.ownerOf(name);
        if (
          owner === null &&
          (typeof spelled[1] === 'undefined' || library(name))
        ) {
          // A scalar, a typedef of one, or a record the library declares.
          continue;
        }
        const target = owner === null ? null : owner.resolve(name);
        const defined =
          owner === null || target === null
            ? undefined
            : owner.spans.get(target);
        const complete =
          typeof defined !== 'undefined' &&
          !(owner === this && target === key) &&
          defined[1] < span[1];
        if (complete) {
          continue;
        }
        const at = this.memberOffset(span, member.name);
        const type =
          typeof spelled[1] === 'undefined' ? name : `${spelled[1]} ${name}`;
        const holder = this.taglessKeys.has(key)
          ? key
          : `${this.keyword} ${key}`;
        found.push({
          line: lineAt(this.masked, at),
          column: at - this.masked.lastIndexOf('\n', at - 1) - 1,
          message:
            `member ${member.name} has incomplete type ${type}: a structure ` +
            `or union is complete only after the closing brace of its ` +
            `definition, so define ${type} before ${holder}, or make the ` +
            `member a pointer`,
        });
      }
    }
    return found;
  }

  /** Where a member's name is written in a body, or where the body opens. */
  private memberOffset(span: [number, number], name: string): number {
    const body = this.masked.slice(span[0], span[1]);
    const written = new RegExp(`\\b${name}\\b\\s*[;,\\[:]`).exec(body);
    return written === null ? span[0] : span[0] + written.index;
  }

  /** `struct` or `union`, for a caller that spells a type with it. */
  kind(): 'struct' | 'union' {
    return this.keyword;
  }

  /**
   * Whether `name` is the tag of a record this table declares - `book` of
   * `struct book { ... }` - rather than a typedef name or nothing. A tag has
   * a name space of its own, so an object may share its name.
   */
  isTag(name: string): boolean {
    return this.members.has(name) && !this.taglessKeys.has(name);
  }

  has(name: string): boolean {
    return this.resolve(name) !== null;
  }

  /** The line the record was declared on, for reporting. */
  lineOf(name: string): number | null {
    const key = this.resolve(name);
    return key === null ? null : this.lines.get(key)!;
  }

  /** The record declared on `line`, used for a tagless typedef parse node. */
  nameAtLine(line: number): string | null {
    for (const [name, declaredAt] of this.lines) {
      if (declaredAt === line) {
        return name;
      }
    }
    return null;
  }

  /** The tag and every typedef name that denote the same record. */
  namesFor(name: string): string[] {
    const key = this.resolve(name);
    if (key === null) {
      return [];
    }
    const names = [key];
    for (const [alias, target] of this.aliases) {
      if (target === key && alias !== key) {
        names.push(alias);
      }
    }
    return names;
  }

  /** Plain record metadata retained for educational visualization. */
  runtimeTypes(): RuntimeRecordTypes {
    const types: RuntimeRecordTypes = {};
    for (const name of this.members.keys()) {
      const layout = this.layoutOf(name);
      const displayLayout = this.displayLayoutOf(name);
      if (layout === null || displayLayout === null) {
        continue;
      }
      const fields: RuntimeRecordInfo['fields'] = {};
      for (const member of this.ownMembers(name)!) {
        const engineField = layout.get(member.name)!;
        const displayField = displayLayout.fields.get(member.name)!;
        fields[member.name] = {
          offset: displayField.offset,
          engineOffset: engineField[0],
          type: member.type.replace(/^\s*(struct|union)\s+/, ''),
          size: displayField.size,
          alignment: displayField.alignment,
          baseQualifiers: member.baseQualifiers,
          pointerQualifiers: member.pointerQualifiers,
        };
        if (typeof member.bits === 'number') {
          fields[member.name].bits = member.bits;
        }
      }
      for (const runtimeName of this.namesFor(name)) {
        types[runtimeName] = {
          displayType: this.anonymousKeys.has(name)
            ? `${this.keyword} <anonymous>`
            : runtimeName === name && !this.taglessKeys.has(name)
              ? `${this.keyword} ${name}`
              : `${runtimeName} (${this.keyword})`,
          kind: this.keyword,
          size: displayLayout.size,
          alignment: displayLayout.alignment,
          fields,
        };
      }
    }
    return types;
  }

  /**
   * Removes array suffixes from record members before unicoen.ts parses them.
   * Their real lengths remain in this table; the mapper only needs a scalar
   * placeholder so it does not discard the rest of the translation unit.
   */
  rewriteForParser(code: string): string {
    const chars = code.split('');
    const masked = mask(code);
    for (const [start, end] of this.bodies) {
      let braceDepth = 0;
      let parenDepth = 0;
      let statementStart = start;
      for (let i = start; i < end; i += 1) {
        const char = masked[i];
        if (char === '{') {
          braceDepth += 1;
        } else if (char === '}') {
          braceDepth -= 1;
        } else if (char === '(') {
          parenDepth += 1;
        } else if (char === ')') {
          parenDepth -= 1;
        } else if (char === ';' && braceDepth === 0 && parenDepth === 0) {
          statementStart = i + 1;
        } else if (char === '[' && braceDepth === 0 && parenDepth === 0) {
          const close = masked.indexOf(']', i + 1);
          const before = masked.slice(statementStart, i);
          if (close !== -1 && close < end && !before.includes('=')) {
            for (let at = i; at <= close; at += 1) {
              if (chars[at] !== '\n') {
                chars[at] = ' ';
              }
            }
            i = close;
          }
        }
      }
    }
    return chars.join('');
  }

  membersOf(name: string): Member[] | null {
    const owner = this.ownerOf(name);
    return owner === null ? null : owner.ownMembers(name);
  }

  /** Byte width of the record itself, bookkeeping bytes not included. */
  sizeOf(name: string, seen: Set<string> = new Set()): number {
    const owner = this.ownerOf(name);
    if (owner === null) {
      return 0;
    }
    if (owner !== this) {
      // A union nested in a struct is still laid out by the union's rule.
      return owner.sizeOf(name, seen);
    }
    const key = this.resolve(name)!;
    if (seen.has(key)) {
      return 0; // a record cannot contain itself by value; do not recurse
    }
    const path = new Set(seen);
    path.add(key);
    const members = this.ownMembers(name)!;
    return this.sizeOfAll(
      members.map((member) => this.sizeOfMember(member, new Set(path)))
    );
  }

  /** Source-language size including member alignment and trailing padding. */
  displaySizeOf(name: string): number {
    const layout = this.displayLayoutOf(name);
    return layout === null ? 0 : layout.size;
  }

  displayAlignmentOf(name: string): number {
    const layout = this.displayLayoutOf(name);
    return layout === null ? 1 : layout.alignment;
  }

  /**
   * Where each member sits in the record as C lays it out - the offsets
   * `sizeof` and the canvas count, and the bytes a union's members share -
   * or null when no record goes by that name.
   */
  displayFieldsOf(name: string): Map<string, DisplayField> | null {
    const layout = this.displayLayoutOf(name);
    return layout === null ? null : layout.fields;
  }

  /**
   * Where every member sits. `null` when no record goes by that name, so a
   * caller can fall back to whatever it did before.
   */
  layoutOf(name: string, seen: Set<string> = new Set()): FieldOffset | null {
    const owner = this.ownerOf(name);
    if (owner === null) {
      return null;
    }
    if (owner !== this) {
      return owner.layoutOf(name, seen);
    }
    const key = this.resolve(name)!;
    const path = new Set(seen);
    path.add(key);
    const members = this.ownMembers(name)!;
    const sizes = members.map((member) =>
      this.sizeOfMember(member, new Set(path))
    );
    const offsets = this.offsetsOf(sizes);
    const layout: FieldOffset = new Map();
    members.forEach((member, index) => {
      layout.set(member.name, [offsets[index], member.type, sizes[index]]);
    });
    return layout;
  }

  /** Offset of each member, given their sizes in declaration order. */
  protected abstract offsetsOf(sizes: number[]): number[];

  /** How wide the whole record is, given its member sizes. */
  protected abstract sizeOfAll(sizes: number[]): number;

  /** The key `name` stands for in this table, following typedefs. */
  private resolve(name: string): string | null {
    // Asked of every variable at every step, so the pattern is not rebuilt.
    const bare = name.replace(TAG_KEYWORD[this.keyword], '').trim();
    if (this.members.has(bare)) {
      return bare;
    }
    const alias = this.aliases.get(bare);
    return alias !== undefined && this.members.has(alias) ? alias : null;
  }

  private ownMembers(name: string): Member[] | null {
    const key = this.resolve(name);
    return key === null ? null : this.members.get(key)!;
  }

  /** The table that declared `name`: this one, or a linked one. */
  private ownerOf(name: string): RecordTable | null {
    if (this.resolve(name) !== null) {
      return this;
    }
    for (const peer of this.peers) {
      if (peer.resolve(name) !== null) {
        return peer;
      }
    }
    return null;
  }

  private sizeOfMember(member: Member, seen: Set<string>): number {
    const count = member.lengths.reduce((a, b) => a * b, 1);
    if (member.type.includes('*')) {
      return this.sizeof(member.type) * count;
    }
    const owner = this.ownerOf(member.type);
    if (owner !== null) {
      return (owner.sizeOf(member.type, seen) + this.infoSize) * count;
    }
    return this.sizeof(member.type) * count;
  }

  /** C-like aligned layout used only by the educational memory canvas. */
  private displayLayoutOf(
    name: string,
    seen: Set<string> = new Set()
  ): {
    fields: Map<string, DisplayField>;
    size: number;
    alignment: number;
  } | null {
    const owner = this.ownerOf(name);
    if (owner === null) {
      return null;
    }
    if (owner !== this) {
      return owner.displayLayoutOf(name, seen);
    }
    const key = this.resolve(name)!;
    if (seen.has(key)) {
      return { fields: new Map(), size: 0, alignment: 1 };
    }
    const path = new Set(seen);
    path.add(key);
    const fields = new Map<string, DisplayField>();
    let cursor = 0;
    let widest = 0;
    let recordAlignment = 1;
    // The storage unit consecutive bit-fields are being packed into: gcc
    // puts the next one in the same unit while its bits still fit there.
    let unit: { offset: number; size: number; used: number } | null = null;
    for (const member of this.ownMembers(name)!) {
      const shape = this.displayShapeOfMember(member, new Set(path));
      recordAlignment = Math.max(recordAlignment, shape.alignment);
      const bits = member.bits;
      if (member.skippedBits === 'unit') {
        unit = null;
      } else if (typeof member.skippedBits === 'number' && unit !== null) {
        unit.used += member.skippedBits;
      }
      if (
        this.keyword !== 'union' &&
        typeof bits === 'number' &&
        unit !== null &&
        unit.size === shape.size &&
        unit.used + bits <= unit.size * 8
      ) {
        fields.set(member.name, {
          offset: unit.offset,
          ...shape,
          bitOffset: unit.used,
        });
        unit.used += bits;
        continue;
      }
      const offset =
        this.keyword === 'union' ? 0 : alignAddress(cursor, shape.alignment);
      fields.set(
        member.name,
        typeof bits === 'number'
          ? { offset, ...shape, bitOffset: 0 }
          : { offset, ...shape }
      );
      unit =
        typeof bits === 'number'
          ? { offset, size: shape.size, used: bits }
          : null;
      cursor = offset + shape.size;
      widest = Math.max(widest, shape.size);
    }
    const contentSize = this.keyword === 'union' ? widest : cursor;
    return {
      fields,
      size: alignAddress(contentSize, recordAlignment),
      alignment: recordAlignment,
    };
  }

  private displayShapeOfMember(
    member: Member,
    seen: Set<string>
  ): { size: number; alignment: number } {
    const count = member.lengths.reduce((a, b) => a * b, 1);
    if (member.type.includes('*')) {
      return { size: 4 * count, alignment: 4 };
    }
    const owner = this.ownerOf(member.type);
    if (owner !== null) {
      const nested = owner.displayLayoutOf(member.type, seen);
      return nested === null
        ? { size: 0, alignment: 1 }
        : { size: nested.size * count, alignment: nested.alignment };
    }
    const size = this.scalarSizeOf(member.type);
    return { size: size * count, alignment: Math.max(1, Math.min(size, 8)) };
  }

  /**
   * A scalar type's size as C counts it, typedefs resolved: `uint8_t` and a
   * program's `typedef unsigned char byte` are one byte, where the engine's
   * `sizeof` gives every name it does not recognise four.
   */
  private scalarSizeOf(type: string): number {
    let spelled = type.trim();
    for (let depth = 0; depth < 8 && !spelled.includes('*'); depth += 1) {
      const alias = this.scalarTypedefs.get(spelled);
      if (typeof alias === 'undefined') {
        break;
      }
      spelled = alias;
    }
    const library = spelled.includes('*')
      ? undefined
      : LIBRARY_TYPEDEFS[spelled];
    return typeof library === 'undefined'
      ? this.sizeof(spelled)
      : library.bytes;
  }

  /**
   * `typedef unsigned char byte;`, `typedef double real, *reals;`: every
   * typedef of a scalar or a pointer. One with a body, or with parentheses
   * (a function pointer), names something else and is read elsewhere.
   */
  private readScalarTypedefs(masked: string): void {
    const pattern = /\btypedef\b([^;{}()]*);/g;
    let match = pattern.exec(masked);
    while (match !== null) {
      const parts = splitTopLevel(match[1], ',');
      const first = parts.length === 0 ? null : splitDeclarator(parts[0]);
      if (
        first !== null &&
        first.prefix !== '' &&
        !/\b(struct|union|enum)\b/.test(first.prefix)
      ) {
        for (const part of parts) {
          const parsed = splitDeclarator(part);
          if (parsed === null || parsed.lengths.length > 0) {
            continue;
          }
          this.scalarTypedefs.set(
            parsed.name,
            `${first.prefix}${' *'.repeat(parsed.stars)}`.trim()
          );
        }
      }
      match = pattern.exec(masked);
    }
  }

  private readAliasUses(masked: string): void {
    const pattern = new RegExp(
      `\\btypedef\\b([^;]*?)\\b${this.keyword}\\s+([A-Za-z_]\\w*)\\s+([A-Za-z_]\\w*)\\s*;`,
      'g'
    );
    let match = pattern.exec(masked);
    while (match !== null) {
      if (this.members.has(match[2])) {
        this.aliases.set(match[3], match[2]);
      }
      match = pattern.exec(masked);
    }
  }

  /**
   * Reads one definition that starts with the keyword at `at`. A use rather
   * than a definition - `struct P p;` names a type, it does not declare one -
   * is passed over. A definition `nested` in the body of another record is
   * the type of one of its members: filed under its tag, which C declares as
   * if it were written outside, or under a key of its own.
   */
  private readOne(masked: string, at: number, nested: boolean): void {
    let i = skipSpace(masked, at + this.keyword.length);
    let tag = '';
    if (i < masked.length && IDENT_START.test(masked[i])) {
      const end = identifierEnd(masked, i);
      tag = masked.slice(i, end);
      i = skipSpace(masked, end);
    }
    if (masked[i] !== '{') {
      return;
    }
    const close = matchBrace(masked, i);
    if (close === -1) {
      return;
    }
    this.bodies.push([i + 1, close]);
    const members = parseMembers(masked.slice(i + 1, close), i + 1);
    if (nested) {
      const key = tag !== '' ? tag : anonymousKey(at);
      this.members.set(key, members);
      this.spans.set(key, [i, close]);
      if (tag === '') {
        this.anonymousKeys.add(key);
      }
      this.lines.set(key, lineAt(masked, at));
      return;
    }
    const after = masked.slice(close + 1, indexOfSemicolon(masked, close + 1));
    const declared = declaratorNames(after);
    const isTypedef = precededByTypedef(masked, at);
    // A tagless `typedef struct { ... } P;` is filed under P: it is the only
    // name the type ever has, and the parse tree drops it entirely. A tagless
    // `struct { ... } s;` declares an object, whose name is no type's: the
    // type has none, and the object was looked up as its own layout.
    const key =
      tag !== ''
        ? tag
        : !isTypedef && declared.length > 0
          ? anonymousKey(at)
          : declared.length > 0
            ? declared[0]
            : '';
    if (key === '') {
      return;
    }
    this.members.set(key, members);
    this.spans.set(key, [i, close]);
    if (tag === '' && isTypedef) {
      this.taglessKeys.add(key);
    } else if (tag === '') {
      this.anonymousKeys.add(key);
    }
    this.lines.set(key, lineAt(masked, at));
    if (isTypedef) {
      for (const alias of declared) {
        this.aliases.set(alias, key);
      }
    }
  }
}

/**
 * The key of a record defined without a tag as the type of a member: from
 * where its keyword is, so the structure and the union table, which both
 * read the same source, give it the same one. A name beginning with two
 * underscores is reserved, so no program declares it.
 */
function anonymousKey(at: number): string {
  return `__anon${at}`;
}

/** Where the body of every structure and union definition is, braces excluded. */
function recordBodies(masked: string): Array<[number, number]> {
  const bodies: Array<[number, number]> = [];
  const pattern = /\b(?:struct|union)\b\s*(?:[A-Za-z_]\w*\s*)?\{/g;
  let found = pattern.exec(masked);
  while (found !== null) {
    const open = found.index + found[0].length - 1;
    const close = matchBrace(masked, open);
    if (close !== -1) {
      bodies.push([open, close]);
    }
    found = pattern.exec(masked);
  }
  return bodies;
}

/** Index of the `;` closing a declaration, or the end of the source. */
function indexOfSemicolon(masked: string, from: number): number {
  const at = masked.indexOf(';', from);
  return at === -1 ? masked.length : at;
}

/**
 * True when the nearest word before `at` is `typedef`, qualifiers passed
 * over: `typedef const struct { ... } Fixed;` is a typedef too.
 */
function precededByTypedef(masked: string, at: number): boolean {
  let i = at - 1;
  for (;;) {
    while (i >= 0 && /\s/.test(masked[i])) {
      i -= 1;
    }
    const end = i + 1;
    while (i >= 0 && /[A-Za-z0-9_]/.test(masked[i])) {
      i -= 1;
    }
    const word = masked.slice(i + 1, end);
    if (!/^(?:const|volatile|restrict|_Atomic)$/.test(word)) {
      return word === 'typedef';
    }
  }
}

/** The names declared after a record body: the `a, b` of `} a, b;`. */
function declaratorNames(text: string): string[] {
  const names: string[] = [];
  for (const part of splitTopLevel(text, ',')) {
    const parsed = splitDeclarator(part);
    if (parsed !== null) {
      names.push(parsed.name);
    }
  }
  return names;
}

/**
 * The members of one record body.
 *
 * Skipped, and recorded nowhere: anything with parentheses, which is a member
 * function or a function pointer, anonymous nested records, and an unnamed
 * bit-field. A named bit-field keeps its declared type and records its width
 * in `bits`: the engine gives it a whole object of that type, and wraps what
 * is stored in it at the width (`CPP14Engine._execCast`).
 */
export function parseMembers(body: string, offset = 0): Member[] {
  const members: Member[] = [];
  let cursor = offset;
  let skipped: number | 'unit' = 0;
  for (const raw of splitTopLevel(body, ';')) {
    const start = cursor;
    cursor += raw.length + 1;
    const declaration = raw.trim();
    const normalizedDeclaration = declaration.replace(
      /\b_Atomic\s*\(([^)]+)\)/g,
      '_Atomic $1'
    );
    if (normalizedDeclaration.includes('{')) {
      members.push(...inlineMembers(raw, start));
      continue;
    }
    if (normalizedDeclaration === '' || normalizedDeclaration.includes('(')) {
      continue;
    }
    const parts = splitTopLevel(normalizedDeclaration, ',');
    let baseType: string | null = null;
    let declarationQualifiers: TypeQualifier[] = [];
    for (const declarator of parts) {
      // `unsigned a : 3, b : 5`: each declarator carries its own width.
      const width = /:\s*([^:]*)$/.exec(declarator);
      const part =
        width === null ? declarator : declarator.slice(0, width.index);
      const bits = width === null ? NaN : Number(width[1].trim());
      // `unsigned int : 0;` names no member: it is padding, and a width of 0
      // starts the next bit-field in a new unit. It was read as a member
      // called `int`, which took a whole word and the next initializer.
      if (
        width !== null &&
        (part.trim() === '' ||
          TYPE_WORDS.test(part.trim()) ||
          Object.prototype.hasOwnProperty.call(LIBRARY_TYPEDEFS, part.trim()))
      ) {
        if (Number.isInteger(bits) && bits >= 0) {
          skipped =
            bits === 0 ? 'unit' : skipped === 'unit' ? skipped : skipped + bits;
        }
        if (baseType === null) {
          baseType = part.trim();
        }
        continue;
      }
      const parsed = splitDeclarator(part);
      if (parsed === null) {
        continue;
      }
      if (baseType === null) {
        baseType = parsed.prefix;
        declarationQualifiers = parsed.baseQualifiers;
      }
      if (baseType === '') {
        continue;
      }
      const member: Member = {
        name: parsed.name,
        type: (baseType + ' ' + '*'.repeat(parsed.stars)).trim(),
        lengths: parsed.lengths,
        baseQualifiers: declarationQualifiers,
        pointerQualifiers: parsed.pointerQualifiers,
      };
      // A width wider than the type is a constraint violation the compiler
      // reports; the member is then laid out as the whole type it says.
      if (
        Number.isInteger(bits) &&
        bits > 0 &&
        bits <= basicSizeof(member.type) * 8 &&
        parsed.stars === 0 &&
        parsed.lengths.length === 0
      ) {
        member.bits = bits;
      }
      if (skipped !== 0) {
        member.skippedBits = skipped;
        skipped = 0;
      }
      members.push(member);
    }
  }
  return members;
}

/**
 * The members a declaration with a record defined inline declares:
 * `union { double celsius; int open; } value` is a member `value` of that
 * union, whose key the table reading the definition gives it (`readOne`).
 * One that declares nothing - an anonymous structure or union, whose members
 * C makes the enclosing record's own - is passed over, as it was before.
 */
function inlineMembers(raw: string, start: number): Member[] {
  const head = /^(\s*)(struct|union)\b\s*([A-Za-z_]\w*)?\s*\{/.exec(raw);
  if (head === null) {
    return [];
  }
  const open = head[0].length - 1;
  const close = matchBrace(raw, open);
  if (close === -1) {
    return [];
  }
  const keyword = head[2];
  const key =
    typeof head[3] === 'string'
      ? head[3]
      : anonymousKey(start + head[1].length);
  const members: Member[] = [];
  for (const part of splitTopLevel(raw.slice(close + 1), ',')) {
    const parsed = splitDeclarator(`${keyword} ${key} ${part.trim()}`);
    if (parsed === null || part.trim() === '') {
      continue;
    }
    members.push({
      name: parsed.name,
      type: `${keyword} ${key}${parsed.stars > 0 ? ' ' : ''}${'*'.repeat(parsed.stars)}`,
      lengths: parsed.lengths,
      baseQualifiers: parsed.baseQualifiers,
      pointerQualifiers: parsed.pointerQualifiers,
    });
  }
  return members;
}

interface Declarator {
  /** Everything before the declarator: the base type, on the first one only. */
  prefix: string;
  stars: number;
  name: string;
  lengths: number[];
  baseQualifiers: TypeQualifier[];
  pointerQualifiers: TypeQualifier[][];
}

/** Takes one declarator apart from the right: `char *name[8]`. */
function splitDeclarator(text: string): Declarator | null {
  let t = text.trim();
  const lengths: number[] = [];
  while (t.endsWith(']')) {
    const open = t.lastIndexOf('[');
    if (open === -1) {
      return null;
    }
    const inner = t.slice(open + 1, t.length - 1).trim();
    const length = Number(inner);
    // An unsized or non-numeric bound only reaches here if a macro failed to
    // expand; one element is the least wrong guess and keeps the layout finite.
    lengths.unshift(inner === '' || isNaN(length) ? 1 : length);
    t = t.slice(0, open).trim();
  }
  const end = t.length;
  let i = end;
  while (i > 0 && /[A-Za-z0-9_]/.test(t[i - 1])) {
    i -= 1;
  }
  const name = t.slice(i, end);
  if (name === '' || !IDENT_START.test(name[0])) {
    return null;
  }
  t = t.slice(0, i).trim();
  const firstStar = t.indexOf('*');
  const baseText = firstStar === -1 ? t : t.slice(0, firstStar);
  const pointerText = firstStar === -1 ? '' : t.slice(firstStar);
  const baseQualifiers = qualifiersIn(baseText);
  const prefix = stripQualifiers(baseText);
  const pointerQualifiers: TypeQualifier[][] = [];
  if (pointerText !== '') {
    for (const level of pointerText.split('*').slice(1)) {
      pointerQualifiers.push(qualifiersIn(level));
    }
  }
  return {
    prefix,
    stars: pointerQualifiers.length,
    name,
    lengths,
    baseQualifiers,
    pointerQualifiers,
  };
}

function qualifiersIn(text: string): TypeQualifier[] {
  const qualifiers: TypeQualifier[] = [];
  for (const word of text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    if (
      word === 'const' ||
      word === 'volatile' ||
      word === 'restrict' ||
      word === '_Atomic'
    ) {
      qualifiers.push(word);
    }
  }
  return qualifiers;
}

function stripQualifiers(text: string): string {
  return text
    .replace(/\b_Atomic\s*\(([^)]+)\)/g, '$1')
    .replace(/\b(const|volatile|restrict|_Atomic)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function alignAddress(address: number, alignment: number): number {
  return Math.ceil(address / alignment) * alignment;
}
