import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  breakpointField,
  breakpointRows,
  setBreakpoints,
  toggleBreakpoint,
} from '../src/ui/editor/breakpoints';
import { diagnosticsFor } from '../src/ui/editor/diagnostics';
import {
  expansionAt,
  expansionField,
  setExpansions,
} from '../src/ui/editor/expansions';
import {
  offsetAt,
  rangeOf,
  rowAt,
  startOfRow,
} from '../src/ui/editor/positions';
import {
  setStepHighlight,
  stepHighlightField,
} from '../src/ui/editor/stepHighlight';
import { DebugExtensions, attachDebugExtensions } from '../src/ui/editor';
import { Expansion } from '../src/interpreter/Expansion';

const doc = ['int main() {', '  int n = 0;', '  return n;', '}'].join('\n');

const stateWith = (...extensions: any[]) =>
  EditorState.create({ doc, extensions });

describe('position conversion', () => {
  it('turns a one-based line and zero-based column into an offset', () => {
    const state = EditorState.create({ doc });
    expect(offsetAt(state.doc, 1, 0)).toBe(0);
    expect(offsetAt(state.doc, 2, 2)).toBe(state.doc.line(2).from + 2);
  });

  it('clamps a line past the end of a document that has shrunk', () => {
    const state = EditorState.create({ doc });
    expect(offsetAt(state.doc, 99, 0)).toBe(state.doc.line(4).from);
    expect(offsetAt(state.doc, 0, 0)).toBe(0);
  });

  it('clamps a column past the end of its line', () => {
    const state = EditorState.create({ doc });
    expect(offsetAt(state.doc, 4, 99)).toBe(state.doc.line(4).to);
  });

  it('round-trips a zero-based row through a document offset', () => {
    const state = EditorState.create({ doc });
    expect(rowAt(state.doc, startOfRow(state.doc, 2))).toBe(2);
  });

  it('makes the interpreter inclusive end column exclusive', () => {
    const state = EditorState.create({ doc });
    // `return n;` on line 3, columns 2 through 10 inclusive.
    const range = rangeOf(state.doc, 3, 2, 3, 10);
    expect(state.sliceDoc(range.from, range.to)).toBe('return n;');
  });
});

describe('breakpoints', () => {
  it('reports the rows it was given, in order', () => {
    const state = stateWith(breakpointField).update({
      effects: setBreakpoints.of([2, 0]),
    }).state;
    expect(breakpointRows(state)).toEqual([0, 2]);
  });

  it('toggles a row off when it is already set', () => {
    let state = stateWith(breakpointField).update({
      effects: setBreakpoints.of([1]),
    }).state;
    state = state.update({
      effects: toggleBreakpoint.of(startOfRow(state.doc, 1)),
    }).state;
    expect(breakpointRows(state)).toEqual([]);
  });

  it('toggles from anywhere on the line, not just its start', () => {
    const start = stateWith(breakpointField);
    const state = start.update({
      effects: toggleBreakpoint.of(start.doc.line(2).from + 5),
    }).state;
    expect(breakpointRows(state)).toEqual([1]);
  });

  it('moves a breakpoint down when a line is inserted above it', () => {
    let state = stateWith(breakpointField).update({
      effects: setBreakpoints.of([2]),
    }).state;
    state = state.update({
      changes: { from: 0, insert: '#include <stdio.h>\n' },
    }).state;
    expect(breakpointRows(state)).toEqual([3]);
  });

  it('answers with no breakpoints when the field is not installed', () => {
    expect(breakpointRows(EditorState.create({ doc }))).toEqual([]);
  });
});

describe('diagnostics', () => {
  it('spans from the reported column to the end of the line', () => {
    const state = EditorState.create({ doc });
    const [diagnostic] = diagnosticsFor(state.doc, [
      { line: 2, charPositionInLine: 2, msg: 'expected ;' },
    ]);
    expect(state.sliceDoc(diagnostic.from, diagnostic.to)).toBe('int n = 0;');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.message).toBe('expected ;');
  });
});

describe('preprocessor marks', () => {
  const expansions: Expansion[] = [
    {
      kind: 'directive',
      line: 1,
      column: 0,
      length: 12,
      name: '#if',
      text: '',
    },
    { kind: 'macro', line: 1, column: 4, length: 3, name: 'MAX', text: '10' },
  ];

  it('answers with the narrowest replacement covering a position', () => {
    expect(expansionAt(expansions, 1, 5)!.kind).toBe('macro');
    expect(expansionAt(expansions, 1, 1)!.kind).toBe('directive');
    expect(expansionAt(expansions, 2, 5)).toBeNull();
  });

  it('decorates every replacement it is given', () => {
    const state = stateWith(expansionField).update({
      effects: [setExpansions.of(expansions)],
    }).state;
    expect(state.field(expansionField).size).toBe(2);
  });
});

describe('step highlight', () => {
  it('marks the line and the expression, and clears on null', () => {
    const start = stateWith(stepHighlightField);
    const range = rangeOf(start.doc, 3, 2, 3, 10);
    const shown = start.update({ effects: setStepHighlight.of(range) }).state;
    // One line decoration and one mark over the expression.
    expect(shown.field(stepHighlightField).size).toBe(2);

    const cleared = shown.update({ effects: setStepHighlight.of(null) }).state;
    expect(cleared.field(stepHighlightField).size).toBe(0);
  });
});

describe('attaching to an editor somebody else built', () => {
  it('adds the debugger to a running view', () => {
    const view = new EditorView({ state: EditorState.create({ doc }) });
    const debugExtensions = new DebugExtensions();

    expect(debugExtensions.rows(view.state)).toEqual([]);

    attachDebugExtensions(view, debugExtensions);
    debugExtensions.setBreakpoints(view, [1, 2]);

    expect(debugExtensions.rows(view.state)).toEqual([1, 2]);

    debugExtensions.setReadOnly(view, true);
    expect(view.state.readOnly).toBe(true);
    debugExtensions.setReadOnly(view, false);
    expect(view.state.readOnly).toBe(false);

    view.destroy();
  });
});
