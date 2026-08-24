import { Bus } from '../src/app/emitter';
import { EditorController } from '../src/app/EditorController';
import {
  ExecutionSource,
  InterpreterClient,
  Request,
  Response,
  emptyStepModel,
} from '../src/core';
import { defaultProgram } from '../src/defaultProgram';
import { stepHighlightField } from '../src/ui/editor/stepHighlight';
import { expansionField } from '../src/ui/editor/expansions';
import { diagnosticCount } from '@codemirror/lint';
import { preprocessSource } from '../src/interpreter/preprocess';

/**
 * The controller with more than one file open.
 *
 * A tab is not only a text: it is where the reader was, which lines they
 * marked and what they pinned. Switching away and back has to give all of it
 * back, or a tab is a worse way to keep a second file than a second window.
 */

/** A client that answers everything with a stopped session. */
const fakeClient = () => {
  const sent: Request[] = [];
  const client = {
    onRunEvent: null,
    send: (request: Request): Promise<Response> => {
      sent.push(request);
      return Promise.resolve({
        output: '',
        sourcecode: request.sourcecode,
        debugState: 'Stop',
        step: 0,
        errors: [],
        model: emptyStepModel(),
        expansions: [],
        constructs: [],
        lints: [],
      } as Response);
    },
  };
  return { client: client as unknown as InterpreterClient, sent };
};

const mounted = (files: { path: string; text: string }[], entry?: string) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client, sent } = fakeClient();
  const controller = new EditorController(host, { bus, client, files, entry });
  return { host, bus, controller, sent };
};

const tabButtons = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.plivet-tabs__select'));

const FILES = [
  { path: 'main.c', text: 'int main(void) {\n  return 0;\n}' },
  { path: 'notes.c', text: 'int unused = 1;' },
];

describe('a breakpoint in a tab that is not in front', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is sent with the file it was marked in', () => {
    const { host, controller, sent } = mounted(FILES);

    // Mark the first line of notes.c, then go back to main.c and run. The
    // mark is now in a session rather than in the visible document, which is
    // where it used to be dropped.
    tabButtons(host)[1].click();
    expect(controller.active()).toBe('notes.c');
    controller.toggleBreakpoint();
    tabButtons(host)[0].click();
    expect(controller.active()).toBe('main.c');

    sent.length = 0;
    controller.send('Exec');

    expect(sent[sent.length - 1].breakpoints).toEqual([
      { path: 'notes.c', rows: [0] },
    ]);
    controller.destroy();
    host.remove();
  });

  it('is sent beside the marks in the tab that is', () => {
    const { host, controller, sent } = mounted(FILES);

    tabButtons(host)[1].click();
    controller.toggleBreakpoint();
    tabButtons(host)[0].click();
    controller.toggleBreakpoint();

    sent.length = 0;
    controller.send('Exec');

    expect(sent[sent.length - 1].breakpoints).toEqual([
      { path: 'main.c', rows: [0] },
      { path: 'notes.c', rows: [0] },
    ]);
    controller.destroy();
    host.remove();
  });
});

describe('the editor with several files', () => {
  it('does not activate the parser until the editor is approached', () => {
    const { host, controller, sent } = mounted(FILES);
    expect(sent).toHaveLength(0);

    host
      .querySelector<HTMLElement>('.cm-editor')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    expect(sent.map((request) => request.controlEvent)).toEqual([
      'Preprocess',
      'SyntaxCheck',
    ]);
    controller.destroy();
    host.remove();
  });

  it('opens the three-file construct tour by default', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bus = new Bus();
    const { client } = fakeClient();
    const controller = new EditorController(host, { bus, client });

    expect(controller.active()).toBe('main.c');
    expect(controller.entry()).toBe('main.c');
    expect(controller.openFiles().map((file) => file.path)).toEqual([
      'main.c',
      'tour.h',
      'tour.c',
    ]);
    expect(controller.code()).toContain('scanf("%d", &entered)');
    expect(controller.code()).toContain('fopen("c-visualizer.txt", "w")');

    controller.destroy();
    host.remove();
  });

  it('collects breakpoints from every file and navigates back to their lines', () => {
    const { host, controller } = mounted(FILES, 'main.c');
    controller.toggleBreakpoint();
    tabButtons(host)[1].click();
    controller.toggleBreakpoint();

    expect(controller.breakpointEntries()).toEqual([
      {
        path: 'main.c',
        line: 1,
        enabled: true,
        statement: 'int main(void) {',
        hits: 0,
      },
      {
        path: 'notes.c',
        line: 1,
        enabled: true,
        statement: 'int unused = 1;',
        hits: 0,
      },
    ]);

    controller.recieve({
      output: '',
      sourcecode: FILES.map((file) => file.text).join('\n'),
      debugState: 'Debugging',
      step: 4,
      errors: [],
      model: emptyStepModel(),
      location: {
        path: 'notes.c',
        range: {
          begin: { x: 0, y: 1 },
          end: { x: 14, y: 1 },
        },
      },
      coverage: [{ line: 1, count: 4 }],
    });
    expect(controller.breakpointEntries()[1].hits).toBe(4);

    controller.setBreakpointEnabled('main.c', 1, false);
    expect(controller.breakpointEntries()[0].enabled).toBe(false);

    controller.navigateToBreakpoint('main.c', 1);
    expect(controller.active()).toBe('main.c');
    const editor = (controller as any).editor;
    expect(
      editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number
    ).toBe(1);

    controller.destroy();
    host.remove();
  });

  it('maps composed header offsets back to main.c', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bus = new Bus();
    const { client } = fakeClient();
    const controller = new EditorController(host, { bus, client });
    const program = defaultProgram();
    const source = new ExecutionSource(
      program.files,
      program.entry,
      program.files[0].text
    );
    const line = source.globalLine('main.c', 10)!;
    const model = emptyStepModel();
    model.codeRange = {
      begin: { x: 0, y: line },
      end: { x: 15, y: line },
    };
    model.constructStates = [
      {
        kind: 'functionDec',
        range: model.codeRange,
        facts: [],
      },
    ];
    (controller as any).executionConstructs = [
      {
        kind: 'functionDec',
        detail: 'main',
        line,
        column: 0,
        endLine: line,
        endColumn: 15,
      },
    ];

    (controller as any).showExecutionSourceFor('main.c');
    const local = (controller as any).editorStep(model, {
      path: 'main.c',
      range: {
        begin: { x: 0, y: 10 },
        end: { x: 15, y: 10 },
      },
    });

    expect((controller as any).constructs[0]).toMatchObject({ line: 10 });
    expect(local.codeRange.begin.y).toBe(10);
    expect(local.constructStates[0].range.begin.y).toBe(10);

    controller.destroy();
    host.remove();
  });

  it('draws the statement with the entry file line rather than the composed line', () => {
    const files = [
      { path: 'main.c', text: '#include "defs.h"\nreturn 0;' },
      { path: 'defs.h', text: '#define VALUE 7\nint declaration;' },
    ];
    const { host, bus, controller } = mounted(files, 'main.c');
    const source = new ExecutionSource(files, 'main.c', files[0].text);
    const globalLine = source.globalLine('main.c', 2)!;
    const model = emptyStepModel();
    model.codeRange = {
      begin: { x: 0, y: globalLine },
      end: { x: 8, y: globalLine },
    };
    let drawn = emptyStepModel();
    bus.slot('draw', (step) => {
      drawn = step;
    });

    controller.recieve({
      output: '',
      sourcecode: source.code,
      debugState: 'Debugging',
      step: 1,
      errors: [],
      model,
      location: {
        path: 'main.c',
        range: {
          begin: { x: 0, y: 2 },
          end: { x: 8, y: 2 },
        },
      },
      constructs: [
        {
          kind: 'return',
          detail: '',
          line: globalLine,
          column: 0,
          endLine: globalLine,
          endColumn: 8,
        },
      ],
      expansions: [],
    });

    expect(drawn.codeRange?.begin.y).toBe(2);
    controller.destroy();
    host.remove();
  });

  it('highlights the complete source macro when its replacement is shorter', () => {
    const text =
      '#define ITEM_COUNT 3\nint main(void) { for (int i = 0; i < ITEM_COUNT; i += 1) {} }';
    const { host, controller } = mounted([{ path: 'main.c', text }], 'main.c');
    const processed = preprocessSource(text);
    const processedLine = processed.code.split('\n')[1];
    const begin = processedLine.indexOf('i <');
    const end = processedLine.indexOf('3');
    const model = emptyStepModel();
    model.codeRange = {
      begin: { x: begin, y: 2 },
      end: { x: end, y: 2 },
    };

    controller.recieve({
      output: '',
      sourcecode: text,
      debugState: 'Debugging',
      step: 1,
      errors: [],
      model,
      location: { path: 'main.c', range: model.codeRange },
      constructs: [],
      expansions: processed.expansions,
    });

    const editor = (controller as any).editor;
    let highlighted = '';
    editor.view.state
      .field(stepHighlightField)
      .between(
        0,
        editor.view.state.doc.length,
        (
          from: number,
          to: number,
          decoration: { spec: { class?: string } }
        ) => {
          if (decoration.spec.class === 'plivet-step-range') {
            highlighted = editor.view.state.sliceDoc(from, to);
          }
        }
      );
    expect(highlighted).toBe('i < ITEM_COUNT');

    controller.destroy();
    host.remove();
  });

  it('keeps preprocessing marks in a macro-only header during a run', () => {
    const files = [
      { path: 'main.c', text: '#include "defs.h"\nint main(void) {}' },
      { path: 'defs.h', text: '#define VALUE 7' },
    ];
    const { host, controller } = mounted(files, 'main.c');
    const source = new ExecutionSource(files, 'main.c', files[0].text);

    controller.recieve({
      output: '',
      sourcecode: source.code,
      debugState: 'First',
      step: 0,
      errors: [],
      model: emptyStepModel(),
      constructs: [],
      expansions: [
        {
          kind: 'directive',
          line: 1,
          column: 0,
          length: '#define VALUE 7'.length,
          name: '#define',
          text: 'VALUE = 7',
        },
      ],
    });
    tabButtons(host)[1].click();

    const editor = (controller as any).editor;
    expect(editor.view.state.field(expansionField).size).toBe(1);
    controller.destroy();
    host.remove();
  });

  it('opens the entry file and lists them all', () => {
    const { host, controller } = mounted(FILES);
    expect(controller.active()).toBe('main.c');
    expect(controller.entry()).toBe('main.c');
    expect(tabButtons(host).map((tab) => tab.textContent)).toEqual([
      'main.c',
      'notes.c',
    ]);
    expect(controller.code()).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('gives a tab back its text and its marks', () => {
    const { host, controller } = mounted(FILES);
    const editor = (controller as any).editor;
    editor.debug.setBreakpoints(editor.view, [1]);

    tabButtons(host)[1].click();
    expect(controller.code()).toBe('int unused = 1;');
    expect(editor.debug.rows(editor.view.state)).toEqual([]);

    tabButtons(host)[0].click();
    expect(controller.code()).toContain('return 0;');
    expect(editor.debug.rows(editor.view.state)).toEqual([1]);
    controller.destroy();
    host.remove();
  });

  it('keeps an edit made in a tab that is not on the screen', () => {
    const { host, controller } = mounted(FILES);
    tabButtons(host)[1].click();
    (controller as any).edited('int unused = 2;');
    tabButtons(host)[0].click();

    const files = controller.openFiles();
    expect(files.find((file) => file.path === 'notes.c')!.text).toBe(
      'int unused = 2;'
    );
    controller.destroy();
    host.remove();
  });

  it('sends every file and says which one runs', () => {
    const { host, controller, sent } = mounted(FILES);
    controller.send('Start');
    const request = sent[sent.length - 1];
    expect(request.entry).toBe('main.c');
    expect(request.files!.map((file) => file.path)).toEqual([
      'main.c',
      'notes.c',
    ]);
    expect(request.sourcecode).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('runs the entry file even while another tab is on the screen', () => {
    const { host, controller, sent } = mounted(FILES);
    tabButtons(host)[1].click();
    controller.send('Start');
    const request = sent[sent.length - 1];
    expect(request.sourcecode).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('shows syntax errors returned for the active helper tab', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bus = new Bus();
    const client = {
      onRunEvent: null,
      send: (request: Request): Promise<Response> => {
        const active =
          request.files?.find((file) => file.path === request.active)?.text ??
          request.sourcecode;
        return Promise.resolve({
          output: '',
          sourcecode: active,
          debugState: 'Stop',
          step: 0,
          errors: [{ line: 1, charPositionInLine: 14, msg: "missing ';'" }],
          model: emptyStepModel(),
          expansions: [],
          constructs: [],
          lints: [],
        });
      },
    } as unknown as InterpreterClient;
    const controller = new EditorController(host, {
      bus,
      client,
      files: FILES,
      entry: 'main.c',
    });

    tabButtons(host)[1].click();
    await Promise.resolve();

    const editor = (controller as any).editor;
    expect(controller.active()).toBe('notes.c');
    expect(diagnosticCount(editor.view.state)).toBe(1);
    controller.destroy();
    host.remove();
  });

  it('opens the first failing file when preflight refuses Start', () => {
    const { host, controller } = mounted(FILES);
    controller.recieve({
      output: '',
      sourcecode: FILES[1].text,
      debugState: 'Stop',
      step: 0,
      errors: [{ line: 1, charPositionInLine: 14, msg: "missing ';'" }],
      fileErrors: [
        {
          path: 'notes.c',
          errors: [{ line: 1, charPositionInLine: 14, msg: "missing ';'" }],
        },
      ],
      diagnosticPath: 'notes.c',
      model: emptyStepModel(),
      expansions: [],
      constructs: [],
      lints: [],
    });

    const editor = (controller as any).editor;
    expect(controller.active()).toBe('notes.c');
    expect(diagnosticCount(editor.view.state)).toBe(1);
    controller.destroy();
    host.remove();
  });

  it('switches to the source tab named by an execution step', () => {
    const { host, controller, sent } = mounted(FILES);
    const model = emptyStepModel();
    model.codeRange = {
      begin: { x: 0, y: 20 },
      end: { x: 14, y: 20 },
    };
    controller.recieve({
      output: '',
      sourcecode: `${FILES[0].text}\n${FILES[1].text}`,
      debugState: 'Debugging',
      step: 4,
      errors: [],
      model,
      location: {
        path: 'notes.c',
        range: {
          begin: { x: 0, y: 1 },
          end: { x: 14, y: 1 },
        },
      },
    });

    expect(controller.active()).toBe('notes.c');
    expect(controller.code()).toBe('int unused = 1;');
    expect(sent[sent.length - 1]).toMatchObject({
      controlEvent: 'SyntaxCheck',
      active: 'notes.c',
    });
    const editor = (controller as any).editor;
    expect(editor.view.state.field(stepHighlightField).size).toBeGreaterThan(0);
    controller.destroy();
    host.remove();
  });

  it('returns to the entry tab at EOF when the last range is in a helper', () => {
    const { host, controller } = mounted(FILES);
    const model = emptyStepModel();
    model.codeRange = {
      begin: { x: 0, y: 20 },
      end: { x: 14, y: 20 },
    };
    const helperLocation = {
      path: 'notes.c',
      range: {
        begin: { x: 0, y: 1 },
        end: { x: 14, y: 1 },
      },
    };
    controller.recieve({
      output: '',
      sourcecode: `${FILES[0].text}\n${FILES[1].text}`,
      debugState: 'Debugging',
      step: 4,
      errors: [],
      model,
      location: helperLocation,
    });
    expect(controller.active()).toBe('notes.c');

    controller.recieve({
      output: '',
      sourcecode: `${FILES[0].text}\n${FILES[1].text}`,
      debugState: 'EOF',
      step: 5,
      errors: [],
      model,
      // This is the stale location unicoen may retain after unwinding the
      // final helper frame.
      location: helperLocation,
    });

    expect(controller.active()).toBe('main.c');
    expect(controller.code()).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('changes which file runs when the reader asks', () => {
    const files = [
      FILES[0],
      { path: 'other.c', text: 'int main(void) { return 1; }' },
    ];
    const { host, controller, sent } = mounted(files);
    host.querySelectorAll<HTMLButtonElement>('.plivet-tabs__entry')[1].click();
    expect(controller.entry()).toBe('other.c');
    controller.send('Start');
    expect(sent[sent.length - 1].sourcecode).toBe(
      'int main(void) { return 1; }'
    );
    controller.destroy();
    host.remove();
  });

  it('offers the entry triangle only to non-header files that define main', () => {
    const { host, controller } = mounted([
      FILES[0],
      { path: 'values.h', text: 'int main(void) { return 1; }' },
      { path: 'prototype.c', text: 'int main(void);' },
      { path: 'comment.c', text: '/* int main(void) {} */' },
      { path: 'other.c', text: 'int main(void) { return 2; }' },
    ]);
    const entries = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.plivet-tabs__entry')
    );
    expect(entries.map((entry) => entry.getAttribute('aria-label'))).toEqual([
      'this is the entry source file: main.c',
      'make this the entry source file: other.c',
    ]);
    entries[1].click();
    expect(controller.entry()).toBe('other.c');
    controller.destroy();
    host.remove();
  });

  it('updates entry eligibility when a source gains a main definition', () => {
    const { host, controller } = mounted(FILES);
    expect(host.querySelectorAll('.plivet-tabs__entry')).toHaveLength(1);

    tabButtons(host)[1].click();
    controller.replaceCode('int main(void) { return 2; }');

    expect(host.querySelectorAll('.plivet-tabs__entry')).toHaveLength(2);
    controller.destroy();
    host.remove();
  });

  it('refreshes preprocessor marks before the full syntax check', () => {
    const { host, controller, sent } = mounted(FILES);
    jest.useFakeTimers();
    try {
      const editor = (controller as any).editor;
      editor.view.dispatch({
        changes: { from: editor.view.state.doc.length, insert: ' ' },
      });

      jest.advanceTimersByTime(99);
      expect(sent).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(sent.map((request) => request.controlEvent)).toEqual([
        'Preprocess',
      ]);
      jest.advanceTimersByTime(900);
      expect(sent.map((request) => request.controlEvent)).toEqual([
        'Preprocess',
        'SyntaxCheck',
      ]);
    } finally {
      controller.destroy();
      host.remove();
      jest.useRealTimers();
    }
  });

  it('ignores an ineligible requested entry when another file defines main', () => {
    const { host, controller } = mounted(
      [
        { path: 'values.h', text: 'int main(void) { return 1; }' },
        FILES[1],
        FILES[0],
      ],
      'values.h'
    );
    expect(controller.entry()).toBe('main.c');
    expect(controller.active()).toBe('main.c');
    controller.destroy();
    host.remove();
  });

  it('opens a file from outside beside the ones already there', () => {
    const { host, controller } = mounted(FILES);
    controller.openInTab('extra.c', 'int extra = 3;');
    expect(controller.active()).toBe('extra.c');
    expect(controller.openFiles().map((file) => file.path)).toEqual([
      'main.c',
      'notes.c',
      'extra.c',
    ]);
    controller.destroy();
    host.remove();
  });

  it('closes a file, but never the one that runs', () => {
    const { host, controller } = mounted(FILES);
    const closers = host.querySelectorAll<HTMLButtonElement>(
      '.plivet-tabs__close'
    );
    // One closer, on the file that is not the entry.
    expect(closers).toHaveLength(1);
    closers[0].click();
    expect(controller.openFiles().map((file) => file.path)).toEqual(['main.c']);
    controller.destroy();
    host.remove();
  });

  it('opens with one unnamed file when it is given no set', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bus = new Bus();
    const { client } = fakeClient();
    const controller = new EditorController(host, {
      bus,
      client,
      doc: 'int main(void) {}',
    });
    expect(controller.openFiles()).toHaveLength(1);
    expect(host.querySelector('.plivet-tabs')!.hasAttribute('hidden')).toBe(
      true
    );
    controller.destroy();
    host.remove();
  });
});
