import { CellModel, Response, Server, StepModel } from '../src/core';
import { RuntimeDiagnostic } from '../src/interpreter/RuntimeDiagnostic';

/**
 * Runs C programs the way the page does - one `Exec` through a `Server` -
 * for the library tests. Not a test file itself: the `library-*.test.ts`
 * files import it.
 */

export interface Run {
  /** Everything the program wrote to the console. */
  output: string;
  runtime: RuntimeDiagnostic[];
  /** The last step's model: the canvas as the run left it. */
  model: StepModel;
  response: Response;
}

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const logged = console.log;
  const errored = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await work();
  } finally {
    console.log = logged;
    console.error = errored;
  }
};

export const exec = async (code: string): Promise<Run> => {
  const server = new Server();
  // `Exec` answers at once with the run under way; the run's own end - the
  // program finishing, or waiting for input - arrives as a run event.
  const finished = new Promise<Response>((resolve) => {
    server.onRunEvent = (_event, response) => resolve(response);
  });
  const response = await quiet(async () => {
    const started = await server.send({
      controlEvent: 'Exec',
      sourcecode: code,
      files: [{ path: 'main.c', text: code }],
      entry: 'main.c',
    });
    return started.debugState === 'Executing' ? finished : started;
  });
  return {
    output: response.output,
    runtime: response.runtime ?? [],
    model: response.model,
    response,
  };
};

/** The output of a program that prints and returns, checked to run clean. */
export const outputOf = async (code: string): Promise<string> => {
  const run = await exec(code);
  const fatal = run.runtime.filter((diagnostic) => diagnostic.fatal);
  if (fatal.length > 0 || run.response.errors.length > 0) {
    throw new Error(
      `the program did not run clean: ${JSON.stringify(
        fatal.concat(run.response.errors as never[])
      )}\n${run.output}`
    );
  }
  return run.output;
};

export const rulesOf = (run: Run): string[] =>
  run.runtime.map((diagnostic) => diagnostic.rule);

const rowsOf = (model: StepModel): CellModel[][] =>
  model.stacks.flatMap((stack) => stack.rows);

/** The cells of the row that draws the object with this name. */
export const rowNamed = (model: StepModel, name: string): CellModel[] => {
  const row = rowsOf(model).find((cells) =>
    cells.some((cell) => cell.kind === 'name' && cell.text === name)
  );
  if (typeof row === 'undefined') {
    throw new Error(`no row named ${name}`);
  }
  return row;
};

/** What the canvas writes in a row's value cell. */
export const valueOf = (model: StepModel, name: string): string => {
  const cell = rowNamed(model, name).find((one) => one.kind === 'value');
  if (typeof cell === 'undefined') {
    throw new Error(`row ${name} has no value`);
  }
  return cell.text;
};

/** What the canvas writes in a row's type cell. */
export const typeOf = (model: StepModel, name: string): string => {
  const cell = rowNamed(model, name).find((one) => one.kind === 'type');
  if (typeof cell === 'undefined') {
    throw new Error(`row ${name} has no type`);
  }
  return cell.text;
};

/** The name of the row a pointer's arrow lands on, or null. */
export const targetOf = (model: StepModel, name: string): string | null => {
  const value = rowNamed(model, name).find((one) => one.kind === 'value');
  const key = value?.pointerTarget;
  if (typeof key === 'undefined') {
    return null;
  }
  const target = rowsOf(model).find((cells) =>
    cells.some((cell) => cell.key === key)
  );
  const label = target?.find((cell) => cell.kind === 'name');
  return typeof label === 'undefined' ? null : label.text;
};
