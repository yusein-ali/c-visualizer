import {
  columnAt,
  fit,
  IDENT_CHAR,
  IDENT_START,
  identifierEnd,
  isWholeIdentifier,
  lineAt,
  mask,
  matchBracket,
  matchParen,
  skipSpace,
} from './scan';

/**
 * Function pointers, done where the parser cannot destroy them.
 *
 * `int (*op)(int, int) = add;` never reaches the engine. unicoen.ts's mapper
 * has no case for a declarator whose name is wrapped in parentheses, so the
 * whole declaration collapses: the block body ends up holding the bare string
 * `"int"`, an empty `UniExpr` and the string `";"`. Execution then stops after
 * one step with no output, no syntax error and no exception - the same silent
 * death `enum` used to produce, and the worst way for a teaching tool to fail.
 *
 * What the engine can already do is the part that looks hard. A function name
 * evaluates to its `UniFunctionDec`, `Scope.setTop` files that on the code
 * segment exactly as it files the function itself, and `execMethoodCall`
 * dispatches on whatever the callee name resolves to. A variable holding a
 * function is therefore callable the moment its declaration survives parsing.
 * The declarator syntax is the whole obstacle.
 *
 * So this pass rewrites the syntax and keeps the meaning:
 *
 *     int (*op)(int, int) = add;   ->   _fp0 op             = add;
 *     int (*ops[2])(int, int)      ->   _fp0 ops[2]
 *     int apply(int (*f)(int, int) ->   int apply(_fp0 f
 *     typedef int (*BinOp)(int,int);    blanked; `BinOp` becomes `_fp0`
 *
 * `_fp0` is a type the parser has never heard of, which is exactly the point:
 * it maps to an ordinary `UniVariableDec`, and `CPP14Engine._execCast` leaves
 * a value of an unrecognised type alone instead of forcing it through
 * `new Int(...)`, which is what turns a function into `NaN`. The signature is
 * not thrown away - it is kept here and handed to the visualizer, which shows
 * `int (*)(int, int)` wherever the runtime says `_fp0`.
 *
 * Two call spellings need the source moved as well, because the mapper drops
 * them even though the grammar accepts them:
 *
 *     ops[1](7, 3)   ->   (*ops[1])(7, 3)
 *     o.fn(2, 3)     ->   (*o.fn)(2, 3)
 *
 * These are the only edits in the pass that do not preserve columns; each adds
 * three characters to its own line. Lines are never moved, so breakpoints and
 * error annotations are unaffected, and `columnShift` reports the drift so
 * editor tooltips can be mapped back onto what the student typed.
 *
 * Reads preprocessed source: macros expanded, directives gone.
 */

/** What the visualizer shows in place of a synthetic `_fpN` type. */
export interface RuntimeFunctionPointerInfo {
  /** The signature as written: `int (*)(int, int)`. */
  displayType: string;
  /** Return type and parameters kept apart, so `[2]` can go in the middle. */
  returnType: string;
  parameters: string;
  /** Stars in the declarator: 1 for `(*f)`, 2 for `(**f)`. */
  depth: number;
}

export interface RuntimeFunctionPointerTypes {
  [runtimeType: string]: RuntimeFunctionPointerInfo;
}

/** The words a function-pointer declaration may begin with. */
const TYPE_KEYWORDS = [
  'void',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'signed',
  'unsigned',
  '_Bool',
  '_Complex',
  'struct',
  'union',
  'enum',
];

interface Declarator {
  /** Index of the first character of the base type. */
  start: number;
  /** Index just past the parameter list's `)`. */
  end: number;
  runtimeType: string;
  /** Empty for an abstract declarator, as in a prototype or a cast. */
  name: string;
  /** `[2]` for an array of function pointers, otherwise empty. */
  arraySuffix: string;
  isTypedef: boolean;
}

/** A span the rewrite replaces, and what it becomes. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

export class FunctionPointerTable {
  private readonly info: RuntimeFunctionPointerTypes = {};
  private readonly declarators: Declarator[] = [];
  /** typedef alias to the synthetic type it stands for. */
  private readonly aliases = new Map<string, string>();
  /** Every name declared as a function pointer, for the call-site pass. */
  private readonly pointerNames = new Set<string>();
  private edits: Edit[] = [];
  /** Added columns per 1-based line, in the coordinates the parser sees. */
  private readonly shifts = new Map<number, Array<[number, number]>>();
  private nextTypeId = 0;

  /** Reads every function-pointer declaration and call out of the source. */
  read(code: string): this {
    const masked = mask(code);
    this.readDeclarators(code, masked, this.typeNamesIn(code, masked));
    this.edits = this.declaratorEdits(code)
      .concat(this.aliasEdits(code, masked))
      .concat(this.callEdits(code, masked));
    return this;
  }

  /** Reads the source and rewrites it in one step. */
  rewrite(code: string): string {
    return this.read(code).apply(code);
  }

  /**
   * Replays the recorded edits onto another copy of the same source.
   *
   * The passes either side of this one - `DeclarationSpecifiers`, `EnumTable`,
   * `DesignatedInitializers` - blank or pad in place rather than moving text,
   * so an offset read from one of their outputs is the same offset in every
   * other. That is what lets the record tables read the source with its
   * qualifiers intact while the parser is handed the rewritten copy.
   */
  apply(code: string): string {
    const ordered = this.edits.slice().sort((a, b) => b.start - a.start);
    let out = code;
    for (const edit of ordered) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return out;
  }

  /** What the visualizer should show for each synthetic `_fpN` type. */
  runtimeTypes(): RuntimeFunctionPointerTypes {
    return this.info;
  }

  /** True when this name was declared as a function pointer. */
  has(name: string): boolean {
    return this.pointerNames.has(name);
  }

  /**
   * The column a parsed position maps back to in the source the student typed.
   *
   * Only the two indirect call spellings move anything, so on most lines this
   * is the identity.
   */
  columnShift(line: number, column: number): number {
    const onLine = this.shifts.get(line);
    if (typeof onLine === 'undefined') {
      return column;
    }
    let shifted = column;
    for (const [at, width] of onLine) {
      if (column >= at) {
        shifted -= width;
      }
    }
    return Math.max(0, shifted);
  }

  /**
   * A declarator is only a declaration when it starts with a type. Without
   * that test `a * (*op)(1, 2)` reads exactly like one: parentheses, a star, a
   * name, an argument list. Collecting the typedef names first is what lets
   * `MyCallback (*f)(int)` be recognised alongside `int (*f)(int)`.
   */
  private typeNamesIn(code: string, masked: string): Set<string> {
    const names = new Set(TYPE_KEYWORDS);
    // Enum declarations have already become synthetic `_eN` types by now.
    for (const synthetic of masked.match(/\b_e\d+\b/g) || []) {
      names.add(synthetic);
    }
    let at = masked.indexOf('typedef');
    while (at !== -1) {
      if (isWholeIdentifier(masked, at, 'typedef'.length)) {
        const semicolon = statementEnd(masked, at);
        if (semicolon === -1) {
          break;
        }
        const alias = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
          code.slice(at, semicolon).replace(/\[[^\]]*\]\s*$/, '')
        );
        if (alias !== null) {
          names.add(alias[1]);
        }
      }
      at = masked.indexOf('typedef', at + 1);
    }
    return names;
  }

  private readDeclarators(
    code: string,
    masked: string,
    typeNames: Set<string>
  ): void {
    for (let i = 0; i < masked.length; i += 1) {
      if (masked[i] !== '(') {
        continue;
      }
      const parsed = this.parseDeclarator(code, masked, i, typeNames);
      if (parsed === null) {
        continue;
      }
      this.declarators.push(parsed);
      if (parsed.name === '') {
        continue;
      }
      if (parsed.isTypedef) {
        this.aliases.set(parsed.name, parsed.runtimeType);
      } else {
        this.pointerNames.add(parsed.name);
      }
      i = parsed.end - 1;
    }
  }

  /**
   * `<type> ( * name [n] ) ( params )`, or null when the parentheses at `open`
   * open something else entirely - a call, a grouping, a real parameter list.
   */
  private parseDeclarator(
    code: string,
    masked: string,
    open: number,
    typeNames: Set<string>
  ): Declarator | null {
    let cursor = skipSpace(masked, open + 1);
    let depth = 0;
    while (masked[cursor] === '*') {
      depth += 1;
      cursor = skipSpace(masked, cursor + 1);
    }
    if (depth === 0) {
      return null;
    }
    let name = '';
    if (IDENT_START.test(masked[cursor] || '')) {
      const nameEnd = identifierEnd(masked, cursor);
      name = code.slice(cursor, nameEnd);
      cursor = skipSpace(masked, nameEnd);
    }
    const suffixStart = cursor;
    while (masked[cursor] === '[') {
      const close = matchBracket(masked, cursor);
      if (close === -1) {
        return null;
      }
      cursor = skipSpace(masked, close + 1);
    }
    const arraySuffix = code.slice(suffixStart, cursor).replace(/\s+/g, '');
    if (matchParen(masked, open) !== cursor) {
      return null;
    }
    const paramsOpen = skipSpace(masked, cursor + 1);
    if (masked[paramsOpen] !== '(') {
      return null;
    }
    const paramsClose = matchParen(masked, paramsOpen);
    if (paramsClose === -1) {
      return null;
    }

    let start = open;
    while (start > 0 && /[A-Za-z0-9_*\s]/.test(masked[start - 1])) {
      start -= 1;
    }
    start = skipSpace(masked, start);
    let baseText = code.slice(start, open).trim();
    const isTypedef = /^typedef\b/.test(baseText);
    if (isTypedef) {
      baseText = baseText.replace(/^typedef\b/, '').trim();
    }
    const firstWord = /^[A-Za-z_][A-Za-z0-9_]*/.exec(baseText);
    if (firstWord === null || !typeNames.has(firstWord[0])) {
      return null;
    }

    const runtimeType = `_fp${this.nextTypeId}`;
    this.nextTypeId += 1;
    const returnType = normalizeSpace(baseText);
    const parameters = normalizeSpace(code.slice(paramsOpen + 1, paramsClose));
    const stars = '*'.repeat(depth);
    this.info[runtimeType] = {
      displayType: signatureOf(returnType, parameters, stars, ''),
      returnType,
      parameters,
      depth,
    };
    return {
      start,
      end: paramsClose + 1,
      runtimeType,
      name,
      arraySuffix,
      isTypedef,
    };
  }

  /**
   * Each declarator becomes `_fpN name[n]`, padded to the span it replaces so
   * every later column on the line stays where the student put it. A typedef
   * declares no object, so it goes entirely and its alias is substituted at
   * every use instead.
   */
  private declaratorEdits(code: string): Edit[] {
    return this.declarators.map((declarator) => {
      const original = code.slice(declarator.start, declarator.end);
      if (declarator.isTypedef) {
        return {
          start: declarator.start,
          end: declarator.end,
          text: original.replace(/[^\n]/g, ' '),
        };
      }
      const text = `${declarator.runtimeType} ${declarator.name}${declarator.arraySuffix}`;
      return {
        start: declarator.start,
        end: declarator.end,
        text: fit(text.trim(), original),
      };
    });
  }

  /** `BinOp op;` becomes `_fp0 op;`, and `op` joins the known names. */
  private aliasEdits(code: string, masked: string): Edit[] {
    const edits: Edit[] = [];
    if (this.aliases.size === 0) {
      return edits;
    }
    let i = 0;
    while (i < masked.length) {
      if (!IDENT_START.test(masked[i])) {
        i += 1;
        continue;
      }
      const end = identifierEnd(masked, i);
      const runtimeType = this.aliases.get(masked.slice(i, end));
      if (typeof runtimeType !== 'undefined' && !this.insideDeclarator(i)) {
        edits.push({
          start: i,
          end,
          text: fit(runtimeType, code.slice(i, end)),
        });
        const nameStart = skipSpace(masked, end);
        if (IDENT_START.test(masked[nameStart] || '')) {
          this.pointerNames.add(
            masked.slice(nameStart, identifierEnd(masked, nameStart))
          );
        }
      }
      i = end;
    }
    return edits;
  }

  /**
   * `ops[1](7, 3)` and `o.fn(2, 3)` parse, but the mapper builds no call from
   * either - the callee has to be a plain name or a parenthesized expression
   * for it to produce a `UniMethodCall`. Spelling them the way C programmers
   * did before the shorthand existed is enough, and it is the one edit here
   * that moves columns.
   */
  private callEdits(code: string, masked: string): Edit[] {
    const edits: Edit[] = [];
    const lineWidths = new Map<number, number>();
    let i = 0;
    while (i < masked.length) {
      if (
        !IDENT_START.test(masked[i]) ||
        (i > 0 && IDENT_CHAR.test(masked[i - 1]))
      ) {
        i += 1;
        continue;
      }
      const end = identifierEnd(masked, i);
      const postfix = this.postfixEnd(masked, end);
      if (
        postfix === null ||
        this.insideDeclarator(i) ||
        !this.namesPointer(masked, masked.slice(i, end), i, postfix)
      ) {
        i = end;
        continue;
      }
      const callOpen = skipSpace(masked, postfix);
      if (masked[callOpen] !== '(' || matchParen(masked, callOpen) === -1) {
        i = end;
        continue;
      }
      edits.push({
        start: i,
        end: postfix,
        text: `(*${code.slice(i, postfix)})`,
      });
      this.recordShift(code, lineWidths, i, postfix);
      i = callOpen;
    }
    return edits;
  }

  /**
   * Index just past a `[i]`, `.name` or `->name` chain, or null when the
   * identifier is followed by none of them - `op(2, 3)` already works and must
   * not be touched.
   */
  private postfixEnd(masked: string, from: number): number | null {
    let cursor = skipSpace(masked, from);
    let moved = false;
    for (;;) {
      if (masked[cursor] === '[') {
        const close = matchBracket(masked, cursor);
        if (close === -1) {
          return null;
        }
        cursor = skipSpace(masked, close + 1);
        moved = true;
        continue;
      }
      const arrow = masked.substr(cursor, 2) === '->';
      if (arrow || masked[cursor] === '.') {
        const nameStart = skipSpace(masked, cursor + (arrow ? 2 : 1));
        if (!IDENT_START.test(masked[nameStart] || '')) {
          return null;
        }
        cursor = skipSpace(masked, identifierEnd(masked, nameStart));
        moved = true;
        continue;
      }
      return moved ? cursor : null;
    }
  }

  /** The base name, or a member reached through it, has to be a pointer. */
  private namesPointer(
    masked: string,
    base: string,
    start: number,
    end: number
  ): boolean {
    if (this.pointerNames.has(base)) {
      return true;
    }
    const members = masked.slice(start, end).match(/[A-Za-z_][A-Za-z0-9_]*/g);
    return (members || []).some((member) => this.pointerNames.has(member));
  }

  /**
   * `(*` goes in at the callee, `)` just before the argument list, so columns
   * past the first move by two and columns past the second by three. Recorded
   * in the parser's coordinates, which is where a construct's column comes
   * from when it is handed back for correction.
   */
  private recordShift(
    code: string,
    lineWidths: Map<number, number>,
    start: number,
    end: number
  ): void {
    const line = lineAt(code, start);
    const prior = lineWidths.get(line) || 0;
    const onLine = this.shifts.get(line) || [];
    onLine.push([columnAt(code, start) + prior + 2, 2]);
    onLine.push([columnAt(code, end) + prior + 3, 1]);
    this.shifts.set(line, onLine);
    lineWidths.set(line, prior + 3);
  }

  private insideDeclarator(index: number): boolean {
    return this.declarators.some(
      (declarator) => declarator.start <= index && index < declarator.end
    );
  }
}

/** `int (*)(int, int)`, or `int (*[2])(int, int)` for an array of them. */
export function signatureOf(
  returnType: string,
  parameters: string,
  stars: string,
  arraySuffix: string
): string {
  const spacer = returnType.endsWith('*') ? '' : ' ';
  return `${returnType}${spacer}(${stars}${arraySuffix})(${parameters})`;
}

/**
 * The `;` that ends the statement starting at `from`, ignoring the ones inside
 * a record body: `typedef struct { int x; } P;` is named by its last semicolon,
 * not its first.
 */
function statementEnd(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    if (masked[i] === '{') {
      depth += 1;
    } else if (masked[i] === '}') {
      depth -= 1;
    } else if (masked[i] === ';' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function normalizeSpace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}
