import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  breakpointStates,
  breakpointField,
  setBreakpointStates,
  setBreakpoints,
  toggleBreakpoint,
} from '../src/ui/editor/breakpoints';
import { breakpointRows } from '../src/ui/editor';
import { isSession, restoreSession, sessionOf } from '../src/ui/editor';
import { toggleWatch, watchField, watchNames } from '../src/ui/editor';
import {
  protectedField,
  protectedRegions,
  setEditableRegions,
} from '../src/ui/editor';

/**
 * A session, handed over.
 *
 * A student who is stuck sends what they have; a teacher opens what they were
 * actually looking at rather than a paste of the source with the interesting
 * part - where they had stopped, and what they were watching - left out.
 */

const doc = 'int main() {\n  int count = 7;\n  return count;\n}';

const viewWith = (text: string = doc) =>
  new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        breakpointField,
        watchField,
        protectedField,
        protectedRegions,
      ],
    }),
  });

describe('saving a session', () => {
  it('holds the program, the cursor, the marks and the pins', () => {
    const view = viewWith();
    view.dispatch({ selection: { anchor: 18 } });
    view.dispatch({ effects: setBreakpoints.of([1, 2]) });
    view.dispatch({
      effects: toggleWatch.of({ name: 'count', pos: doc.indexOf('count') }),
    });

    const session = sessionOf(view.state);
    expect(session.version).toBe(1);
    expect((session.editor as any).doc).toBe(doc);
    expect(session.breakpoints).toEqual([1, 2]);
    expect(session.watches).toEqual([
      { name: 'count', pos: doc.indexOf('count') },
    ]);
    view.destroy();
  });

  it('survives a round trip through JSON', () => {
    const view = viewWith();
    view.dispatch({
      effects: toggleBreakpoint.of(view.state.doc.line(2).from),
    });
    const written = JSON.stringify(sessionOf(view.state));
    view.destroy();

    const opened = JSON.parse(written);
    expect(isSession(opened)).toBe(true);

    const other = viewWith('int main() {}');
    restoreSession(other, opened);
    expect(other.state.doc.toString()).toBe(doc);
    expect(breakpointRows(other.state)).toEqual([1]);
    other.destroy();
  });

  it('keeps disabled breakpoints visible without enabling them', () => {
    const view = viewWith();
    view.dispatch({
      effects: setBreakpointStates.of([
        { row: 1, enabled: true },
        { row: 2, enabled: false },
      ]),
    });
    const written = JSON.parse(JSON.stringify(sessionOf(view.state)));
    view.destroy();

    const other = viewWith('int main() {}');
    restoreSession(other, written);
    expect(breakpointRows(other.state)).toEqual([1]);
    expect(breakpointStates(other.state)).toEqual([
      { row: 1, enabled: true },
      { row: 2, enabled: false },
    ]);
    other.destroy();
  });
});

describe('opening a session', () => {
  it('puts the watches back without doubling them', () => {
    const view = viewWith();
    view.dispatch({
      effects: toggleWatch.of({ name: 'count', pos: doc.indexOf('count') }),
    });
    const session = sessionOf(view.state);

    restoreSession(view, session);
    restoreSession(view, session);
    expect(watchNames(view.state)).toEqual(['count']);
    view.destroy();
  });

  it('restores a program even where the file is mostly protected', () => {
    const view = viewWith();
    view.dispatch({ effects: setEditableRegions.of([{ from: 0, to: 1 }]) });
    const session = { ...sessionOf(view.state) };
    (session.editor as any).doc = 'int main() { return 1; }';

    restoreSession(view, session);
    expect(view.state.doc.toString()).toBe('int main() { return 1; }');
    view.destroy();
  });

  it('refuses what is not a session of this version', () => {
    expect(isSession(null)).toBe(false);
    expect(
      isSession({ version: 2, editor: {}, breakpoints: [], watches: [] })
    ).toBe(false);
    expect(isSession({ version: 1, editor: {}, breakpoints: [] })).toBe(false);
    expect(isSession('{}')).toBe(false);
  });
});

describe('positions that no longer fit', () => {
  it('are dropped rather than moved onto other text', () => {
    const view = viewWith('int main() {}');
    restoreSession(view, {
      version: 1,
      editor: {
        doc: 'int a;\nint b;',
        selection: { ranges: [{ anchor: 40, head: 40 }], main: 0 },
      },
      breakpoints: [1, 2, 9],
      disabledBreakpoints: [0, 7],
      watches: [
        { name: 'b', pos: 11 },
        { name: 'c', pos: 4 },
        { name: 'a', pos: 99 },
      ],
    });
    expect(view.state.doc.toString()).toBe('int a;\nint b;');
    expect(view.state.selection.main.anchor).toBe(0);
    expect(breakpointStates(view.state)).toEqual([
      { row: 0, enabled: false },
      { row: 1, enabled: true },
    ]);
    expect(watchNames(view.state)).toEqual(['b']);
    view.destroy();
  });
});

describe('a version 2 session, as a value', () => {
  it('is a session when every file in it is well formed', () => {
    expect(
      isSession({
        version: 2,
        files: [
          { path: 'main.c', text: 'int x;', selection: { anchor: 1, head: 2 } },
          { path: 'helper.c' },
        ],
        entry: 'main.c',
        active: 'helper.c',
      })
    ).toBe(true);
    expect(isSession({ version: 2, files: [] })).toBe(true);
  });

  it('is refused whole when one file in it is not', () => {
    expect(isSession({ version: 2, files: [{ text: 'x' }] })).toBe(false);
    expect(
      isSession({ version: 2, files: [{ path: 'a.c', breakpoints: [1.5] }] })
    ).toBe(false);
    expect(
      isSession({ version: 2, files: [{ path: 'a.c', watches: [{ pos: 1 }] }] })
    ).toBe(false);
    expect(isSession({ version: 2, files: [], entry: 3 })).toBe(false);
  });
});
