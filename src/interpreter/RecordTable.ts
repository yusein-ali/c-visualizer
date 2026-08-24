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

export function basicSizeof(type: string): number {
  if (type.includes('*')) {
    return 4;
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
}

/** Where each member sits: the shape `Engine.execClassDec` puts in scope. */
export type FieldOffset = Map<string, [number, string, number]>;

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

export abstract class RecordTable {
  /** `struct` or `union`: the keyword this table reads. */
  protected abstract readonly keyword: 'struct' | 'union';

  private readonly members = new Map<string, Member[]>();
  /** typedef name, or tagless alias, to the key it stands for. */
  private readonly aliases = new Map<string, string>();
  private readonly taglessKeys = new Set<string>();
  private readonly lines = new Map<string, number>();
  private readonly peers: RecordTable[] = [];
  private readonly bodies: Array<[number, number]> = [];

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
      const parsed = this.readOne(masked, at);
      if (parsed !== null) {
        i = parsed;
      }
    }
    this.readAliasUses(masked);
    return this;
  }

  names(): string[] {
    return Array.from(this.members.keys());
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
      }
      for (const runtimeName of this.namesFor(name)) {
        types[runtimeName] = {
          displayType:
            runtimeName === name && !this.taglessKeys.has(name)
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
    const bare = name
      .replace(new RegExp(`^\\s*${this.keyword}\\s+`), '')
      .trim();
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
    fields: Map<string, { offset: number; size: number; alignment: number }>;
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
    const fields = new Map<
      string,
      { offset: number; size: number; alignment: number }
    >();
    let cursor = 0;
    let widest = 0;
    let recordAlignment = 1;
    for (const member of this.ownMembers(name)!) {
      const shape = this.displayShapeOfMember(member, new Set(path));
      recordAlignment = Math.max(recordAlignment, shape.alignment);
      const offset =
        this.keyword === 'union' ? 0 : alignAddress(cursor, shape.alignment);
      fields.set(member.name, { offset, ...shape });
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
    const size = this.sizeof(member.type);
    return { size: size * count, alignment: Math.max(1, Math.min(size, 8)) };
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
   * Reads one declaration that starts with the keyword at `at`. Returns the
   * index to carry on from, or null when this is a use rather than a
   * definition - `struct P p;` names a type, it does not declare one.
   */
  private readOne(masked: string, at: number): number | null {
    let i = skipSpace(masked, at + this.keyword.length);
    let tag = '';
    if (i < masked.length && IDENT_START.test(masked[i])) {
      const end = identifierEnd(masked, i);
      tag = masked.slice(i, end);
      i = skipSpace(masked, end);
    }
    if (masked[i] !== '{') {
      return null;
    }
    const close = matchBrace(masked, i);
    if (close === -1) {
      return null;
    }
    this.bodies.push([i + 1, close]);
    const members = parseMembers(masked.slice(i + 1, close));
    const after = masked.slice(close + 1, indexOfSemicolon(masked, close + 1));
    const declared = declaratorNames(after);
    const isTypedef = precededByTypedef(masked, at);
    // A tagless `typedef struct { ... } P;` is filed under P: it is the only
    // name the type ever has, and the parse tree drops it entirely.
    const key = tag !== '' ? tag : declared.length > 0 ? declared[0] : '';
    if (key === '') {
      return close + 1;
    }
    this.members.set(key, members);
    if (tag === '') {
      this.taglessKeys.add(key);
    }
    this.lines.set(key, lineAt(masked, at));
    if (isTypedef) {
      for (const alias of declared) {
        this.aliases.set(alias, key);
      }
    }
    return close + 1;
  }
}

/** Index of the `;` closing a declaration, or the end of the source. */
function indexOfSemicolon(masked: string, from: number): number {
  const at = masked.indexOf(';', from);
  return at === -1 ? masked.length : at;
}

/** True when the nearest word before `at` is `typedef`. */
function precededByTypedef(masked: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(masked[i])) {
    i -= 1;
  }
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(masked[i])) {
    i -= 1;
  }
  return masked.slice(i + 1, end) === 'typedef';
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
 * function or a function pointer, and anonymous nested records. A bitfield
 * keeps its declared type and loses its width - unicoen.ts has no bitfields at
 * all, so a whole `int` is the closest thing available.
 */
export function parseMembers(body: string): Member[] {
  const members: Member[] = [];
  for (const raw of splitTopLevel(body, ';')) {
    const declaration = raw.split(':')[0].trim();
    const normalizedDeclaration = declaration.replace(
      /\b_Atomic\s*\(([^)]+)\)/g,
      '_Atomic $1'
    );
    if (normalizedDeclaration === '' || normalizedDeclaration.includes('(')) {
      continue;
    }
    if (normalizedDeclaration.includes('{')) {
      continue;
    }
    const parts = splitTopLevel(normalizedDeclaration, ',');
    let baseType: string | null = null;
    let declarationQualifiers: TypeQualifier[] = [];
    for (const part of parts) {
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
      members.push({
        name: parsed.name,
        type: (baseType + ' ' + '*'.repeat(parsed.stars)).trim(),
        lengths: parsed.lengths,
        baseQualifiers: declarationQualifiers,
        pointerQualifiers: parsed.pointerQualifiers,
      });
    }
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
