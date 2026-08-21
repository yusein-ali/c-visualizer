import { CPP14Engine } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Engine';
import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { UniRuntimeError } from 'unicoen.ts/dist/interpreter/Engine/RuntimeException';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { UniArray } from 'unicoen.ts/dist/node/UniArray';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniClassDec } from 'unicoen.ts/dist/node/UniClassDec';
import { UniDoWhile } from 'unicoen.ts/dist/node/UniDoWhile';
import { UniExpr } from 'unicoen.ts/dist/node/UniExpr';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniIntLiteral } from 'unicoen.ts/dist/node/UniIntLiteral';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniNoneLiteral } from 'unicoen.ts/dist/node/UniNoneLiteral';
import { UniProgram } from 'unicoen.ts/dist/node/UniProgram';
import { UniStringLiteral } from 'unicoen.ts/dist/node/UniStringLiteral';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import {
  DeclarationSpecifiers,
  RuntimeDeclarationInfo,
  StorageClass,
  StorageRegion,
} from './DeclarationSpecifiers';
import { DesignatedInitializers } from './DesignatedInitializers';
import { ConstructRecorder } from './ConstructTrace';
import { ExpressionRecorder } from './ExpressionTrace';
import { FieldOffset, RecordTable } from './RecordTable';
import { RuntimeDiagnostic } from './RuntimeDiagnostic';
import { scan, ScanFailure, ScanValue } from './scanf';
import { StructTable } from './StructTable';
import { UnionTable } from './UnionTable';

/**
 * Where function addresses are reported from.
 *
 * unicoen.ts starts its code segment at address 0, so the first function a
 * program defines is filed at 0 - the null pointer. A pointer to it would then
 * be false in an `if`, equal to `NULL`, and drawn as nothing, which is the one
 * thing a pointer to a real function can never be. Reporting the segment from
 * a fixed base fixes all three at once, and 0x1000 keeps every function below
 * the static area at 10000, which is where a text segment belongs.
 */
export const CODE_SEGMENT_BASE = 0x1000;

/**
 * A node's own span, in the interpreter's coordinates. Everything a runtime
 * diagnostic can blame is a node, and a diagnostic with nowhere to point is
 * not raised at all - the console line still says what happened.
 */
const rangeOfNode = (node: any): RuntimeDiagnostic | null => {
  const range =
    node === null || typeof node === 'undefined' ? null : node.codeRange;
  if (!range || !range.begin || !range.end) {
    return null;
  }
  return {
    rule: '',
    severity: 'error',
    message: '',
    fatal: true,
    line: range.begin.y,
    column: range.begin.x,
    endLine: range.end.y,
    endColumn: range.end.x,
  };
};

/**
 * Where the engine's static area begins (`Scope` starts its cursors at
 * `new Address(0, 10000, 20000, 50000)`). Below it is the code area, which is
 * where string literals and the library's own functions are written.
 */
const STATIC_AREA_BASE = 10000;

/** Where one string literal is, if it is anywhere: not every literal is. */
export interface StringLiteralLocation {
  /** The engine's own address, or `null` for a literal it never wrote out. */
  address: number | null;
  text: string;
  /** The bytes it would occupy, terminator included. */
  size: number;
}

/**
 * Every string literal in the program, in the order it was written.
 *
 * The engine only puts a literal in memory when something is initialized with
 * it: `const char *p = "hi"` writes the bytes and hands over the address, but
 * `printf("%d\n", n)` passes the bytes themselves and never gives them a
 * home. In C every literal is an object in read-only memory, so the program is
 * read for them rather than the memory alone.
 *
 * The walk is reflective because the node classes have no common accessor for
 * their children, and a switch over every one of them would have to be revised
 * each time unicoen adds a node.
 */
function stringLiteralsIn(root: unknown): string[] {
  const texts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (node instanceof UniStringLiteral) {
      const text = PlivetCPP14Engine.escapeText(String(node.value));
      if (texts.indexOf(text) === -1) {
        texts.push(text);
      }
      return;
    }
    for (const child of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(child)) {
        child.forEach(walk);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return texts;
}

/** A control character reads better as the escape it was written with. */
const ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\t': '\\t',
  '\r': '\\r',
  '\0': '\\0',
  '\v': '\\v',
  '\f': '\\f',
};

const escapedText = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u001f]/g, (character) =>
    typeof ESCAPES[character] === 'undefined'
      ? `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`
      : ESCAPES[character]
  );

/** Runtime reality is looser than unicoen.ts's declarations for tagless types. */
interface RuntimeClassDec {
  className: string | null;
  codeRange: { begin: { y: number } } | null;
}

interface RecordArrayAllocation {
  type: string;
  descriptors: number[];
  scope: Scope;
}

/**
 * unicoen.ts marks its two dispatch helpers private, so they are absent from
 * the declarations even though the running class has them. Naming them here is
 * how an override can hand a call on to the machinery that already knows how
 * to bind arguments and push a stack frame.
 */
interface DispatchingEngine {
  execFunc(
    dec: UniFunctionDec,
    scope: Scope,
    args: any[] | null
  ): Generator<any, any, any>;
  execFuncCall(func: unknown, args: any[]): Generator<any, any, any>;
}

/**
 * What a library function is called with. `execFuncCall` applies it to the
 * engine, whose stdin plumbing is `protected` and so absent from the type an
 * outside caller sees.
 */
interface StdinEngine {
  getStdout(): string;
  getStdin(): string;
  clearStdin(): void;
  stdin(text: string): void;
  stdout(text: string): void;
  setIsWaitingForStdin(enable: boolean): boolean;
  readonly currentScope: Scope;
}

/**
 * Writes one scanned value where its argument points. `%c` is the one
 * conversion that writes no terminator: it reads the characters the width asks
 * for and nothing else, so `char c; scanf("%c", &c)` leaves the byte after `c`
 * alone.
 */
const storeScanValue = (
  scope: Scope,
  address: number,
  value: ScanValue
): void => {
  if (value.kind === 'int' || value.kind === 'float') {
    scope.set(address, value.value);
    return;
  }
  const bytes = CPP14Engine.strToBytes(value.text);
  if (value.kind === 'char') {
    bytes.pop();
  }
  bytes.forEach((byte, i) => scope.set(address + i, byte));
};

/**
 * What a failed conversion says for itself.
 *
 * The text is here rather than in `strings.ts` because it is not interface
 * chrome: the interpreter writes it into the program's own output, where the
 * `printf`s around it are, which is the only place it makes sense of what just
 * happened.
 */
const scanFailureNote = (failure: ScanFailure): string =>
  `[scanf] ${failure.directive} did not match ${failure.found} - it stays in` +
  ` the input, so the next read starts there.\n`;

/**
 * `scanf`, as C defines it: the conversions in `scanf.ts` over an input that
 * arrives a line at a time.
 *
 * A library function is a generator whose first resume delivers the call's
 * arguments, and yielding with the waiting flag set is how it parks the
 * program until the console sends a line. The scan yields whenever it wants a
 * character that has not been typed yet, so one call can park more than once -
 * `scanf("%d %d", &a, &b)` answered one number at a time parks twice.
 *
 * There is no EOF to report. The standard input of a program running in this
 * page has no end: a read that cannot be satisfied waits instead of failing,
 * so the return value is only ever the number of conversions that were
 * assigned.
 */
const plivetScanf = function* (this: StdinEngine): Generator<any, number, any> {
  // `execFuncCall` resumes a library generator with the call's arguments.
  const args = yield;
  if (!Array.isArray(args) || args.length === 0) {
    return 0;
  }
  const raw = args[0];
  const format = typeof raw === 'string' ? raw : Engine.bytesToStr(raw);
  // The engine keeps escape sequences as the two characters they are written
  // with, exactly as it does for the format `printf` is given.
  const scanner = scan(CPP14Engine.escapeText(format), this.getStdin());
  this.clearStdin();
  let step = scanner.next('');
  while (!step.done) {
    this.setIsWaitingForStdin(true);
    yield;
    const line = this.getStdin();
    this.clearStdin();
    this.setIsWaitingForStdin(false);
    // A terminal echoes what was typed at it, and the console does not write
    // the line into the transcript itself. The newline is the Enter that sent
    // it, and it is what ends the line for the scan too.
    this.stdout(line + '\n');
    step = scanner.next(line + '\n');
  }

  const { values, rest, failure } = step.value;
  // Whatever the conversions did not want is the next read's input, including
  // the character a failed conversion refused to convert.
  this.stdin(rest);
  if (failure !== undefined && !failure.suppressed) {
    const note = scanFailureNote(failure);
    // `while (scanf("%d", &n) != 1);` fails identically on every turn, and one
    // note per turn would bury the program's own output. Saying it again only
    // once something else has been printed keeps it to the one that matters.
    if (!this.getStdout().endsWith(note)) {
      this.stdout(note);
    }
  }

  const addresses = args.slice(1);
  let assigned = 0;
  values.forEach((value, i) => {
    if (addresses.length <= i) {
      return;
    }
    storeScanValue(this.currentScope, addresses[i], value);
    if (value.counted) {
      assigned += 1;
    }
  });
  return assigned;
};

/**
 * The two standard-library functions PLIVET replaces, and why.
 *
 * `printf` resolves `%s` only for an address whose type in `typeOnMemory` names
 * char - that is, a `char*` variable. A string literal is passed as the byte
 * array the engine represents it with, and agh.sprintf then formats the array
 * itself, so `printf("%s\n", "abc")` prints `97,98,99,0`.
 *
 * That is independent of macros, but it is what stringification produces: `#x`
 * expands to a literal, so `printf("%s", STR(abc))` would hit it every time.
 *
 * The fix wraps the library function rather than restating it: the byte arrays
 * are decoded to strings before the original runs. Argument 0 is left alone -
 * it is the format string, which the original decodes itself.
 *
 * `scanf` is replaced outright rather than wrapped, by `plivetScanf` below:
 * the stock one hands the read to the `scanf` npm package, which has no notion
 * of a conversion that fails. See `scanf.ts`.
 */
export class PlivetCPP14Engine extends CPP14Engine {
  private structs = new StructTable();
  private unions = new UnionTable();
  private declarationSpecifiers = new DeclarationSpecifiers();
  private designatedInitializers = new DesignatedInitializers();
  private readonly recordArrays = new Map<number, RecordArrayAllocation>();
  /** Every string literal the program contains, in source order. */
  private sourceStrings: string[] = [];
  private readonly declarationInfoByAddress = new Map<
    number,
    RuntimeDeclarationInfo
  >();
  /** Where each function was filed on the code segment, both ways round. */
  private readonly functionAddresses = new Map<string, number>();
  private readonly functionsByAddress = new Map<number, UniFunctionDec>();
  private globalScope: Scope | null = null;
  private entryPoint: UniFunctionDec | null = null;
  private readonly expressions = new ExpressionRecorder();
  private readonly constructs = new ConstructRecorder();
  /** What the run has been told off for, in the order it happened. */
  private readonly runtimeDiagnostics: RuntimeDiagnostic[] = [];
  /**
   * Objects declared with no initializer that nothing has written yet. An
   * object enters only where the source is certain - a local declaration with
   * nothing after the name - and leaves on the first assignment or the first
   * time its address is taken, so a parameter, a global and anything `scanf`
   * was pointed at are never in it.
   */
  private readonly unwritten = new Set<number>();
  /** Addresses already reported, so a read in a loop is said once. */
  private readonly readUnwritten = new Set<number>();

  /** Installs the record metadata read from the program about to execute. */
  setRecordTables(structs: StructTable, unions: UnionTable): void {
    this.structs = structs;
    this.unions = unions;
    this.recordArrays.clear();
  }

  setDeclarationSpecifiers(specifiers: DeclarationSpecifiers): void {
    this.declarationSpecifiers = specifiers;
    this.declarationInfoByAddress.clear();
    this.functionAddresses.clear();
    this.functionsByAddress.clear();
    this.globalScope = null;
    this.entryPoint = null;
  }

  setDesignatedInitializers(initializers: DesignatedInitializers): void {
    this.designatedInitializers = initializers;
  }

  /** Restores member trees that the stock ExecState flattens out of arrays. */
  expandRecordArrays(state: ExecState): ExecState {
    for (const stack of state.getStacks()) {
      for (const variable of stack.getVariables()) {
        const allocation = this.recordArrays.get(variable.address);
        if (typeof allocation === 'undefined') {
          continue;
        }
        const elements = allocation.descriptors.map((descriptor, index) =>
          this.recordVariable(
            allocation.type,
            `${variable.name}[${index}]`,
            descriptor,
            variable.depth,
            allocation.scope
          )
        );
        (variable as any).value = elements;
      }
    }
    return state;
  }

  declarationInfoAt(address: number): RuntimeDeclarationInfo | null {
    const info = this.declarationInfoByAddress.get(address);
    return typeof info === 'undefined' ? null : info;
  }

  /**
   * The mapper represents structs, unions and C++ classes with the same node.
   * Use source-derived layouts for the first two and preserve the stock class
   * behaviour for every node the tables do not recognise.
   */
  protected execClassDec(dec: UniClassDec, scope: Scope): void {
    const runtimeDec = dec as unknown as RuntimeClassDec;
    let name = runtimeDec.className;
    let table = name === null ? null : this.tableFor(name);
    if (name === null && runtimeDec.codeRange !== null) {
      const line = runtimeDec.codeRange.begin.y;
      name = this.structs.nameAtLine(line);
      table = name === null ? null : this.structs;
      if (table === null) {
        name = this.unions.nameAtLine(line);
        table = name === null ? null : this.unions;
      }
    }
    if (table === null || name === null) {
      super.execClassDec(dec, scope);
      return;
    }
    const layout = table.layoutOf(name);
    if (layout === null) {
      super.execClassDec(dec, scope);
      return;
    }
    // The mapper drops the name from `typedef struct { ... } Name`; restoring
    // it lets the inherited typedef path bind Name to this registered layout.
    runtimeDec.className = name;
    const runtimeLayout = this.runtimeLayout(layout);
    for (const runtimeName of table.namesFor(name)) {
      // Scope's typedef map is not inherited by child scopes. Registering the
      // same layout under each alias makes local declarations resolve anyway.
      scope.setTop(runtimeName, runtimeLayout, 'CLASS');
    }
  }

  /** Uses the full descriptor-plus-members stride for an aggregate array. */
  protected *getAddress(expr: UniExpr, scope: Scope): any {
    if (
      expr instanceof UniBinOp &&
      expr.operator === '[]' &&
      expr.left instanceof UniIdent
    ) {
      const handle = scope.getAddress(expr.left.name);
      const allocation = this.recordArrays.get(handle);
      if (typeof allocation === 'undefined') {
        // The subscript of a plain array or a pointer. The base engine
        // computes base plus index times width whatever the index is, so an
        // index past the end quietly reads the object next to the array.
        const index = Number(
          (yield* this.execExpr(expr.right, scope)).valueOf()
        );
        this.checkSubscript(expr.left.name, index, scope);
        return yield* super.getAddress(
          new UniBinOp('[]', expr.left, new UniIntLiteral(index)),
          scope
        );
      }
      const index = Number((yield* this.execExpr(expr.right, scope)).valueOf());
      const descriptor = allocation.descriptors[index];
      if (typeof descriptor === 'undefined') {
        this.refuse(
          'array-out-of-bounds',
          `index ${index} is outside the array, which holds ` +
            `${allocation.descriptors.length}`
        );
      }
      return descriptor;
    }
    return yield* super.getAddress(expr, scope);
  }

  /**
   * `sizeof(recordVariable)` must use the source-derived record width, and a
   * function has to survive `&` and `*`.
   *
   * C says `add`, `&add` and `*add` all denote the same function, which is why
   * `int (*op)(int, int) = &add;` and `(*op)(2, 3)` are legal spellings of the
   * plain ones. The stock engine reads `&` as "the address this object was
   * given" and `*` as "the object at this address"; a function is filed under
   * neither rule, so both spellings lose it and the call that follows has
   * nothing to dispatch on.
   */
  protected *execUnaryOp(uniOp: UniUnaryOp, scope: Scope): any {
    if (uniOp.operator === '&' && uniOp.expr instanceof UniIdent) {
      const designator = this.functionNamed(uniOp.expr.name, scope);
      if (designator !== null) {
        return this.functionAddressOf(designator, scope);
      }
    }
    if (uniOp.operator === '*') {
      // Evaluated once and not handed on, so `*p++` still increments once.
      const target = yield* this.execExpr(uniOp.expr, scope);
      if (Number(target) === 0) {
        this.refuse(
          'null-dereference',
          'dereference of a pointer that points at nothing'
        );
      }
      return this.functionAt(Number(target), scope) === null
        ? scope.getValue(target)
        : target;
    }
    if (uniOp.operator === '&') {
      const address = yield* this.getAddress(uniOp.expr, scope);
      // Whoever was handed the address may write through it, which is what
      // `scanf("%d", &n)` is for.
      this.noteWrite(address);
      const info = this.declarationInfoByAddress.get(address);
      if (info !== undefined && info.region === 'register') {
        this.refuse(
          'register-address',
          'cannot take the address of a register variable'
        );
      }
      return address;
    }
    if (uniOp.operator === 'sizeof' && uniOp.expr instanceof UniIdent) {
      const ident = uniOp.expr.name;
      const type = scope.hasType(ident) ? scope.getRawType(ident) : ident;
      const baseType = type.replace(/\[[^\]]*\]/g, '').trim();
      const table = this.tableFor(baseType);
      if (table !== null) {
        const dimensions =
          type.indexOf('[') === -1 ? [] : scope.getArrayDims(type);
        const count = dimensions.reduce((total, length) => total * length, 1);
        return table.displaySizeOf(baseType) * count;
      }
    }
    return yield* super.execUnaryOp(uniOp, scope);
  }

  /**
   * A function used as a value becomes its address on the code segment.
   *
   * `Scope.setTop` files every function there under its name, so the address
   * already exists; what the stock engine yields for the name is the
   * `UniFunctionDec` itself. That object cannot be a variable's value here:
   * `ExecState.makeImple` skips any variable holding a `UniNode`, so
   * `int (*op)(int, int) = add;` would run correctly and then be invisible on
   * the canvas - and a visualizer that cannot show the variable has not
   * really added the type. An address is also what C says a function pointer
   * holds, which makes `op == add`, `(int)op` and a null check fall out for
   * free instead of each needing a rule.
   *
   * Calls are unaffected: `execMethoodCall` reads the name out of the scope
   * itself rather than going through here, so `add(1, 2)` still finds the
   * declaration.
   */
  protected *execExpr(expr: UniExpr, scope: Scope): any {
    if (expr instanceof UniIdent) {
      this.checkRead(expr, scope);
    }
    // `Break`, `Continue` and `Return` are how the engine leaves a statement,
    // so an evaluation that never finishes is ordinary; what the recorder was
    // told is starting has to be closed either way.
    const marks = this.constructs.begins(expr);
    let value: any;
    try {
      value = yield* super.execExpr(expr, scope);
    } finally {
      this.constructs.ends(marks);
    }
    const result =
      value instanceof UniFunctionDec
        ? (this.functionAddressOf(value, scope) ?? value)
        : value;
    this.constructs.yields(expr, marks, result);
    this.expressions.capture(expr, result);
    return result;
  }

  protected *execIf(statement: UniIf, scope: Scope): any {
    const depth = this.constructs.entered(statement, 'if');
    try {
      return yield* super.execIf(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  protected *execFor(statement: UniFor, scope: Scope): any {
    const depth = this.constructs.entered(statement, 'for');
    try {
      return yield* super.execFor(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  /**
   * `UniDoWhile` extends `UniWhile`, and the stock dispatch tests the base
   * class first, so a do-while arrives here too. Only the label differs: what
   * the engine does with either is what this override is wrapping.
   */
  protected *execWhile(statement: UniWhile, scope: Scope): any {
    const depth = this.constructs.entered(
      statement,
      statement instanceof UniDoWhile ? 'doWhile' : 'while'
    );
    try {
      return yield* super.execWhile(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  protected *execSwitch(statement: UniSwitch, scope: Scope): any {
    const depth = this.constructs.entered(statement, 'switch');
    try {
      return yield* super.execSwitch(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  protected *stopByYield(ret: any, nextExpr: UniExpr): any {
    this.expressions.beforeYield(this.currentState, nextExpr);
    this.constructs.attach(this.currentState);
    return yield* super.stopByYield(ret, nextExpr);
  }

  stepExecute(): ExecState {
    const state = super.stepExecute();
    if (!this.isStepExecutionRunning()) {
      this.expressions.finish(state);
      this.constructs.finish(state);
    }
    return state;
  }

  protected *executeStepByStep(dec: UniProgram): any {
    this.entryPoint = this.getEntryPoint(dec);
    this.sourceStrings = stringLiteralsIn(dec);
    this.constructs.reset(dec, this.entryPoint);
    return yield* super.executeStepByStep(dec);
  }

  /**
   * Calls through a function pointer, in either spelling.
   *
   * `op(2, 3)` reaches the stock engine as a call whose name resolves to a
   * number, and `(*op)(2, 3)`, `(*ops[1])(7, 3)` and `(*o.fn)(2, 3)` reach it
   * as a call whose `methodName` is the dereference rather than an identifier;
   * the stock engine reads `mc.methodName.name` unconditionally and looks up a
   * variable called `undefined`. Both need the callee turned back into the
   * function its address stands for.
   */
  protected *execMethoodCall(mc: UniMethodCall, scope: Scope): any {
    const depth = this.constructs.calling(
      mc,
      this.declarationCalledBy(mc, scope)
    );
    try {
      if (mc.receiver !== null) {
        return yield* super.execMethoodCall(mc, scope);
      }
      const callee = yield* this.calleeOf(mc, scope);
      if (callee === null) {
        return yield* super.execMethoodCall(mc, scope);
      }
      const args: any[] = [];
      for (const arg of mc.args) {
        args.push(yield* this.execExpr(arg, scope));
      }
      return yield* (this as unknown as DispatchingEngine).execFunc(
        callee,
        scope,
        args
      );
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  /**
   * The definition a call names, where the program defines one. A library
   * function has no definition to point a tooltip at, and a call through a
   * pointer only resolves by running the expression - which this must not do,
   * because it is asked before the call has begun.
   */
  private declarationCalledBy(
    mc: UniMethodCall,
    scope: Scope
  ): UniFunctionDec | null {
    return mc.receiver === null && mc.methodName instanceof UniIdent
      ? this.functionNamed(mc.methodName.name, scope)
      : null;
  }

  /**
   * The function a call goes through when it goes through a pointer, or null
   * when the stock lookup should handle it.
   *
   * A plain name is only treated as a pointer when it was declared as one.
   * Without that test an ordinary `int` holding a small number would be
   * callable, because the code segment starts at zero and functions sit four
   * bytes apart.
   */
  private *calleeOf(mc: UniMethodCall, scope: Scope): any {
    if (mc.methodName instanceof UniIdent) {
      const name = mc.methodName.name;
      if (
        !scope.hasType(name) ||
        !isFunctionPointerType(scope.getRawType(name))
      ) {
        return null;
      }
      return this.functionAt(Number(scope.get(name)), scope);
    }
    return this.functionAt(
      Number(yield* this.execExpr(mc.methodName, scope)),
      scope
    );
  }

  /**
   * A function pointer is true when it holds an address.
   *
   * An address arrives here as a plain number, which the stock conversion
   * rejects outright - it accepts only booleans and boxed ones. It also reads
   * a boxed number with `obj !== 0`, comparing an object against a primitive,
   * which is true for every value including zero; that is why `if (!op)` and
   * `if (op == 0)` disagree today. Both readings are fixed here because a null
   * check is how a program asks whether a callback was ever set.
   */
  toBool(value: any): boolean {
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (value instanceof Number) {
      return Number(value.valueOf()) !== 0;
    }
    return super.toBool(value);
  }

  /** Where a function sits on the code segment, or null when it is unknown. */
  functionAddressOf(dec: UniFunctionDec, scope?: Scope): number | null {
    const known = this.functionAddresses.get(dec.name);
    if (typeof known !== 'undefined') {
      return known;
    }
    this.indexFunctions(scope);
    const found = this.functionAddresses.get(dec.name);
    return typeof found === 'undefined' ? null : found;
  }

  /**
   * The function this name denotes, or null when it names something else.
   *
   * A variable holding a function pointer resolves to an address, not to a
   * declaration, so the two are already distinct - but a name bound directly
   * to a declaration could still be either. Its own name settles it: C gives a
   * function and a variable in one scope no way to share one.
   */
  /**
   * What an address holds, for the tooltip that wants to say what an
   * assignment replaced. The engine throws for an object nothing has written,
   * which is not an error here - it is the answer, and the fact is left off
   * rather than invented.
   */
  private valueAt(address: number, scope: Scope): unknown {
    try {
      return scope.getValue(address);
    } catch {
      return undefined;
    }
  }

  private functionNamed(name: string, scope: Scope): UniFunctionDec | null {
    if (!scope.hasValue(name)) {
      return null;
    }
    const value = scope.get(name);
    return value instanceof UniFunctionDec && value.name === name
      ? value
      : null;
  }

  /** The name of the function at a code address, for the visualizer. */
  functionNameAt(address: number): string | null {
    const dec = this.functionAt(address);
    return dec === null ? null : dec.name;
  }

  /**
   * The string literals the program loaded, as objects.
   *
   * `"hello"` is not a variable and never becomes one: the engine writes its
   * bytes into the low code area as consecutive `char` entries and hands the
   * address to whatever named it, so `ExecState` - which only walks scopes -
   * has never seen them, and a canvas built from it showed a `const char *`
   * pointing at nothing. They are read-only memory, and this is where they are
   * read out of.
   */
  stringLiterals(): StringLiteralLocation[] {
    const written = this.writtenStrings();
    const byText = new Map(written.map((one) => [one.text, one]));
    const literals: StringLiteralLocation[] = [];
    // Source order, and one object per distinct literal: a C implementation is
    // free to pool them, and two copies of `"%d\n"` in the same program are
    // one string in read-only memory rather than two.
    for (const text of this.sourceStrings) {
      const materialized = byText.get(text);
      literals.push({
        address:
          typeof materialized === 'undefined' ? null : materialized.address,
        text: escapedText(text),
        size: text.length + 1,
      });
      byText.delete(text);
    }
    // Anything the engine wrote that the source did not obviously spell - a
    // literal the preprocessor built, say - is still in memory and still worth
    // showing.
    for (const one of byText.values()) {
      literals.push({
        address: one.address,
        text: escapedText(one.text),
        size: one.text.length + 1,
      });
    }
    return literals;
  }

  /**
   * The strings the engine has actually written into the low code area, read
   * back as runs of consecutive `char` bytes.
   */
  private writtenStrings(): { address: number; text: string }[] {
    const scope = this.globalScope;
    if (scope === null) {
      return [];
    }
    const addresses = Array.from(scope.typeOnMemory.entries())
      .filter(
        ([address, type]) => address < STATIC_AREA_BASE && type === 'char'
      )
      .map(([address]) => address)
      .sort((left, right) => left - right);

    const written: { address: number; text: string }[] = [];
    let start: number | null = null;
    let bytes: number[] = [];
    const flush = () => {
      if (start !== null && 0 < bytes.length) {
        written.push({ address: start, text: String.fromCharCode(...bytes) });
      }
      start = null;
      bytes = [];
    };
    let previous: number | null = null;
    for (const address of addresses) {
      if (previous !== null && address !== previous + 1) {
        flush();
      }
      const value = scope.objectOnMemory.get(address);
      const byte =
        value === null || typeof value === 'undefined'
          ? 0
          : Number(value.valueOf());
      if (byte === 0) {
        // The NUL ends this string; the next byte starts another.
        flush();
      } else {
        if (start === null) {
          start = address;
        }
        bytes.push(byte);
      }
      previous = address;
    }
    flush();
    return written;
  }

  /** Plain text-segment entries for the Worker model. */
  functionLocations(): { name: string; address: number }[] {
    this.indexFunctions();
    const locations = Array.from(this.functionAddresses.entries()).map(
      ([name, address]) => ({ name, address })
    );
    const entryPoint = this.entryPoint;
    if (
      entryPoint !== null &&
      !locations.some((item) => item.name === entryPoint.name)
    ) {
      const lastAddress = locations.reduce(
        (maximum, item) => Math.max(maximum, item.address),
        CODE_SEGMENT_BASE - 4
      );
      locations.push({
        name: entryPoint.name,
        address: lastAddress + 4,
      });
    }
    return locations.sort((left, right) => left.address - right.address);
  }

  protected loadLibarary(global: Scope): void {
    this.globalScope = global;
    super.loadLibarary(global);
  }

  /** The function at a code address, or null when nothing is filed there. */
  functionAt(address: number, scope?: Scope): UniFunctionDec | null {
    this.indexFunctions(scope);
    const dec = this.functionsByAddress.get(address);
    return typeof dec === 'undefined' ? null : dec;
  }

  /**
   * Both directions of the function/address mapping, read out of the scope the
   * functions were filed in. Keyed by name rather than by node, because the
   * step history deep-copies each `ExecState` and a copied declaration is no
   * longer the object that was registered.
   */
  private indexFunctions(scope?: Scope): void {
    const global =
      typeof scope === 'undefined' ? this.globalScope : scope.global;
    if (global === null || typeof global === 'undefined') {
      return;
    }
    this.globalScope = global;
    for (const address of global.variableAddress.values()) {
      const value = global.objectOnMemory.get(address);
      if (value instanceof UniFunctionDec) {
        this.functionAddresses.set(value.name, CODE_SEGMENT_BASE + address);
        this.functionsByAddress.set(CODE_SEGMENT_BASE + address, value);
      }
    }
  }

  /** Allocates record arrays and retains declaration metadata. */
  protected *execVariableDec(decVar: UniVariableDec, scope: Scope): any {
    // Every declaration reaches here, so this is the earliest and only hook
    // needed to keep hold of the scope the functions were filed in.
    this.globalScope = scope.global;
    const firstVariable = decVar.variables[0];
    const sourceInfo = decVar.variables.map((def) =>
      typeof firstVariable === 'undefined'
        ? null
        : this.declarationSpecifiers.infoForVariable(
            decVar.codeRange,
            def.codeRange,
            firstVariable.codeRange
          )
    );
    const arrayDimensions = decVar.variables.map((def) =>
      def.typeSuffix === null ? [] : scope.getArrayDims(def.typeSuffix)
    );
    const hasSpecialArray = decVar.variables.some(
      (def, index) =>
        arrayDimensions[index].length === 1 &&
        ((decVar.type.indexOf('*') === -1 &&
          !/^[*&]/.test(def.name) &&
          this.tableFor(decVar.type) !== null) ||
          (def.value instanceof UniArray &&
            this.designatedInitializers.hasIn(decVar.codeRange)))
    );
    let value: any = null;
    if (!hasSpecialArray) {
      value = yield* super.execVariableDec(decVar, scope);
    } else {
      Engine.lastSizeOf = decVar.type;
      for (let index = 0; index < decVar.variables.length; index += 1) {
        const def = decVar.variables[index];
        const dimensions = arrayDimensions[index];
        const table =
          decVar.type.indexOf('*') === -1 && !/^[*&]/.test(def.name)
            ? this.tableFor(decVar.type)
            : null;
        const designated =
          def.value instanceof UniArray &&
          this.designatedInitializers.hasIn(decVar.codeRange);
        if (dimensions.length !== 1 || (table === null && !designated)) {
          const single = new UniVariableDec(decVar.modifiers, decVar.type, [
            def,
          ]);
          value = yield* super.execVariableDec(single, scope);
          continue;
        }

        let elements: any[];
        if (def.value instanceof UniArray) {
          const evaluated = yield* this.execExpr(def.value, scope);
          elements = this.designatedInitializers.order(
            decVar.codeRange,
            def.value,
            evaluated,
            dimensions[0],
            table === null ? 0 : []
          );
        } else {
          elements = Array.from(new Array(dimensions[0]), () => null);
        }
        if (table === null) {
          while (def.name.startsWith('*')) {
            def.name = def.name.substring(1);
            decVar.type += '*';
          }
          while (def.name.startsWith('&')) {
            def.name = def.name.substring(1);
            decVar.type += '&';
          }
          value = elements;
          scope.setTop(def.name, value, decVar.type);
        } else {
          value = this.allocateRecordArray(
            def.name,
            decVar.type,
            def.typeSuffix,
            elements,
            scope
          );
        }
      }
      Engine.lastSizeOf = '';
    }
    for (let index = 0; index < decVar.variables.length; index += 1) {
      const def = decVar.variables[index];
      const sourceDeclaration = sourceInfo[index];
      const declaration =
        sourceDeclaration === null
          ? {
              storageClasses: [],
              qualifiers: [],
              baseQualifiers: [],
              pointerQualifiers: [],
            }
          : sourceDeclaration;
      const storageClasses = this.uniqueStorageClasses(
        declaration.storageClasses.concat(
          decVar.modifiers.filter((item) =>
            this.isStorageClass(item)
          ) as StorageClass[]
        )
      );
      const address = scope.variableAddress.get(def.name);
      if (typeof address === 'undefined') {
        continue;
      }
      const info: RuntimeDeclarationInfo = {
        storageClasses,
        qualifiers: declaration.qualifiers,
        baseQualifiers: declaration.baseQualifiers,
        pointerQualifiers: declaration.pointerQualifiers,
        region: this.storageRegion(storageClasses, scope),
        initialized:
          def.value !== null && !(def.value instanceof UniNoneLiteral),
        readOnly: false,
      };
      info.readOnly = this.constBindsObject(info, scope.getRawType(address));
      this.declarationInfoByAddress.set(address, info);
      const recordArray = this.recordArrays.get(address);
      if (typeof recordArray !== 'undefined') {
        for (const descriptor of recordArray.descriptors) {
          this.declarationInfoByAddress.set(descriptor, info);
          this.registerRecordFields(decVar.type, descriptor, info);
        }
        continue;
      }
      this.registerRecordFields(decVar.type, address, info);
      if (def.typeSuffix !== null && def.typeSuffix !== '') {
        const arrayAddress = scope.objectOnMemory.get(address);
        if (typeof arrayAddress === 'number') {
          const dimensions = scope.getArrayDims(def.typeSuffix);
          const count = dimensions.reduce((total, length) => total * length, 1);
          const elementSize = Engine.sizeof(decVar.type);
          for (let element = 0; element < count; element += 1) {
            this.declarationInfoByAddress.set(
              arrayAddress + element * elementSize,
              info
            );
          }
        }
      }
    }
    this.noteDeclaration(decVar, scope);
    return value;
  }

  /**
   * Dividing by zero. C leaves it undefined for integers, and the engine
   * computes in JavaScript numbers, where it quietly yields `Infinity` - a
   * value no C program can produce and the memory view cannot show. Both
   * operands come through here already evaluated, so this is the last point
   * where the program can be stopped on the statement that did it.
   */
  protected execBinOpImple(op: string, l: any, r: any): any {
    if ((op === '/' || op === '%') && Number(r?.valueOf?.() ?? r) === 0) {
      this.refuse(
        'division-by-zero',
        op === '/' ? 'division by zero' : 'remainder of a division by zero'
      );
    }
    return super.execBinOpImple(op, l, r);
  }

  protected execAssign(address: number, value: any, scope: Scope): any {
    this.constructs.assigns(this.valueAt(address, scope));
    this.noteWrite(address);
    const info = this.declarationInfoByAddress.get(address);
    const type = scope.getRawType(address);
    if (info !== undefined && this.constBindsObject(info, type)) {
      this.refuse('read-only-assignment', 'assignment of a read-only variable');
    }
    if (type.indexOf('*') === -1 && this.tableFor(type) !== null) {
      return this.copyRecord(type, address, value, scope);
    }
    return super.execAssign(address, value, scope);
  }

  protected includeStdio(global: Scope): void {
    super.includeStdio(global);
    const original = global.get('printf');
    if (typeof original !== 'function') {
      return;
    }
    // A `function` rather than an arrow: the wrapper is called as a method of
    // the engine's global object, and the arrow would capture the wrong `this`.
    const wrapped = function (this: unknown, ...args: any[]) {
      for (let i = 1; i < args.length; i += 1) {
        if (Array.isArray(args[i])) {
          args[i] = Engine.bytesToStr(args[i]);
        }
      }
      return original.apply(this, args);
    };
    global.setTop('printf', wrapped, 'FUNCTION');
    global.setTop('scanf', plivetScanf, 'FUNCTION');
  }

  /**
   * What `malloc` hands back: memory the program has not written yet.
   *
   * The engine fills a fresh block with random words, and a random word on the
   * canvas reads as a value something put there - the wrong lesson twice over,
   * because the number means nothing and nothing tells it apart from a number
   * the program computed. A block carved out of memory nothing has held before
   * is blanked instead, to the same empty value a local declared without an
   * initializer holds, so the row says `uninitialized` until the program
   * writes something into it.
   *
   * Only memory nothing has held before is blanked. What is already written at
   * an address the allocator hands out again is the truth about that memory -
   * a reader who finds the last owner's value in a new block has learned what
   * `free` does and does not do - so it is left where it is.
   */
  protected includeStdlib(global: Scope): void {
    super.includeStdlib(global);
    const allocate = global.get('malloc');
    if (typeof allocate !== 'function') {
      return;
    }
    // A `function` rather than an arrow, for the reason `includeStdio` gives.
    const wrapped = function (this: unknown, ...args: any[]) {
      const start = global.address.heapAddress;
      const requested = Number(args[0]);
      // What is written where the block is about to land, read before the
      // allocator writes over it. This engine's heap cursor only moves
      // forward, so it is empty for every block it carves; an allocator that
      // filled the hole a `free` left would find the last owner's values here.
      const held = new Map<number, any>();
      const span =
        (Number.isFinite(requested) ? Math.max(requested, 0) : 0) +
        Engine.structInfoSize;
      for (let address = start; address < start + span; address += 1) {
        if (global.objectOnMemory.has(address)) {
          held.set(address, global.objectOnMemory.get(address));
        }
      }
      const block = allocate.apply(this, args);
      if (typeof block !== 'number' || block === 0) {
        // Nothing was allocated: `malloc` answering with a null pointer is the
        // one case where there is no block to say anything about.
        return block;
      }
      for (
        let address = block;
        address < global.address.heapAddress;
        address += 1
      ) {
        const type = global.typeOnMemory.get(address);
        if (typeof type === 'undefined') {
          continue;
        }
        if (held.has(address)) {
          global.objectOnMemory.set(address, held.get(address));
          continue;
        }
        // The word a record's block opens with is the address of its members
        // rather than one of them, and blanking it would lose the block.
        if (address === block && global.isStructType(type)) {
          continue;
        }
        global.objectOnMemory.set(address, null);
      }
      return block;
    };
    global.setTop('malloc', wrapped, 'FUNCTION');
  }

  /** Allocates each element with the same descriptor/member shape as a scalar. */
  private allocateRecordArray(
    name: string,
    type: string,
    suffix: string,
    initializers: any[],
    scope: Scope
  ): number {
    const table = this.tableFor(type)!;
    const stride = Engine.structInfoSize + table.sizeOf(type);
    const descriptors: number[] = [];
    let descriptor = scope.address.stackAddress;
    for (const initializer of initializers) {
      descriptors.push(descriptor);
      this.writeRecord(
        type,
        descriptor,
        initializer,
        initializer !== null,
        scope
      );
      descriptor += stride;
    }
    scope.address.stackAddress = descriptor;

    const handle = scope.address.codeAddress;
    const arrayType = type + suffix;
    scope.variableAddress.set(name, handle);
    scope.variableTypes.set(name, arrayType);
    scope.objectOnMemory.set(handle, descriptors[0]);
    scope.typeOnMemory.set(handle, arrayType);
    scope.address.codeAddress += Engine.sizeof(arrayType);
    const allocation = { type, descriptors, scope };
    // Scope stores the variable under `handle`, but ExecState replaces an
    // array variable's address with the first element address while snapshotting.
    this.recordArrays.set(handle, allocation);
    this.recordArrays.set(descriptors[0], allocation);
    return descriptors[0];
  }

  /**
   * Assigns one record to another the way C does: member by member, into the
   * storage the destination already owns.
   *
   * The inherited path copies each member's stored word. That is right for a
   * scalar and wrong for a member that is itself a record, because the word
   * held there is the address of that member's own block - copying it hands
   * both records the same nested object, and a later write through one shows
   * up in the other. Recursing gives a nested member the same treatment as the
   * whole record. A pointer member is still copied as the word it is, which is
   * what C means by a shallow copy.
   */
  private copyRecord(
    type: string,
    descriptor: number,
    source: any,
    scope: Scope
  ): any {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type);
    const members = table.membersOf(type);
    const target = scope.getValue(descriptor);
    if (
      layout === null ||
      members === null ||
      typeof target !== 'number' ||
      typeof source !== 'number'
    ) {
      // Nothing to walk: leave the write to the inherited path rather than
      // computing member addresses from a value that is not one.
      return super.execAssign(descriptor, source, scope);
    }
    // A record with a const member is not assignable as a whole, so refuse
    // before the first member moves - half a copy is worse than none.
    const readOnly = this.readOnlyMemberOf(type, target, scope);
    if (readOnly !== null) {
      this.refuse(
        'read-only-assignment',
        `assignment of a record with the read-only member ${readOnly}`
      );
    }
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const destination = target + field[0];
      const origin = source + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      if (nested !== null) {
        this.copyRecord(
          member.type,
          destination,
          scope.getValue(origin),
          scope
        );
        continue;
      }
      if (scope.objectOnMemory.has(origin)) {
        scope.objectOnMemory.set(destination, scope.getValue(origin));
      }
    }
    return target;
  }

  /**
   * The first const member the record holds, named as the program writes it,
   * or null if every member is assignable. Members are checked here rather
   * than in `execAssign` because a whole-record assignment never reaches it
   * for a member: the copy writes their addresses directly.
   */
  private readOnlyMemberOf(
    type: string,
    memberBase: number,
    scope: Scope
  ): string | null {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type);
    const members = table.membersOf(type);
    if (layout === null || members === null) {
      return null;
    }
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const address = memberBase + field[0];
      const info = this.declarationInfoByAddress.get(address);
      if (info !== undefined && this.constBindsObject(info, member.type)) {
        return member.name;
      }
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      if (nested === null) {
        continue;
      }
      const nestedBase = scope.getValue(address);
      if (typeof nestedBase !== 'number') {
        continue;
      }
      const found = this.readOnlyMemberOf(member.type, nestedBase, scope);
      if (found !== null) {
        return `${member.name}.${found}`;
      }
    }
    return null;
  }

  /** Writes one record and recursively materialises record-valued members. */
  private writeRecord(
    type: string,
    descriptor: number,
    initializer: any,
    zeroFill: boolean,
    scope: Scope
  ): void {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type)!;
    const members = table.membersOf(type)!;
    const values = Array.isArray(initializer) ? initializer : [];
    const memberBase = descriptor + Engine.structInfoSize;
    scope.typeOnMemory.set(descriptor, type);
    scope.objectOnMemory.set(descriptor, memberBase);

    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const field = layout.get(member.name)!;
      const address = memberBase + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      const hasValue = index < values.length;
      if (nested !== null) {
        this.writeRecord(
          member.type,
          address,
          hasValue ? values[index] : [],
          zeroFill || !hasValue,
          scope
        );
      } else if (table !== this.unions || index === 0) {
        scope.typeOnMemory.set(address, field[1]);
        scope.objectOnMemory.set(
          address,
          hasValue ? values[index] : zeroFill ? 0 : this.randInt32()
        );
      }
    }
  }

  /** Builds the member Variables that ExecState omits for record elements. */
  private recordVariable(
    type: string,
    name: string,
    descriptor: number,
    depth: number,
    scope: Scope
  ): Variable {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type)!;
    const members = table.membersOf(type)!;
    const memberBase = scope.objectOnMemory.get(descriptor);
    const fields = members.map((member) => {
      const field = layout.get(member.name)!;
      const address = memberBase + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      return nested === null
        ? new Variable(
            field[1],
            member.name,
            scope.objectOnMemory.get(address),
            address,
            depth
          )
        : this.recordVariable(member.type, member.name, address, depth, scope);
    });
    const variable = new Variable(type, name, null, descriptor, depth);
    (variable as any).value = fields;
    return variable;
  }

  /**
   * Refuses what C refuses, where the user is looking.
   *
   * `Engine.execFunc` swallows every exception a statement throws, so a bare
   * throw ends the program with nothing to show for it: the output stops, the
   * canvas holds the last state, and nothing says which line the program died
   * on or why. Writing the reason to the console before throwing is what turns
   * that silence into a diagnostic. The throw still ends the run - a program
   * that has done something C does not allow has no defined behaviour to
   * continue with - and the console keeps everything printed up to that point.
   */
  private refuse(rule: string, message: string): never {
    const transcript = this.getStdout();
    const separator =
      transcript === '' || transcript.endsWith('\n') ? '' : '\n';
    const line = this.currentLine();
    const where = line === null ? '' : ` on line ${line}`;
    this.stdout(`${separator}PLIVET stopped the program${where}: ${message}\n`);
    this.record(rule, 'error', message, true, this.currentRange());
    throw new UniRuntimeError(message);
  }

  /**
   * What C leaves undefined about a subscript: an index outside the array, and
   * a subscript of a pointer that points at nothing.
   *
   * Only an object whose declared type says how long it is can be checked. A
   * pointer knows nothing about the block it addresses - `p[7]` on a
   * `malloc(4)` is exactly as legal to the compiler as `p[0]` - so what is
   * checked there is that it addresses something at all.
   */
  private checkSubscript(name: string, index: number, scope: Scope): void {
    let type = '';
    try {
      type = scope.getRawType(name);
    } catch {
      return;
    }
    if (typeof type !== 'string') {
      return;
    }
    if (type.indexOf('[') === -1) {
      if (
        type.indexOf('*') !== -1 &&
        Number(scope.getValue(scope.getAddress(name))) === 0
      ) {
        this.refuse(
          'null-dereference',
          `${name} points at nothing, so ${name}[${index}] has no object`
        );
      }
      return;
    }
    const dimensions = scope.getArrayDims(type);
    const length = dimensions.length === 0 ? 0 : dimensions[0];
    if (length <= 0) {
      return;
    }
    if (index < 0 || length <= index) {
      this.refuse(
        'array-out-of-bounds',
        `index ${index} is outside ${name}, which holds ${length}` +
          `${dimensions.length === 1 ? '' : ' rows'}`
      );
    }
  }

  /**
   * Whether the object at an address has been written since it was declared.
   * Nothing enters `unwritten` unless the source is certain about it, so the
   * answer is only ever given about a local declared with no initializer.
   */
  private noteWrite(address: number): void {
    this.unwritten.delete(address);
  }

  /**
   * The read of an object nothing has written. Reported once per object: a
   * loop reading it a thousand times is one mistake, not a thousand.
   */
  private checkRead(expr: UniIdent, scope: Scope): void {
    let address = -1;
    try {
      address = scope.getAddress(expr.name);
    } catch {
      return;
    }
    if (!this.unwritten.has(address) || this.readUnwritten.has(address)) {
      return;
    }
    this.readUnwritten.add(address);
    this.warn(
      'uninitialized-read',
      `${expr.name} has not been given a value yet, so this reads whatever ` +
        `was left in its memory`,
      rangeOfNode(expr)
    );
  }

  /**
   * The locals a declaration leaves empty. An array is left out - a partly
   * filled one is ordinary C - and so is anything with static storage, which
   * the standard fills with zero before the program starts.
   */
  private noteDeclaration(decVar: UniVariableDec, scope: Scope): void {
    if (
      scope === scope.global ||
      (Array.isArray(decVar.modifiers) &&
        (decVar.modifiers.indexOf('static') !== -1 ||
          decVar.modifiers.indexOf('extern') !== -1))
    ) {
      return;
    }
    if (this.tableFor(decVar.type) !== null) {
      return;
    }
    for (const def of decVar.variables) {
      if (def.value !== null || def.typeSuffix !== null) {
        continue;
      }
      const name = def.name.replace(/^[*&]+/, '');
      try {
        this.unwritten.add(scope.getAddress(name));
      } catch {
        // A declaration the scope did not take is not one to watch.
      }
    }
  }

  /**
   * The same, for what C leaves undefined but does not stop for. Reading an
   * object nobody has written is a fact about the program worth saying where
   * the reader is looking; ending the run over it would teach that C does
   * something it does not do.
   */
  private warn(
    rule: string,
    message: string,
    range: RuntimeDiagnostic | null = null
  ): void {
    this.record(rule, 'warning', message, false, range);
  }

  private record(
    rule: string,
    severity: 'warning' | 'error',
    message: string,
    fatal: boolean,
    range: RuntimeDiagnostic | null
  ): void {
    if (range === null) {
      return;
    }
    this.runtimeDiagnostics.push({ ...range, rule, severity, message, fatal });
  }

  /** Everything this run has been told off for. Cleared with the session. */
  public diagnostics(): RuntimeDiagnostic[] {
    return this.runtimeDiagnostics.slice();
  }

  /**
   * The statement the engine stopped at, as a range. The current expression is
   * the one that last produced a value, which by the time something is refused
   * is the statement before it; the next one is what it stopped to run.
   */
  private currentRange(): RuntimeDiagnostic | null {
    const expr =
      this.currentState.getNextExpr() ?? this.currentState.getCurrentExpr();
    return rangeOfNode(expr);
  }

  /**
   * The source line of the statement being executed, as the user typed it.
   *
   * The state's *current* expression is the one that last produced a value,
   * which by the time a statement is refused is the statement before it. The
   * next expression is the one the engine stopped at to run, and that is the
   * one to blame.
   */
  private currentLine(): number | null {
    const expr =
      this.currentState.getNextExpr() ?? this.currentState.getCurrentExpr();
    const range = typeof expr === 'undefined' ? null : expr.codeRange;
    if (range === null || typeof range === 'undefined') {
      return null;
    }
    return range.begin.y;
  }

  private tableFor(name: string): RecordTable | null {
    if (this.structs.has(name)) {
      return this.structs;
    }
    return this.unions.has(name) ? this.unions : null;
  }

  private isStorageClass(value: string): value is StorageClass {
    return (
      value === 'auto' ||
      value === 'register' ||
      value === 'static' ||
      value === 'extern' ||
      value === '_Thread_local' ||
      value === 'thread_local'
    );
  }

  private uniqueStorageClasses(values: StorageClass[]): StorageClass[] {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  private storageRegion(
    storageClasses: StorageClass[],
    scope: Scope
  ): StorageRegion {
    if (storageClasses.indexOf('register') !== -1) {
      return 'register';
    }
    if (
      storageClasses.indexOf('static') !== -1 ||
      storageClasses.indexOf('_Thread_local') !== -1 ||
      storageClasses.indexOf('thread_local') !== -1
    ) {
      return 'static';
    }
    if (scope.parent === null || storageClasses.indexOf('extern') !== -1) {
      return 'global';
    }
    return 'stack';
  }

  private constBindsObject(
    info: RuntimeDeclarationInfo,
    type: string
  ): boolean {
    if (type.indexOf('*') === -1) {
      return (info.baseQualifiers || info.qualifiers).indexOf('const') !== -1;
    }
    const levels = info.pointerQualifiers || [];
    return (
      levels.length > 0 && levels[levels.length - 1].indexOf('const') !== -1
    );
  }

  private registerRecordFields(
    type: string,
    descriptorAddress: number,
    parentInfo: RuntimeDeclarationInfo
  ): void {
    const table = this.tableFor(type);
    if (table === null || type.indexOf('*') !== -1) {
      return;
    }
    const layout = table.layoutOf(type);
    const members = table.membersOf(type);
    if (layout === null || members === null) {
      return;
    }
    const parentConst =
      (parentInfo.baseQualifiers || parentInfo.qualifiers).indexOf('const') !==
      -1;
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const address = descriptorAddress + Engine.structInfoSize + field[0];
      const baseQualifiers = parentConst
        ? this.uniqueQualifiers(member.baseQualifiers.concat(['const']))
        : member.baseQualifiers;
      const info: RuntimeDeclarationInfo = {
        storageClasses: parentInfo.storageClasses,
        qualifiers: this.uniqueQualifiers(
          baseQualifiers.concat(...member.pointerQualifiers)
        ),
        baseQualifiers,
        pointerQualifiers: member.pointerQualifiers,
        region: parentInfo.region,
        initialized: parentInfo.initialized,
        readOnly: parentInfo.readOnly || baseQualifiers.indexOf('const') !== -1,
      };
      this.declarationInfoByAddress.set(address, info);
      this.registerRecordFields(member.type, address, info);
    }
  }

  private uniqueQualifiers<T>(values: T[]): T[] {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  /** The runtime names records without their C tag keyword. */
  private runtimeLayout(layout: FieldOffset): FieldOffset {
    const normalized: FieldOffset = new Map();
    for (const [name, [offset, type, size]] of layout) {
      normalized.set(name, [
        offset,
        type.replace(/^\s*(struct|union)\s+/, ''),
        size,
      ]);
    }
    return normalized;
  }
}

/** The synthetic type `FunctionPointerTable` gives every declarator it maps. */
function isFunctionPointerType(type: string): boolean {
  return /^_fp\d+/.test(type);
}
