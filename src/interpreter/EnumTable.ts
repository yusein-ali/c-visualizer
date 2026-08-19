import { Expansion } from './Expansion';
import { evaluateConstantExpression } from './preprocess';
import {
  columnAt,
  fit,
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
 * `enum` support, done where the parser cannot destroy it.
 *
 * unicoen.ts's grammar has an `enumspecifier` rule, but the mapper has no
 * `visitEnumspecifier`, so the whole declaration collapses into a type string -
 * `enum Color { RED, GREEN };` arrives as a `UniVariableDec` whose type is the
 * literal text `"enumColor{RED,GREEN}"` with no variables and no enumerators
 * bound anywhere. Nothing downstream can recover them. Using `RED` after that
 * ends the run with no output, no syntax error and no exception, which is the
 * worst way for a teaching tool to fail.
 *
 * So an enum is handled the way PLIVET already handles an object-like macro:
 * before the parser runs, every enumerator becomes the integer it stands for
 * and the declaration itself is blanked. That is what an enumerator is in C - a
 * named integer constant - so the substitution works in the places a `const int`
 * would not, `case` labels and array bounds among them, and it inherits the
 * editor's existing "what was this replaced with" tooltip for free.
 *
 * Lines are never moved, and columns are kept wherever the replacement fits in
 * the space the original took, so the highlight and the breakpoints stay put.
 *
 * Reads preprocessed source: macros expanded, directives gone.
 */

export interface Enumerator {
  name: string;
  value: number;
  /** 1-based line the enumerator was declared on. */
  line: number;
  /** 0-based column the name starts at, for the editor to explain it there. */
  column: number;
  /** The tag it belongs to; empty for an enum written without one. */
  tag: string;
  /** The enumeration it belongs to, as a reader should see it named. */
  enumeration: string;
}

/** Enum information retained for the execution-state visualizer. */
export interface RuntimeEnumInfo {
  /** What students should see in the type column. */
  displayType: string;
  /** Enumerator names indexed by their numeric value. */
  namesByValue: { [value: string]: string[] };
}

export interface RuntimeEnumTypes {
  [runtimeType: string]: RuntimeEnumInfo;
}

interface EnumDeclaration {
  start: number;
  /** Index just after the closing brace. */
  end: number;
  runtimeType: string;
  isTypedef: boolean;
}

/** A span of the source the rewrite replaces, and what it becomes. */
interface Edit {
  start: number;
  end: number;
  text: string;
  expansion: Expansion | null;
}

export class EnumTable {
  private readonly constants = new Map<string, Enumerator>();
  private readonly tags = new Set<string>();
  private readonly runtimeByTag = new Map<string, string>();
  private readonly runtimeInfo: RuntimeEnumTypes = {};
  private nextTypeId = 0;
  /** Spans of `enum ... { ... }` declarations, to leave alone when rewriting. */
  private readonly declarations: EnumDeclaration[] = [];

  /** Reads every enum declaration out of the source. */
  read(code: string): this {
    const masked = mask(code);
    let i = 0;
    while (i < masked.length) {
      const at = masked.indexOf('enum', i);
      if (at === -1) {
        break;
      }
      i = at + 4;
      if (!isWholeIdentifier(masked, at, 4)) {
        continue;
      }
      let cursor = skipSpace(masked, at + 4);
      let tag = '';
      if (cursor < masked.length && IDENT_START.test(masked[cursor])) {
        const end = identifierEnd(masked, cursor);
        tag = masked.slice(cursor, end);
        cursor = skipSpace(masked, end);
      }
      if (masked[cursor] !== '{') {
        continue; // `enum Color c;` names a type, it does not declare one
      }
      const close = matchBrace(masked, cursor);
      if (close === -1) {
        continue;
      }
      if (tag !== '') {
        this.tags.add(tag);
      }
      const semicolon = masked.indexOf(';', close + 1);
      const trailing = masked.slice(
        close + 1,
        semicolon === -1 ? close + 1 : semicolon
      );
      const isTypedef = precededByTypedef(masked, at);
      const aliases = isTypedef ? declaratorNames(trailing) : [];
      // C keeps "anonymous" for an unnamed member of a struct or union; an
      // enum written without a tag is just that - unless a typedef gave the
      // reader a name for it, which is the name they will recognise.
      const displayType =
        tag !== ''
          ? `enum ${tag}`
          : aliases.length === 0
          ? 'enum without a tag'
          : aliases[0];
      const enumerators = this.readEnumerators(
        masked.slice(cursor + 1, close),
        code.slice(cursor + 1, close),
        cursor + 1,
        tag,
        displayType,
        code
      );
      const runtimeType = this.runtimeType(tag, masked);
      this.addRuntimeInfo(runtimeType, displayType, enumerators);
      for (const alias of aliases) {
        this.addRuntimeInfo(alias, `${alias} (enum)`, enumerators);
      }
      this.declarations.push({
        start: at,
        end: close + 1,
        runtimeType,
        isTypedef,
      });
      i = close + 1;
    }
    this.readAliasUses(masked);
    return this;
  }

  has(name: string): boolean {
    return this.constants.has(name);
  }

  valueOf(name: string): number | null {
    const found = this.constants.get(name);
    return found === undefined ? null : found.value;
  }

  names(): string[] {
    return Array.from(this.constants.keys());
  }

  /** Every enumeration constant declared, in the order they were read. */
  declaredConstants(): Enumerator[] {
    return Array.from(this.constants.values());
  }

  tagNames(): string[] {
    return Array.from(this.tags);
  }

  /** Plain enum metadata safe to retain on an execution-state snapshot. */
  runtimeTypes(): RuntimeEnumTypes {
    return this.runtimeInfo;
  }

  /**
   * The source with enums resolved, plus what was replaced where in the
   * original, for the editor to mark and explain.
   */
  rewrite(code: string): { code: string; expansions: Expansion[] } {
    this.read(code);
    const masked = mask(code);
    const edits = this.declarationEdits(code, masked)
      .concat(this.typeUseEdits(code, masked))
      .concat(this.constantEdits(code, masked));
    return applyEdits(code, edits);
  }

  /**
   * Blanks each declaration. One that declares variables keeps them and becomes
   * a synthetic enum-typed declaration; a typedef keeps `int` as its underlying
   * type. A declaration of only the tag goes entirely.
   */
  private declarationEdits(code: string, masked: string): Edit[] {
    const edits: Edit[] = [];
    for (const declaration of this.declarations) {
      const { start, end } = declaration;
      const semicolon = masked.indexOf(';', end);
      const trailing = masked.slice(end, semicolon === -1 ? end : semicolon);
      const declaresVariables = trailing.trim() !== '';
      if (declaresVariables) {
        edits.push({
          start,
          end,
          text: fit(
            declaration.isTypedef ? 'int' : declaration.runtimeType,
            code.slice(start, end)
          ),
          expansion: null,
        });
      } else {
        const stop = semicolon === -1 ? end : semicolon + 1;
        edits.push({
          start,
          end: stop,
          text: code.slice(start, stop).replace(/[^\n]/g, ' '),
          expansion: null,
        });
      }
    }
    return edits;
  }

  /** `enum Color c;` becomes `_e0 c;`, retaining identity for visualization. */
  private typeUseEdits(code: string, masked: string): Edit[] {
    const edits: Edit[] = [];
    let i = 0;
    while (i < masked.length) {
      const at = masked.indexOf('enum', i);
      if (at === -1) {
        break;
      }
      i = at + 4;
      if (!isWholeIdentifier(masked, at, 4) || this.insideDeclaration(at)) {
        continue;
      }
      const tagStart = skipSpace(masked, at + 4);
      let cursor = tagStart;
      if (cursor >= masked.length || !IDENT_START.test(masked[cursor])) {
        continue;
      }
      const end = identifierEnd(masked, cursor);
      cursor = skipSpace(masked, end);
      if (masked[cursor] === '{') {
        continue; // a declaration, already handled
      }
      if (masked[cursor] === ';') {
        // `enum Color;` declares nothing the engine needs; drop the statement.
        edits.push({
          start: at,
          end: cursor + 1,
          text: code.slice(at, cursor + 1).replace(/[^\n]/g, ' '),
          expansion: null,
        });
        i = cursor + 1;
        continue;
      }
      const tag = masked.slice(tagStart, end);
      const runtimeType = this.runtimeByTag.get(tag);
      edits.push({
        start: at,
        end,
        text: fit(
          runtimeType === undefined ? 'int' : runtimeType,
          code.slice(at, end)
        ),
        expansion: null,
      });
      i = end;
    }
    return edits;
  }

  /** Every use of an enumerator becomes the integer it stands for. */
  private constantEdits(code: string, masked: string): Edit[] {
    const edits: Edit[] = [];
    let i = 0;
    while (i < masked.length) {
      if (!IDENT_START.test(masked[i])) {
        i += 1;
        continue;
      }
      const end = identifierEnd(masked, i);
      const name = masked.slice(i, end);
      const constant = this.constants.get(name);
      if (
        constant !== undefined &&
        !this.insideDeclaration(i) &&
        isWholeIdentifier(masked, i, name.length) &&
        !isMemberName(masked, i)
      ) {
        const text = String(constant.value);
        edits.push({
          start: i,
          end,
          text: fit(text, code.slice(i, end)),
          expansion: {
            kind: 'enum',
            line: lineAt(code, i),
            column: columnAt(code, i),
            length: name.length,
            name,
            text,
            definedAt: constant.line,
          },
        });
      }
      i = end;
    }
    return edits;
  }

  private insideDeclaration(index: number): boolean {
    return this.declarations.some(
      ({ start, end }) => start <= index && index < end
    );
  }

  /**
   * `RED, GREEN = 5, BLUE` - an enumerator without a value is one more than the
   * one before it, counting from zero.
   */
  private readEnumerators(
    maskedBody: string,
    codeBody: string,
    offset: number,
    tag: string,
    enumeration: string,
    code: string
  ): Enumerator[] {
    const enumerators: Enumerator[] = [];
    let next = 0;
    let at = 0;
    // Split on the mask so a comma inside `','` does not end an enumerator,
    // but read the value out of the source: the mask has blanked the literal.
    for (const part of splitTopLevel(maskedBody, ',')) {
      const text = codeBody.slice(at, at + part.length);
      const equals = part.indexOf('=');
      const nameText = (equals === -1 ? part : part.slice(0, equals)).trim();
      if (nameText !== '' && IDENT_START.test(nameText[0])) {
        const value =
          equals === -1 ? next : this.evaluate(text.slice(equals + 1), next);
        const declaredAt = offset + at + part.indexOf(nameText);
        const enumerator = {
          name: nameText,
          value,
          line: lineAt(code, declaredAt),
          column: columnAt(code, declaredAt),
          tag,
          enumeration,
        };
        this.constants.set(nameText, enumerator);
        enumerators.push(enumerator);
        next = value + 1;
      }
      at += part.length + 1;
    }
    return enumerators;
  }

  private runtimeType(tag: string, masked: string): string {
    if (tag !== '') {
      const existing = this.runtimeByTag.get(tag);
      if (existing !== undefined) {
        return existing;
      }
    }
    let candidate = '';
    do {
      candidate = `_e${this.nextTypeId}`;
      this.nextTypeId += 1;
    } while (new RegExp(`\\b${candidate}\\b`).test(masked));
    if (tag !== '') {
      this.runtimeByTag.set(tag, candidate);
    }
    return candidate;
  }

  private addRuntimeInfo(
    runtimeType: string,
    displayType: string,
    enumerators: Enumerator[]
  ): void {
    const namesByValue: { [value: string]: string[] } = {};
    for (const enumerator of enumerators) {
      const value = String(enumerator.value);
      if (typeof namesByValue[value] === 'undefined') {
        namesByValue[value] = [];
      }
      namesByValue[value].push(enumerator.name);
    }
    this.runtimeInfo[runtimeType] = { displayType, namesByValue };
  }

  /** `typedef const enum Color Shade;` aliases an already declared tag. */
  private readAliasUses(masked: string): void {
    const pattern = /\btypedef\b([^;]*?)\benum\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*;/g;
    let match = pattern.exec(masked);
    while (match !== null) {
      const runtimeType = this.runtimeByTag.get(match[2]);
      const sourceInfo =
        runtimeType === undefined ? undefined : this.runtimeInfo[runtimeType];
      if (sourceInfo !== undefined) {
        this.runtimeInfo[match[3]] = {
          displayType: `${match[3]} (enum)`,
          namesByValue: sourceInfo.namesByValue,
        };
      }
      match = pattern.exec(masked);
    }
  }

  /**
   * An explicit value. Enumerators already read are substituted first, so
   * `enum { A = 1, B = A + 1 }` works; anything else still unresolved is zero,
   * which is what the same evaluator does for `#if`.
   */
  private evaluate(expression: string, fallback: number): number {
    let text = expression.replace(/'(\\.|[^'\\])'/g, (_, char: string) =>
      String(charCode(char))
    );
    for (const [name, constant] of this.constants) {
      text = text.replace(
        new RegExp(`\\b${name}\\b`, 'g'),
        String(constant.value)
      );
    }
    try {
      const value = evaluateConstantExpression(text);
      return isNaN(value) ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }
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

/** Declarator names after an enum body, used only for typedef aliases. */
function declaratorNames(text: string): string[] {
  return splitTopLevel(text, ',')
    .map((part) => /[A-Za-z_][A-Za-z0-9_]*/.exec(part.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[0]);
}

/** The code point a character literal's body stands for. */
function charCode(body: string): number {
  if (body[0] !== '\\') {
    return body.charCodeAt(0);
  }
  const escapes: { [key: string]: number | undefined } = {
    '0': 0,
    n: 10,
    r: 13,
    t: 9,
    '\\': 92,
    "'": 39,
  };
  const found = escapes[body[1]];
  return found === undefined ? body.charCodeAt(1) : found;
}

/**
 * True when the identifier at `index` is the member half of `s.RED` or
 * `s->RED`, where it names a field and not the enumerator.
 */
function isMemberName(masked: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(masked[i])) {
    i -= 1;
  }
  if (i < 0) {
    return false;
  }
  if (masked[i] === '.') {
    return true;
  }
  return masked[i] === '>' && i > 0 && masked[i - 1] === '-';
}

/** Applies edits right to left, so earlier offsets stay valid. */
function applyEdits(
  code: string,
  edits: Edit[]
): { code: string; expansions: Expansion[] } {
  const ordered = edits.slice().sort((a, b) => b.start - a.start);
  let out = code;
  const expansions: Expansion[] = [];
  for (const edit of ordered) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    if (edit.expansion !== null) {
      expansions.push(edit.expansion);
    }
  }
  expansions.reverse();
  return { code: out, expansions };
}
