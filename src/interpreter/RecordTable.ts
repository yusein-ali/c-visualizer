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
 *     storage. `baseline/scripts/probe-aggregates.js` records what that costs:
 *     `u.i = 65; u.c` reads 0.
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
}

/** Where each member sits: the shape `Engine.execClassDec` puts in scope. */
export type FieldOffset = Map<string, [number, string, number]>;

/**
 * The bytes unicoen.ts reserves in front of a nested record for its own
 * bookkeeping. Mirrors `Engine.structInfoSize`, which the engine adds to the
 * size of any member that is itself a record.
 */
export const STRUCT_INFO_SIZE = 4;

export abstract class RecordTable {
  /** `struct` or `union`: the keyword this table reads. */
  protected abstract readonly keyword: string;

  private readonly members = new Map<string, Member[]>();
  /** typedef name, or tagless alias, to the key it stands for. */
  private readonly aliases = new Map<string, string>();
  private readonly lines = new Map<string, number>();
  private readonly peers: RecordTable[] = [];

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

  membersOf(name: string): Member[] | null {
    const key = this.resolve(name);
    if (key === null) {
      for (const peer of this.peers) {
        const found = peer.membersOf(name);
        if (found !== null) {
          return found;
        }
      }
      return null;
    }
    return this.members.get(key)!;
  }

  /** Byte width of the record itself, bookkeeping bytes not included. */
  sizeOf(name: string, seen: Set<string> = new Set()): number {
    const members = this.membersOf(name);
    if (members === null) {
      return 0;
    }
    if (seen.has(name)) {
      return 0; // a record cannot contain itself by value; do not recurse
    }
    seen.add(name);
    return this.sizeOfAll(members.map((m) => this.sizeOfMember(m, seen)));
  }

  /**
   * Where every member sits. `null` when no record of this kind goes by that
   * name, so a caller can fall back to whatever it did before.
   */
  layoutOf(name: string, seen: Set<string> = new Set()): FieldOffset | null {
    const members = this.membersOf(name);
    if (members === null) {
      return null;
    }
    seen.add(name);
    const sizes = members.map((m) => this.sizeOfMember(m, seen));
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

  /** The key `name` stands for, following typedefs. */
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

  private sizeOfMember(member: Member, seen: Set<string>): number {
    const count = member.lengths.reduce((a, b) => a * b, 1);
    if (member.type.includes('*')) {
      return this.sizeof(member.type) * count;
    }
    const record = this.recordSize(member.type, seen);
    if (record !== null) {
      return (record + this.infoSize) * count;
    }
    return this.sizeof(member.type) * count;
  }

  /** Size of a member that is itself a record, asking peers too. */
  private recordSize(type: string, seen: Set<string>): number | null {
    if (this.membersOf(type) !== null) {
      return this.sizeOf(type, seen);
    }
    for (const peer of this.peers) {
      if (peer.membersOf(type) !== null) {
        return peer.sizeOf(type, seen);
      }
    }
    return null;
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
    if (declaration === '' || declaration.includes('(')) {
      continue;
    }
    if (declaration.includes('{')) {
      continue;
    }
    const parts = splitTopLevel(declaration, ',');
    let baseType: string | null = null;
    for (const part of parts) {
      const parsed = splitDeclarator(part);
      if (parsed === null) {
        continue;
      }
      if (baseType === null) {
        baseType = parsed.prefix;
      }
      if (baseType === '') {
        continue;
      }
      members.push({
        name: parsed.name,
        type: (baseType + ' ' + '*'.repeat(parsed.stars)).trim(),
        lengths: parsed.lengths,
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
  let stars = 0;
  while (t.endsWith('*')) {
    stars += 1;
    t = t.slice(0, t.length - 1).trim();
  }
  return { prefix: t, stars, name, lengths };
}
