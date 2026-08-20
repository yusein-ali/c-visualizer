import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import { StepHistory } from './history';
import { Construct } from '../interpreter/Construct';
import { Expansion } from '../interpreter/Expansion';

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
export class Request {
  constructor(
    public controlEvent: CONTROL_EVENT,
    public sourcecode: string,
    public stdinText?: string,
    public lineNumOfBreakpoint?: number[]
  ) {}
}

export class Response {
  constructor(
    public output: string,
    public sourcecode: string,
    public debugState: DEBUG_STATE,
    public step: number,
    public errors: SyntaxErrorData[],
    public files: Map<string, ArrayBuffer>,
    public execState?: ExecState,
    /** Preprocessor replacements, for the editor to mark. Syntax checks only. */
    public expansions?: Expansion[],
    /** Parsed statements, for the editor to explain. Syntax checks only. */
    public constructs?: Construct[]
  ) {}
}

/**
 * A run that ended somewhere other than where the caller asked it to: at the
 * end of the program, at a read, or at a breakpoint. `StepAll` returns as soon
 * as the run starts, so what stopped it has to be reported separately.
 */
export type RUN_EVENT = 'EOF' | 'stdin' | 'Breakpoint';

/** Implemented by interpreters that can describe their source. */
interface ExpansionSource {
  getExpansions(code: string): Expansion[];
  getConstructs(code: string): Construct[];
}

function reportsExpansions(
  interpreter: Interpreter
): interpreter is Interpreter & ExpansionSource {
  const source = interpreter as unknown as ExpansionSource;
  return (
    typeof source.getExpansions === 'function' &&
    typeof source.getConstructs === 'function'
  );
}

class Server {
  private timer: NodeJS.Timeout | null = null;
  private isExecuting: boolean = false;
  private files: Map<string, ArrayBuffer> = new Map();
  private count: number = 0;
  private interpreter: Interpreter | null = null;
  private history = new StepHistory();

  /**
   * Where a run that stopped on its own is reported. The application sets it;
   * nothing here knows what the interface does with it, which is what keeps
   * this file free of `src/components` and lets it move into a Worker in
   * Phase 6.
   */
  public onRunEvent: ((event: RUN_EVENT, response: Response) => void) | null =
    null;

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
    this.count = 0;
    const interpreter = await this.createInterpreter();
    interpreter.setFileList(this.files);
    this.interpreter = interpreter;
    this.history.clear();
  }

  private addFile(file: File) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onerror = () => {
        reader.abort();
        reject(new DOMException('Problem parsing input file.'));
      };

      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          this.files.set(file.name, reader.result);
          resolve(reader.result);
        } else {
          reject(new DOMException('Problem loading input file.'));
        }
      };

      reader.readAsArrayBuffer(file);
    });
  }

  public async upload(files: FileList) {
    await Promise.all(Array.from(files).map((file) => this.addFile(file)));
    return this.files;
  }

  public delete(filename: string) {
    this.files.delete(filename);
    return this.files;
  }

  public async send(request: Request): Promise<Response> {
    const { controlEvent, sourcecode, stdinText, lineNumOfBreakpoint } =
      request;

    switch (controlEvent) {
      case 'Start': {
        return this.Start(sourcecode);
      }
      case 'Stop': {
        return this.Stop(sourcecode);
      }
      case 'BackAll': {
        return this.BackAll(sourcecode);
      }
      case 'StepBack': {
        return this.StepBack(sourcecode);
      }
      case 'Step': {
        return this.Step(sourcecode, stdinText);
      }
      case 'StepAll': {
        return this.StepAll(sourcecode, lineNumOfBreakpoint, stdinText);
      }
      case 'Exec': {
        return this.Exec(sourcecode, lineNumOfBreakpoint);
      }
      case 'SyntaxCheck': {
        return this.SyntaxCheck(sourcecode);
      }
    }
  }

  private async Start(sourcecode: string) {
    await this.reset();
    if (this.interpreter === null) {
      throw new Error('interpreter is not found');
    }
    const execState = this.interpreter.startStepExecution(sourcecode);
    const output = this.interpreter.getStdout();
    this.record(execState, output);
    this.isExecuting = true;
    const res: Response = {
      execState,
      output,
      sourcecode,
      debugState: 'First',
      step: this.count,
      errors: [],
      files: this.files,
    };
    return res;
  }

  private Stop(sourcecode: string) {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.interpreter = null;
    const ret: Response = {
      sourcecode,
      execState: undefined,
      debugState: 'Stop',
      output: '',
      step: this.count,
      errors: [],
      files: this.files,
    };
    return ret;
  }

  private BackAll(sourcecode: string) {
    this.count = 0;
    const execState = this.history.stateAt(this.count);
    const output = this.history.outputAt(this.count);
    const ret: Response = {
      execState,
      output,
      sourcecode,
      debugState: 'First',
      step: this.count,
      errors: [],
      files: this.files,
    };
    return ret;
  }

  private StepBack(sourcecode: string) {
    // Not below the window: the states before it were dropped, and there is
    // nothing to step back to. `BackAll` still reaches the first state.
    if (this.history.oldestRetained() < this.count) {
      this.count -= 1;
    }
    const execState = this.history.stateAt(this.count);
    const output = this.history.outputAt(this.count);
    const ret: Response = {
      execState,
      output,
      sourcecode,
      debugState: 'Debugging',
      step: this.count,
      errors: [],
      files: this.files,
    };
    return ret;
  }

  private Step(sourcecode: string, stdinText?: string) {
    ++this.count;
    if (this.count < this.history.length) {
      // Stepping forward out of a stretch that has been dropped - the run was
      // long enough to evict it - resumes at the oldest step still held.
      this.count = this.history.nextRetained(this.count);
      const execState = this.history.stateAt(this.count);
      const output = this.history.outputAt(this.count);
      const ret: Response = {
        execState,
        output,
        sourcecode,
        debugState: 'Debugging',
        step: this.count,
        errors: [],
        files: this.files,
      };
      return ret;
    }
    if (this.isExecuting) {
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
          const waiting: Response = {
            sourcecode,
            output: this.history.outputAt(this.count),
            execState: this.history.stateAt(this.count),
            debugState: 'stdin',
            step: this.count,
            errors: [],
            files: this.files,
          };
          return waiting;
        }
        this.interpreter.stdin(stdinText);
        //  console.log(`stdin:${stdinText}`);
      }
      const state: ExecState | null = this.interpreter.stepExecute();
      // let maxSkip = 10;
      // while (state.getCurrentExpr().codeRange == null && 0 < --maxSkip) {
      //   state = this.engine.stepExecute();
      // }
      if (state === null) {
        // The engine has no step iterator, so it is not the one `Start` armed.
        // Report the last known good state: a null ExecState reaches the canvas
        // through the `draw` signal and takes the whole UI down with it.
        this.isExecuting = false;
        this.count = Math.max(this.history.length - 1, 0);
        const dead: Response = {
          sourcecode,
          output: this.history.outputAt(this.count),
          execState: this.getLastHistory(),
          debugState: 'EOF',
          step: this.count,
          errors: [],
          files: this.files,
        };
        return dead;
      }
      const execState = state;
      const output = this.interpreter.getStdout();
      this.record(execState, output);
      //  console.log(`output:${output}`);
      // let stateText = `Step:${this.count} | Value:${execState.getCurrentValue()}`;
      let debugState: DEBUG_STATE = 'Debugging';
      if (this.interpreter.getIsWaitingForStdin()) {
        debugState = 'stdin';
      } else if (!this.interpreter.isStepExecutionRunning()) {
        debugState = 'EOF';
        this.isExecuting = false;
      }
      const ret: Response = {
        execState,
        output,
        sourcecode,
        debugState,
        step: this.count,
        errors: [],
        files: this.files,
      };
      return ret;
    }
    this.count = Math.max(this.history.length - 1, 0);
    const output = this.history.outputAt(this.count);
    const ret: Response = {
      output,
      sourcecode,
      execState: this.getLastHistory(),
      debugState: 'EOF',
      step: this.count,
      errors: [],
      files: this.files,
    };
    return ret;
  }

  private StepAll(
    sourcecode: string,
    lineNumOfBreakpoint?: number[],
    stdinText?: string
  ) {
    const currentCount = this.count;
    // Only the first step of the run may consume the submitted line: it is the
    // one the program is blocked on. Every later step runs with no input, and
    // the guard in Step stops the run at the next scanf.
    let pendingStdin = stdinText;
    const loop = () => {
      const ret: Response = this.Step(sourcecode, pendingStdin);
      pendingStdin = undefined;
      if (ret.debugState === 'EOF') {
        this.report('EOF', ret);
        return;
      } else if (ret.debugState === 'stdin') {
        this.report('stdin', ret);
        return;
      } else if (typeof lineNumOfBreakpoint !== 'undefined') {
        if (typeof ret.execState !== 'undefined') {
          const nextExpr = ret.execState.getNextExpr();
          const { codeRange } = nextExpr;
          if (codeRange) {
            if (lineNumOfBreakpoint.includes(codeRange.begin.y - 1)) {
              this.report('Breakpoint', ret);
              return;
            }
          }
        }
      }
      this.timer = global.setTimeout(loop.bind(this), 1);
    };
    loop();
    const execState = this.history.stateAt(currentCount);
    const output = this.history.outputAt(currentCount);
    const debugState: DEBUG_STATE = 'Executing';
    return {
      execState,
      output,
      sourcecode,
      debugState,
      step: currentCount,
      errors: [],
      files: this.files,
    };
  }

  private async Exec(sourcecode: string, lineNumOfBreakpoint?: number[]) {
    await this.Start(sourcecode);
    return this.StepAll(sourcecode, lineNumOfBreakpoint);
  }

  private async SyntaxCheck(code: string) {
    // Deliberately a throwaway interpreter, never `this.interpreter`.
    const interpreter = await this.createInterpreter();
    const errors: SyntaxErrorData[] = interpreter.checkSyntaxError(code);
    const ret: Response = {
      errors,
      expansions: reportsExpansions(interpreter)
        ? interpreter.getExpansions(code)
        : [],
      constructs: reportsExpansions(interpreter)
        ? interpreter.getConstructs(code)
        : [],
      sourcecode: code,
      execState: undefined,
      debugState: 'Stop',
      output: '',
      step: this.count,
      files: this.files,
    };
    return ret;
  }

  private record(execState: ExecState, output: string) {
    this.history.push(execState, output);
  }

  private getLastHistory() {
    return this.history.lastState();
  }

  private report(event: RUN_EVENT, response: Response) {
    if (this.onRunEvent !== null) {
      this.onRunEvent(event, response);
    }
  }
}

export const server = new Server();
