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
  rangeCovers,
  rangeSpan,
  VariableModel,
} from '../core';
import { libraryHelp } from './libraryHelp';
import {
  expansionAt,
  HoverContext,
  HoverFact,
  HoverRecord,
} from '../ui/editor';

/**
 * What PLIVET says about a position in the source.
 *
 * This is the editor's hover provider, and nothing in it knows what editor it
 * is answering: it takes a row, a column and a word, and returns a record -
 * a headline and a list of facts. The knowledge is all on this side - what the
 * preprocessor did, what the parser saw, what a variable holds right now - so
 * replacing Ace with CodeMirror did not touch a line of it.
 *
 * Records rather than lines, because two surfaces read them. The tooltip sets
 * them as a small table and the canvas reads the same records for the
 * statement it is drawing, and neither has to parse the other's prose. A
 * record also carries the object it is about, which is what lets pointing at
 * a variable here light up its row on the canvas.
 *
 * All of it arrives as plain data. Reading a variable off the running engine
 * is `extractVariables` in `src/core`, which runs in the Worker; what is left
 * here is how to say it.
 */

const fact = (label: string, value: string, code = false): HoverFact =>
  code ? { label, value, code } : { label, value };

/** A sentence with no left-hand column: a note about the language itself. */
const note = (text: string): HoverFact => ({ label: text, value: '' });

export const formatVariableDeclaration = (
  declaration: VariableDeclarationDetail
): HoverFact[] => [
  fact(strings.declarationType, declaration.type, true),
  fact(
    strings.storageClass,
    declaration.storageClasses.join(', ') || strings.none
  ),
  fact(strings.qualifiers, declaration.qualifiers.join(', ') || strings.none),
  fact(strings.identifier, declaration.identifier, true),
  fact(
    strings.value,
    declaration.initialValue === null
      ? strings.uninitialized
      : declaration.initialValue,
    true
  ),
];

/**
 * A type declaration names a type; it does not declare an object with storage.
 * The last line takes the standard's own term for the name being introduced: a
 * typedef declarator defines a typedef name, while a record or enumeration
 * definition declares a tag.
 */
export const formatTypeDeclaration = (
  declaration: TypeDeclarationDetail
): HoverFact[] => [
  fact(strings.declarationType, declaration.type, true),
  fact(strings.qualifiers, declaration.qualifiers.join(', ') || strings.none),
  fact(stringFor(declaration.nameKind), declaration.name || strings.none, true),
];

/**
 * What an enumerator declares. The value is the point of it: nothing in
 * `enum Mode { OFF, ON = 4, FAULT }` tells a reader that FAULT is 5.
 */
export const formatEnumerator = (
  declaration: EnumeratorDetail
): HoverFact[] => [
  fact(strings.declarationType, declaration.type, true),
  fact(strings.enumeration, declaration.enumeration, true),
  fact(strings.identifier, declaration.identifier, true),
  fact(strings.value, String(declaration.value), true),
];

/** A structure or union member, described where its name is declared. */
export const formatRecordField = (
  declaration: RecordFieldDetail
): HoverFact[] => [
  fact(strings.declarationType, declaration.type, true),
  fact(strings.record, declaration.record, true),
  fact(strings.identifier, declaration.identifier, true),
];

/**
 * What a function declaration says, in the standard's own words: the type it
 * returns, the identifier it declares (6.9.1), and its parameters (3.16) - one
 * row each, named before the type it has, the way the declaration reads.
 * `void` in a parameter list declares no parameters, so it is reported as
 * none rather than as a parameter called nothing.
 */
export const formatFunctionDeclaration = (
  declaration: FunctionDeclarationDetail
): HoverFact[] => [
  fact(strings.returnType, declaration.returnType, true),
  fact(strings.identifier, declaration.identifier, true),
  ...(declaration.parameters.length === 0
    ? [fact(strings.parameters, strings.none)]
    : declaration.parameters.map((parameter) =>
        fact(
          strings.parameter,
          `${parameter.identifier}: ${parameter.type}`,
          true
        )
      )),
  fact(
    strings.storageClass,
    declaration.storageClasses.join(', ') || strings.none
  ),
  fact(
    strings.functionKind,
    declaration.isDefinition
      ? strings.functionDefinition
      : strings.functionPrototype
  ),
];

/** One clause, named the way the standard names it. */
const clauseFact = (clause: ConstructClause): HoverFact =>
  fact(stringFor(clause.label), clause.text, true);

/**
 * One thing a construct is doing at this step. A fact with no value is a
 * sentence on its own - control fell through, the `else` branch is the one
 * running - and one with a value reads as the clauses above do.
 */
const runtimeFact = (found: ConstructFactModel): HoverFact =>
  found.value === ''
    ? note(stringFor(found.label))
    : fact(stringFor(found.label), found.value, true);

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
      rangeCovers(evaluation.range, line, column) &&
      (found === null || rangeSpan(evaluation.range) < rangeSpan(found.range))
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
const jumpFact = (kind: string, enclosing: EnclosingConstruct): HoverFact => {
  const verb = kind === 'continue' ? strings.jumpRestarts : strings.jumpLeaves;
  const named = stringFor(
    `construct${enclosing.kind.charAt(0).toUpperCase()}${enclosing.kind.slice(1)}`
  );
  const what =
    typeof enclosing.name === 'undefined'
      ? named
      : `${named} ${enclosing.name}`;
  return fact(verb, `${what} ${strings.onLine} ${enclosing.line}`);
};

/** The name of a construct kind, as `strings.ts` spells it. */
const nameOfKind = (kind: string): string =>
  stringFor(`construct${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);

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
  describe = (context: HoverContext): HoverRecord | null => {
    const { row, column, word } = context;

    const variable = this.variableNamed(word);
    if (variable !== null) {
      return this.variableRecord(variable);
    }

    const expansion = expansionAt(this.expansions, row + 1, column);
    if (expansion !== null) {
      return this.expansionRecord(expansion);
    }

    const help = libraryHelp(word);
    if (help !== null) {
      return {
        title: word,
        facts: [
          fact(strings.signature, help.signature, true),
          note(help.description),
        ],
      };
    }

    const subexpression = this.subexpressionRecord(context);
    if (subexpression !== null) {
      return subexpression;
    }

    const construct = constructAt(this.constructs, row + 1, column);
    if (construct !== null) {
      return this.constructRecord(construct);
    }
    return null;
  };

  /**
   * What a pinned name holds, or a record saying that nothing of that name is
   * in the frame being executed. A watch that vanished when the program left
   * the function would leave the reader wondering whether they had unpinned
   * it by accident; one that says so is telling them about scope.
   */
  watchRecord(name: string): HoverRecord {
    const variable = this.variableNamed(name);
    return variable === null
      ? { title: name, facts: [note(strings.notInScope)] }
      : this.variableRecord(variable);
  }

  /**
   * The declaration of an object the canvas is pointing at, as the parser
   * recorded it. The canvas names an object by the key its cells carry, this
   * side knows which variable that is, and the constructs know where its
   * declarator is written - three facts, each held by whoever owns it.
   */
  declarationOf(object: string): Construct | null {
    const variable = this.variables.find((one) => one.key === object);
    if (typeof variable === 'undefined') {
      return null;
    }
    let found: Construct | null = null;
    const size = (construct: Construct) =>
      (construct.endLine - construct.line) * 1000 + construct.endColumn;
    for (const construct of this.constructs) {
      const declared = (construct.variableDeclarations ?? []).some(
        (declaration) => declaration.identifier === variable.name
      );
      if (declared && (found === null || size(construct) < size(found))) {
        found = construct;
      }
    }
    return found;
  }

  /**
   * The part of the current statement under the pointer, and what it came to.
   *
   * It is asked before the construct is, because it is the more specific
   * answer: hovering the `*` in `total = a * b + c` is a question about the
   * multiplication, not about the assignment that contains it. An operator is
   * worth something only once it has run, so this answers for the statement
   * the step just finished, and says nothing at all once the session stops.
   */
  private subexpressionRecord(context: HoverContext): HoverRecord | null {
    const found = innermostEvaluated(
      this.evaluations,
      context.row + 1,
      context.column
    );
    if (found === null) {
      return null;
    }
    const written = writtenAt(context, found.range);
    return written === ''
      ? null
      : { title: written, facts: [fact(strings.value, found.value, true)] };
  }

  private constructRecord(construct: Construct): HoverRecord {
    const name = nameOfKind(construct.kind);
    const declared = this.declarationFacts(construct);
    if (declared !== null) {
      return {
        title: name,
        facts: declared.concat(this.aroundFacts(construct)),
      };
    }
    return {
      title: construct.detail === '' ? name : `${name} — ${construct.detail}`,
      facts: this.aroundFacts(construct),
    };
  }

  /**
   * What a declaration says, where the construct is one. The five kinds
   * `outline.ts` records details for are the five that have more to say than
   * their own name; everything else is described by its clauses instead.
   */
  private declarationFacts(construct: Construct): HoverFact[] | null {
    if (
      construct.kind === 'variableDec' &&
      typeof construct.variableDeclarations !== 'undefined'
    ) {
      return construct.variableDeclarations.flatMap(formatVariableDeclaration);
    }
    if (
      construct.kind === 'enumerator' &&
      typeof construct.enumerator !== 'undefined'
    ) {
      return formatEnumerator(construct.enumerator);
    }
    if (
      construct.kind === 'recordField' &&
      typeof construct.recordField !== 'undefined'
    ) {
      return formatRecordField(construct.recordField);
    }
    if (
      construct.kind === 'functionDec' &&
      typeof construct.declaredFunction !== 'undefined'
    ) {
      return formatFunctionDeclaration(construct.declaredFunction);
    }
    if (
      construct.kind === 'typeDec' &&
      typeof construct.declaredTypes !== 'undefined'
    ) {
      return construct.declaredTypes.flatMap(formatTypeDeclaration);
    }
    return null;
  }

  /**
   * The clauses of a construct, what is always true of it, what it leaves,
   * and what it is doing right now. The static half always stands on its own;
   * the runtime half is there only while the run is on a step this construct
   * is part of.
   *
   * Hovering an `if` used to say "if statement", which the reader could
   * already see; control flow is where a beginner's model of C actually
   * breaks, so this is the half of the language that was left unexplained.
   */
  private aroundFacts(construct: Construct): HoverFact[] {
    const clauses = (construct.clauses ?? []).map(clauseFact);
    const notes = (construct.notes ?? []).map((key) => note(stringFor(key)));
    const enclosing = construct.enclosing;
    const said = clauses
      .concat(notes)
      .concat(
        typeof enclosing === 'undefined'
          ? []
          : [jumpFact(construct.kind, enclosing)]
      );
    return said.concat(this.runtimeFacts(construct));
  }

  /** What this construct is doing at this step, if it is doing anything. */
  private runtimeFacts(construct: Construct): HoverFact[] {
    const state = this.stateFor(construct);
    return state === null ? [] : state.facts.map(runtimeFact);
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

  /**
   * A variable, as the table the plan asked for: what it is, what it holds,
   * what it points at, and where it lives. It carries the object key too, so
   * the canvas lights up the row while the tooltip stands.
   */
  private variableRecord(variable: VariableModel): HoverRecord {
    const { target } = variable;
    const facts = [
      fact(strings.declarationType, variable.type, true),
      fact(strings.value, variable.value, true),
    ];
    if (typeof target !== 'undefined') {
      facts.push(
        fact(strings.pointsAt, `${target.name} = ${target.value}`, true)
      );
    }
    facts.push(fact(strings.atAddress, formatAddress(variable.address), true));
    return { title: variable.name, facts, object: variable.key };
  }

  /** One line of what happened, and one of why. */
  private expansionRecord(expansion: Expansion): HoverRecord {
    if (expansion.kind === 'excluded') {
      return {
        title: expansion.name,
        facts: [note(strings.excludedLine)],
      };
    }
    if (expansion.kind === 'directive') {
      return {
        title: `${expansion.name} ${expansion.text}`.trim(),
        facts:
          typeof expansion.taken === 'undefined'
            ? []
            : [
                note(
                  expansion.taken
                    ? strings.branchCompiled
                    : strings.branchSkipped
                ),
              ],
      };
    }
    // A macro defined in terms of another is two steps, and showing only the
    // end of the chain leaves the reader to unfold the middle by hand.
    const chain = [expansion.name, expansion.replacement, expansion.text]
      .filter((part) => typeof part !== 'undefined' && part !== '')
      .join(' → ');
    return {
      title: chain,
      facts:
        typeof expansion.definedAt === 'undefined'
          ? []
          : [fact(strings.definedOnLine, String(expansion.definedAt))],
    };
  }
}
