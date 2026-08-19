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
}

export type DeclarationSpecifierInfo = Omit<RuntimeDeclarationInfo, 'region'>;

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

/**
 * Retains declaration specifiers that unicoen.ts either discards or refuses
 * to map. Rewriting only blanks unsupported words, preserving every source
 * position so parser ranges and editor highlights remain aligned.
 */
export class DeclarationSpecifiers {
  private source = '';
  private lineStarts: number[] = [0];
  private occurrences: Occurrence[] = [];
  private readonly typedefQualifiers = new Map<
    string,
    DeclarationSpecifierInfo
  >();

  rewrite(code: string): string {
    this.source = code;
    this.lineStarts = [0];
    this.occurrences = [];
    this.typedefQualifiers.clear();
    for (let i = 0; i < code.length; i += 1) {
      if (code[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }

    const masked = mask(code);
    const chars = code.split('');
    let i = 0;
    while (i < masked.length) {
      if (!IDENT_START.test(masked[i])) {
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
        if (qualifier || word === 'auto' || word === '_Thread_local') {
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
      }
      i = end;
    }
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
    if (declarationInfo === null && typedefInfo === null) {
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
      const typedefPointers = (
        typedefInfo.pointerQualifiers || []
      ).map((level) => level.slice());
      if (typedefPointers.length > 0 && baseQualifiers.length > 0) {
        typedefPointers[typedefPointers.length - 1].push(...baseQualifiers);
        baseQualifiers.length = 0;
      }
      baseQualifiers.unshift(
        ...(typedefInfo.baseQualifiers || typedefInfo.qualifiers)
      );
      pointerQualifiers.unshift(...typedefPointers);
    }
    return {
      storageClasses: unique(storageClasses),
      qualifiers: unique(baseQualifiers.concat(...pointerQualifiers)),
      baseQualifiers: unique(baseQualifiers),
      pointerQualifiers: pointerQualifiers.map(unique),
    };
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
