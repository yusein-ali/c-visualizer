import { dia } from '@joint/core';
import { Plivet } from '../src';
import type { ExternalDiagnostic } from '../src';
import { Bus } from '../src/app/emitter';
import { EditorController } from '../src/app/EditorController';
import type {
  DEBUG_STATE,
  InterpreterClient,
  Request,
  Response,
  RUN_EVENT,
} from '../src/core';
import { emptyStepModel } from '../src/core';
import {
  diagnosticColumns,
  diagnosticStatus,
  diagnosticStatusCell,
  diagnosticStatusText,
  diagnosticsTableCells,
  sameDiagnostics,
  sortedDiagnostics,
} from '../src/ui/graph/diagnosticsTable';
import type {
  DebugPosition,
  DiagnosticActivity,
  DiagnosticEntry,
  DiagnosticStatus,
  RunStatus,
  StatusTone,
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
  positions: (DebugPosition | null)[];
  runStatuses: RunStatus[];
} = {
  entries: [],
  activity: [],
  states: [],
  positions: [],
  runStatuses: [],
};

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
    setDebugState(state: string, position: DebugPosition | null): void {
      captured.states.push(state);
      captured.positions.push(position ?? null);
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
      strings.diagnosticsDebugSingleStep
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

describe('what the status line says a live session is doing', () => {
  const at = (line: number, atBreakpoint: boolean): DebugPosition => ({
    path: 'main.c',
    line,
    atBreakpoint,
  });

  it('names the line a step stopped on', () => {
    expect(
      diagnosticStatusText(
        'buildComplete',
        'Debugging',
        false,
        null,
        at(7, false)
      )
    ).toBe('Single step debugging: main.c:7');
    // The armed session, before the reader has taken a step, is sitting on a
    // statement the same way: it is one press from moving, not running.
    expect(diagnosticStatusText(null, 'First', false, null, at(3, false))).toBe(
      'Single step debugging: main.c:3'
    );
  });

  it('says a mark stopped the run, and where', () => {
    expect(
      diagnosticStatusText(null, 'Debugging', false, null, at(12, true))
    ).toBe('Stopped at breakpoint: main.c:12');
  });

  it('reports a run and a wait without a line, which neither has', () => {
    // Executing is between statements, and a program blocked on a read is
    // waiting on the reader rather than on anything they can be sent to.
    expect(
      diagnosticStatusText(null, 'Executing', false, null, at(7, false))
    ).toBe(strings.diagnosticsDebugRunning);
    expect(diagnosticStatusText(null, 'stdin', false, null, at(7, false))).toBe(
      strings.diagnosticsDebugWaitingInput
    );
  });

  it('says the program has ended, rather than naming the state EOF', () => {
    expect(diagnosticStatusText(null, 'EOF', false, null, at(9, false))).toBe(
      'Program finished'
    );
  });

  it('still says it is stopped with no line to name', () => {
    // A step the interpreter could not map back to a visible tab. There is
    // nowhere to send the reader, which is no reason to answer them in the
    // interpreter's vocabulary instead.
    expect(diagnosticStatusText(null, 'Debugging', false)).toBe(
      strings.diagnosticsDebugSingleStep
    );
  });

  it('keeps a refusal above the position it never reached', () => {
    expect(
      diagnosticStatusText(null, 'Stop', false, 'rejected', at(1, false))
    ).toBe(strings.diagnosticsRunRejected);
  });
});

describe('the wash the status band is drawn on', () => {
  const at = (line: number): DebugPosition => ({
    path: 'main.c',
    line,
    atBreakpoint: false,
  });

  it('colours a refused run and a run that failed as errors', () => {
    expect(diagnosticStatus(null, 'Stop', false, 'rejected').tone).toBe(
      'error'
    );
    expect(diagnosticStatus(null, 'EOF', false, 'stoppedOnError').tone).toBe(
      'error'
    );
    expect(
      diagnosticStatus(null, 'EOF', false, {
        kind: 'invalidStatement',
        path: 'main.c',
        line: 12,
      }).tone
    ).toBe('error');
  });

  it('colours the two ways a run is taken away from the machine', () => {
    // What the reader is watching for: the mark that stopped the run, and the
    // read that is waiting on them to type. Neither is a failure, so neither
    // is the error wash, but both are the moment they have to do something.
    expect(
      diagnosticStatus(null, 'Debugging', false, null, {
        path: 'main.c',
        line: 12,
        atBreakpoint: true,
      }).tone
    ).toBe('break');
    expect(diagnosticStatus(null, 'stdin', false).tone).toBe('input');
  });

  it('gives running a colour, so that stopping is a change of one', () => {
    expect(diagnosticStatus(null, 'Executing', false).tone).toBe('running');
  });

  it('leaves every ordinary report alone, a finished program included', () => {
    // Reaching the end of main is not the program asking for anything, and
    // neither is a reader already in the middle of stepping.
    const ordinary: DiagnosticStatus[] = [
      diagnosticStatus(null, 'EOF', false),
      diagnosticStatus(null, 'Debugging', false, null, at(7)),
      diagnosticStatus('buildStarted', 'Stop', false),
      diagnosticStatus('localComplete', 'Stop', false),
      diagnosticStatus(null, 'Stop', true),
    ];

    expect(ordinary.map((status) => status.tone)).toEqual(
      ordinary.map(() => 'normal')
    );
  });

  it('draws each tone in its own hue, outline included', () => {
    const hueOf = (tone: StatusTone) => {
      const drawn = diagnosticStatusCell('status', 0, 0, 300, tone);
      return [
        String(drawn.attr('body/fill')),
        String(drawn.attr('body/stroke')),
        String(drawn.attr('label/fill')),
      ];
    };

    expect(hueOf('running')).toEqual([
      expect.stringContaining('--plivet-graph-status-running,'),
      expect.stringContaining('--plivet-graph-status-running-line'),
      expect.stringContaining('--plivet-graph-status-running-text'),
    ]);
    expect(hueOf('break')).toEqual([
      expect.stringContaining('--plivet-graph-status-break,'),
      expect.stringContaining('--plivet-graph-status-break-line'),
      expect.stringContaining('--plivet-graph-status-break-text'),
    ]);
    expect(hueOf('input')).toEqual([
      expect.stringContaining('--plivet-graph-status-input,'),
      expect.stringContaining('--plivet-graph-status-input-line'),
      expect.stringContaining('--plivet-graph-status-input-text'),
    ]);
  });

  it('does not colour a run the line has stopped reporting', () => {
    // A build under way outranks the refusal, so the sentence is the build's
    // and the band has to be the build's too.
    expect(diagnosticStatus('buildStarted', 'Stop', false, 'rejected')).toEqual(
      {
        text: strings.diagnosticsBuildStarted,
        tone: 'normal',
      }
    );
  });

  it('says the same thing in text, whatever the wash', () => {
    // The colour is a second reading of the sentence, never the only one.
    expect(diagnosticStatus(null, 'Stop', false, 'rejected').text).toBe(
      diagnosticStatusText(null, 'Stop', false, 'rejected')
    );
  });

  it('draws the error band in the palette the findings table uses', () => {
    const broken = diagnosticStatusCell('halted', 0, 0, 300, 'error');
    const ordinary = diagnosticStatusCell('idle', 0, 0, 300);

    expect(String(broken.attr('body/fill'))).toContain('--plivet-graph-error');
    expect(String(broken.attr('label/fill'))).toContain(
      '--plivet-graph-error-text'
    );
    expect(String(broken.attr('body/stroke'))).toContain(
      '--plivet-graph-error-line'
    );
    expect(String(ordinary.attr('body/fill'))).toContain(
      '--plivet-graph-caption'
    );
    expect(String(ordinary.attr('body/stroke'))).toContain(
      '--plivet-graph-grid'
    );
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
    captured.positions = [];
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

/**
 * The stop the status line reports, and how it learns which kind it was.
 *
 * A press answers through the promise; a run answers later through
 * `onRunEvent`, which is the only place the difference between stepping onto
 * a marked line and being stopped by the mark is visible.
 */
describe('where a live session tells the canvas it has stopped', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const stoppedAt = (debugState: DEBUG_STATE, line: number): Response =>
    ({
      output: '',
      sourcecode: FILES[0].text,
      debugState,
      step: line,
      errors: [],
      model: emptyStepModel(),
      location: {
        path: 'main.c',
        range: { begin: { x: 2, y: line }, end: { x: 17, y: line } },
      },
      expansions: [],
      constructs: [],
      lints: [],
    }) as Response;

  /** A client the test answers for: presses by promise, runs by hand. */
  const drivenClient = () => {
    const client = {
      onRunEvent: null as
        | ((event: RUN_EVENT, response: Response) => void)
        | null,
      reply: stoppedAt('Debugging', 1),
      send: (): Promise<Response> => Promise.resolve(client.reply),
    };
    return client;
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('marks a breakpoint stop as one, and a press as a step', async () => {
    const bus = new Bus();
    const announced: [DEBUG_STATE, DebugPosition | null][] = [];
    bus.slot('changeState', (state, _step, position) =>
      announced.push([state, position ?? null])
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = drivenClient();
    const controller = new EditorController(host, {
      bus,
      client: client as unknown as InterpreterClient,
      files: FILES,
      entry: 'main.c',
    });

    client.reply = stoppedAt('Debugging', 7);
    controller.send('Step');
    await flush();

    expect(announced[announced.length - 1]).toEqual([
      'Debugging',
      { path: 'main.c', line: 7, atBreakpoint: false },
    ]);

    // A run: the press answers Executing, and where it stopped arrives later.
    client.reply = stoppedAt('Executing', 7);
    controller.send('StepAll');
    await flush();
    expect(announced[announced.length - 1][0]).toBe('Executing');
    client.onRunEvent!('Breakpoint', stoppedAt('Debugging', 12));

    expect(announced[announced.length - 1]).toEqual([
      'Debugging',
      { path: 'main.c', line: 12, atBreakpoint: true },
    ]);

    // The next press is a step again, from the very line the mark is on.
    client.reply = stoppedAt('Debugging', 12);
    controller.send('Step');
    await flush();

    expect(announced[announced.length - 1]).toEqual([
      'Debugging',
      { path: 'main.c', line: 12, atBreakpoint: false },
    ]);
    controller.destroy();
  });

  it('has nowhere to report for a stopped session', async () => {
    const bus = new Bus();
    const announced: (DebugPosition | null)[] = [];
    bus.slot('changeState', (_state, _step, position) =>
      announced.push(position ?? null)
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = drivenClient();
    const controller = new EditorController(host, {
      bus,
      client: client as unknown as InterpreterClient,
      files: FILES,
      entry: 'main.c',
    });

    client.reply = { ...stoppedAt('Debugging', 4), debugState: 'Stop' };
    controller.send('Stop');
    await flush();

    expect(announced[announced.length - 1]).toBeNull();
    controller.destroy();
  });
});
