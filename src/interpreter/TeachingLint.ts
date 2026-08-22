import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniBlock } from 'unicoen.ts/dist/node/UniBlock';
import { UniBreak } from 'unicoen.ts/dist/node/UniBreak';
import { UniCharacterLiteral } from 'unicoen.ts/dist/node/UniCharacterLiteral';
import { UniClassDec } from 'unicoen.ts/dist/node/UniClassDec';
import { UniDoWhile } from 'unicoen.ts/dist/node/UniDoWhile';
import { UniDoubleLiteral } from 'unicoen.ts/dist/node/UniDoubleLiteral';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniIntLiteral } from 'unicoen.ts/dist/node/UniIntLiteral';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniParam } from 'unicoen.ts/dist/node/UniParam';
import { UniReturn } from 'unicoen.ts/dist/node/UniReturn';
import { UniStringLiteral } from 'unicoen.ts/dist/node/UniStringLiteral';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';

/**
 * The checks a compiler would make, said the way a teacher would say them.
 *
 * `checkSyntaxError` reports what the parser could not read; everything here is
 * about programs that parse and are still wrong, which is where a beginner
 * actually spends their time. The rules are a table walked by one pass rather
 * than a pass per rule, so adding the next one is a table entry and not a new
 * traversal - that, rather than the five rules below, is the point of the
 * module.
 *
 * Everything it produces is plain data: this runs in the Worker and the linter
 * that shows it runs on the page.
 *
 * Severity describes how urgently the editor presents a finding, not a C
 * standard category. Diagnostics state explicitly when evaluation would have
 * undefined behavior; warnings also cover constructs that are valid C but are
 * commonly accidental.
 */

export type LintSeverity = 'info' | 'warning' | 'error';

/** 1-based line and 0-based column, as the parser reports them; end exclusive. */
export interface LintRange {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** A replacement the reader can apply in one click. */
export interface LintFix extends LintRange {
  label: string;
  text: string;
}

export interface LintDiagnostic extends LintRange {
  /** Which rule spoke, so a reader can be told to switch one off later. */
  rule: string;
  severity: LintSeverity;
  message: string;
  fix?: LintFix;
  /** A library function the message is about, for the editor to link. */
  help?: string;
}

/** What a name was declared as, as far as a source-level rule needs it. */
interface Declared {
  name: string;
  /** The type as written, without the declarator's stars. */
  type: string;
  pointer: boolean;
  array: boolean;
  /**
   * Whether anything has given it a value yet. Lexical rather than
   * flow-sensitive: an assignment anywhere above the read counts, which is
   * what keeps `if (a > b) max = a; else max = b;` quiet.
   */
  initialised: boolean;
}

type TypeClass = 'integer' | 'floating' | 'pointer' | 'string' | 'unknown';

interface Rule {
  readonly name: string;
  readonly severity: LintSeverity;
  /** Every node, in source order, with the scope as it stands there. */
  enter?(node: any, pass: LintPass): void;
  /** The same node once its children have been walked. */
  leave?(node: any, pass: LintPass): void;
}

const rangeOf = (node: any): LintRange | null => {
  const range = node === null ? null : node.codeRange;
  if (!range || !range.begin || !range.end) {
    return null;
  }
  return {
    line: range.begin.y,
    column: range.begin.x,
    endLine: range.end.y,
    endColumn: range.end.x,
  };
};

/** The declarator's stars belong to the name the parser reports: `*p`. */
const declaratorStars = (name: string): number => {
  const found = /^\**/.exec(name);
  return found === null ? 0 : found[0].length;
};

const withoutStars = (name: string): string => name.replace(/^\**/, '');

const classOf = (declared: Declared): TypeClass => {
  const isCharacter = /\bchar\b/.test(declared.type);
  if (declared.pointer || declared.array) {
    return isCharacter ? 'string' : 'pointer';
  }
  if (/\b(float|double)\b/.test(declared.type)) {
    return 'floating';
  }
  if (
    /\b(char|short|int|long|signed|unsigned|_Bool|bool)\b/.test(declared.type)
  ) {
    return 'integer';
  }
  return 'unknown';
};

/** The class a type name has when it is not attached to a declarator. */
const classOfType = (type: string): TypeClass =>
  classOf({
    name: '',
    type: type.replace(/\*/g, ''),
    pointer: type.indexOf('*') !== -1,
    array: false,
    initialised: true,
  });

const NAMES: Record<TypeClass, string> = {
  integer: 'an integer',
  floating: 'a floating-point number',
  pointer: 'a pointer',
  string: 'a string',
  unknown: 'something else',
};

/**
 * The `printf` and `scanf` family, and where each one keeps its format string.
 * Only the first two are interpreted today; the rest cost a table row and stop
 * the rule from going quiet the day one of them is.
 */
const FORMAT_FUNCTIONS: Record<
  string,
  { format: number; first: number; reads: boolean }
> = {
  printf: { format: 0, first: 1, reads: false },
  fprintf: { format: 1, first: 2, reads: false },
  sprintf: { format: 1, first: 2, reads: false },
  snprintf: { format: 2, first: 3, reads: false },
  scanf: { format: 0, first: 1, reads: true },
  fscanf: { format: 1, first: 2, reads: true },
  sscanf: { format: 1, first: 2, reads: true },
};

/** The family that stores through the pointers it is handed. */
const SCANNING = ['scanf', 'fscanf', 'sscanf'];

/** One conversion specification, as much of it as a rule needs. */
interface Conversion {
  /** The conversion character: `d`, `s`, `f`. */
  kind: string;
  /** The whole specification as written, for the message. */
  text: string;
}

/**
 * The conversions in a format string, in order. `%%` is not one - it prints a
 * per cent sign and takes no argument - and neither is a scanf field whose
 * value is suppressed with `*`.
 */
const conversionsIn = (format: string): Conversion[] => {
  const pattern =
    /%(\*?)[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|L|z|j|t)?([diouxXeEfFgGaAcspn%])/g;
  const conversions: Conversion[] = [];
  let found = pattern.exec(format);
  while (found !== null) {
    if (found[2] !== '%' && found[1] !== '*') {
      conversions.push({ kind: found[2], text: found[0] });
    }
    found = pattern.exec(format);
  }
  return conversions;
};

/** What a conversion expects of its argument once C has promoted it. */
const expectedClass = (kind: string): TypeClass | null => {
  if ('diouxXc'.indexOf(kind) !== -1) {
    return 'integer';
  }
  if ('eEfFgGaA'.indexOf(kind) !== -1) {
    return 'floating';
  }
  if (kind === 's') {
    return 'string';
  }
  if (kind === 'p') {
    return 'pointer';
  }
  return null;
};

/** `1 conversion`, `2 conversions` - said the way a message needs it. */
const count = (howMany: number, noun: string): string =>
  `${howMany} ${noun}${howMany === 1 ? '' : 's'}`;

const calleeName = (node: any): string =>
  node instanceof UniMethodCall && node.methodName instanceof UniIdent
    ? node.methodName.name
    : '';

const isAssignment = (node: any): boolean =>
  node instanceof UniBinOp && /^(?:[-+*/%&|^]|<<|>>)?=$/.test(node.operator);

/** Whether a loop can only be left by `break` or `return`. */
const isEndless = (cond: any): boolean =>
  cond === null ||
  typeof cond === 'undefined' ||
  (cond instanceof UniIntLiteral && cond.value !== 0);

const contains = (node: any, accept: (child: any) => boolean): boolean => {
  if (node === null || typeof node !== 'object') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((child) => contains(child, accept));
  }
  if (typeof node.fields === 'undefined') {
    return false;
  }
  if (accept(node)) {
    return true;
  }
  for (const field of Array.from(node.fields.keys()) as string[]) {
    if (
      field !== 'comments' &&
      field !== 'codeRange' &&
      contains(node[field], accept)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Whether control can run off the end of a statement.
 *
 * Three answers rather than two, because the honest answer to a `switch` with
 * one case falling into the next is that this rule cannot tell - and a lesson
 * a reader can see is wrong teaches worse than no lesson. `unknown` reports
 * nothing.
 */
type Flow = 'returns' | 'falls' | 'unknown';

function flowOf(node: any): Flow {
  if (node === null || typeof node !== 'object') {
    return 'falls';
  }
  if (node instanceof UniReturn) {
    return 'returns';
  }
  // `exit` does not return, so a function ending in one cannot fall off it.
  if (node instanceof UniMethodCall) {
    const name = calleeName(node);
    return name === 'exit' || name === 'abort' ? 'returns' : 'falls';
  }
  if (node instanceof UniBlock) {
    return flowOfSequence(node.body);
  }
  if (node instanceof UniIf) {
    const taken = flowOf(node.trueStatement);
    const other =
      node.falseStatement === null || typeof node.falseStatement === 'undefined'
        ? 'falls'
        : flowOf(node.falseStatement);
    if (taken === 'unknown' || other === 'unknown') {
      return 'unknown';
    }
    return taken === 'returns' && other === 'returns' ? 'returns' : 'falls';
  }
  if (node instanceof UniSwitch) {
    return flowOfSwitch(node);
  }
  if (node instanceof UniDoWhile || node instanceof UniWhile) {
    return endlessFlow(node.cond, node.statement);
  }
  if (node instanceof UniFor) {
    return endlessFlow(node.cond, node.statement);
  }
  return 'falls';
}

function flowOfSequence(statements: any): Flow {
  if (!Array.isArray(statements)) {
    return flowOf(statements);
  }
  let uncertain = false;
  for (const statement of statements) {
    const flow = flowOf(statement);
    if (flow === 'returns') {
      // Everything after a return is unreachable, so the sequence returns.
      return 'returns';
    }
    if (flow === 'unknown') {
      uncertain = true;
    }
  }
  return uncertain ? 'unknown' : 'falls';
}

/**
 * A `switch` says nothing unless it has a default: without one, the value that
 * matches no label runs nothing at all. With one, a case that falls into the
 * next is beyond what this reads, and it says so rather than guessing.
 */
function flowOfSwitch(node: any): Flow {
  const cases: any[] = Array.isArray(node.cases) ? node.cases : [];
  if (!cases.some((unit) => unit.label === 'default')) {
    return 'falls';
  }
  let uncertain = false;
  for (const unit of cases) {
    const flow = flowOf(unit.statement);
    if (flow !== 'returns') {
      uncertain = true;
    }
  }
  return uncertain ? 'unknown' : 'returns';
}

/** A loop that cannot end is a statement control never comes back from. */
const endlessFlow = (cond: any, body: any): Flow =>
  // `instanceof` and not a class name: the production build mangles those.
  isEndless(cond) && !contains(body, (child) => child instanceof UniBreak)
    ? 'returns'
    : 'falls';

/**
 * The walk, the scope and the diagnostics: everything a rule is handed. The
 * scope is maintained here rather than by a rule because three of the five
 * want it, and because keeping it live - declarations added where they are
 * written, parameters at the head of their function - is what lets a rule ask
 * about a name without a pass of its own.
 */
class LintPass {
  readonly diagnostics: LintDiagnostic[] = [];
  /** Return types by function name, for typing a call in an argument list. */
  readonly returnTypes = new Map<string, string>();
  /** Identifiers being assigned to rather than read. */
  readonly assigned = new Set<any>();
  /** Identifiers that name a member after `.` or `->`, rather than an object. */
  readonly memberSelectors = new Set<any>();
  /** Names already reported by a rule that reports each name once. */
  readonly reported = new Set<string>();

  private readonly lines: string[];
  private readonly scopes: Array<Map<string, Declared>> = [new Map()];

  constructor(source: string) {
    this.lines = source.split('\n');
  }

  declared(name: string): Declared | null {
    for (let i = this.scopes.length - 1; 0 <= i; i -= 1) {
      const found = this.scopes[i].get(name);
      if (typeof found !== 'undefined') {
        return found;
      }
    }
    return null;
  }

  declare(declared: Declared): void {
    this.scopes[this.scopes.length - 1].set(declared.name, declared);
  }

  pushScope(): void {
    this.scopes.push(new Map());
  }

  popScope(): void {
    if (1 < this.scopes.length) {
      this.scopes.pop();
    }
  }

  report(
    rule: Rule,
    range: LintRange,
    message: string,
    extra: { fix?: LintFix; help?: string } = {}
  ): void {
    this.diagnostics.push({
      rule: rule.name,
      severity: rule.severity,
      message,
      ...range,
      ...extra,
    });
  }

  /**
   * The source the reader typed, at a range the parser reported.
   *
   * The tree is parsed from a rewritten source - qualifiers blanked, enums and
   * function pointers given generated names - and the passes that do it keep
   * line numbers but not always column counts. A fix is an edit to the
   * reader's own file, so it is only offered where the text at the range is
   * still the text the rule thinks it is.
   */
  textAt(range: LintRange): string | null {
    if (range.line !== range.endLine) {
      return null;
    }
    const line = this.lines[range.line - 1];
    if (typeof line === 'undefined' || line.length < range.endColumn) {
      return null;
    }
    return line.slice(range.column, range.endColumn);
  }

  /** Where an operator sits between its operands, for a fix that replaces it. */
  operatorRange(node: any, operator: string): LintRange | null {
    const left = rangeOf(node.left);
    const right = rangeOf(node.right);
    if (left === null || right === null || left.endLine !== right.line) {
      return null;
    }
    const line = this.lines[left.endLine - 1];
    if (typeof line === 'undefined') {
      return null;
    }
    const at = line.indexOf(operator, left.endColumn);
    if (at === -1 || right.column < at + operator.length) {
      return null;
    }
    return {
      line: left.endLine,
      column: at,
      endLine: left.endLine,
      endColumn: at + operator.length,
    };
  }

  /** The static type of an expression, as far as the format rules need it. */
  classOfExpression(node: any): TypeClass {
    if (node instanceof UniIdent) {
      const declared = this.declared(node.name);
      return declared === null ? 'unknown' : classOf(declared);
    }
    if (node instanceof UniIntLiteral || node instanceof UniCharacterLiteral) {
      return 'integer';
    }
    if (node instanceof UniDoubleLiteral) {
      return 'floating';
    }
    if (node instanceof UniStringLiteral) {
      return 'string';
    }
    if (node instanceof UniUnaryOp && node.operator === '&') {
      return 'pointer';
    }
    if (node instanceof UniMethodCall) {
      const returns = this.returnTypes.get(calleeName(node));
      return typeof returns === 'undefined' ? 'unknown' : classOfType(returns);
    }
    return 'unknown';
  }

  /**
   * What a `scanf` argument points at. `&n` points at whatever `n` is, an
   * array points at its element, and a pointer points at what it addresses -
   * which is the type the conversion has to agree with.
   */
  pointeeClassOf(node: any): TypeClass {
    if (node instanceof UniUnaryOp && node.operator === '&') {
      return this.classOfExpression(node.expr);
    }
    if (node instanceof UniIdent) {
      const declared = this.declared(node.name);
      if (declared === null || !(declared.pointer || declared.array)) {
        return 'unknown';
      }
      return classOf({ ...declared, pointer: false, array: false });
    }
    if (node instanceof UniStringLiteral) {
      return 'string';
    }
    return 'unknown';
  }

  /** Text of the source the node covers, for quoting it back in a message. */
  quote(node: any): string {
    const range = rangeOf(node);
    if (range === null) {
      return '';
    }
    const text = this.textAt(range);
    return text === null ? '' : text.trim();
  }

  /** How long a line is, for underlining the whole of it. */
  lineLength(line: number): number {
    const found = this.lines[line - 1];
    return typeof found === 'undefined' ? 0 : found.length;
  }
}

/**
 * A `scanf` conversion that assigns a value requires a pointer to the object
 * that receives it. Passing the object's stored value as a variadic argument
 * does not provide that pointer.
 */
const scanfAddress: Rule = {
  name: 'scanf-address',
  severity: 'error',
  enter(node, pass) {
    const name = calleeName(node);
    if (SCANNING.indexOf(name) === -1) {
      return;
    }
    const shape = FORMAT_FUNCTIONS[name];
    const args: any[] = Array.isArray(node.args) ? node.args : [];
    for (const argument of args.slice(shape.first)) {
      if (!(argument instanceof UniIdent)) {
        continue;
      }
      const declared = pass.declared(argument.name);
      if (declared === null || declared.pointer || declared.array) {
        continue;
      }
      const range = rangeOf(argument);
      if (range === null) {
        continue;
      }
      const fix =
        pass.textAt(range) === argument.name
          ? {
              ...range,
              label: `Pass &${argument.name}`,
              text: `&${argument.name}`,
            }
          : undefined;
      pass.report(
        this,
        range,
        `${name} requires a pointer to the object that receives this input. ` +
          `Pass the address of ${argument.name} by writing ` +
          `&${argument.name}; passing ${argument.name} supplies its stored ` +
          `value instead, and using that value as an address has undefined behavior.`,
        { fix, help: name }
      );
    }
  },
};

/**
 * `=` in a controlling expression performs an assignment, and the assignment
 * expression's result then determines control flow. The idiom that intends an
 * assignment - `while ((c = getchar()) != EOF)` - makes the comparison
 * explicit, which is why only the complete controlling expression is checked.
 */
const assignmentAsCondition: Rule = {
  name: 'assignment-as-condition',
  severity: 'warning',
  enter(node, pass) {
    const conditional =
      node instanceof UniIf ||
      node instanceof UniWhile ||
      node instanceof UniDoWhile ||
      node instanceof UniFor;
    if (!conditional || !isAssignment(node.cond)) {
      return;
    }
    // Typed loosely on purpose: the four conditional nodes agree on the
    // field and disagree on its declared type.
    const condition: any = node.cond;
    const range = rangeOf(condition);
    if (range === null) {
      return;
    }
    const operator = condition.operator;
    const at = pass.operatorRange(condition, operator);
    const fix =
      operator === '=' && at !== null && pass.textAt(at) === '='
        ? { ...at, label: 'Compare with ==', text: '==' }
        : undefined;
    const target = pass.quote(condition.left);
    pass.report(
      this,
      range,
      `${operator} is an assignment operator; == is the equality operator. ` +
        `This controlling expression stores a value in ` +
        `${target === '' ? 'the object designated by the left operand' : target} ` +
        `and then uses the assignment expression's result to determine control flow.`,
      { fix }
    );
  },
};

/**
 * Each conversion specification imposes a type requirement on its
 * corresponding argument. A variadic call carries no parameter type
 * information for these trailing arguments, so a mismatch has undefined
 * behavior rather than producing a language-level conversion.
 */
const formatArguments: Rule = {
  name: 'format-arguments',
  severity: 'error',
  enter(node, pass) {
    const name = calleeName(node);
    const shape = FORMAT_FUNCTIONS[name];
    if (typeof shape === 'undefined') {
      return;
    }
    const args: any[] = Array.isArray(node.args) ? node.args : [];
    const format = args[shape.format];
    // A format that is not a literal is not readable here, and a program that
    // builds one is not the program this rule is for.
    if (!(format instanceof UniStringLiteral)) {
      return;
    }
    const conversions = conversionsIn(String(format.value));
    const given = args.slice(shape.first);
    const callRange = rangeOf(node);
    if (conversions.length !== given.length && callRange !== null) {
      pass.report(
        this,
        callRange,
        `The ${name} format contains ${count(
          conversions.length,
          'conversion specification'
        )}, but the call supplies ${count(
          given.length,
          'corresponding argument'
        )}. The mismatch has undefined behavior.`,
        { help: name }
      );
      return;
    }
    conversions.forEach((conversion, index) => {
      const argument = given[index];
      const expected = expectedClass(conversion.kind);
      const range = rangeOf(argument);
      if (expected === null || range === null) {
        return;
      }
      const actual = shape.reads
        ? pass.pointeeClassOf(argument)
        : pass.classOfExpression(argument);
      if (actual === 'unknown' || actual === expected) {
        return;
      }
      // A pointer printed with %s is a string when it addresses characters,
      // and the two classes are the same promise to a reader.
      if (expected === 'pointer' && actual === 'string') {
        return;
      }
      pass.report(
        this,
        range,
        shape.reads
          ? `${conversion.text} requires a pointer to ${NAMES[expected]} ` +
              `object, but this argument points to ${NAMES[actual]}. The ` +
              `mismatch has undefined behavior.`
          : `${conversion.text} requires ${NAMES[expected]} after the ` +
              `default argument promotions, but this argument is ` +
              `${NAMES[actual]}. The mismatch has undefined behavior.`,
        { help: name }
      );
    });
  },
};

/**
 * An object with automatic storage duration and no initializer has an
 * indeterminate value. Evaluating that value is not the same as reading a
 * predictable leftover bit pattern.
 */
const uninitializedRead: Rule = {
  name: 'uninitialized-read',
  severity: 'warning',
  enter(node, pass) {
    if (
      node instanceof UniBinOp &&
      (node.operator === '.' || node.operator === '->') &&
      node.right instanceof UniIdent
    ) {
      // Unicoen represents `record.member` as a binary operation whose right
      // side is an identifier. That identifier selects a field; it is not a
      // variable read and must not be resolved through the lexical scope.
      pass.memberSelectors.add(node.right);
      return;
    }
    if (isAssignment(node) && node.left instanceof UniIdent) {
      // The left of an assignment is written, not read. Marked here and
      // initialised on the way out, so `x = x + 1` still reports the read.
      pass.assigned.add(node.left);
      return;
    }
    // Taking the address of an object hands it to something that may fill it,
    // which is exactly what `scanf(\"%d\", &n)` does.
    if (node instanceof UniUnaryOp && node.operator === '&') {
      const target = node.expr;
      if (target instanceof UniIdent) {
        const declared = pass.declared(target.name);
        if (declared !== null) {
          declared.initialised = true;
        }
        pass.assigned.add(target);
      }
      return;
    }
    if (
      !(node instanceof UniIdent) ||
      pass.assigned.has(node) ||
      pass.memberSelectors.has(node)
    ) {
      return;
    }
    const declared = pass.declared(node.name);
    if (declared === null || declared.initialised || declared.array) {
      return;
    }
    if (pass.reported.has(declared.name)) {
      return;
    }
    const range = rangeOf(node);
    if (range === null) {
      return;
    }
    pass.reported.add(declared.name);
    pass.report(
      this,
      range,
      `${node.name} is evaluated before a value is stored in it. This ` +
        `uninitialized object of type ${declared.type} has an indeterminate ` +
        `value; using that value here has undefined behavior.`
    );
  },
  leave(node, pass) {
    if (isAssignment(node) && node.left instanceof UniIdent) {
      const declared = pass.declared(node.left.name);
      if (declared !== null) {
        declared.initialised = true;
      }
    }
  },
};

/**
 * Reaching the closing brace of a non-`void` function is equivalent to a
 * return statement with no expression. If the caller uses that function
 * call's value, the behavior is undefined. `main` is exempt: reaching its
 * closing brace returns zero.
 */
const missingReturn: Rule = {
  name: 'missing-return',
  severity: 'warning',
  enter(node, pass) {
    if (
      !(node instanceof UniFunctionDec) ||
      !(node.block instanceof UniBlock) ||
      node.name === 'main'
    ) {
      return;
    }
    const returns = typeof node.returnType === 'string' ? node.returnType : '';
    if (returns === '' || /^\s*void\s*$/.test(returns)) {
      return;
    }
    if (flowOf(node.block) !== 'falls') {
      return;
    }
    const range = rangeOf(node);
    if (range === null) {
      return;
    }
    // The signature, not the whole body: a warning drawn over forty lines
    // says nothing about where to look.
    pass.report(
      this,
      { ...range, endLine: range.line, endColumn: pass.lineLength(range.line) },
      `${node.name} has return type ${returns}, but control can reach its ` +
        `closing brace. This is equivalent to a return statement with no ` +
        `expression; if the caller uses the function call's value, the ` +
        `behavior is undefined.`
    );
  },
};

/**
 * The table. Order is the order the diagnostics come out in for one node, and
 * nothing else depends on it.
 */
const RULES: Rule[] = [
  scanfAddress,
  assignmentAsCondition,
  formatArguments,
  uninitializedRead,
  missingReturn,
];

const declaredFrom = (
  declaration: any,
  variable: any,
  initialised: boolean
): Declared => {
  const type = typeof declaration.type === 'string' ? declaration.type : '';
  const name = typeof variable.name === 'string' ? variable.name : '';
  const suffix =
    typeof variable.typeSuffix === 'string' ? variable.typeSuffix : '';
  return {
    name: withoutStars(name),
    type,
    pointer: 0 < declaratorStars(name),
    array: suffix.indexOf('[') !== -1,
    initialised,
  };
};

/**
 * The checks, over one program.
 *
 * `source` is what the reader typed; the tree is parsed from the rewritten
 * copy of it, so the two are the same lines and not always the same columns -
 * see `LintPass.textAt`, which is what keeps a fix from editing the wrong
 * characters.
 */
export function teachingDiagnostics(
  root: UniNode,
  source: string
): LintDiagnostic[] {
  const pass = new LintPass(source);
  collectReturnTypes(root, pass);

  const visit = (node: any, parent: any = null): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, parent));
      return;
    }
    if (typeof node.fields === 'undefined') {
      return;
    }
    const isFunction = node instanceof UniFunctionDec;
    if (isFunction) {
      pass.pushScope();
      declareParameters(node, pass);
    }
    for (const rule of RULES) {
      if (typeof rule.enter !== 'undefined') {
        rule.enter(node, pass);
      }
    }
    // A parameter is a `UniVariableDec` subclass and was declared with the
    // function it belongs to; declaring it again here would say it has no
    // initializer, which for a parameter means nothing - it arrives with
    // whatever the caller passed.
    const isRecordMember =
      node instanceof UniVariableDec && parent instanceof UniClassDec;
    if (
      node instanceof UniVariableDec &&
      !(node instanceof UniParam) &&
      !isRecordMember
    ) {
      // Declared after the rules have seen the node, so the initializer of
      // `int y = x;` is still read against the scope that has no `y` in it.
      // A declaration nested directly in a class declaration is a structure
      // or union member, not a lexical variable; its name only has meaning on
      // the right of `.` or `->`.
      declareVariables(node, pass);
    }
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field], node);
      }
    }
    for (const rule of RULES) {
      if (typeof rule.leave !== 'undefined') {
        rule.leave(node, pass);
      }
    }
    if (isFunction) {
      pass.popScope();
    }
  };
  visit(root);
  return pass.diagnostics.sort(
    (left, right) => left.line - right.line || left.column - right.column
  );
}

function collectReturnTypes(root: any, pass: LintPass): void {
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
    if (node instanceof UniFunctionDec && typeof node.name === 'string') {
      pass.returnTypes.set(
        node.name,
        typeof node.returnType === 'string' ? node.returnType : ''
      );
    }
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field]);
      }
    }
  };
  visit(root);
}

function declareParameters(node: any, pass: LintPass): void {
  const params: any[] = Array.isArray(node.params) ? node.params : [];
  for (const param of params) {
    const variables: any[] = Array.isArray(param.variables)
      ? param.variables
      : [];
    for (const variable of variables) {
      // An argument arrives with a value, whatever the caller passed.
      pass.declare(declaredFrom(param, variable, true));
    }
  }
}

function declareVariables(node: any, pass: LintPass): void {
  const variables: any[] = Array.isArray(node.variables) ? node.variables : [];
  const isStatic =
    Array.isArray(node.modifiers) &&
    (node.modifiers.indexOf('static') !== -1 ||
      node.modifiers.indexOf('extern') !== -1);
  for (const variable of variables) {
    // Static storage is zero-initialised by the standard, so reading it before
    // an assignment is defined and says nothing worth warning about.
    const initialised =
      isStatic ||
      (variable.value !== null && typeof variable.value !== 'undefined');
    pass.declare(declaredFrom(node, variable, initialised));
  }
}
