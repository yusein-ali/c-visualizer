import { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import {
  breakpointField,
  breakpointRows,
  setBreakpoints,
  toggleBreakpoint,
} from '../src/ui/editor/breakpoints';
import {
  diagnosticsFor,
  errorLineField,
  teachingDiagnosticsFor,
} from '../src/ui/editor/diagnostics';
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
  InlineValue,
  setStepHighlight,
  stepHighlightField,
} from '../src/ui/editor/stepHighlight';
import { inlineValueField } from '../src/ui/editor/inlineValues';
import { DebugExtensions, attachDebugExtensions } from '../src/ui/editor';
import { Expansion } from '../src/interpreter/Expansion';

const doc = ['int main() {', '  int n = 0;', '  return n;', '}'].join('\n');

const stateWith = (...extensions: any[]) =>
  EditorState.create({ doc, extensions });

/** The one widget a decoration set holds, for asking what it says. */
const widgetOf = (state: EditorState): WidgetType | null => {
  let found: WidgetType | null = null;
  state
    .field(inlineValueField)
    .between(0, state.doc.length, (_from, _to, decoration) => {
      const { widget } = decoration.spec;
      if (widget instanceof WidgetType) {
        found = widget;
      }
    });
  return found;
};

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

  it('gives source excluded by preprocessing its inactive class', () => {
    const state = stateWith(expansionField).update({
      effects: [
        setExpansions.of([
          {
            kind: 'excluded',
            line: 2,
            column: 0,
            length: '  int n = 0;'.length,
            name: '#if',
            text: '',
          },
        ]),
      ],
    }).state;
    const classes: string[] = [];
    state
      .field(expansionField)
      .between(0, state.doc.length, (_from, _to, decoration) => {
        classes.push(decoration.spec.class);
      });

    expect(classes).toHaveLength(2);
    expect(classes).toEqual(
      expect.arrayContaining(['plivet-excluded-region', 'plivet-inactive-line'])
    );
  });

  it('gives directives inside an excluded branch the same inactive marks', () => {
    const state = stateWith(expansionField).update({
      effects: [
        setExpansions.of([
          {
            kind: 'directive',
            line: 2,
            column: 0,
            length: '  int n = 0;'.length,
            name: '#define',
            text: 'N 1',
            active: false,
          },
        ]),
      ],
    }).state;
    const classes: string[] = [];
    state
      .field(expansionField)
      .between(0, state.doc.length, (_from, _to, decoration) => {
        classes.push(decoration.spec.class);
      });

    expect(classes).toHaveLength(2);
    expect(classes).toEqual(
      expect.arrayContaining(['plivet-excluded-region', 'plivet-inactive-line'])
    );
  });

  it('marks conditional arguments with expression token roles', () => {
    const source = '#if LEVEL > 1 && defined(FEATURE)';
    const state = EditorState.create({
      doc: source,
      extensions: [expansionField],
    }).update({
      effects: [
        setExpansions.of([
          {
            kind: 'directive',
            line: 1,
            column: 0,
            length: source.length,
            name: '#if',
            text: 'LEVEL > 1 && defined(FEATURE)',
            active: true,
            taken: false,
          },
        ]),
      ],
    }).state;
    const tokens: [string, string][] = [];
    state
      .field(expansionField)
      .between(0, state.doc.length, (from, to, decoration) => {
        if (decoration.spec.class.startsWith('plivet-preprocessor-')) {
          tokens.push([state.sliceDoc(from, to), decoration.spec.class]);
        }
      });

    expect(tokens).toEqual([
      ['LEVEL', 'plivet-preprocessor-macro'],
      ['>', 'plivet-preprocessor-operator'],
      ['1', 'plivet-preprocessor-number'],
      ['&&', 'plivet-preprocessor-operator'],
      ['defined', 'plivet-preprocessor-keyword'],
      ['(', 'plivet-preprocessor-punctuation'],
      ['FEATURE', 'plivet-preprocessor-macro'],
      [')', 'plivet-preprocessor-punctuation'],
    ]);
  });
});

describe('step highlight', () => {
  it('marks the line and the expression, and clears on null', () => {
    const start = stateWith(stepHighlightField);
    const range = rangeOf(start.doc, 3, 2, 3, 10);
    const shown = start.update({
      effects: setStepHighlight.of({ range, values: [] }),
    }).state;
    // One line decoration and one mark over the expression.
    expect(shown.field(stepHighlightField).size).toBe(2);

    const cleared = shown.update({ effects: setStepHighlight.of(null) }).state;
    expect(cleared.field(stepHighlightField).size).toBe(0);
  });
});

describe('inline values', () => {
  const markWith = (state: EditorState, values: InlineValue[]) => ({
    range: rangeOf(state.doc, 3, 2, 3, 10),
    values,
  });

  it('puts one widget at the end of the current statement line', () => {
    const start = stateWith(inlineValueField);
    const shown = start.update({
      effects: setStepHighlight.of(
        markWith(start, [{ name: 'n', display: '0' }])
      ),
    }).state;
    const decorations = shown.field(inlineValueField);
    expect(decorations.size).toBe(1);
    let at = -1;
    decorations.between(0, shown.doc.length, (from) => {
      at = from;
    });
    expect(at).toBe(shown.doc.line(3).to);
  });

  it('says every variable of the statement, name and value', () => {
    const start = stateWith(inlineValueField);
    const shown = start.update({
      effects: setStepHighlight.of(
        markWith(start, [
          { name: 'n', display: '3' },
          { name: 'sum', display: '10' },
        ])
      ),
    }).state;
    const widget = widgetOf(shown);
    expect(widget).not.toBeNull();
    const view = new EditorView({ state: shown });
    expect(widget!.toDOM(view).textContent).toBe('n = 3, sum = 10');
    view.destroy();
  });

  it('shows nothing for a statement whose variables are all out of scope', () => {
    const start = stateWith(inlineValueField);
    const shown = start.update({
      effects: setStepHighlight.of(markWith(start, [])),
    }).state;
    expect(shown.field(inlineValueField).size).toBe(0);
  });

  it('leaves with the step marker when the session stops', () => {
    const start = stateWith(inlineValueField);
    const shown = start.update({
      effects: setStepHighlight.of(
        markWith(start, [{ name: 'n', display: '0' }])
      ),
    }).state;
    const cleared = shown.update({ effects: setStepHighlight.of(null) }).state;
    expect(cleared.field(inlineValueField).size).toBe(0);
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

describe('teaching diagnostics', () => {
  const state = EditorState.create({ doc });
  const scanfLint = {
    rule: 'scanf-address',
    severity: 'error' as const,
    message: 'scanf stores through the pointer it is given',
    line: 2,
    column: 6,
    endLine: 2,
    endColumn: 7,
    fix: {
      label: 'Pass &n',
      text: '&n',
      line: 2,
      column: 6,
      endLine: 2,
      endColumn: 7,
    },
  };

  it('spans exactly what the rule reported', () => {
    const [found] = teachingDiagnosticsFor(state.doc, [scanfLint]);
    expect(state.sliceDoc(found.from, found.to)).toBe('n');
    expect(found.severity).toBe('error');
    expect(found.source).toBe('c-visualizer:local/scanf-address');
  });

  it('offers no action for a rule that has no fix', () => {
    const { fix: _fix, ...withoutFix } = scanfLint;
    const [found] = teachingDiagnosticsFor(state.doc, [withoutFix]);
    expect(found.actions).toBeUndefined();
  });

  it('applies the fix where the finding has moved to', () => {
    const view = new EditorView({ state });
    const [found] = teachingDiagnosticsFor(view.state.doc, [scanfLint]);
    // An edit above the finding moves it down; the action is handed where it
    // ended up, and edits relative to that rather than to where it was.
    view.dispatch({ changes: { from: 0, insert: '// a note\n' } });
    const moved = view.state.doc.line(3);
    found.actions![0].apply(view, moved.from + 6, moved.from + 7);
    expect(view.state.doc.line(3).text).toBe('  int &n = 0;');
    view.destroy();
  });

  it('shows the library entry beside the message when one was found', () => {
    const [found] = teachingDiagnosticsFor(state.doc, [
      {
        ...scanfLint,
        help: {
          signature: 'int scanf(const char* format, ...)',
          description: 'reads formatted input',
        },
      },
    ]);
    const view = new EditorView({ state });
    const rendered = found.renderMessage!(view) as HTMLElement;
    expect(rendered.textContent).toContain('int scanf(');
    expect(rendered.textContent).toContain('reads formatted input');
    view.destroy();
  });

  it('keeps the syntax errors when teaching findings are shown beside them', () => {
    const view = new EditorView({ state: EditorState.create({ doc }) });
    const debugExtensions = new DebugExtensions();
    attachDebugExtensions(view, debugExtensions);
    debugExtensions.showDiagnostics(
      view,
      [{ line: 2, charPositionInLine: 2, msg: 'no' }],
      [scanfLint]
    );
    expect(view.state.field(errorLineField).size).toBe(1);
    view.destroy();
  });
});
