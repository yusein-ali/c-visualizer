import type { EditorView } from '@codemirror/view';
import { Plivet } from '../src';
import type { LoadRefusal, PlivetOptions, ProgramSessionJSON } from '../src';
import {
  breakpointStates,
  loadNoticeOf,
  toggleWatch,
  watchNames,
} from '../src/ui/editor';
import { setBreakpointStates } from '../src/ui/editor/breakpoints';
import { undo } from '@codemirror/commands';
import strings from '../src/strings';

jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    setFocus(): void {}
    setDiagnostics(): void {}
    setDiagnosticActivity(): void {}
    setRunStatus(): void {}
    setDebugState(): void {}
    destroy(): void {}
  },
}));

/**
 * Protected text and whole-program sessions, through the API a host page
 * uses: per-file editable lines (H2), the load policy that refuses a
 * replacement losing protected text (H5), and version 2 sessions (H1).
 */

const MAIN =
  '#include <stdio.h>\n\nint main(void) {\n  int x = 1;\n  int y = 2;\n' +
  '  printf("%d\\n", x + y);\n  return 0;\n}\n';
const HELPER = 'int helper(void) {\n  return 1;\n}\n';
const FILES = [
  { path: 'main.c', text: MAIN },
  { path: 'helper.c', text: HELPER },
];
/** `return 0;` changed: line 7 is protected under `4-5`. */
const ALTERED = MAIN.replace('return 0;', 'return 1;');

const view = (plivet: Plivet): EditorView =>
  (plivet as any).editor.editor.view as EditorView;

const text = (plivet: Plivet) => view(plivet).state.doc.toString();

const type = (plivet: Plivet, at: number, insert: string) =>
  view(plivet).dispatch({ changes: { from: at, insert } });

const tab = (parent: HTMLElement, index: number) =>
  parent
    .querySelectorAll<HTMLButtonElement>('.plivet-tabs__select')
    [index].click();

const open = (options: PlivetOptions) => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const refusals: LoadRefusal[] = [];
  const plivet = new Plivet(parent, {
    onLoadRefused: (refusal) => refusals.push(refusal),
    ...options,
  });
  return { parent, plivet, refusals };
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('per-file editable lines', () => {
  it('holds the protected lines of the file it names and no other', () => {
    const { parent, plivet } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });

    type(plivet, 0, '// ');
    expect(text(plivet)).toBe(MAIN);
    type(plivet, MAIN.indexOf('int x'), 'unsigned ');
    expect(text(plivet)).toContain('unsigned int x = 1;');

    tab(parent, 1);
    type(plivet, 0, '// ');
    expect(text(plivet)).toBe(`// ${HELPER}`);

    // Back on main.c the regions the edit moved are still the regions.
    tab(parent, 0);
    type(plivet, 0, '// ');
    expect(text(plivet)).toContain('unsigned int x');
    expect(text(plivet).startsWith('#include')).toBe(true);
    type(plivet, text(plivet).indexOf('int y'), 'long ');
    expect(text(plivet)).toContain('long int y = 2;');
    plivet.destroy();
  });

  it('shades the protected lines and marks them with a lock', () => {
    const { parent, plivet } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    const shaded = Array.from(
      parent.querySelectorAll('.cm-line.plivet-protected-line')
    ).map((line) => line.textContent);
    expect(shaded).toContain('int main(void) {');
    expect(shaded).toContain('  return 0;');
    expect(shaded).not.toContain('  int x = 1;');
    expect(parent.querySelectorAll('.plivet-lock').length).toBeGreaterThan(0);
    plivet.destroy();
  });

  it('lists the protected spans of each file in the snapshot', () => {
    const { plivet } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    type(plivet, MAIN.indexOf('int x'), 'unsigned ');
    const [main, helper] = plivet.sourceSnapshot().files;
    expect(helper.protected).toBeUndefined();
    expect(main.protected).toHaveLength(2);
    for (const span of main.protected ?? []) {
      expect(main.text.slice(span.from, span.to)).toBe(span.text);
    }
    expect(main.protected?.[1].text).toBe(
      '\n  printf("%d\\n", x + y);\n  return 0;\n}\n'
    );
    plivet.destroy();
  });

  it('keeps the offset regions of the entry file across a tab switch', () => {
    const doc = 'int main(void) {\n  return 0;\n}\n';
    const blank = { from: doc.indexOf('0;'), to: doc.indexOf('0;') + 1 };
    const { parent, plivet } = open({
      files: [
        { path: 'main.c', text: doc },
        { path: 'helper.c', text: HELPER },
      ],
      editableRegions: [blank],
    });
    tab(parent, 1);
    tab(parent, 0);
    type(plivet, 0, 'x');
    expect(text(plivet)).toBe(doc);
    type(plivet, blank.to, '42');
    expect(text(plivet)).toContain('return 042;');
    plivet.destroy();
  });
});

describe('the load policy', () => {
  it('refuses an update that loses protected text, and says where', () => {
    const { parent, plivet, refusals } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    const before = plivet.sourceSnapshot();

    expect(
      plivet.updateFiles([
        { path: 'main.c', text: ALTERED },
        { path: 'helper.c', text: 'int helper(void);\n' },
      ])
    ).toBe(false);
    expect(plivet.sourceSnapshot()).toEqual(before);
    expect(refusals).toEqual([
      { path: 'main.c', line: 7, origin: 'updateFiles' },
    ]);
    const notice = parent.querySelector('.plivet-load-notice');
    expect(notice?.textContent).toContain('Line 7 of main.c is protected');

    // The notice puts the default back.
    type(plivet, MAIN.indexOf('int x'), 'unsigned ');
    parent
      .querySelector<HTMLButtonElement>('.plivet-load-notice__restore')!
      .click();
    expect(text(plivet)).toBe(MAIN);
    expect(parent.querySelector('.plivet-load-notice')).toBeNull();
    plivet.destroy();
  });

  it('accepts an update whose editable lines changed, and re-anchors', () => {
    const { plivet } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    const grown = MAIN.replace('  int y = 2;', '  int y = 2;\n  int z = 3;');
    expect(
      plivet.updateFiles([
        { path: 'main.c', text: grown },
        { path: 'helper.c', text: HELPER },
      ])
    ).toBe(true);
    expect(text(plivet)).toBe(grown);
    type(plivet, grown.indexOf('int z'), 'long ');
    expect(text(plivet)).toContain('long int z = 3;');
    type(plivet, grown.indexOf('return'), 'x');
    expect(text(plivet)).not.toContain('xreturn');
    plivet.destroy();
  });

  it('refuses a loaded file of a protected name', () => {
    const { plivet, refusals } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    const editor = (plivet as any).editor;
    expect(editor.openInTab('main.c', ALTERED, 'load')).toBe(false);
    expect(text(plivet)).toBe(MAIN);
    expect(refusals).toEqual([{ path: 'main.c', line: 7, origin: 'load' }]);
    expect(editor.openInTab('main.c', MAIN.replace('= 1', '= 5'))).toBe(true);
    expect(text(plivet)).toContain('int x = 5;');
    plivet.destroy();
  });

  it('opens an altered file locked against its default text', () => {
    const { parent, plivet, refusals } = open({
      files: [{ path: 'main.c', text: ALTERED }],
      editableRegions: { 'main.c': { lines: [[4, 5]], text: MAIN } },
    });
    expect(refusals).toEqual([{ path: 'main.c', line: 7, origin: 'files' }]);
    type(plivet, ALTERED.indexOf('int x'), 'unsigned ');
    expect(text(plivet)).toBe(ALTERED);
    expect(loadNoticeOf(view(plivet))).toEqual({
      path: 'main.c',
      line: 7,
      locked: true,
    });
    expect(parent.querySelector('.plivet-load-notice__dismiss')).toBeNull();
    expect(plivet.sourceSnapshot().files[0].protected?.[1]).toMatchObject({
      from: -1,
      to: -1,
    });

    parent
      .querySelector<HTMLButtonElement>('.plivet-load-notice__restore')!
      .click();
    expect(text(plivet)).toBe(MAIN);
    type(plivet, MAIN.indexOf('int x'), 'unsigned ');
    expect(text(plivet)).toContain('unsigned int x');
    expect(loadNoticeOf(view(plivet))).toBeNull();
    plivet.destroy();
  });
});

describe('a version 2 session', () => {
  const marked = () => {
    const { parent, plivet } = open({ files: FILES });
    view(plivet).dispatch({
      selection: { anchor: MAIN.indexOf('x'), head: MAIN.indexOf('x') + 1 },
    });
    view(plivet).dispatch({
      effects: setBreakpointStates.of([
        { row: 3, enabled: true },
        { row: 4, enabled: false },
      ]),
    });
    view(plivet).dispatch({
      effects: toggleWatch.of({ name: 'y', pos: MAIN.indexOf('y =') }),
    });
    tab(parent, 1);
    view(plivet).dispatch({
      effects: setBreakpointStates.of([{ row: 1, enabled: true }]),
    });
    return { parent, plivet };
  };

  it('holds every file, the entry and the file on screen', () => {
    const { plivet } = marked();
    const session = plivet.session();
    expect(session).toEqual({
      version: 2,
      files: [
        {
          path: 'main.c',
          text: MAIN,
          selection: { anchor: MAIN.indexOf('x'), head: MAIN.indexOf('x') + 1 },
          breakpoints: [3],
          disabledBreakpoints: [4],
          watches: [{ name: 'y', pos: MAIN.indexOf('y =') }],
        },
        {
          path: 'helper.c',
          text: HELPER,
          selection: { anchor: 0, head: 0 },
          breakpoints: [1],
          disabledBreakpoints: [],
          watches: [],
        },
      ],
      entry: 'main.c',
      active: 'helper.c',
    });
    // And survives JSON.
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    plivet.destroy();
  });

  it('opens where it was saved, as the session option', () => {
    const saved = marked();
    const session = saved.plivet.session();
    saved.plivet.destroy();

    const { plivet } = open({ files: FILES, session });
    expect(plivet.sourceSnapshot().active).toBe('helper.c');
    expect(breakpointStates(view(plivet).state)).toEqual([
      { row: 1, enabled: true },
    ]);
    expect(plivet.sourceSnapshot().revision).toBe(0);
    const back = plivet.session();
    expect(back.files[0]).toEqual(session.files[0]);
    plivet.destroy();
  });

  it('is applied after files: unknown files ignored, protected text kept', () => {
    const session: ProgramSessionJSON = {
      version: 2,
      files: [
        { path: 'main.c', text: ALTERED, breakpoints: [2, 99] },
        {
          path: 'helper.c',
          text: 'int helper(void) {\n  return 2;\n}\n',
          selection: { anchor: 500, head: 500 },
          watches: [
            { name: 'helper', pos: 4 },
            { name: 'gone', pos: 4 },
          ],
        },
        { path: 'other.c', text: 'int other;' },
      ],
      entry: 'main.c',
      active: 'main.c',
    };
    const changes: number[] = [];
    const { parent, plivet, refusals } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
      session,
      onSourceChange: (snapshot) => changes.push(snapshot.revision),
    });

    const snapshot = plivet.sourceSnapshot();
    expect(snapshot.files.map((file) => file.path)).toEqual([
      'main.c',
      'helper.c',
    ]);
    expect(snapshot.files[0].text).toBe(MAIN);
    expect(snapshot.files[1].text).toContain('return 2;');
    expect(changes).toEqual([1]);
    expect(refusals).toEqual([{ path: 'main.c', line: 7, origin: 'session' }]);
    // The row past the end is dropped; the one that fits is kept.
    expect(breakpointStates(view(plivet).state)).toEqual([
      { row: 2, enabled: true },
    ]);

    tab(parent, 1);
    expect(view(plivet).state.selection.main.anchor).not.toBe(500);
    expect(watchNames(view(plivet).state)).toEqual(['helper']);
    plivet.destroy();
  });

  it('positions the marks on the given text when the session has none', () => {
    const { plivet } = open({
      files: FILES,
      session: {
        version: 2,
        files: [{ path: 'main.c', breakpoints: [6] }],
      },
    });
    expect(plivet.sourceSnapshot().files[0].text).toBe(MAIN);
    expect(breakpointStates(view(plivet).state)).toEqual([
      { row: 6, enabled: true },
    ]);
    expect(plivet.sourceSnapshot().revision).toBe(0);
    plivet.destroy();
  });

  it('is refused whole by restoreSession when it would change protected text', () => {
    const { plivet, refusals } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    const before = plivet.sourceSnapshot();
    expect(
      plivet.restoreSession({
        version: 2,
        files: [
          { path: 'main.c', text: ALTERED },
          { path: 'helper.c', text: 'int helper;\n' },
        ],
      })
    ).toBe(false);
    expect(plivet.sourceSnapshot()).toEqual(before);
    expect(refusals).toEqual([
      { path: 'main.c', line: 7, origin: 'restoreSession' },
    ]);

    expect(
      plivet.restoreSession({
        version: 2,
        files: [{ path: 'helper.c', text: 'int helper;\n' }],
        active: 'helper.c',
      })
    ).toBe(true);
    expect(text(plivet)).toBe('int helper;\n');
    plivet.destroy();
  });

  it('still reads a version 1 session, into the file on screen', () => {
    const { plivet } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    const v1 = (doc: string) => ({
      version: 1,
      editor: { doc, selection: { ranges: [{ anchor: 2, head: 2 }], main: 0 } },
      breakpoints: [0],
      watches: [],
    });
    expect(plivet.restoreSession(v1(ALTERED))).toBe(false);
    expect(text(plivet)).toBe(MAIN);
    const edited = MAIN.replace('= 2', '= 3');
    expect(plivet.restoreSession(v1(edited))).toBe(true);
    expect(text(plivet)).toBe(edited);
    expect(view(plivet).state.selection.main.anchor).toBe(2);
    expect(breakpointStates(view(plivet).state)).toEqual([
      { row: 0, enabled: true },
    ]);
    // Protection follows the restored text.
    type(plivet, 0, 'x');
    expect(text(plivet)).toBe(edited);
    plivet.destroy();
  });

  it('is refused when it names none of the open files', () => {
    const { plivet } = open({ files: FILES });
    expect(
      plivet.restoreSession({ version: 2, files: [{ path: 'nope.c' }] })
    ).toBe(false);
    expect(plivet.restoreSession({ version: 2, files: 'main.c' })).toBe(false);
    plivet.destroy();
  });
});

describe('undo', () => {
  it('undoes the reader’s edits, never a replacement past the filter', () => {
    const { parent, plivet } = open({
      files: [{ path: 'main.c', text: ALTERED }, FILES[1]],
      editableRegions: { 'main.c': { lines: [[4, 5]], text: MAIN } },
    });
    parent
      .querySelector<HTMLButtonElement>('.plivet-load-notice__restore')!
      .click();
    expect(text(plivet)).toBe(MAIN);
    undo(view(plivet));
    expect(text(plivet)).toBe(MAIN);

    type(plivet, MAIN.indexOf('int x'), 'long ');
    undo(view(plivet));
    expect(text(plivet)).toBe(MAIN);

    type(plivet, MAIN.indexOf('int x'), 'unsigned ');
    tab(parent, 1);
    undo(view(plivet));
    expect(text(plivet)).toBe(HELPER);
    tab(parent, 0);
    undo(view(plivet));
    expect(text(plivet)).toBe(MAIN.replace('int x', 'unsigned int x'));
    plivet.destroy();
  });
});

describe('the notice a refusal leaves', () => {
  it('can be dismissed, and names the file and the line', () => {
    const { parent, plivet } = open({
      files: FILES,
      editableRegions: { 'main.c': [[4, 5]] },
    });
    plivet.updateFiles([{ path: 'main.c', text: ALTERED }]);
    const notice = parent.querySelector('.plivet-load-notice');
    expect(notice?.getAttribute('role')).toBe('alert');
    expect(
      parent.querySelector('.plivet-load-notice__restore')?.textContent
    ).toBe(strings.restoreDefault);
    parent
      .querySelector<HTMLButtonElement>('.plivet-load-notice__dismiss')!
      .click();
    expect(parent.querySelector('.plivet-load-notice')).toBeNull();
    expect(text(plivet)).toBe(MAIN);
    plivet.destroy();
  });
});
