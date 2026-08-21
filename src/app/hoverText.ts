import strings, { stringFor } from '../strings';
import { Expansion } from '../interpreter/Expansion';
import {
  Construct,
  ConstructClause,
  constructAt,
  EnclosingConstruct,
  EnumeratorDetail,
  FunctionDeclarationDetail,
  RecordFieldDetail,
  TypeDeclarationDetail,
  VariableDeclarationDetail,
} from '../interpreter/Construct';
import {
  CodeRangeModel,
  ConstructFactModel,
  ConstructStateModel,
  EvaluationModel,
  StepModel,
  formatAddress,
  VariableModel,
} from '../core';
import { libraryHelp } from './libraryHelp';
import { expansionAt, HoverContext } from '../ui/editor';

/**
 * What PLIVET says about a position in the source.
 *
 * This is the editor's hover provider, and nothing in it knows what editor it
 * is answering: it takes a row, a column and a word, and returns plain text.
 * The knowledge is all on this side - what the preprocessor did, what the
 * parser saw, what a variable holds right now - so replacing Ace with
 * CodeMirror did not touch a line of it.
 *
 * All of it arrives as plain data. Reading a variable off the running engine
 * is `extractVariables` in `src/core`, which runs in the Worker; what is left
 * here is how to say it.
 */

export const formatVariableDeclaration = (
  declaration: VariableDeclarationDetail
): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.storageClass}: ${
      declaration.storageClasses.join(', ') || strings.none
    }`,
    `${strings.qualifiers}: ${
      declaration.qualifiers.join(', ') || strings.none
    }`,
    `${strings.identifier}: ${declaration.identifier}`,
    `${strings.value}: ${
      declaration.initialValue === null
        ? strings.uninitialized
        : declaration.initialValue
    }`,
  ].join('\n');

/**
 * A type declaration names a type; it does not declare an object with storage.
 * The last line takes the standard's own term for the name being introduced: a
 * typedef declarator defines a typedef name, while a record or enumeration
 * definition declares a tag.
 */
export const formatTypeDeclaration = (
  declaration: TypeDeclarationDetail
): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.qualifiers}: ${
      declaration.qualifiers.join(', ') || strings.none
    }`,
    `${stringFor(declaration.nameKind)}: ${declaration.name || strings.none}`,
  ].join('\n');

/**
 * What an enumerator declares. The value is the point of it: nothing in
 * `enum Mode { OFF, ON = 4, FAULT }` tells a reader that FAULT is 5.
 */
export const formatEnumerator = (declaration: EnumeratorDetail): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.enumeration}: ${declaration.enumeration}`,
    `${strings.identifier}: ${declaration.identifier}`,
    `${strings.value}: ${declaration.value}`,
  ].join('\n');

/** A structure or union member, described where its name is declared. */
export const formatRecordField = (declaration: RecordFieldDetail): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.record}: ${declaration.record}`,
    `${strings.identifier}: ${declaration.identifier}`,
  ].join('\n');

/**
 * What a function declaration says, in the standard's own words: the type it
 * returns, the identifier it declares (6.9.1), and its parameters (3.16) - one
 * per line, each named before the type it has, the way the declaration reads.
 * `void` in a parameter list declares no parameters, so it is reported as
 * none rather than as a parameter called nothing.
 */
export const formatFunctionDeclaration = (
  declaration: FunctionDeclarationDetail
): string =>
  [
    `${strings.returnType}: ${declaration.returnType}`,
    `${strings.identifier}: ${declaration.identifier}`,
    declaration.parameters.length === 0
      ? `${strings.parameters}: ${strings.none}`
      : [`${strings.parameters}:`]
          .concat(
            declaration.parameters.map(
              (parameter) => `  ${parameter.identifier}: ${parameter.type}`
            )
          )
          .join('\n'),
    `${strings.storageClass}: ${
      declaration.storageClasses.join(', ') || strings.none
    }`,
    `${strings.functionKind}: ${
      declaration.isDefinition
        ? strings.functionDefinition
        : strings.functionPrototype
    }`,
  ].join('\n');

/** One clause, named the way the standard names it. */
const clauseText = (clause: ConstructClause): string =>
  `${stringFor(clause.label)}: ${clause.text}`;

/**
 * One thing a construct is doing at this step. A fact with no value is a
 * sentence on its own - control fell through, the `else` branch is the one
 * running - and one with a value reads as the clauses above do.
 */
const factText = (fact: ConstructFactModel): string =>
  fact.value === ''
    ? stringFor(fact.label)
    : `${stringFor(fact.label)}: ${fact.value}`;

/**
 * Whether a position falls inside an expression's range.
 *
 * The end column of an expression is one past its last character - `n * 2` in
 * `return n * 2;` ends at the semicolon's column - so the comparison is strict
 * at that end and the trailing punctuation stays outside the expression.
 */
const covers = (range: CodeRangeModel, line: number, column: number): boolean =>
  (range.begin.y < line ||
    (range.begin.y === line && range.begin.x <= column)) &&
  (line < range.end.y || (range.end.y === line && column < range.end.x));

/** How many characters a range covers, for choosing the smallest. */
const span = (range: CodeRangeModel): number =>
  (range.end.y - range.begin.y) * 1000 + (range.end.x - range.begin.x);

/**
 * The innermost part of the statement under the pointer that produced a value.
 *
 * This is the same rule `constructAt` uses one level up - the smallest thing
 * that covers the position - because the question a reader asks by pointing at
 * an operator is about that operator, not about the statement around it.
 */
const innermostEvaluated = (
  evaluations: EvaluationModel[],
  line: number,
  column: number
): EvaluationModel | null => {
  let found: EvaluationModel | null = null;
  for (const evaluation of evaluations) {
    if (
      covers(evaluation.range, line, column) &&
      (found === null || span(evaluation.range) < span(found.range))
    ) {
      found = evaluation;
    }
  }
  return found;
};

/**
 * The subexpression as the reader wrote it, which says what an operator alone
 * cannot: `a * b` rather than `*`. Only a span on one line is read back, which
 * is every subexpression a reader points at and none of the statements that
 * wrap.
 */
const writtenAt = (context: HoverContext, range: CodeRangeModel): string => {
  const { begin, end } = range;
  if (begin.y !== end.y || context.state.doc.lines < begin.y) {
    return '';
  }
  return context.state.doc.line(begin.y).text.slice(begin.x, end.x).trim();
};

/**
 * Where a jump goes. `continue` restarts the loop it names; `break` and
 * `return` leave what they name, and which construct that is is exactly what a
 * reader cannot see - a `break` inside a `switch` inside a loop leaves the
 * switch.
 */
const jumpText = (kind: string, enclosing: EnclosingConstruct): string => {
  const verb = kind === 'continue' ? strings.jumpRestarts : strings.jumpLeaves;
  const named = stringFor(
    `construct${enclosing.kind.charAt(0).toUpperCase()}${enclosing.kind.slice(1)}`
  );
  const what =
    typeof enclosing.name === 'undefined'
      ? named
      : `${named} ${enclosing.name}`;
  return `${verb}: ${what} ${strings.onLine} ${enclosing.line}`;
};

export class HoverTextSource {
  private expansions: Expansion[] = [];
  private constructs: Construct[] = [];
  private variables: VariableModel[] = [];
  private constructStates: ConstructStateModel[] = [];
  private evaluations: EvaluationModel[] = [];

  setExpansions(expansions: Expansion[]): void {
    this.expansions = expansions;
  }

  setConstructs(constructs: Construct[]): void {
    this.constructs = constructs;
  }

  /**
   * The step as it stands, which is what a reader wants while stepping: what
   * each variable holds, what the constructs around the marker are doing, and
   * what the parts of the statement just finished came to. A stopped session
   * sends an empty model, and that is what takes every runtime line back off
   * again - a tooltip shows the last run's values to nobody.
   */
  setStep(model: StepModel): void {
    this.variables = model.variables;
    this.constructStates = model.constructStates;
    this.evaluations = model.evaluations;
  }

  /**
   * What to say about the position under the cursor, most specific first: the
   * value a variable holds right now, then what the preprocessor did there,
   * then the library function being called, then the construct the parser saw.
   */
  text = (context: HoverContext): string | null => {
    const { row, column, word } = context;

    const variable = this.variableNamed(word);
    if (variable !== null) {
      return this.variableText(variable);
    }

    const expansion = expansionAt(this.expansions, row + 1, column);
    if (expansion !== null) {
      return this.expansionText(expansion);
    }

    const help = libraryHelp(word);
    if (help !== null) {
      return `${help.signature}\n${help.description}`;
    }

    const subexpression = this.subexpressionText(context);
    if (subexpression !== null) {
      return subexpression;
    }

    const construct = constructAt(this.constructs, row + 1, column);
    if (construct !== null) {
      return this.constructText(construct);
    }
    return null;
  };

  /**
   * The part of the current statement under the pointer, and what it came to.
   *
   * It is asked before the construct is, because it is the more specific
   * answer: hovering the `*` in `total = a * b + c` is a question about the
   * multiplication, not about the assignment that contains it. An operator is
   * worth something only once it has run, so this answers for the statement
   * the step just finished, and says nothing at all once the session stops.
   */
  private subexpressionText(context: HoverContext): string | null {
    const found = innermostEvaluated(
      this.evaluations,
      context.row + 1,
      context.column
    );
    if (found === null) {
      return null;
    }
    const written = writtenAt(context, found.range);
    return written === '' ? null : `${written} = ${found.value}`;
  }

  private constructText(construct: Construct): string {
    const name = stringFor(
      `construct${construct.kind.charAt(0).toUpperCase()}${construct.kind.slice(
        1
      )}`
    );
    if (
      construct.kind === 'variableDec' &&
      typeof construct.variableDeclarations !== 'undefined'
    ) {
      const declarations = construct.variableDeclarations.map((declaration) =>
        formatVariableDeclaration(declaration)
      );
      return this.assemble(`${name}\n${declarations.join('\n\n')}`, construct);
    }
    if (
      construct.kind === 'enumerator' &&
      typeof construct.enumerator !== 'undefined'
    ) {
      return this.assemble(
        `${name}\n${formatEnumerator(construct.enumerator)}`,
        construct
      );
    }
    if (
      construct.kind === 'recordField' &&
      typeof construct.recordField !== 'undefined'
    ) {
      return this.assemble(
        `${name}\n${formatRecordField(construct.recordField)}`,
        construct
      );
    }
    if (
      construct.kind === 'functionDec' &&
      typeof construct.declaredFunction !== 'undefined'
    ) {
      return this.assemble(
        `${name}\n${formatFunctionDeclaration(construct.declaredFunction)}`,
        construct
      );
    }
    if (
      construct.kind === 'typeDec' &&
      typeof construct.declaredTypes !== 'undefined'
    ) {
      const declared = construct.declaredTypes.map((declaration) =>
        formatTypeDeclaration(declaration)
      );
      return this.assemble(`${name}\n${declared.join('\n\n')}`, construct);
    }
    const described =
      construct.detail === '' ? name : `${name} — ${construct.detail}`;
    return this.assemble(described, construct);
  }

  /**
   * A description, the clauses under it, and what the construct is doing right
   * now under those. The static half always stands on its own; the runtime
   * half is there only while the run is on a step this construct is part of.
   */
  private assemble(described: string, construct: Construct): string {
    return [
      described,
      ...this.constructParts(construct),
      ...this.runtimeParts(construct),
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  /**
   * The clauses of a construct, what is always true of it, and what it leaves,
   * under the line that names it. Hovering an `if` used to say "if statement",
   * which the reader could already see; control flow is where a beginner's
   * model of C actually breaks, so this is the half of the language that was
   * left unexplained.
   */
  private constructParts(construct: Construct): string[] {
    const clauses = (construct.clauses ?? []).map(clauseText);
    const notes = (construct.notes ?? []).map(stringFor);
    const enclosing = construct.enclosing;
    const said = clauses.concat(notes);
    return typeof enclosing === 'undefined'
      ? said
      : said.concat(jumpText(construct.kind, enclosing));
  }

  /** What this construct is doing at this step, if it is doing anything. */
  private runtimeParts(construct: Construct): string[] {
    const state = this.stateFor(construct);
    return state === null ? [] : state.facts.map(factText);
  }

  /**
   * The record of this construct at this step, found by where it is written.
   * The most recent match wins: a function that called itself has one record
   * per call, and the reader is asking about the innermost - or about the one
   * that has just returned, which is the newer record of the two.
   */
  private stateFor(construct: Construct): ConstructStateModel | null {
    for (let i = this.constructStates.length - 1; 0 <= i; i -= 1) {
      const state = this.constructStates[i];
      if (
        state.kind === construct.kind &&
        state.range.begin.y === construct.line &&
        state.range.begin.x === construct.column
      ) {
        return state;
      }
    }
    return null;
  }

  /**
   * The variable of that name in the innermost frame that has one. The frames
   * arrive outermost first, so the last match is the innermost.
   */
  private variableNamed(name: string): VariableModel | null {
    if (name === '') {
      return null;
    }
    for (let i = this.variables.length - 1; 0 <= i; i -= 1) {
      if (this.variables[i].name === name) {
        return this.variables[i];
      }
    }
    return null;
  }

  private variableText(variable: VariableModel): string {
    const { target } = variable;
    const points =
      target === undefined ? '' : ` → ${target.name} = ${target.value}`;
    return (
      `${variable.name} : ${variable.type} = ${variable.value}${points}\n` +
      `${strings.atAddress} ${formatAddress(variable.address)}`
    );
  }

  /** One line of what happened, and one of why. */
  private expansionText(expansion: Expansion): string {
    if (expansion.kind === 'excluded') {
      return `${expansion.name}: ${strings.excludedLine}`;
    }
    if (expansion.kind === 'directive') {
      const head = `${expansion.name} ${expansion.text}`.trim();
      if (typeof expansion.taken === 'undefined') {
        return head;
      }
      return `${head}\n${
        expansion.taken ? strings.branchCompiled : strings.branchSkipped
      }`;
    }
    // A macro defined in terms of another is two steps, and showing only the
    // end of the chain leaves the reader to unfold the middle by hand.
    const head = [expansion.name, expansion.replacement, expansion.text]
      .filter((part) => typeof part !== 'undefined' && part !== '')
      .join(' → ');
    return typeof expansion.definedAt === 'undefined'
      ? head
      : `${head}\n${strings.definedOnLine} ${expansion.definedAt}`;
  }
}
