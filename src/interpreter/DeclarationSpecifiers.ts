import { CodeRange } from 'unicoen.ts/dist/node_helper/CodeRange';
import { identifierEnd, IDENT_START, mask } from './scan';

export type StorageClass =
  | 'auto'
  | 'register'
  | 'static'
  | 'extern'
  | '_Thread_local'
  | 'thread_local';

export type TypeQualifier = 'const' | 'volatile' | 'restrict' | '_Atomic';

export type StorageRegion = 'register' | 'static' | 'global' | 'stack';

export interface RuntimeDeclarationInfo {
  storageClasses: StorageClass[];
  qualifiers: TypeQualifier[];
  baseQualifiers?: TypeQualifier[];
  pointerQualifiers?: TypeQualifier[][];
  region: StorageRegion;
  /**
   * The type as the reader spelled it, where that is not the type the engine
   * was given. Only `reducedSpecifiers` sets it, so it is absent for every
   * declaration whose specifiers reached the mapper untouched.
   */
  declaredType?: string;
  /** Whether this declaration had an initializer in the source. */
  initialized: boolean;
  /** Whether `const` binds the declared object rather than its pointee. */
  readOnly: boolean;
}

export type DeclarationSpecifierInfo = Omit<
  RuntimeDeclarationInfo,
  'region' | 'initialized' | 'readOnly'
>;

interface Occurrence {
  name: StorageClass | TypeQualifier;
  start: number;
  end: number;
  kind: 'storage' | 'qualifier';
}

const STORAGE_CLASSES: StorageClass[] = [
  'auto',
  'register',
  'static',
  'extern',
  '_Thread_local',
  'thread_local',
];
const TYPE_QUALIFIERS: TypeQualifier[] = [
  'const',
  'volatile',
  'restrict',
  '_Atomic',
];

/** The two words that say how a type is signed rather than how wide it is. */
const SIGN_SPECIFIERS = ['signed', 'unsigned'];

/**
 * The type specifiers unicoen's mapper reads one of, and no more.
 *
 * Its C++14 grammar maps a declaration whose type is a single one of these,
 * optionally preceded by `unsigned`. Every other combination C allows -
 * `long long`, `short int`, `signed char`, `long double` - it fails to map:
 * the declaration came back as a bare `UniExpr` carrying no name, so the
 * object was never created, `printf` printed nothing, and the run reported
 * success over a program that had not declared its variable. Ordered widest
 * first, which is how `reducedSpecifiers` chooses the word to keep.
 */
const BASE_TYPES = [
  'double',
  'float',
  'long',
  'short',
  'char',
  '_Bool',
  'int',
];

/** One type specifier word, where it is written. */
interface TypeWord {
  name: string;
  start: number;
  end: number;
}

/**
 * Which words of a type specifier sequence to keep, or null to keep them all.
 *
 * A sequence naming one base type is what the mapper already reads, and is
 * returned untouched however it is signed: `unsigned int` and a bare
 * `unsigned` both map today. Anything else is reduced to the widest base type
 * it names - `long long` and `long int` are both `long`, `long double` is
 * `double` - keeping `unsigned` where it appears, because that much the
 * mapper does read. `signed` always goes: it is the default, so dropping it
 * changes the type the engine builds only where C says it should not.
 *
 * The width lost by the reduction is the width PLIVET never modelled anyway.
 * `basicSizeof` gives `int` and `long` four bytes each and knows nothing of
 * `long long`, so no size the reader is shown changes by this.
 */
const reducedSpecifiers = (words: TypeWord[]): TypeWord[] | null => {
  const bases = words.filter((word) => BASE_TYPES.indexOf(word.name) !== -1);
  const signs = words.filter(
    (word) => SIGN_SPECIFIERS.indexOf(word.name) !== -1
  );
  const signedness = signs.filter((word) => word.name === 'unsigned');
  if (
    bases.length === 0 ||
    (bases.length === 1 && signs.length === signedness.length && signs.length <= 1)
  ) {
    return null;
  }
  const kept = BASE_TYPES.map((name) =>
    bases.find((word) => word.name === name)
  ).find((word) => typeof word !== 'undefined');
  if (typeof kept === 'undefined') {
    return null;
  }
  return signedness.length === 0 ? [kept] : [signedness[0], kept];
};

/**
 * Where one declaration's specifier list can no longer be running.
 *
 * Only used to decide whether a storage class leads its declaration, so it is
 * deliberately coarse: every one of these characters ends a specifier list,
 * and reading one that has not started as "not started" is the safe way round.
 */
const DECLARATION_BOUNDARY = /[;{}(),=]/;

/** What one reduced type specifier sequence said, and where it said it. */
interface TypeSpelling {
  start: number;
  end: number;
  text: string;
}

/**
 * Blank every word of one type specifier sequence the reduction drops, and
 * record what the sequence said so the reader is still shown their own type.
 */
const reduceTypeWords = (
  chars: string[],
  words: TypeWord[],
  spellings: TypeSpelling[]
): void => {
  const kept = reducedSpecifiers(words);
  for (const word of kept === null ? [] : words) {
    if (kept!.indexOf(word) !== -1) {
      continue;
    }
    for (let at = word.start; at < word.end; at += 1) {
      chars[at] = ' ';
    }
  }
  // Every sequence of more than one word is recorded, reduced or not: the
  // mapper reads `unsigned int` but joins it into the single word
  // `unsignedint`, which is not how anybody spells a type.
  if (words.length < 2) {
    return;
  }
  spellings.push({
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((word) => word.name).join(' '),
  });
};

/**
 * Retains declaration specifiers that unicoen.ts either discards or refuses
 * to map. Rewriting only blanks unsupported words, preserving every source
 * position so parser ranges and editor highlights remain aligned.
 */
export class DeclarationSpecifiers {
  private source = '';
  private lineStarts: number[] = [0];
  private occurrences: Occurrence[] = [];
  private typeSpellings: TypeSpelling[] = [];
  private readonly typedefQualifiers = new Map<
    string,
    DeclarationSpecifierInfo
  >();

  rewrite(code: string): string {
    this.source = code;
    this.lineStarts = [0];
    this.occurrences = [];
    this.typeSpellings = [];
    this.typedefQualifiers.clear();
    for (let i = 0; i < code.length; i += 1) {
      if (code[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }

    const masked = mask(code);
    const chars = code.split('');
    let i = 0;
    // Whether a word naming a type has already appeared in the declaration
    // being read, and the type specifier words it has named so far. Both are
    // per-declaration, so both are cleared at every boundary between them.
    let typeSeen = false;
    let typeWords: TypeWord[] = [];
    while (i < masked.length) {
      if (!IDENT_START.test(masked[i])) {
        if (DECLARATION_BOUNDARY.test(masked[i])) {
          reduceTypeWords(chars, typeWords, this.typeSpellings);
          typeWords = [];
          typeSeen = false;
        }
        i += 1;
        continue;
      }
      const end = identifierEnd(masked, i);
      const word = masked.slice(i, end);
      const storage = STORAGE_CLASSES.indexOf(word as StorageClass) !== -1;
      const qualifier = TYPE_QUALIFIERS.indexOf(word as TypeQualifier) !== -1;
      if (storage || qualifier) {
        this.occurrences.push({
          name: word as StorageClass | TypeQualifier,
          start: i,
          end,
          kind: storage ? 'storage' : 'qualifier',
        });
        // The mapper already retains register/static/extern/thread_local.
        // C's `auto int` and `_Thread_local` are not valid CPP14 grammar, and
        // all three qualifiers make its mapper drop the declaration.
        //
        // `typeSeen` is the fourth case. C's declaration specifiers are an
        // unordered set, so `int register a;` and `int static visits;` are as
        // valid as the leading form, and ANTLR's C++14 grammar reads only the
        // leading one: `int register a` produced a tree holding no statement
        // the interpreter could place, and the run ended on its first step
        // with no output, no location and nothing said. Blanking is safe for
        // the same reason it is for `auto` - the word is already in
        // `occurrences`, so the memory view still puts the object in its
        // register or static region. Only the word ANTLR choked on goes.
        if (
          qualifier ||
          word === 'auto' ||
          word === '_Thread_local' ||
          (storage && typeSeen)
        ) {
          for (let at = i; at < end; at += 1) {
            chars[at] = ' ';
          }
          if (word === '_Atomic') {
            let open = end;
            while (open < masked.length && /\s/.test(masked[open])) {
              open += 1;
            }
            if (masked[open] === '(') {
              const close = masked.indexOf(')', open + 1);
              if (close !== -1) {
                chars[open] = ' ';
                chars[close] = ' ';
              }
            }
          }
        }
      } else if (
        BASE_TYPES.indexOf(word) !== -1 ||
        SIGN_SPECIFIERS.indexOf(word) !== -1
      ) {
        typeWords.push({ name: word, start: i, end });
        typeSeen = true;
      } else {
        // The declarator's own name, a typedef name or a struct tag: whatever
        // it is, the specifier sequence before it has finished.
        reduceTypeWords(chars, typeWords, this.typeSpellings);
        typeWords = [];
        typeSeen = true;
      }
      i = end;
    }
    reduceTypeWords(chars, typeWords, this.typeSpellings);
    this.readQualifiedTypedefs(masked);
    return chars.join('');
  }

  /** Specifiers belonging to the declaration represented by this AST range. */
  infoFor(range: CodeRange): DeclarationSpecifierInfo | null {
    const start = this.offsetOf(range.begin.y, range.begin.x);
    const end = this.offsetOf(range.end.y, range.end.x);
    const relevant = this.occurrences.filter((occurrence) => {
      if (occurrence.start >= start && occurrence.start <= end) {
        return true;
      }
      return (
        occurrence.end <= start &&
        this.onlySpecifiersAndWhitespace(occurrence.end, start)
      );
    });
    if (relevant.length === 0) {
      return null;
    }
    return {
      storageClasses: relevant
        .filter((item) => item.kind === 'storage')
        .map((item) => item.name as StorageClass),
      qualifiers: relevant
        .filter((item) => item.kind === 'qualifier')
        .map((item) => item.name as TypeQualifier),
    };
  }

  infoForVariable(
    declarationRange: CodeRange,
    variableRange: CodeRange,
    firstVariableRange: CodeRange
  ): DeclarationSpecifierInfo | null {
    const declarationInfo = this.infoFor(declarationRange);
    const typedefInfo = this.typedefInfoFromRange(declarationRange);
    const spelling = this.typeSpellingBefore(
      this.offsetOf(firstVariableRange.begin.y, firstVariableRange.begin.x)
    );
    // A reduced type is a fact about this declaration on its own. `long long
    // a;` carries no storage class and no qualifier, so without this the
    // whole lookup returned null and the canvas fell back to the `long` the
    // engine was handed.
    if (declarationInfo === null && typedefInfo === null && spelling === null) {
      return null;
    }
    const declarationStart = this.offsetOf(
      declarationRange.begin.y,
      declarationRange.begin.x
    );
    const variableStart = this.offsetOf(
      variableRange.begin.y,
      variableRange.begin.x
    );
    const variableEnd = this.offsetOf(variableRange.end.y, variableRange.end.x);
    const firstVariableStart = this.offsetOf(
      firstVariableRange.begin.y,
      firstVariableRange.begin.x
    );
    const baseQualifiers: TypeQualifier[] = [];
    const pointerQualifiers: TypeQualifier[][] = [];
    const storageClasses: StorageClass[] = [];
    for (const occurrence of this.occurrences) {
      const isPrefix =
        occurrence.end <= declarationStart &&
        this.onlySpecifiersAndWhitespace(occurrence.end, declarationStart);
      const inBase =
        occurrence.start >= declarationStart &&
        occurrence.start < firstVariableStart;
      const inVariable =
        occurrence.start >= variableStart && occurrence.start <= variableEnd;
      if (!isPrefix && !inBase && !inVariable) {
        continue;
      }
      if (occurrence.kind === 'storage') {
        storageClasses.push(occurrence.name as StorageClass);
        continue;
      }
      const qualifier = occurrence.name as TypeQualifier;
      if (inVariable) {
        const stars = this.countStars(variableStart, occurrence.start);
        if (stars > 0) {
          while (pointerQualifiers.length < stars) {
            pointerQualifiers.push([]);
          }
          pointerQualifiers[stars - 1].push(qualifier);
          continue;
        }
      }
      baseQualifiers.push(qualifier);
    }
    if (typedefInfo !== null) {
      const typedefPointers = (typedefInfo.pointerQualifiers || []).map(
        (level) => level.slice()
      );
      if (typedefPointers.length > 0 && baseQualifiers.length > 0) {
        typedefPointers[typedefPointers.length - 1].push(...baseQualifiers);
        baseQualifiers.length = 0;
      }
      baseQualifiers.unshift(
        ...(typedefInfo.baseQualifiers || typedefInfo.qualifiers)
      );
      pointerQualifiers.unshift(...typedefPointers);
    }
    const info: DeclarationSpecifierInfo = {
      storageClasses: unique(storageClasses),
      qualifiers: unique(baseQualifiers.concat(...pointerQualifiers)),
      baseQualifiers: unique(baseQualifiers),
      pointerQualifiers: pointerQualifiers.map(unique),
    };
    if (spelling !== null) {
      info.declaredType = spelling;
    }
    return info;
  }

  /**
   * The type this declaration was written with, where the rewrite reduced it.
   *
   * Matched by looking back from the first declarator rather than by
   * containment: the sequence sits in front of the name, and the declaration
   * range unicoen reports does not always begin at the first specifier word.
   * The nearest one wins, and only across a gap naming nothing else - stars,
   * brackets and the words already blanked are all the declarator may put
   * between its type and its name.
   */
  private typeSpellingBefore(variableStart: number): string | null {
    for (let at = this.typeSpellings.length - 1; at >= 0; at -= 1) {
      const spelling = this.typeSpellings[at];
      if (spelling.end <= variableStart && this.namesNothing(spelling.end, variableStart)) {
        return spelling.text;
      }
    }
    return null;
  }

  /** Whether the gap between two offsets names anything of its own. */
  private namesNothing(start: number, end: number): boolean {
    const gap = this.source.slice(start, end).split('');
    for (const occurrence of this.occurrences) {
      if (occurrence.start < start || occurrence.end > end) {
        continue;
      }
      for (let at = occurrence.start; at < occurrence.end; at += 1) {
        gap[at - start] = ' ';
      }
    }
    return !/[A-Za-z0-9_]/.test(gap.join(''));
  }

  private offsetOf(line: number, column: number): number {
    const lineStart = this.lineStarts[Math.max(0, line - 1)];
    return typeof lineStart === 'undefined'
      ? this.source.length
      : lineStart + column;
  }

  private onlySpecifiersAndWhitespace(start: number, end: number): boolean {
    let cursor = start;
    for (const occurrence of this.occurrences) {
      if (occurrence.start < start || occurrence.end > end) {
        continue;
      }
      if (
        !this.isQualifierPunctuation(
          this.source.slice(cursor, occurrence.start)
        )
      ) {
        return false;
      }
      cursor = occurrence.end;
    }
    return this.isQualifierPunctuation(this.source.slice(cursor, end));
  }

  private isQualifierPunctuation(text: string): boolean {
    return text.replace(/[()]/g, '').trim() === '';
  }

  private countStars(start: number, end: number): number {
    return (this.source.slice(start, end).match(/\*/g) || []).length;
  }

  private readQualifiedTypedefs(masked: string): void {
    const pattern = /\btypedef\b/g;
    let found = pattern.exec(masked);
    while (found !== null) {
      const end = masked.indexOf(';', found.index + found[0].length);
      if (end === -1) {
        break;
      }
      const text = masked.slice(found.index, end);
      const aliasMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text);
      const alias = aliasMatch === null ? undefined : aliasMatch[1];
      const typeText =
        aliasMatch === null ? text : text.slice(0, aliasMatch.index);
      const baseQualifiers: TypeQualifier[] = [];
      const pointerQualifiers: TypeQualifier[][] = [];
      const tokenPattern = /\*|[A-Za-z_][A-Za-z0-9_]*/g;
      let pointerLevel = 0;
      let token = tokenPattern.exec(typeText);
      while (token !== null) {
        if (token[0] === '*') {
          pointerLevel += 1;
          pointerQualifiers.push([]);
        } else if (TYPE_QUALIFIERS.indexOf(token[0] as TypeQualifier) !== -1) {
          const qualifier = token[0] as TypeQualifier;
          if (pointerLevel === 0) {
            baseQualifiers.push(qualifier);
          } else {
            pointerQualifiers[pointerLevel - 1].push(qualifier);
          }
        }
        token = tokenPattern.exec(typeText);
      }
      if (
        typeof alias !== 'undefined' &&
        (baseQualifiers.length > 0 || pointerQualifiers.length > 0)
      ) {
        const qualifiers = unique(baseQualifiers.concat(...pointerQualifiers));
        this.typedefQualifiers.set(alias, {
          storageClasses: [],
          qualifiers,
          baseQualifiers,
          pointerQualifiers,
        });
      }
      pattern.lastIndex = end + 1;
      found = pattern.exec(masked);
    }
  }

  private typedefInfoFromRange(
    range: CodeRange
  ): DeclarationSpecifierInfo | null {
    const start = this.offsetOf(range.begin.y, range.begin.x);
    const end = this.offsetOf(range.end.y, range.end.x);
    const words = this.source
      .slice(start, end)
      .match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (words === null) {
      return null;
    }
    for (const word of words) {
      const info = this.typedefQualifiers.get(word);
      if (typeof info !== 'undefined') {
        return info;
      }
    }
    return null;
  }
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
