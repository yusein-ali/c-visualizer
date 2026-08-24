import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import type { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { HISTORY_LIMIT, StepHistory } from './history';
import { extractModel } from './extractModel';
import { StepModel, emptyStepModel } from './model';
import { Construct } from '../interpreter/Construct';
import { Expansion } from '../interpreter/Expansion';
import { RuntimeDiagnostic } from '../interpreter/RuntimeDiagnostic';
import { LintDiagnostic } from '../interpreter/TeachingLint';
import type { SourceAnalysis } from '../interpreter/CPP14';
import { ExecutionSource } from './executionSource';
import type { SourceLocation } from './executionSource';

export type CONTROL_EVENT =
  | 'Exec'
  | 'Start'
  | 'Stop'
  | 'BackAll'
  | 'StepBack'
  | 'Step'
  | 'StepOver'
  | 'StepAll'
  | 'Preprocess'
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
/** One file the reader has open, named the way the page names it. */
export interface SourceFile {
  path: string;
  text: string;
}

export interface Request {
  controlEvent: CONTROL_EVENT;
  /**
   * The entry file text, retained as the fallback for older callers that do
   * not send `files`. A multi-file request composes its named sources below.
   */
  sourcecode: string;
  stdinText?: string;
  lineNumOfBreakpoint?: number[];
  /**
   * Every file the reader has open, and which of them is the one that runs.
   *
   * unicoen has no linker, so PLIVET composes these into one interpreter input:
   * headers first, then the entry and the remaining implementations. Step
   * locations are mapped back to the named file, which lets the editor follow
   * a call into another tab.
   */
  files?: SourceFile[];
  /** The `path` of the file in `files` that is the translation unit. */
  entry?: string;
  /** The file whose editor diagnostics a SyntaxCheck should return. */
  active?: string;
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

const syntaxErrorMessage = (
  source: string,
  line: number,
  column: number,
  message: string
): string => {
  if (!message.startsWith('no viable alternative')) {
    return message;
  }
  const sourceLine = source.split(/\r?\n/)[line - 1] ?? '';
  const beforeError = sourceLine.slice(0, column).trimEnd();
  if (beforeError.endsWith('=')) {
    return "expected an expression after '='";
  }
  const lines = source.split(/\r?\n/);
  const previousLine =
    lines
      .slice(0, Math.max(0, line - 1))
      .reverse()
      .find((candidate) => candidate.trim() !== '')
      ?.trim() ?? '';
  const looksLikeDeclaration =
    /^(?:(?:const|static|extern|unsigned|signed|long|short)\s+)*(?:void|char|short|int|long|float|double|struct|enum|union)\b/.test(
      previousLine
    );
  const looksLikeStatement = /^[_A-Za-z]\w*\s*\(/.test(sourceLine.trim());
  if (
    looksLikeDeclaration &&
    looksLikeStatement &&
    !/[;{}:]$/.test(previousLine)
  ) {
    return "expected ';' after declaration";
  }
  return message;
};

/**
 * The rules whose diagnostics refuse a run rather than merely marking it.
 *
 * A teaching rule describes a program that compiles and behaves badly, and a
 * reader has to be able to run one and watch it misbehave - that is what the
 * visualizer is for. These are different: they describe a program a compiler
 * refuses to translate, so there is no execution to show. Using a name that
 * nothing declares is the first of them; C has no implicit declaration of
 * objects, and PLIVET used to run such a program, print nothing and report
 * success.
 */
const REFUSING_RULES = new Set(['undeclared-identifier']);

const refusals = (analysis: SourceAnalysis): LintDiagnostic[] =>
  analysis.linkerLints.filter((diagnostic) =>
    REFUSING_RULES.has(diagnostic.rule)
  );

/** Syntax errors belonging to one named file in a start/run preflight. */
export interface FileSyntaxErrors {
  path: string;
  errors: SyntaxErrorModel[];
}

/** Findings belonging to one named file, with that file's own coordinates. */
export interface FileLints {
  path: string;
  lints: LintDiagnostic[];
}

/**
 * Parser errors from the composed program, grouped by the file each one is in.
 *
 * The interpreter is handed one translation unit and answers in its
 * coordinates, so every error has to be put back into the file it came from
 * before a reader can be sent to it. An error the map cannot place belongs to
 * `fallback` - the entry file - because a line that is nowhere is still a line
 * somebody has to be told about.
 */
const errorsByFile = (
  errors: SyntaxErrorData[],
  execution: ExecutionSource,
  sources: SourceFile[],
  fallback: string
): Map<string, SyntaxErrorModel[]> => {
  const byPath = new Map<string, SyntaxErrorModel[]>();
  for (const error of errors) {
    const location = execution.locate({
      begin: { x: error.charPositionInLine, y: error.line },
      end: { x: error.charPositionInLine, y: error.line },
    });
    const path = location?.path ?? fallback;
    const line = location?.range.begin.y ?? error.line;
    const file = sources.find((candidate) => candidate.path === path);
    const model = {
      line,
      charPositionInLine: error.charPositionInLine,
      msg: syntaxErrorMessage(
        file?.text ?? execution.code,
        line,
        error.charPositionInLine,
        // `getMsg` writes the coordinate into the sentence, and the one it
        // has is the composed unit's. A row saying `helper.c:3` beside a
        // sentence saying `line 10:0` names two different places, so the
        // sentence is given the file's own line as well.
        error
          .getMsg()
          .replace(/^line \d+:\d+/, `line ${line}:${error.charPositionInLine}`)
      ),
    };
    const found = byPath.get(path) ?? [];
    found.push(model);
    byPath.set(path, found);
  }
  return byPath;
};

/**
 * Whole-program findings, grouped by the file each one is in.
 *
 * The same mapping as `errorsByFile` and for the same reason, with one
 * difference: a lint has a range rather than a point, so both ends are mapped
 * and the file's own line numbers replace the composed unit's.
 */
const lintsByFile = (
  lints: LintDiagnostic[],
  execution: ExecutionSource,
  fallback: string
): FileLints[] => {
  const byPath = new Map<string, LintDiagnostic[]>();
  for (const lint of lints) {
    const location = execution.locate({
      begin: { x: lint.column, y: lint.line },
      end: { x: lint.endColumn, y: lint.endLine },
    });
    const path = location?.path ?? fallback;
    const found = byPath.get(path) ?? [];
    found.push(
      location === null
        ? lint
        : {
            ...lint,
            line: location.range.begin.y,
            column: location.range.begin.x,
            endLine: location.range.end.y,
            endColumn: location.range.end.x,
          }
    );
    byPath.set(path, found);
  }
  return Array.from(byPath, ([path, found]) => ({ path, lints: found }));
};

export interface Response {
  output: string;
  sourcecode: string;
  debugState: DEBUG_STATE;
  step: number;
  errors: SyntaxErrorModel[];
  /** Every file that prevents Start/Exec, with file-local coordinates. */
  fileErrors?: FileSyntaxErrors[];
  /** The first failing file the editor should bring into view. */
  diagnosticPath?: string;
  /**
   * The step as the interface reads it. Always present: a state the
   * interpreter has none for - a stopped session, a syntax check - is an empty
   * model rather than a missing one, because everything downstream of here
   * draws it.
   */
  model: StepModel;
  /** The current interpreter range mapped back to one visible source tab. */
  location?: SourceLocation;
  /** Preprocessor replacements, for the editor to mark. Editor checks only. */
  expansions?: Expansion[];
  /**
   * Replacements in the complete composed program. Editor checks keep this
   * second map so a macro use in one tab can navigate to its definition in a
   * header tab without waiting for Start.
   */
  programExpansions?: Expansion[];
  /** Parsed statements, for the editor and canvas to explain. Checks/Start. */
  constructs?: Construct[];
  /** Parsed statements in the complete composed program. Syntax checks only. */
  programConstructs?: Construct[];
  /** What the teaching rules found in the checked file. Checks only. */
  lints?: LintDiagnostic[];
  /**
   * What the rules that read the whole program found, in every file rather
   * than in the one being edited: what is declared but never defined, what is
   * used but never declared. Sent per file with that file's own coordinates,
   * and replaced as a set by each check - one edit can answer or raise a
   * question about a file nobody has touched, so a reader cannot be left
   * holding half of an older answer.
   */
  programLints?: FileLints[];
  /**
   * Parser errors in every file of the composed program, from an editor check
   * rather than from a refused start.
   *
   * Not `fileErrors`: nothing has been refused here, and the two must stay
   * apart because `fileErrors` is what tells the editor a run did not happen.
   */
  programErrors?: FileSyntaxErrors[];
  /**
   * How often the run has arrived at each line so far. Counted here rather
   * than by the editor because a run reports two responses and takes
   * thousands of steps between them: everything the editor could count is
   * the handful of steps it was shown.
   */
  coverage?: LineCount[];
  /**
   * What has gone wrong in the run so far. Sent with every step rather than
   * once, because a session is only ever shown one response at a time and the
   * editor's linter holds one set: the list is what the run has said, not what
   * this step added.
   */
  runtime?: RuntimeDiagnostic[];
}

/** The entry text for syntax checks and callers that send no named file set. */
const entryTextOf = (request: Request): string => {
  const { files, entry, sourcecode } = request;
  if (typeof files === 'undefined' || typeof entry === 'undefined') {
    return sourcecode;
  }
  const found = files.find((file) => file.path === entry);
  return typeof found === 'undefined' ? sourcecode : found.text;
};

/** The open tab a syntax check belongs to; old callers check the entry. */
const activePathOf = (request: Request): string => {
  const { files, active, entry } = request;
  if (
    typeof files !== 'undefined' &&
    typeof active !== 'undefined' &&
    files.some((file) => file.path === active)
  ) {
    return active;
  }
  return entry ?? '';
};

const activeTextOf = (request: Request): string => {
  const path = activePathOf(request);
  return (
    request.files?.find((file) => file.path === path)?.text ??
    entryTextOf(request)
  );
};

/** The files in the same stable order used when a refusal chooses the first. */
const sourceFilesOf = (request: Request): SourceFile[] =>
  typeof request.files === 'undefined' || request.files.length === 0
    ? [{ path: request.entry ?? '', text: entryTextOf(request) }]
    : [
        ...request.files.filter((file) => file.path === request.entry),
        ...request.files.filter((file) => file.path !== request.entry),
      ];

/** The composed source used for execution; syntax checks remain entry-only. */
const executionSourceOf = (request: Request): ExecutionSource =>
  new ExecutionSource(
    request.files ?? [],
    request.entry ?? '',
    entryTextOf(request)
  );

/** How many times the run has reached one line. Lines are 1-based. */
export interface LineCount {
  line: number;
  count: number;
}

/**
 * A run that ended somewhere other than where the caller asked it to: at the
 * end of the program, at a read, or at a breakpoint. `StepAll` returns as soon
 * as the run starts, so what stopped it has to be reported separately.
 */
export type RUN_EVENT = 'EOF' | 'stdin' | 'Breakpoint' | 'StepOver';

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

/** The source coordinates exposed by unicoen's next expression. */
interface InterpreterRange {
  begin: { x: number; y: number };
  end: { x: number; y: number };
}

interface StartResult {
  step: StepResult;
  constructs: Construct[];
  expansions: Expansion[];
}

interface PreparedStart {
  interpreter: Interpreter;
  constructs: Construct[];
  expansions: Expansion[];
}

interface CheckedProgram extends PreparedStart {
  activeCode: string;
  activePath: string;
  executionCode: string;
  analysis: SourceAnalysis;
}

/** Implemented by interpreters that can describe their source. */
interface ExpansionSource {
  analyze(code: string, linkedCode?: string): SourceAnalysis;
  getExpansions(code: string): Expansion[];
  getConstructs(code: string): Construct[];
  getLints(code: string, linkedCode?: string): LintDiagnostic[];
  getTeachingLints(code: string): LintDiagnostic[];
  getLinkerLints(code: string): LintDiagnostic[];
  getRuntimeDiagnostics(): RuntimeDiagnostic[];
}

function reportsExpansions(
  interpreter: Interpreter
): interpreter is Interpreter & ExpansionSource {
  const source = interpreter as unknown as ExpansionSource;
  return (
    typeof source.getExpansions === 'function' &&
    typeof source.analyze === 'function' &&
    typeof source.getConstructs === 'function' &&
    typeof source.getLints === 'function' &&
    typeof source.getTeachingLints === 'function' &&
    typeof source.getLinkerLints === 'function' &&
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
  /**
   * How often each line has been arrived at, over the session rather than
   * over one step. It is what shades the coverage gutter, and what makes a
   * loop body and a branch nobody took visible without reading either.
   */
  private readonly coverage = new Map<number, number>();
  private interpreter: Interpreter | null = null;
  /** The latest diagnostics parse, reusable only while its source is exact. */
  private checkedProgram: CheckedProgram | null = null;
  /**
   * The source map armed by Start. Follow-up commands intentionally do not
   * have to repeat their source text, so their ranges must use the same map
   * rather than constructing an empty translation unit from the command.
   */
  private execution: ExecutionSource | null = null;
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
  private async reset(prepared?: PreparedStart) {
    // A restart retires a run still in flight, the same way stopping does.
    this.runToken += 1;
    this.count = 0;
    this.coverage.clear();
    const interpreter =
      prepared?.interpreter ?? (await this.createInterpreter());
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
    const { controlEvent, stdinText, lineNumOfBreakpoint } = request;
    const requestedExecution = executionSourceOf(request);
    // Breakpoints come from the active editor as zero-based, file-local rows.
    // The interpreter executes the composed source and reports one-based
    // global lines, so translate them once before any run command consumes
    // them. Single-file requests keep the same values after this conversion.
    const globalBreakpoints = lineNumOfBreakpoint?.flatMap((row) => {
      const line = requestedExecution.globalLine(
        activePathOf(request),
        row + 1
      );
      // Keep the run-loop contract in zero-based rows; only the source-map
      // lookup itself uses one-based interpreter lines.
      return line === null ? [] : [line - 1];
    });

    switch (controlEvent) {
      case 'Start': {
        const prepared = this.takeCheckedProgram(request, requestedExecution);
        const preflight =
          prepared === null
            ? await this.preflight(request, requestedExecution)
            : prepared;
        if ('debugState' in preflight) {
          return preflight;
        }
        this.execution = requestedExecution;
        const started = await this.Start(requestedExecution.code, preflight);
        return this.respond(
          started.step,
          requestedExecution,
          started.constructs,
          started.expansions
        );
      }
      case 'Stop': {
        return this.respond(this.Stop(), this.execution ?? requestedExecution);
      }
      case 'BackAll': {
        return this.respond(
          this.BackAll(),
          this.execution ?? requestedExecution
        );
      }
      case 'StepBack': {
        return this.respond(
          this.StepBack(),
          this.execution ?? requestedExecution
        );
      }
      case 'Step': {
        return this.respond(
          this.Step(stdinText),
          this.execution ?? requestedExecution
        );
      }
      case 'StepOver': {
        const execution = this.execution ?? requestedExecution;
        return this.respond(
          this.StepOver(execution, globalBreakpoints, stdinText),
          execution
        );
      }
      case 'StepAll': {
        const execution = this.execution ?? requestedExecution;
        return this.respond(
          this.StepAll(execution, globalBreakpoints, stdinText),
          execution
        );
      }
      case 'Exec': {
        const prepared = this.takeCheckedProgram(request, requestedExecution);
        const preflight =
          prepared === null
            ? await this.preflight(request, requestedExecution)
            : prepared;
        if ('debugState' in preflight) {
          return preflight;
        }
        this.execution = requestedExecution;
        const started = await this.Start(requestedExecution.code, preflight);
        return this.respond(
          this.StepAll(requestedExecution, globalBreakpoints),
          requestedExecution,
          started.constructs,
          started.expansions
        );
      }
      case 'Preprocess': {
        return this.Preprocess(activeTextOf(request), requestedExecution);
      }
      case 'SyntaxCheck': {
        return this.SyntaxCheck(
          activeTextOf(request),
          activePathOf(request),
          sourceFilesOf(request),
          requestedExecution
        );
      }
    }
  }

  /**
   * The cheap half of a syntax check, returned separately so editor marks do
   * not wait for the parser, construct outline and teaching rules. It remains
   * in the Worker: preprocessing a large source set must not hold typing up.
   */
  private async Preprocess(
    code: string,
    execution: ExecutionSource
  ): Promise<Response> {
    // Keep this in the interpreter chunk even though the fast path needs only
    // the preprocessor. A reader still downloads one lazy C-language chunk.
    // prettier-ignore
    const module = await import(/* webpackChunkName: "CPP14" */ '../interpreter/preprocess');
    const expansions = module.preprocessSource(code).expansions;
    return {
      errors: [],
      expansions,
      programExpansions:
        execution.code === code
          ? expansions
          : module.preprocessSource(execution.code).expansions,
      sourcecode: code,
      model: emptyStepModel(),
      debugState: 'Stop',
      output: '',
      step: this.count,
    };
  }

  /**
   * A step spelled out for the caller. This is where the interpreter's own
   * objects are left behind and the model that crosses the Worker boundary is
   * built, so it is the only place a `Response` is made.
   */
  private respond(
    result: StepResult,
    execution: ExecutionSource,
    constructs?: Construct[],
    expansions?: Expansion[]
  ): Response {
    const model = extractModel(result.execState);
    const location = execution.locate(model.codeRange);
    model.context.file = location?.path ?? null;
    return {
      model,
      output: result.output,
      sourcecode: execution.code,
      debugState: result.debugState,
      step: result.step,
      errors: [],
      runtime: this.runtimeDiagnostics(),
      coverage:
        location === null ? [] : this.lineCounts(execution, location.path),
      constructs,
      expansions,
      ...(location === null ? {} : { location }),
    };
  }

  /** The syntax map belonging to the interpreter that Start just armed. */
  private constructs(sourcecode: string): Construct[] {
    return this.interpreter !== null && reportsExpansions(this.interpreter)
      ? this.interpreter.getConstructs(sourcecode)
      : [];
  }

  /** The preprocessing map belonging to the source Start just prepared. */
  private expansions(sourcecode: string): Expansion[] {
    return this.interpreter !== null && reportsExpansions(this.interpreter)
      ? this.interpreter.getExpansions(sourcecode)
      : [];
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
      debugState:
        debugState === 'Debugging' && this.history.waitingForStdinAt(step)
          ? 'stdin'
          : debugState,
      step,
    };
  }

  private async Start(
    sourcecode: string,
    prepared?: PreparedStart
  ): Promise<StartResult> {
    await this.reset(prepared);
    if (this.interpreter === null) {
      throw new Error('interpreter is not found');
    }
    // Reading constructs prepares the interpreter too. Do it before arming
    // the run: doing it after `startStepExecution` resets the engine's cached
    // global scope and function addresses, so the entry point disappears from
    // text memory on the next step.
    const constructs = prepared?.constructs ?? this.constructs(sourcecode);
    const expansions = prepared?.expansions ?? this.expansions(sourcecode);
    const execState = this.interpreter.startStepExecution(sourcecode);
    const output = this.interpreter.getStdout();
    this.record(execState, output);
    this.isExecuting = true;
    return {
      step: { execState, output, debugState: 'First', step: this.count },
      constructs,
      expansions,
    };
  }

  private Stop(): StepResult {
    this.runToken += 1;
    this.interpreter = null;
    // A stopped session has run nothing, which is what takes the shading off.
    this.coverage.clear();
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
    let debugState: DEBUG_STATE = 'Debugging';
    if (this.interpreter.getIsWaitingForStdin()) {
      debugState = 'stdin';
    } else if (!this.interpreter.isStepExecutionRunning()) {
      debugState = 'EOF';
      this.isExecuting = false;
    }
    this.record(state, output, debugState === 'stdin');
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
    execution: ExecutionSource,
    lineNumOfBreakpoint?: number[],
    stdinText?: string
  ): StepResult {
    const executing = this.held(this.count, 'Executing');
    this.runToken += 1;
    void this.run(this.runToken, execution, lineNumOfBreakpoint, stdinText);
    return executing;
  }

  /**
   * Run the statement under the marker without stopping in a function it
   * calls. Like Continue, this returns an Executing response first and does
   * the work asynchronously so Stop can still retire a long-running call.
   */
  private StepOver(
    execution: ExecutionSource,
    lineNumOfBreakpoint?: number[],
    stdinText?: string
  ): StepResult {
    const executing = this.held(this.count, 'Executing');
    this.runToken += 1;
    void this.runOver(this.runToken, execution, lineNumOfBreakpoint, stdinText);
    return executing;
  }

  private async runOver(
    token: number,
    execution: ExecutionSource,
    lineNumOfBreakpoint?: number[],
    stdinText?: string
  ): Promise<void> {
    await pause();
    const initial = this.history.stateAt(this.count);
    const initialDepth = initial?.getStacks().length ?? 0;
    const initialRange = initial?.getNextExpr()?.codeRange;
    let pendingStdin = stdinText;
    let taken = 0;

    while (this.runToken === token) {
      const result = this.Step(pendingStdin);
      pendingStdin = undefined;
      if (result.debugState === 'EOF' || result.debugState === 'stdin') {
        this.report(result.debugState, result, execution);
        return;
      }
      if (
        typeof lineNumOfBreakpoint !== 'undefined' &&
        this.stoppedAtBreakpoint(result, lineNumOfBreakpoint)
      ) {
        this.report('Breakpoint', result, execution);
        return;
      }
      if (this.steppedOver(initialDepth, initialRange, result.execState)) {
        this.report('StepOver', result, execution);
        return;
      }
      taken += 1;
      if (taken % RUN_SLICE === 0) {
        await pause();
      }
    }
  }

  /** The next expression is back in the frame and past the source we left. */
  private steppedOver(
    initialDepth: number,
    initialRange: InterpreterRange | undefined,
    state?: ExecState
  ): boolean {
    // The first state may precede the entry frame. There is no caller to stay
    // in yet, so Step Over has the same meaning as one ordinary step.
    if (initialDepth <= 1 || typeof state === 'undefined') {
      return true;
    }
    const depth = state.getStacks().length;
    if (initialDepth < depth) {
      return false;
    }
    if (depth < initialDepth || typeof initialRange === 'undefined') {
      return true;
    }
    const range = state.getNextExpr()?.codeRange;
    return (
      typeof range === 'undefined' ||
      range.begin.x !== initialRange.begin.x ||
      range.begin.y !== initialRange.begin.y ||
      range.end.x !== initialRange.end.x ||
      range.end.y !== initialRange.end.y
    );
  }

  /**
   * The run itself: a straight loop, because this is a Worker and there is no
   * interface on this thread to keep alive. It used to be one step per
   * `setTimeout`, which capped a run at a thousand steps a second whatever the
   * program did.
   */
  private async run(
    token: number,
    execution: ExecutionSource,
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
        this.report(result.debugState, result, execution);
        return;
      }
      if (
        typeof lineNumOfBreakpoint !== 'undefined' &&
        this.stoppedAtBreakpoint(result, lineNumOfBreakpoint)
      ) {
        this.report('Breakpoint', result, execution);
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
    // A step can stop with no next expression at all - a `switch` entering its
    // `default` is the one that happens in practice - and a breakpoint cannot
    // be on a line the step does not have, so this is read rather than
    // destructured.
    const next = result.execState.getNextExpr() ?? null;
    const codeRange = next === null ? null : next.codeRange;
    return (
      codeRange !== null &&
      typeof codeRange !== 'undefined' &&
      lineNumOfBreakpoint.includes(codeRange.begin.y - 1)
    );
  }

  /**
   * Consume a diagnostics parse only when every byte of its source still
   * matches. The cached interpreter owns the prepared AST and may be armed
   * once; a restart after that deliberately performs a fresh analysis.
   */
  private takeCheckedProgram(
    request: Request,
    execution: ExecutionSource
  ): PreparedStart | null {
    const checked = this.checkedProgram;
    if (
      checked === null ||
      checked.activeCode !== activeTextOf(request) ||
      checked.activePath !== activePathOf(request) ||
      checked.executionCode !== execution.code ||
      checked.analysis.programErrors.length !== 0 ||
      refusals(checked.analysis).length !== 0
    ) {
      return null;
    }
    this.checkedProgram = null;
    return checked;
  }

  private async SyntaxCheck(
    code: string,
    path: string,
    sources: SourceFile[],
    execution: ExecutionSource
  ): Promise<Response> {
    // Deliberately a throwaway interpreter, never `this.interpreter`.
    const interpreter = await this.createInterpreter();
    if (!reportsExpansions(interpreter)) {
      throw new Error('interpreter cannot analyze source');
    }
    const analysis = interpreter.analyze(code, execution.code);
    const errors: SyntaxErrorModel[] = analysis.errors.map(
      ({ line, charPositionInLine, getMsg }) => ({
        line,
        charPositionInLine,
        msg: syntaxErrorMessage(code, line, charPositionInLine, getMsg()),
      })
    );
    // The teaching rules read the file in front of the reader, so what they
    // found is about that file alone. A program that does not parse has
    // syntax errors to fix first, and a teaching rule reading a broken tree
    // would only add noise to them.
    const lints = errors.length === 0 ? analysis.teachingLints : [];
    // The rules that read the whole program are a different question, and one
    // the active tab does not bound: both halves were being computed on every
    // check and everything outside the open file thrown away, which is why a
    // reader was never told that the file they were not looking at was the
    // broken one. `analysis.linkerLints` is already empty where the composed
    // program did not parse, so nothing here needs to ask a second time.
    const programLints = lintsByFile(analysis.linkerLints, execution, path);
    const programErrors: FileSyntaxErrors[] = Array.from(
      errorsByFile(analysis.programErrors, execution, sources, path),
      ([file, found]) => ({ path: file, errors: found })
    );
    const response: Response = {
      errors,
      expansions: analysis.expansions,
      programExpansions: analysis.programExpansions,
      constructs: analysis.constructs,
      programConstructs: analysis.programConstructs,
      lints,
      programLints,
      programErrors,
      sourcecode: code,
      diagnosticPath: path,
      model: emptyStepModel(),
      debugState: 'Stop',
      output: '',
      step: this.count,
    };
    this.checkedProgram = {
      activeCode: code,
      activePath: path,
      executionCode: execution.code,
      interpreter,
      analysis,
      constructs: analysis.programConstructs,
      expansions: analysis.programExpansions,
    };
    return response;
  }

  /**
   * Parse every source before a new session is armed. unicoen recovers from
   * parser errors aggressively enough to execute malformed input, which is
   * useful while editing but wrong for Start/Run: a debugger must not pretend
   * that a program the compiler rejects is executable.
   */
  private async preflight(
    request: Request,
    execution: ExecutionSource
  ): Promise<PreparedStart | Response> {
    const sources = sourceFilesOf(request);
    const interpreter = await this.createInterpreter();
    if (!reportsExpansions(interpreter)) {
      throw new Error('interpreter cannot analyze source');
    }
    const analysis = interpreter.analyze(execution.code);
    const fallback = request.entry ?? sources[0]?.path ?? '';
    const byPath = errorsByFile(
      analysis.programErrors,
      execution,
      sources,
      fallback
    );
    // A program that parses can still be one no compiler would translate.
    // Reported through the same channel as a syntax error, and after them, so
    // a file with both shows the parse failure first.
    for (const diagnostic of refusals(analysis)) {
      const location = execution.locate({
        begin: { x: diagnostic.column, y: diagnostic.line },
        end: { x: diagnostic.endColumn, y: diagnostic.endLine },
      });
      const path = location?.path ?? fallback;
      const errors = byPath.get(path) ?? [];
      errors.push({
        line: location?.range.begin.y ?? diagnostic.line,
        charPositionInLine: location?.range.begin.x ?? diagnostic.column,
        msg: diagnostic.message,
      });
      byPath.set(path, errors);
    }
    const fileErrors: FileSyntaxErrors[] = Array.from(
      byPath,
      ([path, errors]) => ({
        path,
        errors,
      })
    );
    if (fileErrors.length === 0) {
      return {
        interpreter,
        constructs: analysis.programConstructs,
        expansions: analysis.programExpansions,
      };
    }
    const stopped = this.Stop();
    const first = fileErrors[0];
    const sourcecode =
      sources.find((file) => file.path === first.path)?.text ?? '';
    return {
      output: '',
      sourcecode,
      debugState: 'Stop',
      step: stopped.step,
      errors: first.errors,
      fileErrors,
      diagnosticPath: first.path,
      model: emptyStepModel(),
      constructs: [],
      expansions: [],
      lints: [],
    };
  }

  private record(
    execState: ExecState,
    output: string,
    waitingForStdin: boolean = false
  ) {
    this.history.push(execState, output, waitingForStdin);
    this.recordArrival(execState);
  }

  /**
   * One more arrival at the line about to run. `getNextExpr` is what the
   * breakpoint check already asks of every step, so this costs a lookup
   * rather than a model.
   */
  private recordArrival(execState: ExecState) {
    // A program with nothing left to run has no next expression, and unicoen
    // says so with `undefined` rather than the `null` its type promises:
    // `int main(void) {}` is entirely valid C, and reading `codeRange` off
    // that threw before the first step ever completed.
    const next = execState.getNextExpr() ?? null;
    const range = next === null ? null : next.codeRange;
    if (!range || !range.begin) {
      return;
    }
    const line = range.begin.y;
    this.coverage.set(line, (this.coverage.get(line) ?? 0) + 1);
  }

  private lineCounts(execution: ExecutionSource, path: string): LineCount[] {
    return [...this.coverage.entries()].flatMap(([line, count]) => {
      const location = execution.locate({
        begin: { x: 0, y: line },
        end: { x: 0, y: line },
      });
      return location?.path === path
        ? [{ line: location.range.begin.y, count }]
        : [];
    });
  }

  private report(
    event: RUN_EVENT,
    result: StepResult,
    execution: ExecutionSource
  ) {
    if (this.onRunEvent !== null) {
      this.onRunEvent(event, this.respond(result, execution));
    }
  }
}
