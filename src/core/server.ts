import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import { HISTORY_LIMIT, StepHistory } from './history';
import { extractModel } from './extractModel';
import { StepModel, emptyStepModel } from './model';
import { Construct } from '../interpreter/Construct';
import { Expansion } from '../interpreter/Expansion';
import { RuntimeDiagnostic } from '../interpreter/RuntimeDiagnostic';
import { LintDiagnostic } from '../interpreter/TeachingLint';

export type CONTROL_EVENT =
  | 'Exec'
  | 'Start'
  | 'Stop'
  | 'BackAll'
  | 'StepBack'
  | 'Step'
  | 'StepAll'
  | 'SyntaxCheck';
export type DEBUG_STATE =
  | 'First'
  | 'Debugging'
  | 'stdin'
  | 'EOF'
  | 'Stop'
  | 'Executing';

/**
 * Both messages are plain data rather than classes: they cross the Worker
 * boundary through `structuredClone`, which keeps an object's fields and
 * throws its prototype away.
 */
export interface Request {
  controlEvent: CONTROL_EVENT;
  sourcecode: string;
  stdinText?: string;
  lineNumOfBreakpoint?: number[];
}

/**
 * A syntax error as the editor's linter reads it. `SyntaxErrorData` holds its
 * accessor as an instance property, and a function is the one thing
 * `structuredClone` refuses to carry, so the message is unwrapped here.
 */
export interface SyntaxErrorModel {
  line: number;
  charPositionInLine: number;
  msg: string;
}

export interface Response {
  output: string;
  sourcecode: string;
  debugState: DEBUG_STATE;
  step: number;
  errors: SyntaxErrorModel[];
  /**
   * The step as the interface reads it. Always present: a state the
   * interpreter has none for - a stopped session, a syntax check - is an empty
   * model rather than a missing one, because everything downstream of here
   * draws it.
   */
  model: StepModel;
  /** Preprocessor replacements, for the editor to mark. Syntax checks only. */
  expansions?: Expansion[];
  /** Parsed statements, for the editor to explain. Syntax checks only. */
  constructs?: Construct[];
  /** What the teaching rules found in a program that parses. Checks only. */
  lints?: LintDiagnostic[];
  /**
   * What has gone wrong in the run so far. Sent with every step rather than
   * once, because a session is only ever shown one response at a time and the
   * editor's linter holds one set: the list is what the run has said, not what
   * this step added.
   */
  runtime?: RuntimeDiagnostic[];
}

/**
 * A run that ended somewhere other than where the caller asked it to: at the
 * end of the program, at a read, or at a breakpoint. `StepAll` returns as soon
 * as the run starts, so what stopped it has to be reported separately.
 */
export type RUN_EVENT = 'EOF' | 'stdin' | 'Breakpoint';

/**
 * Where a step of the session left it, before it is spelled out for the
 * caller. A run steps hundreds of times between the two responses it sends,
 * and extracting a model for every one of those steps would be the price of
 * running rather than the price of showing.
 */
interface StepResult {
  execState?: ExecState;
  output: string;
  debugState: DEBUG_STATE;
  step: number;
}

/** Implemented by interpreters that can describe their source. */
interface ExpansionSource {
  getExpansions(code: string): Expansion[];
  getConstructs(code: string): Construct[];
  getLints(code: string): LintDiagnostic[];
  getRuntimeDiagnostics(): RuntimeDiagnostic[];
}

function reportsExpansions(
  interpreter: Interpreter
): interpreter is Interpreter & ExpansionSource {
  const source = interpreter as unknown as ExpansionSource;
  return (
    typeof source.getExpansions === 'function' &&
    typeof source.getConstructs === 'function' &&
    typeof source.getLints === 'function' &&
    typeof source.getRuntimeDiagnostics === 'function'
  );
}

/**
 * How many steps a run takes before it lets the Worker read its messages. The
 * `Stop` button is the only thing waiting on the other side, and a run that
 * checked for it every step would spend more time on the check than on the
 * program; a run that never checked could not be stopped at all.
 */
const RUN_SLICE = 5000;

/** Lets the Worker's message queue drain. A microtask would not. */
const pause = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export class Server {
  private isExecuting: boolean = false;
  private files: Map<string, ArrayBuffer> = new Map();
  private count: number = 0;
  /**
   * Which run is the current one. A run outlives the command that started it,
   * so stopping or restarting cannot reach into it - it retires the number the
   * run was started under, and the run reads that before every step.
   */
  private runToken: number = 0;
  private interpreter: Interpreter | null = null;
  private readonly history: StepHistory;

  /**
   * Where a run that stopped on its own is reported. The Worker sets it and
   * forwards what arrives; nothing here knows what the interface does with it,
   * which is what lets this file run on a thread that has no interface.
   */
  public onRunEvent: ((event: RUN_EVENT, response: Response) => void) | null =
    null;

  /** The history limit is a constructor argument so a test can fill it. */
  constructor(historyLimit: number = HISTORY_LIMIT) {
    this.history = new StepHistory(historyLimit);
  }

  // Returns a new interpreter rather than assigning `this.interpreter`. Only
  // `reset` may replace the session's interpreter: `SyntaxCheck` runs off a
  // debounced keystroke and can land at any moment, including right after
  // `Start` has armed a session.
  // C is the only supported language, but the interpreter still arrives
  // through a dynamic import: it keeps the parser out of the initial bundle,
  // and adding a language back later is a branch here rather than a rewrite.
  private async createInterpreter(): Promise<Interpreter> {
    // PLIVET's own subclass, for the preprocessor unicoen.ts does not have.
    // prettier-ignore
    const module = await import(/* webpackChunkName: "CPP14" */ '../interpreter/CPP14');
    return new module.PlivetCPP14Interpreter();
  }
  private async reset() {
    // A restart retires a run still in flight, the same way stopping does.
    this.runToken += 1;
    this.count = 0;
    const interpreter = await this.createInterpreter();
    interpreter.setFileList(this.files);
    this.interpreter = interpreter;
    this.history.clear();
  }

  /**
   * The uploaded files, sent once when they change rather than read from disk
   * here: reading a `File` belongs to the page that owns the input element.
   */
  public setFiles(files: Map<string, ArrayBuffer>) {
    this.files = files;
    if (this.interpreter !== null) {
      this.interpreter.setFileList(files);
    }
  }

  public async send(request: Request): Promise<Response> {
    const { controlEvent, sourcecode, stdinText, lineNumOfBreakpoint } =
      request;

    switch (controlEvent) {
      case 'Start': {
        return this.respond(await this.Start(sourcecode), sourcecode);
      }
      case 'Stop': {
        return this.respond(this.Stop(), sourcecode);
      }
      case 'BackAll': {
        return this.respond(this.BackAll(), sourcecode);
      }
      case 'StepBack': {
        return this.respond(this.StepBack(), sourcecode);
      }
      case 'Step': {
        return this.respond(this.Step(stdinText), sourcecode);
      }
      case 'StepAll': {
        return this.respond(
          this.StepAll(sourcecode, lineNumOfBreakpoint, stdinText),
          sourcecode
        );
      }
      case 'Exec': {
        await this.Start(sourcecode);
        return this.respond(
          this.StepAll(sourcecode, lineNumOfBreakpoint),
          sourcecode
        );
      }
      case 'SyntaxCheck': {
        return this.SyntaxCheck(sourcecode);
      }
    }
  }

  /**
   * A step spelled out for the caller. This is where the interpreter's own
   * objects are left behind and the model that crosses the Worker boundary is
   * built, so it is the only place a `Response` is made.
   */
  private respond(result: StepResult, sourcecode: string): Response {
    return {
      model: extractModel(result.execState),
      output: result.output,
      sourcecode,
      debugState: result.debugState,
      step: result.step,
      errors: [],
      runtime: this.runtimeDiagnostics(),
    };
  }

  /**
   * What the run has been told off for. A stopped session has no interpreter
   * and therefore nothing to say, which is what clears the marks off the
   * editor when the reader stops.
   */
  private runtimeDiagnostics(): RuntimeDiagnostic[] {
    return this.interpreter !== null && reportsExpansions(this.interpreter)
      ? this.interpreter.getRuntimeDiagnostics()
      : [];
  }

  /** The step held in the history, for the commands that only look back. */
  private held(step: number, debugState: DEBUG_STATE): StepResult {
    return {
      execState: this.history.stateAt(step),
      output: this.history.outputAt(step),
      debugState,
      step,
    };
  }

  private async Start(sourcecode: string): Promise<StepResult> {
    await this.reset();
    if (this.interpreter === null) {
      throw new Error('interpreter is not found');
    }
    const execState = this.interpreter.startStepExecution(sourcecode);
    const output = this.interpreter.getStdout();
    this.record(execState, output);
    this.isExecuting = true;
    return { execState, output, debugState: 'First', step: this.count };
  }

  private Stop(): StepResult {
    this.runToken += 1;
    this.interpreter = null;
    return { output: '', debugState: 'Stop', step: this.count };
  }

  private BackAll(): StepResult {
    this.count = 0;
    return this.held(this.count, 'First');
  }

  private StepBack(): StepResult {
    // Only into a step still held: past the window the states were dropped and
    // there is nothing to step back to. `BackAll` still reaches the first.
    if (1 <= this.count && this.history.has(this.count - 1)) {
      this.count -= 1;
    }
    return this.held(this.count, 'Debugging');
  }

  private Step(stdinText?: string): StepResult {
    ++this.count;
    if (this.count < this.history.length) {
      // Stepping forward out of a stretch that has been dropped - the run was
      // long enough to evict it - resumes at the oldest step still held.
      this.count = this.history.nextRetained(this.count);
      return this.held(this.count, 'Debugging');
    }
    if (!this.isExecuting) {
      return this.atEnd();
    }
    if (this.interpreter === null) {
      throw new Error('engine is not found');
    }
    if (this.interpreter.getIsWaitingForStdin()) {
      if (stdinText === undefined) {
        // The program is blocked in scanf, which is a generator that yielded
        // with the waiting flag set. Resuming it now consumes the read with
        // an empty string and clears the flag, so the scanf is silently gone
        // and the variable keeps its old value. Stepping has to be a no-op
        // until the console submits a line.
        --this.count;
        return this.held(this.count, 'stdin');
      }
      this.interpreter.stdin(stdinText);
    }
    const state: ExecState | null = this.interpreter.stepExecute();
    if (state === null) {
      // The engine has no step iterator, so it is not the one `Start` armed.
      // Report the last known good state: a step with no model at all reaches
      // the canvas and takes the whole visualization down with it.
      this.isExecuting = false;
      return this.atEnd();
    }
    const output = this.interpreter.getStdout();
    this.record(state, output);
    let debugState: DEBUG_STATE = 'Debugging';
    if (this.interpreter.getIsWaitingForStdin()) {
      debugState = 'stdin';
    } else if (!this.interpreter.isStepExecutionRunning()) {
      debugState = 'EOF';
      this.isExecuting = false;
    }
    return { execState: state, output, debugState, step: this.count };
  }

  /** The last step recorded, for a session that has nowhere left to go. */
  private atEnd(): StepResult {
    this.count = Math.max(this.history.length - 1, 0);
    return {
      execState: this.history.lastState(),
      output: this.history.outputAt(this.count),
      debugState: 'EOF',
      step: this.count,
    };
  }

  /**
   * Starts a run and answers immediately: what stops it - the end of the
   * program, a read, a breakpoint - is reported through `onRunEvent` whenever
   * it happens.
   */
  private StepAll(
    sourcecode: string,
    lineNumOfBreakpoint?: number[],
    stdinText?: string
  ): StepResult {
    const executing = this.held(this.count, 'Executing');
    this.runToken += 1;
    void this.run(this.runToken, sourcecode, lineNumOfBreakpoint, stdinText);
    return executing;
  }

  /**
   * The run itself: a straight loop, because this is a Worker and there is no
   * interface on this thread to keep alive. It used to be one step per
   * `setTimeout`, which capped a run at a thousand steps a second whatever the
   * program did.
   */
  private async run(
    token: number,
    sourcecode: string,
    lineNumOfBreakpoint?: number[],
    stdinText?: string
  ): Promise<void> {
    // Let the `Executing` answer go out before the run begins.
    await pause();
    // Only the first step of the run may consume the submitted line: it is the
    // one the program is blocked on. Every later step runs with no input, and
    // the guard in Step stops the run at the next scanf.
    let pendingStdin = stdinText;
    let taken = 0;
    while (this.runToken === token) {
      const result = this.Step(pendingStdin);
      pendingStdin = undefined;
      if (result.debugState === 'EOF' || result.debugState === 'stdin') {
        this.report(result.debugState, result, sourcecode);
        return;
      }
      if (
        typeof lineNumOfBreakpoint !== 'undefined' &&
        this.stoppedAtBreakpoint(result, lineNumOfBreakpoint)
      ) {
        this.report('Breakpoint', result, sourcecode);
        return;
      }
      taken += 1;
      if (taken % RUN_SLICE === 0) {
        await pause();
      }
    }
  }

  /**
   * Whether the statement about to run is one the reader marked. Asked of the
   * `ExecState` rather than of a model: a run reaches this once per step, and
   * building a model to read one code range out of it would make every step of
   * every run pay for the visualization of the one step that stops.
   */
  private stoppedAtBreakpoint(
    result: StepResult,
    lineNumOfBreakpoint: number[]
  ): boolean {
    if (typeof result.execState === 'undefined') {
      return false;
    }
    const { codeRange } = result.execState.getNextExpr();
    return (
      Boolean(codeRange) && lineNumOfBreakpoint.includes(codeRange.begin.y - 1)
    );
  }

  private async SyntaxCheck(code: string): Promise<Response> {
    // Deliberately a throwaway interpreter, never `this.interpreter`.
    const interpreter = await this.createInterpreter();
    const errors: SyntaxErrorModel[] = interpreter
      .checkSyntaxError(code)
      .map(({ line, charPositionInLine, getMsg }) => ({
        line,
        charPositionInLine,
        msg: getMsg(),
      }));
    return {
      errors,
      expansions: reportsExpansions(interpreter)
        ? interpreter.getExpansions(code)
        : [],
      constructs: reportsExpansions(interpreter)
        ? interpreter.getConstructs(code)
        : [],
      // A program that does not parse has syntax errors to fix first, and a
      // teaching rule reading a broken tree would only add noise to them.
      lints:
        reportsExpansions(interpreter) && errors.length === 0
          ? interpreter.getLints(code)
          : [],
      sourcecode: code,
      model: emptyStepModel(),
      debugState: 'Stop',
      output: '',
      step: this.count,
    };
  }

  private record(execState: ExecState, output: string) {
    this.history.push(execState, output);
  }

  private report(event: RUN_EVENT, result: StepResult, sourcecode: string) {
    if (this.onRunEvent !== null) {
      this.onRunEvent(event, this.respond(result, sourcecode));
    }
  }
}
