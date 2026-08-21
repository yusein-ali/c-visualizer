import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniDoWhile } from 'unicoen.ts/dist/node/UniDoWhile';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniReturn } from 'unicoen.ts/dist/node/UniReturn';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import { ASSIGNMENT, expressionValue } from './ExpressionTrace';
import type {
  CodeRangeModel,
  ConstructFactModel,
  ConstructStateModel,
  EvaluationModel,
} from '../core/model';

/**
 * What each construct is doing while the program runs.
 *
 * `outline.ts` says what a construct *is* - the clauses it is made of, the
 * loop a `break` leaves - and that description is true whether or not anything
 * is running. This is the other half: the value the controlling expression
 * evaluated to, which branch was taken, how many iterations have begun, what a
 * call was passed and what it gave back. Both halves reach the tooltip, and
 * item 13's explanation reads the same records rather than computing a second
 * description of the same construct.
 *
 * Nothing here walks the interpreter's objects from the outside. The engine
 * drives the recorder as it executes - `begins`/`yields` around every
 * expression, `entered`/`leftAt` around every construct that has a body - and
 * what comes out is plain data on the `ExecState`, which is the only thing
 * that crosses to the main thread (constraint 6).
 *
 * ## Which step a fact belongs to
 *
 * Two kinds of record end up in one snapshot:
 *
 * - The constructs the step is **inside**: the loops, the `switch`, the `if`
 *   and the calls whose bodies contain the statement about to run. These are
 *   live, and their counters go on climbing as the run continues.
 * - The constructs that **just finished** - the call that returned, the
 *   assignment that landed - recorded since the previous stop. The step marker
 *   has already moved past them, which is exactly why they are worth showing:
 *   there is no stop at which a `return` has produced its value and the
 *   statement is still the current one.
 *
 * Both are cleared at every stop, so a tooltip never shows a value from a step
 * the reader has left, and a stopped session shows none at all.
 */

interface StateWithConstructs extends ExecState {
  plivetConstructs?: ConstructStateModel[];
  plivetEvaluations?: EvaluationModel[];
}

/**
 * The expressions worth reporting a value for. A name is answered by the
 * variable it denotes and a literal answers itself; what a reader cannot
 * recover by looking is what an operator, a call or a conversion produced.
 */
const evaluates = (expression: object): boolean =>
  expression instanceof UniBinOp ||
  expression instanceof UniUnaryOp ||
  expression instanceof UniMethodCall ||
  expression instanceof UniCast ||
  expression instanceof UniTernaryOp;

/**
 * What the value of an expression means for the construct that asked for it.
 * A node carries one marker per construct interested in it, because one node
 * can be two things at once: the condition of a `while` and a call in its own
 * right.
 */
interface Marker {
  /** The construct node this says something about. */
  owner: object;
  /** Its kind, the same key `Construct.kind` uses. */
  kind: string;
  role:
    | 'condition'
    | 'body'
    | 'then'
    | 'else'
    | 'case'
    | 'argument'
    | 'result'
    | 'source'
    | 'returned'
    | 'trueArm'
    | 'falseArm'
    | 'assigned';
  /** Which argument this is, for `argument`. */
  index?: number;
  /** Which label this statement belongs to, for `case`. */
  label?: string;
}

/** One construct, and what has happened to it so far. */
interface Activation {
  node: object;
  kind: string;
  range: CodeRangeModel;
  condition?: string;
  /** `factBranchThen` or `factBranchElse`, once a branch has run. */
  branch?: string;
  iterations?: number;
  label?: string;
  /** The labels whose statements have run, for detecting fall-through. */
  labels: string[];
  /** Argument values, by position, spelled with the parameter they fill. */
  args: string[];
  parameters: string[];
  result?: string;
  /** What a cast was handed, before it converted it. */
  source?: string;
  /** What an assignment's target held before the assignment. */
  before?: string;
  timesEntered?: number;
  /** The function this call entered, so an argument reaches both. */
  callee?: Activation;
}

/**
 * How many finished constructs are kept between two stops. A statement
 * finishes a handful; the cap is there so that a run which somehow gets
 * between stops without finishing one cannot grow the list without end.
 */
const FINISHED_LIMIT = 32;

/**
 * How many evaluated subexpressions are kept between two stops. One statement
 * has a handful; the cap bounds what a statement built out of a hundred
 * operators could put on a step.
 */
const EVALUATION_LIMIT = 64;

/** The roles that describe an expression starting rather than finishing. */
const BEFORE: Marker['role'][] = [
  'body',
  'then',
  'else',
  'trueArm',
  'falseArm',
  'case',
  'assigned',
];

const rangeOf = (node: any): CodeRangeModel | null => {
  const range = node === null ? null : node.codeRange;
  if (!range || !range.begin || !range.end) {
    return null;
  }
  return {
    begin: { x: range.begin.x, y: range.begin.y },
    end: { x: range.end.x, y: range.end.y },
  };
};

/**
 * The parameters a function declares, in order. `execFunc` strips the stars
 * off a pointer parameter's name before binding it, and the name a reader sees
 * in the body is the stripped one.
 */
const parameterNames = (declaration: UniFunctionDec): string[] => {
  const names: string[] = [];
  for (const parameter of (declaration.params ?? []) as any[]) {
    for (const variable of (parameter.variables ?? []) as any[]) {
      names.push(String(variable.name ?? '').replace(/^\*+/, ''));
    }
  }
  return names;
};

/**
 * The constructs whose controlling expression decides something. A `switch`
 * is not among them: it selects on a value rather than on whether the value is
 * zero, and telling a reader that `switch (6)` is "true" would teach a rule
 * that is not there.
 */
const TRUTH_VALUED = ['if', 'while', 'doWhile', 'for', 'ternary'];

/** What C reads a controlling expression as, said as C reads it. */
const truthOf = (value: string): string | null => {
  const number = Number(value);
  if (value === '' || Number.isNaN(number)) {
    return null;
  }
  return number === 0 ? 'factZero' : 'factNonzero';
};

/**
 * How long a value may be before it is cut short. An argument can be a whole
 * array - a format string reaches the engine as its bytes - and a tooltip that
 * has to be scrolled says less than one that does not.
 */
const VALUE_LIMIT = 48;

/**
 * A byte array read back as the string it holds.
 *
 * A string literal reaches a call as the bytes the engine wrote, so
 * `printf("%d\n", n)` would otherwise report its first argument as
 * `[37, 100, 10, 0]`. The terminator is what identifies one: C's strings end
 * in a zero byte, and an `int` array a program passes by value does not
 * reach here at all - arrays decay to a pointer, which is a number.
 */
const asText = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const bytes = value.map((one) => Number(one));
  if (bytes[bytes.length - 1] !== 0) {
    return null;
  }
  const body = bytes.slice(0, -1);
  const printable = body.every(
    (byte) => Number.isInteger(byte) && 9 <= byte && byte <= 126
  );
  return printable ? JSON.stringify(String.fromCharCode(...body)) : null;
};

/**
 * A value as C leaves it.
 *
 * The engine compares with JavaScript's operators and hands back a boolean;
 * C's relational operators yield an `int`, and the whole point of showing a
 * value here is that C has no boolean type to hide behind - `i < 3` is worth
 * 1, and a reader told it is worth `true` has learned the wrong language.
 */
const spell = (value: unknown): string => {
  const primitive = value instanceof Boolean ? value.valueOf() : value;
  if (typeof primitive === 'boolean') {
    return primitive ? '1' : '0';
  }
  const text = asText(value) ?? expressionValue(value);
  return text.length <= VALUE_LIMIT
    ? text
    : `${text.slice(0, VALUE_LIMIT - 1)}…`;
};

/**
 * One activation as facts. A fact with no value is a sentence on its own; one
 * with a value reads as `phrase: value`, and the phrases live in `strings.ts`
 * because the interpreter does not speak English.
 */
function factsOf(activation: Activation): ConstructFactModel[] {
  const facts: ConstructFactModel[] = [];
  const { condition } = activation;
  if (typeof condition !== 'undefined') {
    facts.push({ label: 'factConditionValue', value: condition });
    const truth =
      TRUTH_VALUED.indexOf(activation.kind) === -1 ? null : truthOf(condition);
    if (truth !== null) {
      facts.push({ label: truth, value: '' });
    }
  }
  if (typeof activation.branch !== 'undefined') {
    facts.push({ label: activation.branch, value: '' });
  }
  if (typeof activation.iterations !== 'undefined') {
    facts.push({
      label: 'factIterations',
      value: String(activation.iterations),
    });
  }
  if (typeof activation.label !== 'undefined') {
    facts.push({ label: 'factLabel', value: activation.label });
    if (1 < activation.labels.length) {
      facts.push({ label: 'factFallsThrough', value: '' });
    }
  }
  activation.args.forEach((value, index) => {
    if (typeof value === 'undefined') {
      return;
    }
    const parameter = activation.parameters[index];
    facts.push({
      label: 'factArgument',
      value:
        typeof parameter === 'undefined' || parameter === ''
          ? value
          : `${parameter} = ${value}`,
    });
  });
  if (typeof activation.timesEntered !== 'undefined') {
    facts.push({
      label: 'factTimesEntered',
      value: String(activation.timesEntered),
    });
  }
  if (typeof activation.before !== 'undefined') {
    facts.push({ label: 'factWas', value: activation.before });
  }
  if (typeof activation.result === 'undefined') {
    return facts;
  }
  if (activation.kind === 'assignment') {
    facts.push({ label: 'factNow', value: activation.result });
  } else if (activation.kind === 'return' || activation.kind === 'call') {
    // A `void` function yields the engine's own nothing, and C has no value
    // there to report; saying `returns: null` would invent one.
    if (activation.result !== 'null' && activation.result !== 'undefined') {
      facts.push({ label: 'factReturns', value: activation.result });
    }
  } else if (activation.kind === 'cast') {
    const { source } = activation;
    facts.push({
      label: 'factConverted',
      value:
        typeof source === 'undefined'
          ? activation.result
          : `${source} → ${activation.result}`,
    });
    if (typeof source !== 'undefined' && source !== activation.result) {
      facts.push({ label: 'factLoses', value: '' });
    }
  }
  return facts;
}

export class ConstructRecorder {
  private markers = new Map<object, Marker[]>();
  /** The constructs the run is inside, outermost first. */
  private stack: Activation[] = [];
  /** What has finished since the previous stop. */
  private finished: Activation[] = [];
  /** The assignments being carried out, so `execAssign` knows whose it is. */
  private assigning: Activation[] = [];
  private entries = new Map<object, number>();
  /** What each part of the statement running now has come to. */
  private evaluations = new Map<object, EvaluationModel>();

  /**
   * A new run. The index is built once, from the tree about to execute: a
   * lookup by node identity is what lets the engine report a value without
   * knowing which construct wanted it.
   */
  reset(program: UniNode, entryPoint: UniFunctionDec | null): void {
    this.markers = new Map<object, Marker[]>();
    this.stack = [];
    this.finished = [];
    this.assigning = [];
    this.entries = new Map<object, number>();
    this.evaluations = new Map<object, EvaluationModel>();
    this.index(program);
    if (entryPoint !== null) {
      // Nothing calls `main`, so its activation is opened here; the count is
      // one because C gives a program one entry.
      this.entries.set(entryPoint, 1);
      const activation = this.activationOf(entryPoint, 'functionDec');
      if (activation !== null) {
        activation.timesEntered = 1;
        this.stack.push(activation);
      }
    }
  }

  /**
   * A construct with a body is starting. The depth it returns is what closes
   * it again, so a `break` out of three loops closes all three.
   */
  entered(node: object, kind: string): number {
    const depth = this.stack.length;
    const activation = this.activationOf(node, kind);
    if (activation !== null) {
      this.stack.push(activation);
    }
    return depth;
  }

  /** A call, and the function it enters where the program defines one. */
  calling(call: UniMethodCall, declaration: UniFunctionDec | null): number {
    const depth = this.entered(call, 'call');
    if (declaration === null) {
      return depth;
    }
    const site = this.stack[this.stack.length - 1];
    const times = (this.entries.get(declaration) ?? 0) + 1;
    this.entries.set(declaration, times);
    const activation = this.activationOf(declaration, 'functionDec');
    if (activation === null) {
      return depth;
    }
    activation.timesEntered = times;
    activation.parameters = parameterNames(declaration);
    this.stack.push(activation);
    if (typeof site !== 'undefined' && site.node === call) {
      site.parameters = activation.parameters;
      site.callee = activation;
    }
    return depth;
  }

  /** Back to where `entered` was called, however control got out. */
  leftAt(depth: number): void {
    while (depth < this.stack.length) {
      this.remember(this.stack.pop() as Activation);
    }
  }

  /**
   * An expression is about to be evaluated. What is recorded here is what has
   * to be true before it runs rather than after: an iteration is under way as
   * soon as the body starts, and a reader hovering the loop from inside its
   * first pass should not be told that none have begun.
   */
  begins(expression: object): Marker[] | null {
    const markers = this.markers.get(expression);
    if (typeof markers === 'undefined') {
      return null;
    }
    for (const marker of markers) {
      if (BEFORE.indexOf(marker.role) === -1) {
        // Everything else is worth something only once it has a value, and
        // making its record now would leave an empty one behind for a call
        // that `calling` is about to open properly.
        continue;
      }
      const activation = this.recordFor(marker);
      if (activation === null) {
        continue;
      }
      if (marker.role === 'body') {
        activation.iterations = (activation.iterations ?? 0) + 1;
      } else if (marker.role === 'then') {
        activation.branch = 'factBranchThen';
      } else if (marker.role === 'else') {
        activation.branch = 'factBranchElse';
      } else if (marker.role === 'trueArm') {
        activation.branch = 'factArmNonzero';
      } else if (marker.role === 'falseArm') {
        activation.branch = 'factArmZero';
      } else if (marker.role === 'case') {
        const label = marker.label ?? '';
        activation.label = label;
        if (activation.labels.indexOf(label) === -1) {
          activation.labels.push(label);
        }
      } else if (marker.role === 'assigned') {
        this.assigning.push(activation);
      }
    }
    return markers;
  }

  /** That expression is finished, whether or not it produced a value. */
  ends(markers: Marker[] | null): void {
    if (markers === null) {
      return;
    }
    for (const marker of markers) {
      if (marker.role === 'assigned') {
        this.assigning.pop();
      }
    }
  }

  /** What the expression was worth. */
  yields(expression: object, markers: Marker[] | null, value: unknown): void {
    if (
      evaluates(expression) &&
      this.evaluations.size < EVALUATION_LIMIT &&
      !this.evaluations.has(expression)
    ) {
      const range = rangeOf(expression);
      if (range !== null) {
        this.evaluations.set(expression, { range, value: spell(value) });
      }
    }
    if (markers === null) {
      return;
    }
    const spelled = spell(value);
    for (const marker of markers) {
      const activation = this.recordFor(marker);
      if (activation === null) {
        continue;
      }
      if (marker.role === 'condition') {
        activation.condition = spelled;
      } else if (marker.role === 'source') {
        activation.source = spelled;
      } else if (
        marker.role === 'result' ||
        marker.role === 'returned' ||
        marker.role === 'assigned'
      ) {
        activation.result = spelled;
      } else if (marker.role === 'argument') {
        const index = marker.index ?? 0;
        activation.args[index] = spelled;
        if (typeof activation.callee !== 'undefined') {
          activation.callee.args[index] = spelled;
        }
      }
    }
  }

  /**
   * What the object an assignment names held before it was written. The
   * assignment itself never evaluates its target - the engine takes its
   * address instead - so this is the one place the previous value is in hand.
   */
  assigns(previous: unknown): void {
    const activation = this.assigning[this.assigning.length - 1];
    if (typeof activation !== 'undefined' && typeof previous !== 'undefined') {
      activation.before = spell(previous);
    }
  }

  /**
   * The run has stopped, and this state is what the reader is looking at.
   * Everything recorded since the previous stop is spent here: it described
   * the move into this step, and describes nothing about the next one.
   */
  attach(state: ExecState): void {
    const states = this.stack.concat(this.finished).map((activation) => ({
      range: activation.range,
      kind: activation.kind,
      facts: factsOf(activation),
    }));
    (state as StateWithConstructs).plivetConstructs = states.filter(
      (one) => 0 < one.facts.length
    );
    (state as StateWithConstructs).plivetEvaluations = Array.from(
      this.evaluations.values()
    );
    // An assignment whose right-hand side called something is still going on:
    // its record has to outlive the stops inside that call, or the value the
    // target held would be forgotten before the value replacing it arrives.
    this.finished = this.assigning.slice();
    this.evaluations = new Map<object, EvaluationModel>();
  }

  /** Nothing is running any more, so nothing is doing anything. */
  finish(state: ExecState): void {
    this.stack = [];
    this.finished = [];
    this.assigning = [];
    this.evaluations = new Map<object, EvaluationModel>();
    (state as StateWithConstructs).plivetConstructs = [];
    (state as StateWithConstructs).plivetEvaluations = [];
  }

  /**
   * The record a marker is about, live if the construct is still running and
   * kept from this step if it has finished. A construct with no lifetime of
   * its own - an assignment, a `return`, a cast - gets its record made here,
   * the first time anything is said about it.
   */
  private recordFor(marker: Marker): Activation | null {
    for (let i = this.stack.length - 1; 0 <= i; i -= 1) {
      if (this.stack[i].node === marker.owner) {
        return this.stack[i];
      }
    }
    for (let i = this.finished.length - 1; 0 <= i; i -= 1) {
      if (this.finished[i].node === marker.owner) {
        return this.finished[i];
      }
    }
    const created = this.activationOf(marker.owner, marker.kind);
    if (created !== null) {
      this.remember(created);
    }
    return created;
  }

  private activationOf(node: object, kind: string): Activation | null {
    const range = rangeOf(node);
    // A construct the tooltip cannot be pointed at is not worth recording:
    // every surface that reads these finds one by where it is written.
    return range === null
      ? null
      : { node, kind, range, labels: [], args: [], parameters: [] };
  }

  private remember(activation: Activation): void {
    if (this.finished.indexOf(activation) !== -1) {
      return;
    }
    this.finished.push(activation);
    if (FINISHED_LIMIT < this.finished.length) {
      this.finished.shift();
    }
  }

  private mark(node: unknown, marker: Marker): void {
    if (node === null || typeof node !== 'object') {
      return;
    }
    const existing = this.markers.get(node);
    if (typeof existing === 'undefined') {
      this.markers.set(node, [marker]);
    } else {
      existing.push(marker);
    }
  }

  /**
   * Every node whose value says something about a construct, against what it
   * says. The walk is generic - `UniNode.fields` names each node's children -
   * for the reason `outline.ts` gives: a switch over the node classes has to
   * be revised every time unicoen grows one.
   */
  private index(root: UniNode): void {
    const visit = (node: any): void => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node.fields === 'undefined') {
        return;
      }
      this.indexOne(node);
      for (const field of Array.from(node.fields.keys()) as string[]) {
        if (field !== 'comments' && field !== 'codeRange') {
          visit(node[field]);
        }
      }
    };
    visit(root);
  }

  private indexOne(node: any): void {
    if (node instanceof UniIf) {
      this.mark(node.cond, { owner: node, kind: 'if', role: 'condition' });
      this.mark(node.trueStatement, { owner: node, kind: 'if', role: 'then' });
      this.mark(node.falseStatement, { owner: node, kind: 'if', role: 'else' });
      return;
    }
    if (node instanceof UniFor) {
      this.mark(node.cond, { owner: node, kind: 'for', role: 'condition' });
      this.mark(node.statement, { owner: node, kind: 'for', role: 'body' });
      return;
    }
    if (node instanceof UniWhile) {
      // UniDoWhile extends UniWhile, so the subclass is tested first - the
      // same order `outline.ts` keeps its kinds in, and for the same reason.
      const kind = node instanceof UniDoWhile ? 'doWhile' : 'while';
      this.mark(node.cond, { owner: node, kind, role: 'condition' });
      this.mark(node.statement, { owner: node, kind, role: 'body' });
      return;
    }
    if (node instanceof UniSwitch) {
      this.mark(node.cond, { owner: node, kind: 'switch', role: 'condition' });
      for (const unit of (node.cases ?? []) as any[]) {
        const label = labelOf(unit);
        for (const statement of (unit.statement ?? []) as any[]) {
          this.mark(statement, {
            owner: node,
            kind: 'switch',
            role: 'case',
            label,
          });
        }
      }
      return;
    }
    if (node instanceof UniMethodCall) {
      this.mark(node, { owner: node, kind: 'call', role: 'result' });
      (node.args ?? []).forEach((argument: any, index: number) => {
        this.mark(argument, {
          owner: node,
          kind: 'call',
          role: 'argument',
          index,
        });
      });
      return;
    }
    if (node instanceof UniReturn) {
      this.mark(node.value, {
        owner: node,
        kind: 'return',
        role: 'returned',
      });
      return;
    }
    if (node instanceof UniCast) {
      this.mark(node, { owner: node, kind: 'cast', role: 'result' });
      this.mark(node.value, { owner: node, kind: 'cast', role: 'source' });
      return;
    }
    if (node instanceof UniTernaryOp) {
      this.mark(node.cond, {
        owner: node,
        kind: 'ternary',
        role: 'condition',
      });
      this.mark(node.trueExpr, {
        owner: node,
        kind: 'ternary',
        role: 'trueArm',
      });
      this.mark(node.falseExpr, {
        owner: node,
        kind: 'ternary',
        role: 'falseArm',
      });
      return;
    }
    if (node instanceof UniBinOp && ASSIGNMENT.test(node.operator)) {
      this.mark(node, {
        owner: node,
        kind: 'assignment',
        role: 'assigned',
      });
    }
  }
}

/** How a `switch` label reads in the source it was written in. */
function labelOf(unit: any): string {
  if (unit.label === 'default' || unit.cond === null) {
    return 'default';
  }
  const value = (unit.cond as { value?: unknown }).value;
  return typeof value === 'undefined'
    ? 'case'
    : `case ${typeof value === 'string' ? value : String(value)}`;
}

export function constructStatesOf(state: ExecState): ConstructStateModel[] {
  const states = (state as StateWithConstructs).plivetConstructs;
  return typeof states === 'undefined' ? [] : states;
}

export function evaluationsOf(state: ExecState): EvaluationModel[] {
  const evaluations = (state as StateWithConstructs).plivetEvaluations;
  return typeof evaluations === 'undefined' ? [] : evaluations;
}
