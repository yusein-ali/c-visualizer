import { Construct } from '../interpreter/Construct';
import { Expansion } from '../interpreter/Expansion';
import { DeclarationRequest } from '../ui/editor';

/**
 * Which declaration a name refers to.
 *
 * The constructs of the last syntax check are the whole of what this knows:
 * every declaration the parser saw, with where it is written. What it adds is
 * C's own rule for choosing between them, which is the part a reader cannot
 * do by searching - `grep` finds every `count` in the file, and only one of
 * them is the one this `count` means.
 *
 * The rule, in the order it is applied:
 *
 *   1. A name being called is a function: the definition if the program has
 *      one, the prototype otherwise. A body is what a reader asking about a
 *      call wants, and a prototype is where the linker would have sent them.
 *   2. Otherwise the nearest object declaration at or above the use, inside
 *      the function the use is in, and then at file scope. Nearest wins,
 *      which is what shadowing means in a file the parser has already read.
 *   3. Otherwise a function of that name - taking a function's address is not
 *      calling it - then a type name or tag, an enumeration constant, and
 *      last a structure member, which is the only one that is not a name in
 *      any scope at all.
 *
 * Blocks are deliberately not narrowed: the constructs record where a
 * declaration is, not where its block ends, so two locals of one name in two
 * blocks of one function resolve to the nearer one above the use, which is
 * right in every case except a use after the first block has closed.
 */

/** The innermost function definition covering a line, if any. */
const functionAt = (
  constructs: Construct[],
  line: number
): Construct | null => {
  let found: Construct | null = null;
  for (const construct of constructs) {
    if (
      construct.kind !== 'functionDec' ||
      typeof construct.declaredFunction === 'undefined' ||
      !construct.declaredFunction.isDefinition ||
      construct.line > line ||
      construct.endLine < line
    ) {
      continue;
    }
    if (found === null || construct.line > found.line) {
      found = construct;
    }
  }
  return found;
};

/**
 * The declaration of a variable that the use can see: at or above it, and in
 * the same function or at file scope. The nearest one wins.
 */
const objectFor = (
  constructs: Construct[],
  name: string,
  line: number
): Construct | null => {
  const enclosing = functionAt(constructs, line);
  let found: Construct | null = null;
  for (const construct of constructs) {
    if (construct.kind !== 'variableDec' || construct.line > line) {
      continue;
    }
    const declares = (construct.variableDeclarations ?? []).some(
      (declaration) => declaration.identifier === name
    );
    if (!declares) {
      continue;
    }
    const owner = functionAt(constructs, construct.line);
    if (owner !== null && owner !== enclosing) {
      continue;
    }
    // Two constructs are recorded per declaration - the statement and the
    // declarator inside it - and the declarator is the narrower one, which is
    // where the name is actually written.
    const narrower =
      found === null ||
      construct.line > found.line ||
      (construct.line === found.line && width(construct) < width(found));
    if (narrower) {
      found = construct;
    }
  }
  return found;
};

const width = (construct: Construct): number =>
  (construct.endLine - construct.line) * 1000 +
  (construct.endColumn - construct.column);

/** A parameter is declared by its function, so that is where a use goes. */
const parameterOwner = (
  constructs: Construct[],
  name: string,
  line: number
): Construct | null => {
  const enclosing = functionAt(constructs, line);
  if (enclosing === null) {
    return null;
  }
  const declared = (enclosing.declaredFunction?.parameters ?? []).some(
    (parameter) => parameter.identifier === name
  );
  return declared ? enclosing : null;
};

const functionFor = (
  constructs: Construct[],
  name: string
): Construct | null => {
  let prototype: Construct | null = null;
  for (const construct of constructs) {
    const declared = construct.declaredFunction;
    if (typeof declared === 'undefined' || declared.identifier !== name) {
      continue;
    }
    if (declared.isDefinition) {
      return construct;
    }
    if (prototype === null) {
      prototype = construct;
    }
  }
  return prototype;
};

const typeFor = (constructs: Construct[], name: string): Construct | null =>
  constructs.find((construct) =>
    (construct.declaredTypes ?? []).some((declared) => declared.name === name)
  ) ?? null;

const constantFor = (constructs: Construct[], name: string): Construct | null =>
  constructs.find((construct) => construct.enumerator?.identifier === name) ??
  null;

const memberFor = (constructs: Construct[], name: string): Construct | null =>
  constructs.find((construct) => construct.recordField?.identifier === name) ??
  null;

/**
 * The line of the `#define` a macro use came from, or null where the word is
 * not a macro use.
 *
 * Macros are the one name in the program the constructs cannot answer for.
 * The parser never sees them: by the time it reads the line, `LIMIT` is `100`
 * and the name is gone. What is left of it is the expansion record the
 * preprocessor kept, which names the macro and the line that defined it - so
 * the question is asked of that list instead, and answered with a line rather
 * than a construct.
 *
 * Two things are required of the record and not one. A function-like macro's
 * span covers its whole call, arguments and all, so a pointer over `a` in
 * `MAX(a, b)` falls inside the expansion without being the macro; only a word
 * that is the macro's name, starting where the expansion starts, is the name
 * the reader is pointing at.
 */
export function macroDefinitionLine(
  expansions: Expansion[],
  request: DeclarationRequest
): number | null {
  const { word, line, column } = request;
  if (word === '') {
    return null;
  }
  for (const expansion of expansions) {
    if (
      expansion.kind === 'macro' &&
      expansion.line === line &&
      expansion.column === column &&
      expansion.name === word &&
      typeof expansion.definedAt !== 'undefined'
    ) {
      return expansion.definedAt;
    }
  }
  return null;
}

/**
 * The declaration a use refers to, or null where the program declares no such
 * name - a library function, a macro (which `macroDefinitionLine` answers for
 * instead, the parser having never seen it), or a misspelling, none of which
 * this file has anywhere to go for.
 */
export function declarationFor(
  constructs: Construct[],
  request: DeclarationRequest
): Construct | null {
  const { word, line, isCall } = request;
  if (word === '') {
    return null;
  }
  if (isCall) {
    const called = functionFor(constructs, word);
    if (called !== null) {
      return called;
    }
  }
  return (
    objectFor(constructs, word, line) ??
    parameterOwner(constructs, word, line) ??
    functionFor(constructs, word) ??
    typeFor(constructs, word) ??
    constantFor(constructs, word) ??
    memberFor(constructs, word)
  );
}
