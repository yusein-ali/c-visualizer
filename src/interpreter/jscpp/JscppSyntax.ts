import { IDENT_CHAR, IDENT_START, mask } from '../scan';
import strings from '../../strings';
import { PegNode, PegSyntaxError } from './ast.generated';
import * as parser from './ast.generated';

/**
 * Whether PLIVET accepts a program as C, decided by the PEG grammar vendored
 * from JSCPP rather than by unicoen's ANTLR parser.
 *
 * ANTLR is a recovering parser, and a debugger wants the opposite of recovery.
 * Three of its habits cost PLIVET real accuracy:
 *
 * - It stays silent on `int a` with no semicolon, recovering the declaration
 *   and executing it. `AstValidator.ts` existed to read that back out of the
 *   tree, from the enclosing block's brace, because the token's own position
 *   was already gone.
 * - It reports cascades. One unbalanced parenthesis produced three errors, two
 *   of them on lines the reader had not touched.
 * - It rejects `case 1:` followed directly by `case 2:`, which is C. A syntax
 *   error refuses the run, so empty fallthrough could not be stepped at all.
 *
 * The PEG grammar has no recovery: it stops at the first token that cannot
 * continue a valid parse and hands back that exact position. That is one
 * error rather than a list, which is the trade this makes deliberately - the
 * cascades were not extra information, they were noise with wrong lines on it.
 *
 * It is also the whole of what PLIVET borrows from JSCPP. The interpreter,
 * JSCPP's own preprocessor and its `includes/` library are never constructed;
 * unicoen still parses, still builds the tree, and still executes it.
 */
export interface JscppSyntaxError {
  line: number;
  /** Zero-based, the convention `SyntaxErrorData` reports in. */
  column: number;
  message: string;
}

/**
 * A program the grammar accepts and a compiler would still complain about.
 *
 * Kept apart from the error above because the difference decides whether the
 * reader may run the program. `int x volatile;` is a parse failure and clang
 * refuses it; `int volatile register;` is a constraint violation clang only
 * warns about, and the program runs correctly. Refusing that one would be
 * stricter than a compiler for no gain.
 */
export interface JscppWarning extends JscppSyntaxError {
  rule: string;
  endLine: number;
  endColumn: number;
}

/** Grammar plumbing PEG.js lists as an alternative but no reader would type. */
const PLUMBING = new Set(['/*', '//', '\\U', '\\u']);

/** The delimiters worth naming in a message when the grammar expects one. */
const SEPARATORS = [';', ',', ')', ']', '}'];

const CLOSERS = new Set([')', ']', '}']);

/** A line with any trailing `//` comment and trailing space removed. */
const statementText = (line: string): string =>
  line.replace(/\/\/.*$/, '').trimEnd();

/** A line the parser would have read as finished, or as continuing. */
const TERMINATED = /[;{}:,=+\-*/%<>&|^!?~[(\\]$/;

/** All that stands before the colon of a labelled statement: one name. */
const LABEL = /^[A-Za-z_]\w*$/;

/**
 * The whole token at `offset`, not the single character PEG.js reports.
 *
 * `found` is one character wide, so an unexpected `int` arrives as `"i"` and a
 * message built from it reads `unexpected 'i'`. Widening it to the identifier,
 * number or operator the reader actually typed is the difference between a
 * message they can act on and one they have to decode.
 */
const tokenAt = (text: string, offset: number): string => {
  const first = text[offset];
  if (typeof first === 'undefined') {
    return '';
  }
  if (IDENT_START.test(first)) {
    let end = offset;
    while (end < text.length && IDENT_CHAR.test(text[end])) {
      end += 1;
    }
    return text.slice(offset, end);
  }
  if (/[0-9]/.test(first)) {
    let end = offset;
    while (end < text.length && /[0-9a-fA-FxX.]/.test(text[end])) {
      end += 1;
    }
    return text.slice(offset, end);
  }
  return first;
};

/** The last line before `line` that carries code, or null if there is none. */
const previousCodeLine = (
  lines: string[],
  line: number
): { line: number; text: string } | null => {
  for (let candidate = line - 1; candidate >= 1; candidate -= 1) {
    const text = statementText(lines[candidate - 1] ?? '');
    if (text.trim() !== '' && !text.trim().startsWith('#')) {
      return { line: candidate, text };
    }
  }
  return null;
};

/**
 * The line holding the `{` that nothing closes.
 *
 * Read from the masked source so a brace inside a string or a comment does not
 * count, and reported as the opening line rather than as end of file: the
 * reader has to go to the block that was left open, and end of file is never
 * where the mistake is.
 */
const unclosedBrace = (code: string): number | null => {
  const masked = mask(code);
  const open: number[] = [];
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === '{') {
      open.push(i);
    } else if (masked[i] === '}') {
      open.pop();
    }
  }
  if (open.length === 0) {
    return null;
  }
  return code.slice(0, open[0]).split(/\r?\n/).length;
};

/** The delimiters the grammar would have accepted here, in reading order. */
const expectedSeparators = (error: PegSyntaxError): string[] => {
  const literals = new Set(
    error.expected
      .filter((item) => item.type === 'literal' && !PLUMBING.has(item.value!))
      .map((item) => item.value!)
  );
  return SEPARATORS.filter((separator) => literals.has(separator));
};

const quoted = (items: string[]): string =>
  items.length === 1
    ? `'${items[0]}'`
    : `${items
        .slice(0, -1)
        .map((item) => `'${item}'`)
        .join(', ')} or '${items[items.length - 1]}'`;

/**
 * Where the reader has to edit, and what to tell them, from one PEG failure.
 *
 * The position PEG.js reports is the first token that could not continue the
 * parse, which is the right mark for a token that should not be there and the
 * wrong one for a token that is merely missing: a forgotten semicolon fails on
 * the *next* statement, a line or more further down. Rule 3 below is the only
 * one that moves the mark, and it moves it to where the semicolon goes.
 */
const describe = (
  error: PegSyntaxError,
  code: string,
  source: string
): JscppSyntaxError => {
  const { line, column, offset } = error.location.start;
  const lines = source.split(/\r?\n/);
  const at = (message: string): JscppSyntaxError => ({
    line,
    column: column - 1,
    message,
  });

  // 1. End of input. Whatever is unclosed, the mark belongs on the opening.
  if (error.found === null) {
    const opened = unclosedBrace(code);
    if (opened !== null) {
      const text = statementText(lines[opened - 1] ?? '');
      return {
        line: opened,
        column: Math.max(0, text.length - 1),
        message: "expected '}' to close this block",
      };
    }
    return at('unexpected end of file');
  }

  const token = tokenAt(code, offset) || error.found;
  const separators = expectedSeparators(error);

  // 2. A closing delimiter with nothing open. Naming what the grammar wanted
  //    instead would send the reader to the wrong end of the problem.
  if (CLOSERS.has(token) && !separators.includes(token)) {
    return at(`unexpected '${token}'`);
  }

  const before = statementText((lines[line - 1] ?? '').slice(0, column - 1));

  // 3. A labelled statement. The grammar has no rule for one, and adding a
  //    rule would be the wrong repair: unicoen's interpreter cannot execute a
  //    label either - a function holding one stops at it, printing what came
  //    before and nothing after, saying nothing. Named for what it is, rather
  //    than as the missing punctuation the grammar happened to be looking
  //    for, which sent the reader to correct a line that was already right.
  if (token === ':' && LABEL.test(before.trim())) {
    return {
      line,
      // The label itself, not the colon the parse stopped on. The reader has
      // to remove the whole statement, and it begins at the name.
      column: before.length - before.trimStart().length,
      message: strings.labelUnsupported,
    };
  }

  // 4. Nothing on the right of an assignment.
  if (before.endsWith('=') && !before.endsWith('==')) {
    return at("expected an expression after '='");
  }

  // 5. The forgotten semicolon: the parse ran on into a later line, and the
  //    last line carrying code did not finish. The mark goes at the end of
  //    that line, where the semicolon is missing, not on the statement that
  //    tripped over it.
  const previous = previousCodeLine(lines, line);
  if (
    before.trim() === '' &&
    separators.includes(';') &&
    previous !== null &&
    !TERMINATED.test(previous.text.trim())
  ) {
    return {
      line: previous.line,
      column: previous.text.length,
      message: "expected ';' after this statement",
    };
  }

  // 6. A delimiter the grammar names and the reader did not type.
  if (separators.length > 0 && separators.length <= 3) {
    return at(`expected ${quoted(separators)} before '${token}'`);
  }

  return at(`unexpected '${token}'`);
};

/**
 * How many times one type specifier may appear in a single declaration.
 * `long long` is the only one C lets a reader write twice.
 */
const SPECIFIER_LIMIT: Record<string, number> = {
  void: 1,
  char: 1,
  short: 1,
  int: 1,
  long: 2,
  float: 1,
  double: 1,
  signed: 1,
  unsigned: 1,
  _Bool: 1,
  _Complex: 1,
};

/** At most one of these names a declaration's base type. */
const BASE_TYPES = ['void', 'char', 'int', 'float', 'double', '_Bool'];

/** Pairs C never allows together. */
const EXCLUSIVE: [string, string][] = [
  ['signed', 'unsigned'],
  ['short', 'long'],
];

/**
 * The words that say where an object is kept rather than what it is.
 *
 * C allows a declaration at most one of them - 6.7.1 constraint 2 - and both
 * clang and gcc refuse a second one outright. `typedef` is the fifth, and is
 * counted by `specifierFault`'s caller rather than listed here: the grammar
 * takes it in a rule of its own, so it is never one of the strings a
 * `DeclarationSpecifiers` list holds. `_Thread_local`, which C does let stand
 * beside `static` or `extern`, is not in the grammar at all, so the exception
 * has nothing here to except.
 */
const STORAGE_CLASSES = ['extern', 'static', 'auto', 'register'];

/** The storage classes one specifier list names, in the order it names them. */
const storageClasses = (specifiers: unknown[]): string[] =>
  specifiers.filter(
    (item): item is string =>
      typeof item === 'string' && STORAGE_CLASSES.indexOf(item) !== -1
  );

/**
 * Whether a declaration's type specifiers could describe a type.
 *
 * The grammar has to accept a repeated specifier - `unsigned long int` is
 * three of them - so a half-typed `int` on its own line is not a parse error:
 * it merges with the declaration under it and reads as `int auto int
 * automatic`. C rejects that, and rejects it for a reason a reader recognises,
 * so the check runs over the specifier list the parse already produced rather
 * than over the source.
 *
 * Only combinations that are certainly wrong are reported. A syntax error
 * refuses the run, and refusing a valid program is far worse than missing an
 * invalid one, so anything this cannot be sure about - a typedef name beside a
 * keyword, a specifier the grammar returned as an object - is left alone.
 */
const invalidSpecifiers = (specifiers: unknown[]): boolean => {
  const keywords = specifiers.filter(
    (item): item is string =>
      typeof item === 'string' && item in SPECIFIER_LIMIT
  );
  const count = (name: string): number =>
    keywords.filter((item) => item === name).length;
  if (keywords.some((name) => count(name) > SPECIFIER_LIMIT[name])) {
    return true;
  }
  if (BASE_TYPES.filter((name) => count(name) > 0).length > 1) {
    return true;
  }
  return EXCLUSIVE.some(([a, b]) => count(a) > 0 && count(b) > 0);
};

/** What one declaration's specifiers get wrong, and the word that says so. */
interface SpecifierFault {
  message: string;
  /** The word to point the reader at, where there is one worth naming. */
  token: string | null;
}

/**
 * The two ways a specifier list cannot describe an object, or null where it
 * can describe one.
 *
 * `classes` is the storage classes the list names, passed in rather than read
 * here because `typedef` is one of them and only the caller knows the node it
 * came from. Two different ones is the case worth reporting: C allows a
 * declaration at most one, and every compiler refuses a second - `static
 * extern int x;` is `cannot combine with previous 'static' declaration
 * specifier` from clang and `multiple storage classes in declaration
 * specifiers` from gcc.
 *
 * The same word written twice is deliberately not a fault. clang warns about
 * `static static int x;` and compiles it, so it is reported by
 * `duplicateStorageClasses` as a warning instead: a syntax error refuses the
 * run, and refusing a program a compiler accepts is the worse mistake.
 */
const specifierFault = (
  specifiers: unknown[],
  classes: string[]
): SpecifierFault | null => {
  if (invalidSpecifiers(specifiers)) {
    return {
      message: 'this declaration names more than one type',
      token: null,
    };
  }
  for (let at = 1; at < classes.length; at += 1) {
    if (classes.slice(0, at).every((name) => name === classes[at])) {
      continue;
    }
    return {
      message: `cannot combine '${classes[at]}' with previous '${
        classes[at - 1]
      }'`,
      token: classes[at],
    };
  }
  return null;
};

/**
 * The column of one specifier word on the line the declaration begins on, or
 * null where that line does not name it.
 *
 * The grammar returns its specifiers as bare strings, so the position has to
 * come back from the source. A declaration spread over several lines may name
 * the word on none of them; the caller then falls back to the indent, which is
 * where every other specifier fault is already reported.
 */
const specifierColumn = (text: string, token: string): number | null => {
  const found = new RegExp(`\\b${token}\\b`).exec(text);
  return found === null ? null : found.index;
};

/** The first line a declarator is named on, or null if the tree has none. */
const declaratorLine = (node: PegNode): number | null => {
  let found: number | null = null;
  const visit = (value: unknown): void => {
    if (found !== null || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as PegNode;
    if (record.type === 'Identifier' && typeof record.sLine === 'number') {
      found = record.sLine;
      return;
    }
    Object.entries(record).forEach(([field, item]) => {
      if (field !== 'DeclarationSpecifiers') {
        visit(item);
      }
    });
  };
  visit(node.InitDeclaratorList ?? node.Declarators ?? node.Declarator);
  return found;
};

/**
 * The first declaration in the tree whose specifiers cannot describe a type.
 *
 * Reported as a missing semicolon where the shape says so - the specifiers
 * began on one line and the name arrived on a later one, and the first line
 * was never finished - because that is what the reader has actually done.
 */
const specifierError = (
  tree: PegNode,
  source: string
): JscppSyntaxError | null => {
  const lines = source.split(/\r?\n/);
  let error: JscppSyntaxError | null = null;
  const visit = (value: unknown): void => {
    if (error !== null || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as PegNode;
    const fault = Array.isArray(node.DeclarationSpecifiers)
      ? specifierFault(
          node.DeclarationSpecifiers,
          // `typedef` is a storage class like the other four, and the grammar
          // has already eaten it: a `TypedefDeclaration` is the node it built
          // from it, so the word is in its type and not in its specifier list.
          // Without putting it back, `typedef static int T;` - which clang
          // refuses - read as a declaration naming one storage class.
          (node.type === 'TypedefDeclaration' ? ['typedef'] : []).concat(
            storageClasses(node.DeclarationSpecifiers)
          )
        )
      : null;
    if (fault !== null && typeof node.sLine === 'number') {
      const line = node.sLine;
      const text = statementText(lines[line - 1] ?? '');
      const named = declaratorLine(node);
      const indent = Math.max(0, text.length - text.trimStart().length);
      const column =
        fault.token === null ? null : specifierColumn(text, fault.token);
      error =
        fault.token === null &&
        named !== null &&
        named > line &&
        !TERMINATED.test(text.trim())
          ? {
              line,
              column: text.length,
              message: "expected ';' after this statement",
            }
          : {
              line,
              column: column ?? indent,
              message: fault.message,
            };
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(tree);
  return error;
};

/**
 * `>>=`, which unicoen's mapper drops on the floor.
 *
 * Its C++14 grammar splits `>>` so that nested template arguments close, and
 * the compound assignment does not survive it: `y >>= 1` maps to the two
 * halves `y` and `1` as separate statements, with no operator between them.
 * The shift then never happens and nothing says so - `y` keeps its old value
 * and the program runs on to a wrong answer, which is worse than stopping.
 *
 * `<<=` maps correctly and is left alone. Read from the source because the
 * grammar parses `>>=` perfectly well; it is only the tree behind it that
 * loses the operator.
 */
const unsupportedShiftAssign = (
  code: string,
  source: string
): JscppSyntaxError | null => {
  const at = mask(code).indexOf('>>=');
  if (at === -1) {
    return null;
  }
  const before = source.slice(0, at).split(/\r?\n/);
  return {
    line: before.length,
    column: before[before.length - 1].length,
    message: strings.shiftAssignUnsupported,
  };
};

/**
 * A `goto`, which the grammar reads and the interpreter cannot run.
 *
 * The label it jumps to is refused by rule 3 of `describe`, so a complete
 * `goto` is normally reported there. This is the other half: a `goto` whose
 * label is missing, or written in another function, reaches a clean parse and
 * would then have been stepped - unicoen stops at the jump, printing what came
 * before it and nothing after, with no diagnostic of any kind. Refusing it
 * here is the difference between a reader being told and a reader guessing.
 */
const unsupportedGoto = (tree: PegNode): JscppSyntaxError | null => {
  let error: JscppSyntaxError | null = null;
  const visit = (value: unknown): void => {
    if (error !== null || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as PegNode;
    if (node.type === 'JumpStatement_goto' && typeof node.sLine === 'number') {
      error = {
        line: node.sLine,
        column: Math.max(0, (node.sColumn ?? 1) - 1),
        message: strings.gotoUnsupported,
      };
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(tree);
  return error;
};

/**
 * Character constants holding no character: `printf('')`.
 *
 * C requires a character constant to contain at least one c-char, and the
 * grammar does not: `Char*` accepts `''` and returns a node with an empty
 * `Char` list. Nothing behind the grammar refuses it either. ANTLR's *lexer*
 * cannot tokenize `''` at all, drops it with a token recognition error that
 * goes to `console.error` and no listener, and the statement built from the
 * debris is not executable - the stepper reached end of file on the first
 * step, printing nothing and saying nothing. Reading the empty list back off
 * the tree is what puts a line on it.
 *
 * `'ab'` is deliberately not reported. A multi-character constant is
 * implementation-defined rather than invalid, and clang compiles it.
 */
const emptyCharacterConstant = (tree: PegNode): JscppSyntaxError | null => {
  let error: JscppSyntaxError | null = null;
  const visit = (value: unknown): void => {
    if (error !== null || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as PegNode;
    if (
      node.type === 'CharacterConstant' &&
      Array.isArray(node.Char) &&
      node.Char.length === 0 &&
      typeof node.sLine === 'number'
    ) {
      error = {
        line: node.sLine,
        column: Math.max(0, (node.sColumn ?? 1) - 1),
        message: 'empty character constant',
      };
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(tree);
  return error;
};

/** Whichever of two failures the reader meets first reading down the file. */
const earlier = (
  a: JscppSyntaxError | null,
  b: JscppSyntaxError | null
): JscppSyntaxError | null => {
  if (a === null || b === null) {
    return a ?? b;
  }
  if (a.line !== b.line) {
    return a.line < b.line ? a : b;
  }
  return a.column <= b.column ? a : b;
};

/**
 * Declarations that declare nothing: `int;`, `int volatile register;`.
 *
 * C requires a declaration to declare a declarator, a tag, or the members of
 * an enumeration, and clang reports exactly this as `declaration does not
 * declare anything`. The grammar cannot refuse it - `InitDeclaratorList` is
 * genuinely optional, because `struct S { int a; };` needs it to be - so the
 * shape is read back off the tree instead.
 *
 * A tag declaration is the case that must not be reported, and it is what
 * separates the two: a struct, union or enum specifier comes back from the
 * grammar as a nested array, where every plain keyword comes back as a string.
 * A declaration whose specifiers are all strings and whose declarator list is
 * empty has named a type and then done nothing with it.
 */
const emptyDeclarations = (tree: PegNode, source: string): JscppWarning[] => {
  const lines = source.split(/\r?\n/);
  const warnings: JscppWarning[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as PegNode;
    const declarators = node.InitDeclaratorList;
    if (
      node.type === 'Declaration' &&
      Array.isArray(node.DeclarationSpecifiers) &&
      typeof node.sLine === 'number' &&
      (declarators === null ||
        (Array.isArray(declarators) && declarators.length === 0)) &&
      node.DeclarationSpecifiers.every((item) => typeof item === 'string')
    ) {
      const line = node.sLine;
      const text = statementText(lines[line - 1] ?? '');
      warnings.push({
        rule: 'empty-declaration',
        line,
        column: Math.max(0, text.length - text.trimStart().length),
        endLine: line,
        endColumn: text.length,
        message:
          'This declaration declares nothing. It names a type and then no ' +
          'object, so nothing is brought into being by it.',
      });
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(tree);
  return warnings;
};

/** Where the second of two identical specifier words sits on its line. */
const repeatedColumn = (text: string, token: string): number | null => {
  const pattern = new RegExp(`\\b${token}\\b`, 'g');
  const first = pattern.exec(text);
  const second = first === null ? null : pattern.exec(text);
  return second === null ? null : second.index;
};

/**
 * A storage class written twice: `static static int x;`.
 *
 * A warning rather than an error, because that is what a compiler makes of
 * it - clang says `duplicate 'static' declaration specifier` and builds the
 * program, where two *different* classes stop the build and are reported by
 * `specifierFault`. The object is kept exactly where the single word would
 * have kept it, so nothing about the run changes; the reader is told because
 * a repeated keyword is usually a half-finished edit.
 */
const duplicateStorageClasses = (
  tree: PegNode,
  source: string
): JscppWarning[] => {
  const lines = source.split(/\r?\n/);
  const warnings: JscppWarning[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as PegNode;
    const classes = Array.isArray(node.DeclarationSpecifiers)
      ? storageClasses(node.DeclarationSpecifiers)
      : [];
    // Every word the same: a list naming two different ones is the error
    // above, and must not also be reported here.
    const repeated =
      classes.length > 1 && classes.every((name) => name === classes[0]);
    if (repeated && typeof node.sLine === 'number') {
      const line = node.sLine;
      const text = statementText(lines[line - 1] ?? '');
      const at = repeatedColumn(text, classes[0]);
      const column = at ?? Math.max(0, text.length - text.trimStart().length);
      warnings.push({
        rule: 'duplicate-storage-class',
        line,
        column,
        endLine: line,
        endColumn:
          at === null
            ? text.length
            : Math.min(text.length, at + classes[0].length),
        message:
          `This declaration says ${classes[0]} twice. The second one adds ` +
          'nothing to the first, and a compiler warns about it.',
      });
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(tree);
  return warnings;
};

/** What one reading of a translation unit found. */
export interface JscppCheck {
  /** The first thing that stops the program compiling, if there is one. */
  error: JscppSyntaxError | null;
  /** What compiles but a compiler would still say something about. */
  warnings: JscppWarning[];
}

/**
 * Read one translation unit.
 *
 * `code` is `prepare()`'s `checkCode` - preprocessed, with only the rewrites
 * this grammar genuinely needs - and `source` is what the reader typed, used
 * for the message text. Both pad in place, so a line number and a column mean
 * the same thing in either.
 *
 * A parse failure ends the reading: everything after it would be guesswork
 * about a program whose shape is not known.
 */
export const jscppCheck = (code: string, source: string = code): JscppCheck => {
  let tree: PegNode;
  try {
    tree = parser.parse(code);
  } catch (thrown) {
    const error = thrown as Partial<PegSyntaxError>;
    // Anything without a position is a fault in the checker, not in the
    // program. Refusing to run a valid program is the worse failure, so an
    // unrecognisable throw is reported as no error at all.
    if (
      typeof error.location?.start?.line !== 'number' ||
      !Array.isArray(error.expected)
    ) {
      return { error: null, warnings: [] };
    }
    return {
      error: describe(error as PegSyntaxError, code, source),
      warnings: [],
    };
  }
  return {
    error: earlier(
      earlier(specifierError(tree, source), emptyCharacterConstant(tree)),
      earlier(unsupportedGoto(tree), unsupportedShiftAssign(code, source))
    ),
    warnings: emptyDeclarations(tree, source).concat(
      duplicateStorageClasses(tree, source)
    ),
  };
};

/** The error alone, for callers with nowhere to put a warning. */
export const jscppSyntaxError = (
  code: string,
  source: string = code
): JscppSyntaxError | null => jscppCheck(code, source).error;
