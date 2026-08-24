import { dia } from '@joint/core';
import { Plivet } from '../src';
import type { ExternalDiagnostic } from '../src';
import { Bus } from '../src/app/emitter';
import { EditorController } from '../src/app/EditorController';
import type { InterpreterClient, Request, Response } from '../src/core';
import { emptyStepModel } from '../src/core';
import {
  diagnosticColumns,
  diagnosticStatusText,
  diagnosticsTableCells,
  sameDiagnostics,
  sortedDiagnostics,
} from '../src/ui/graph/diagnosticsTable';
import type {
  DiagnosticActivity,
  DiagnosticEntry,
  RunStatus,
} from '../src/ui/graph/diagnosticsTable';
import strings from '../src/strings';

/**
 * The findings band: the table the canvas draws over its state views, and the
 * wiring that fills it.
 *
 * The table itself is checked as cells rather than as SVG - JointJS builds an
 * element under jsdom, and what it will not do is put a paper on the page -
 * and the wiring is checked through a whole `Plivet` with the canvas stubbed,
 * which is where the two checkers' answers actually meet.
 */
const captured: {
  entries: DiagnosticEntry[][];
  activity: DiagnosticActivity[];
  states: string[];
  runStatuses: RunStatus[];
} = { entries: [], activity: [], states: [], runStatuses: [] };

jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    setFocus(): void {}
    destroy(): void {}
    setDiagnostics(entries: DiagnosticEntry[]): void {
      captured.entries.push(entries);
    }
    setDiagnosticActivity(activity: DiagnosticActivity): void {
      captured.activity.push(activity);
    }
    setRunStatus(status: RunStatus): void {
      captured.runStatuses.push(status);
    }
    setDebugState(state: string): void {
      captured.states.push(state);
    }
  },
}));

const FILES = [
  { path: 'main.c', text: 'int main(void) { return 0; }' },
  { path: 'helper.c', text: 'int helper(void) { return 1; }' },
];

const external = (path: string, line: number): ExternalDiagnostic => ({
  path,
  severity: 'warning',
  message: 'unused value',
  code: '-Wunused-value',
  from: { line, column: 4 },
  to: { line, column: 8 },
});

const entry = (
  severity: DiagnosticEntry['severity'],
  path: string,
  line: number
): DiagnosticEntry => ({
  severity,
  origin: 'local',
  path,
  line,
  column: 0,
  message: `${severity} in ${path}`,
});

const labelOf = (cell: dia.Cell): string =>
  String((cell as dia.Element).attr('label/text'));

const indexOf = (cell: dia.Cell): string | undefined => {
  const value = (cell as dia.Element).attr('body/data-diagnostic-index');
  return typeof value === 'undefined' ? undefined : String(value);
};

describe('the status line over the findings', () => {
  it('reports the checker that is still working before anything else', () => {
    expect(diagnosticStatusText('buildStarted', 'Debugging', false)).toBe(
      strings.diagnosticsBuildStarted
    );
    expect(diagnosticStatusText('localRunning', 'Debugging', true)).toBe(
      strings.diagnosticsLocalRunning
    );
  });

  it('reports the run while one is under way', () => {
    expect(diagnosticStatusText('buildComplete', 'Debugging', false)).toBe(
      `${strings.diagnosticsDebugging}: Debugging`
    );
  });

  it('reports the last checker to finish, until the wait makes it history', () => {
    expect(diagnosticStatusText('localComplete', 'Stop', false)).toBe(
      strings.diagnosticsLocalComplete
    );
    expect(diagnosticStatusText('localComplete', 'Stop', true)).toBe(
      strings.diagnosticsIdle
    );
    expect(diagnosticStatusText(null, 'Stop', false)).toBe(
      strings.diagnosticsIdle
    );
  });

  it('distinguishes a rejected run from a fatal runtime stop', () => {
    expect(diagnosticStatusText(null, 'Stop', false, 'rejected')).toBe(
      strings.diagnosticsRunRejected
    );
    expect(diagnosticStatusText(null, 'EOF', false, 'stoppedOnError')).toBe(
      strings.diagnosticsRunStoppedOnError
    );
    expect(
      diagnosticStatusText(null, 'EOF', false, {
        kind: 'invalidStatement',
        path: 'helper.c',
        line: 12,
      })
    ).toBe(
      'Execution stopped at helper.c:12 because the statement is not valid.'
    );
  });

  it('names the file, the line and the reason a run was refused', () => {
    expect(
      diagnosticStatusText(null, 'Stop', false, {
        kind: 'rejected',
        path: 'main.c',
        line: 1,
        message: "expected '}' to close this block",
      })
    ).toBe("Run rejected at main.c:1: expected '}' to close this block");
  });

  it('keeps a check still running above a refusal it has not seen yet', () => {
    // The rule the line has always followed: work in progress outranks an
    // outcome, because a reader waiting on a checker is asking about it.
    expect(
      diagnosticStatusText('localRunning', 'Stop', false, {
        kind: 'rejected',
        path: 'main.c',
        line: 1,
        message: 'anything',
      })
    ).toBe(strings.diagnosticsLocalRunning);
  });
});

describe('the findings table', () => {
  it('reads errors first, then by file and line', () => {
    const sorted = sortedDiagnostics([
      entry('warning', 'main.c', 2),
      entry('error', 'helper.c', 9),
      entry('info', 'main.c', 1),
      entry('error', 'helper.c', 3),
      entry('error', 'main.c', 8),
    ]);

    expect(
      sorted.map((found) => `${found.severity} ${found.path}:${found.line}`)
    ).toEqual([
      'error helper.c:3',
      'error helper.c:9',
      'error main.c:8',
      'warning main.c:2',
      'info main.c:1',
    ]);
  });

  it('gives the message what is left after the four fixed columns', () => {
    const columns = diagnosticColumns(900);

    expect(columns).toHaveLength(5);
    expect(columns[0].x).toBe(0);
    columns.slice(1).forEach((column, index) => {
      expect(column.x).toBe(columns[index].x + columns[index].width);
    });
    expect(columns[4].width).toBe(900 - columns[4].x);
    // Narrow windows scroll rather than squeezing the sentence out.
    expect(diagnosticColumns(200)[4].width).toBe(200);
  });

  it('draws a header and one clickable row per finding', () => {
    const entries = [
      entry('error', 'main.c', 4),
      entry('warning', 'main.c', 7),
    ];
    const table = diagnosticsTableCells(entries, 24, 24, 800);
    const headers = table.cells.filter(
      (cell) => typeof indexOf(cell) === 'undefined'
    );
    const rows = table.cells.filter(
      (cell) => typeof indexOf(cell) !== 'undefined'
    );

    expect(headers.map(labelOf)).toEqual([
      strings.diagnosticsColumnSeverity,
      strings.diagnosticsColumnSource,
      strings.diagnosticsColumnFile,
      strings.diagnosticsColumnLine,
      strings.diagnosticsColumnType,
    ]);
    expect(rows).toHaveLength(entries.length * 5);
    // Every cell of a row carries the row's index, so a click anywhere along
    // it finds the same finding.
    expect(rows.slice(0, 5).map(indexOf)).toEqual(['0', '0', '0', '0', '0']);
    expect(rows.slice(0, 5).map(labelOf)).toEqual([
      strings.diagnosticsSeverityError,
      strings.diagnosticsSourceLocal,
      'main.c',
      '4',
      'error in main.c',
    ]);
    expect(rows.slice(5).map(indexOf)).toEqual(['1', '1', '1', '1', '1']);
  });

  it('tells one answer from the same answer sent again', () => {
    const first = [entry('error', 'main.c', 4), entry('warning', 'main.c', 7)];
    const again = [entry('error', 'main.c', 4), entry('warning', 'main.c', 7)];

    expect(sameDiagnostics(first, again)).toBe(true);
    expect(sameDiagnostics(first, [first[0]])).toBe(false);
    expect(sameDiagnostics(first, [{ ...first[0], line: 5 }, first[1]])).toBe(
      false
    );
    expect(
      sameDiagnostics(first, [{ ...first[0], rule: 'parser' }, first[1]])
    ).toBe(false);
  });

  it('names the rule beside the message when the checker gave one', () => {
    const table = diagnosticsTableCells(
      [{ ...entry('warning', 'main.c', 1), rule: '-Wunused-value' }],
      0,
      0,
      800
    );

    expect(table.cells.map(labelOf)).toContain(
      '-Wunused-value: warning in main.c'
    );
  });
});

describe('what reaches the findings band', () => {
  beforeEach(() => {
    captured.entries = [];
    captured.activity = [];
    captured.states = [];
    captured.runStatuses = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('carries a build finding to the canvas with the file it belongs to', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, { files: FILES, entry: 'main.c' });

    plivet.setDiagnostics('a-plus', [external('helper.c', 0)]);

    const last = captured.entries[captured.entries.length - 1];
    expect(last).toEqual([
      {
        severity: 'warning',
        origin: 'build',
        path: 'helper.c',
        line: 1,
        column: 4,
        message: 'unused value',
        rule: '-Wunused-value',
      },
    ]);
    plivet.destroy();
  });

  it('reports a finding in a file the reader is not looking at', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, { files: FILES, entry: 'main.c' });

    plivet.setDiagnostics('a-plus', [
      external('main.c', 0),
      external('helper.c', 0),
    ]);

    const last = captured.entries[captured.entries.length - 1];
    expect(last.map((found) => found.path).sort()).toEqual([
      'helper.c',
      'main.c',
    ]);
    plivet.destroy();
  });

  it('says when a build starts and when it has finished', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, {
      files: FILES,
      entry: 'main.c',
      supportBuild: true,
      diagnosticProviders: {
        'a-plus': () => Promise.resolve([external('main.c', 0)]),
      },
    });

    await plivet.requestDiagnostics();

    expect(captured.activity).toEqual(['buildStarted', 'buildComplete']);
    plivet.destroy();
  });

  it('says a build has finished even when the compiler could not be reached', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, {
      files: FILES,
      entry: 'main.c',
      supportBuild: true,
      diagnosticProviders: {
        'a-plus': () => Promise.reject(new Error('no compiler')),
      },
    });

    await expect(plivet.requestDiagnostics()).rejects.toThrow('no compiler');

    expect(captured.activity).toEqual(['buildStarted', 'buildComplete']);
    plivet.destroy();
  });
});

/** A client that answers everything with a stopped session. */
const stoppedClient = () =>
  ({
    onRunEvent: null,
    send: (request: Request): Promise<Response> =>
      Promise.resolve({
        output: '',
        sourcecode: request.sourcecode,
        debugState: 'Stop',
        step: 0,
        errors: [],
        model: emptyStepModel(),
        expansions: [],
        constructs: [],
        lints: [],
      } as Response),
  }) as unknown as InterpreterClient;

/**
 * A client that answers a syntax check the way `core/server.ts` does: with the
 * checked file's own text, so the controller does not read the answer as one
 * about a file the reader has since left.
 */
const checkingClient = (
  answer: (request: Request) => Partial<Response>
): InterpreterClient =>
  ({
    onRunEvent: null,
    send: (request: Request): Promise<Response> =>
      Promise.resolve({
        output: '',
        sourcecode:
          request.files?.find((file) => file.path === request.active)?.text ??
          request.sourcecode,
        debugState: 'Stop',
        step: 0,
        errors: [],
        model: emptyStepModel(),
        expansions: [],
        constructs: [],
        lints: [],
        ...answer(request),
      }) as Promise<Response>,
  }) as unknown as InterpreterClient;

const undeclared = (line: number) => ({
  rule: 'undeclared-identifier',
  severity: 'error' as const,
  message: 'nothing declares total',
  line,
  column: 2,
  endLine: line,
  endColumn: 7,
});

/**
 * What the check found in the files it was not asked about.
 *
 * The background check reads one tab, but the parse behind it reads the whole
 * composed program on every keystroke - and everything it found outside the
 * open file used to be thrown away, so a reader was never told that the file
 * they were not looking at was the broken one. The table is where they are
 * told, so this is checked through the signal the canvas draws.
 */
describe('findings in a file the reader is not editing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const held = () => {
    const bus = new Bus();
    const published: DiagnosticEntry[][] = [];
    bus.slot('diagnostics', (entries) => published.push(entries));
    const host = document.createElement('div');
    document.body.appendChild(host);
    return { bus, published, host };
  };

  const latest = (published: DiagnosticEntry[][]): DiagnosticEntry[] =>
    published[published.length - 1] ?? [];

  it('names the file each one is in, not the file being checked', async () => {
    const { bus, published, host } = held();
    const controller = new EditorController(host, {
      bus,
      client: checkingClient(() => ({
        programErrors: [
          {
            path: 'helper.c',
            errors: [{ line: 1, charPositionInLine: 20, msg: "missing ';'" }],
          },
        ],
        programLints: [{ path: 'helper.c', lints: [undeclared(1)] }],
      })),
      files: FILES,
      entry: 'main.c',
    });

    controller.send('SyntaxCheck');
    await Promise.resolve();

    expect(latest(published)).toEqual([
      {
        severity: 'error',
        origin: 'local',
        path: 'helper.c',
        line: 1,
        column: 20,
        message: "missing ';'",
      },
      {
        severity: 'error',
        origin: 'local',
        path: 'helper.c',
        line: 1,
        column: 2,
        message: 'nothing declares total',
        rule: 'undeclared-identifier',
      },
    ]);
    controller.destroy();
  });

  it('keeps them while the reader edits another file', async () => {
    const { bus, published, host } = held();
    const controller = new EditorController(host, {
      bus,
      client: checkingClient(() => ({
        programLints: [{ path: 'helper.c', lints: [undeclared(1)] }],
      })),
      files: FILES,
      entry: 'main.c',
    });

    controller.send('SyntaxCheck');
    await Promise.resolve();
    expect(latest(published)).toHaveLength(1);

    // The edit is in main.c. What was found in helper.c still describes
    // helper.c exactly, and emptying the table on every keystroke would be
    // the whole of what the reader ever saw of the file they are not in.
    controller.replaceCode('int main(void) { return 1; }');

    expect(latest(published)).toEqual([
      expect.objectContaining({ path: 'helper.c', line: 1 }),
    ]);
    controller.destroy();
  });

  it('replaces them as a set when the next check answers', async () => {
    const { bus, published, host } = held();
    const controller = new EditorController(host, {
      bus,
      client: checkingClient((request) =>
        request.active === 'main.c'
          ? {
              errors: [
                { line: 1, charPositionInLine: 17, msg: 'expected expression' },
              ],
              programErrors: [
                {
                  path: 'main.c',
                  errors: [
                    {
                      line: 1,
                      charPositionInLine: 17,
                      msg: 'expected expression',
                    },
                  ],
                },
              ],
              programLints: [{ path: 'helper.c', lints: [undeclared(1)] }],
            }
          : { programLints: [] }
      ),
      files: FILES,
      entry: 'main.c',
    });

    controller.send('SyntaxCheck');
    await Promise.resolve();
    expect(latest(published).map((found) => found.path)).toEqual([
      'main.c',
      'helper.c',
    ]);

    // Reading the same error twice is the thing to avoid: the checked file
    // parses twice, alone and composed, and both answers arrive.
    expect(
      latest(published).filter((found) => found.path === 'main.c')
    ).toHaveLength(1);

    bus.signal('navigateMemory', {
      kind: 'location',
      path: 'helper.c',
      line: 1,
      column: 0,
    });
    controller.send('SyntaxCheck');
    await Promise.resolve();

    // helper.c was never edited, and its finding is gone all the same: it was
    // about the program, and the program has just been read again.
    expect(latest(published)).toEqual([
      expect.objectContaining({
        path: 'main.c',
        message: 'expected expression',
      }),
    ]);
    controller.destroy();
  });
});

describe('a finding cleared by an edit', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('removes the stale row before the delayed parser answers', async () => {
    const bus = new Bus();
    const published: DiagnosticEntry[][] = [];
    bus.slot('diagnostics', (entries) => published.push(entries));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = {
      onRunEvent: null,
      send: (request: Request): Promise<Response> =>
        Promise.resolve({
          output: '',
          sourcecode: request.sourcecode,
          debugState: 'Stop',
          step: 0,
          errors: request.sourcecode.includes('return ;')
            ? [{ line: 1, charPositionInLine: 17, msg: 'expected expression' }]
            : [],
          model: emptyStepModel(),
          expansions: [],
          constructs: [],
          lints: [],
        }),
    } as unknown as InterpreterClient;
    const controller = new EditorController(host, {
      bus,
      client,
      doc: 'int main(void) { return ; }',
    });

    controller.send('SyntaxCheck');
    await Promise.resolve();
    expect(published[published.length - 1]).toHaveLength(1);

    controller.replaceCode('int main(void) { return 0; }');
    expect(published[published.length - 1]).toEqual([]);
    controller.destroy();
  });
});

describe('a start the parser refused', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reports the errors it was refused for, in the file holding them', () => {
    const bus = new Bus();
    const published: DiagnosticEntry[][] = [];
    const statuses: RunStatus[] = [];
    bus.slot('diagnostics', (entries) => published.push(entries));
    bus.slot('runStatus', (status) => statuses.push(status));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = new EditorController(host, {
      bus,
      client: stoppedClient(),
      files: FILES,
      entry: 'main.c',
    });

    // What the preflight in `core/server.ts` answers a refused Start with.
    controller.recieve({
      output: '',
      sourcecode: FILES[1].text,
      debugState: 'Stop',
      step: 0,
      errors: [{ line: 1, charPositionInLine: 14, msg: "missing ';'" }],
      fileErrors: [
        {
          path: 'helper.c',
          errors: [{ line: 1, charPositionInLine: 14, msg: "missing ';'" }],
        },
      ],
      diagnosticPath: 'helper.c',
      model: emptyStepModel(),
      expansions: [],
      constructs: [],
      lints: [],
    });

    expect(published[published.length - 1]).toEqual([
      {
        severity: 'error',
        origin: 'local',
        path: 'helper.c',
        line: 1,
        column: 14,
        message: "missing ';'",
      },
    ]);
    // Not the bare sentence: the reader who pressed Step is asking where, and
    // the refusal already knows the file and the line it is sending them to.
    expect(statuses[statuses.length - 1]).toEqual({
      kind: 'rejected',
      path: 'helper.c',
      line: 1,
      message: "missing ';'",
    });
    expect(
      diagnosticStatusText(null, 'Stop', false, statuses[statuses.length - 1])
    ).toBe("Run rejected at helper.c:1: missing ';'");
    controller.destroy();
  });

  it('reports a fatal runtime stop separately from ordinary EOF', () => {
    const bus = new Bus();
    const statuses: RunStatus[] = [];
    bus.slot('runStatus', (status) => statuses.push(status));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = new EditorController(host, {
      bus,
      client: stoppedClient(),
      files: FILES,
      entry: 'main.c',
    });

    controller.recieve({
      output: 'c-visualizer stopped the program',
      sourcecode: FILES[0].text,
      debugState: 'EOF',
      step: 3,
      errors: [],
      model: emptyStepModel(),
      location: {
        path: 'main.c',
        range: {
          begin: { x: 2, y: 4 },
          end: { x: 17, y: 4 },
        },
      },
      runtime: [
        {
          rule: 'division-by-zero',
          severity: 'error',
          message: 'division by zero',
          line: 1,
          column: 17,
          endLine: 1,
          endColumn: 22,
          fatal: true,
        },
      ],
    });

    expect(statuses[statuses.length - 1]).toEqual({
      kind: 'invalidStatement',
      path: 'main.c',
      line: 4,
    });
    controller.destroy();
  });
});
