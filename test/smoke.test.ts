import { Plivet } from '../src/index';
import { Server } from '../src/core/server';
import type { Response, RUN_EVENT, StepModel } from '../src/core';
import type { FromWorker, ToWorker } from '../src/core/messages';
import type { StatementExplanation } from '../src/ui/records';

/**
 * The whole application, once, end to end: a `Plivet` built into a div, the
 * Start and Step buttons pressed the way a reader presses them, and a real
 * interpreter answering behind them.
 *
 * Everything else under `test/` checks one piece against its own inputs. This
 * one is here to notice when the pieces stop being connected - a signal that
 * nobody carries any more, a widget that stopped subscribing - which no unit
 * test can see. It is deliberately shallow: what a step contains is
 * `core.test.ts`'s business, and how it is drawn is checked in a browser.
 */

/**
 * The Worker, on this thread. Jest has none, so `spawnWorker` is stubbed
 * (`jest.config.js`), and this stands in for `interpreter.worker.ts` with the
 * same `Server` behind it: messages in, responses and run events out, one
 * turn of the event loop later. The interpreter is the real one - that is the
 * point of the test - so the only fake here is the thread boundary.
 */
class InlineWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  private readonly server = new Server();
  private stopped = false;
  private fileVersion = 0;
  private reportedFiles = new Map<string, ArrayBuffer>();

  constructor() {
    this.server.onRunEvent = (event: RUN_EVENT, response: Response) => {
      this.reportFiles();
      this.send({ kind: 'run', event, response });
    };
  }

  postMessage(message: ToWorker): void {
    if (message.kind === 'files') {
      this.server.setFiles(
        new Map(
          Array.from(message.files, ([filename, contents]) => [
            filename,
            contents.slice(0),
          ])
        )
      );
      this.fileVersion = message.version;
      this.reportedFiles = this.server.fileSnapshot();
      return;
    }
    const { id, request } = message;
    this.server
      .send(request)
      .then((response) => {
        this.reportFiles();
        this.send({ kind: 'response', id, response });
      })
      .catch((thrown: unknown) =>
        this.send({
          kind: 'failed',
          id,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        })
      );
  }

  terminate(): void {
    this.stopped = true;
  }

  private send(message: FromWorker): void {
    // A terminated Worker says nothing more, which is what `destroy()` counts
    // on: a run in flight must not reach widgets that have been taken down.
    if (this.stopped || this.onmessage === null) {
      return;
    }
    this.onmessage({ data: message } as MessageEvent<FromWorker>);
  }

  private reportFiles(): void {
    const current = this.server.fileSnapshot();
    const unchanged =
      current.size === this.reportedFiles.size &&
      Array.from(current).every(
        ([filename, contents]) => this.reportedFiles.get(filename) === contents
      );
    if (unchanged) {
      return;
    }
    this.reportedFiles = current;
    this.send({
      kind: 'files',
      version: this.fileVersion,
      files: new Map(
        Array.from(current, ([filename, contents]) => {
          const value = contents as ArrayBuffer | ArrayBufferView;
          const bytes =
            value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : new Uint8Array(
                  value.buffer,
                  value.byteOffset,
                  value.byteLength
                );
          return [filename, bytes.slice().buffer];
        })
      ),
    });
  }
}

jest.mock('../src/core/spawnWorker', () => ({
  spawnWorker: () => new InlineWorker(),
}));

/** As in `instances.test.ts`: JointJS needs an SVG implementation jsdom has
 * not got. The model it was handed is kept, so that a step reaching the
 * canvas is still something this test can see. */
const drawn: StepModel[] = [];
const explained: StatementExplanation[] = [];
jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    render(model: StepModel, explanation: StatementExplanation): void {
      drawn.push(model);
      explained.push(explanation);
    }
    setScale(): void {}
    setDark(): void {}
    setDiagnostics(): void {}
    setDiagnosticActivity(): void {}
    setRunStatus(): void {}
    setDebugState(): void {}
    destroy(): void {}
  },
}));

const PROGRAM = `#include <stdio.h>

int main(void) {
  int n = 41;
  n = n + 1;
  printf("counted %d\\n", n);
  return 0;
}
`;

const FILE_PROGRAM = `#include <stdio.h>

int main(void) {
  FILE *output = fopen("result.txt", "w");
  fputs("created by C\\n", output);
  fclose(output);
  return 0;
}
`;

/**
 * The debug buttons, in the order `ControlBar` builds them. The arrow and the
 * double arrow are what a reader presses: with no session they carry `Start`
 * and `Exec`, and the dedicated Start button is the restart, disabled until
 * there is something to restart.
 */
const RESTART = 0;
const STOP = 1;
const STEP = 5;
const RUN = 6;

const buttonsOf = (parent: HTMLElement) =>
  Array.from(
    parent.querySelectorAll<HTMLButtonElement>(
      '.plivet-controls__group--debug .plivet-controls__button'
    )
  );

const outputOf = (parent: HTMLElement) =>
  parent.querySelector('.plivet-console-output')!.textContent;

/**
 * Waits for something the interpreter is doing. A step is a promise; a run is
 * a loop that yields to the timer queue between slices, so both are reached by
 * letting the event loop turn rather than by counting ticks.
 */
const until = async (
  what: string,
  ready: () => boolean,
  turns = 200
): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) {
    if (ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`gave up waiting for ${what}`);
};

let parent: HTMLElement;
let plivet: Plivet;
const log = console.log;

beforeAll(() => {
  // The interpreter announces its builtin table on every session, which is
  // several hundred lines of it in a test that starts four.
  console.log = () => undefined;

  /*
   * CodeMirror measures the document in a `requestAnimationFrame`, and jsdom's
   * `Range` has no `getClientRects` for it to measure with. The other editor
   * tests never reach it - they finish before the frame runs - but this one
   * waits for an interpreter, so the frame lands in the middle of it. Zero
   * rectangles is the honest answer for a document that was never laid out.
   */
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterAll(() => {
  console.log = log;
});

beforeEach(() => {
  drawn.length = 0;
  explained.length = 0;
  parent = document.createElement('div');
  document.body.appendChild(parent);
  plivet = new Plivet(parent, { sourceCode: PROGRAM });
});

afterEach(() => {
  plivet.destroy();
  document.body.innerHTML = '';
});

describe('a PLIVET on a page', () => {
  it('supports the debugger function-key shortcuts inside its own shell', async () => {
    const shell = parent.querySelector('.plivet') as HTMLElement;

    shell.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'F9' })
    );
    expect(plivet.session().breakpoints).toEqual([0]);

    shell.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'F6' })
    );
    await until('F6 to start the session', () => drawn.length === 1);

    shell.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'F7' })
    );
    await until('F7 to step over', () => drawn.length === 2);
  });

  it('runs or continues with F5', async () => {
    const shell = parent.querySelector('.plivet') as HTMLElement;
    shell.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'F5' })
    );

    await until('F5 to run to EOF', () => outputOf(parent).includes('counted'));
    expect(outputOf(parent)).toContain('counted 42');
  });

  it('opens stopped, offering the two buttons that begin a session', () => {
    const buttons = buttonsOf(parent);
    expect(parent.querySelector('.plivet-controls__status')).toBeNull();
    expect(buttons.map((button) => button.disabled)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(drawn).toHaveLength(0);
  });

  it('steps once, and says so everywhere at once', async () => {
    const buttons = buttonsOf(parent);
    buttons[STEP].click();
    await until('the session to start', () => drawn.length === 1);

    buttons[STEP].click();
    await until('the step', () => drawn.length === 2);

    // The canvas and editor both answer the step without a duplicate strip.
    const model = drawn[drawn.length - 1];
    expect(model.variables.map((variable) => variable.name)).toContain('n');
    expect(model.codeRange).not.toBeNull();
    expect(parent.querySelector('.cm-editor')!.getAttribute('read-only')).toBe(
      'true'
    );
  });

  it('updates the statement type as execution moves to a new construct', async () => {
    const buttons = buttonsOf(parent);
    buttons[STEP].click();
    await until('the object declaration', () => explained.length === 1);
    expect(explained[explained.length - 1].statement!.title).toBe(
      'object declaration'
    );

    buttons[STEP].click();
    await until('the assignment', () => explained.length === 2);
    expect(explained[explained.length - 1].statement!.title).toBe(
      'assignment expression'
    );

    buttons[STEP].click();
    await until('the function call', () => explained.length === 3);
    expect(explained[explained.length - 1].statement!.title).toBe(
      'function call — printf'
    );
  });

  it('runs to the end of the program and prints what it printed', async () => {
    // One press: with no session the double arrow starts one and runs it.
    buttonsOf(parent)[RUN].click();
    await until('the run to reach EOF', () =>
      outputOf(parent).includes('counted 42')
    );

    expect(outputOf(parent)).toContain('counted 42');
  });

  it('lists a file created by the program for download', async () => {
    plivet.destroy();
    parent.textContent = '';
    plivet = new Plivet(parent, { sourceCode: FILE_PROGRAM });

    buttonsOf(parent)[RUN].click();
    await until(
      'the file-producing run to reach EOF',
      () => parent.querySelector('.plivet-files__name') !== null
    );

    expect(
      Array.from(parent.querySelectorAll('.plivet-files__name')).map(
        (name) => name.textContent
      )
    ).toEqual(['result.txt']);
    expect(
      parent.querySelector('.plivet-files__button')?.getAttribute('aria-label')
    ).toBe('download result.txt');
  });

  it('gives the document back when the session is stopped', async () => {
    const buttons = buttonsOf(parent);
    buttons[STEP].click();
    await until('the session to start', () => drawn.length === 1);
    expect(buttons[RESTART].disabled).toBe(false);

    buttons[STOP].click();
    await until(
      'the session to stop',
      () => !parent.querySelector('.cm-editor')!.hasAttribute('read-only')
    );

    expect(parent.querySelector('.cm-editor')!.hasAttribute('read-only')).toBe(
      false
    );
  });
});
