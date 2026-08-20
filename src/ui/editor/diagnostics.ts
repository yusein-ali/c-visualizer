import { EditorState, StateEffect, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { offsetAt, rowRange } from './positions';

/**
 * Syntax errors, as CodeMirror's linter understands them. Ace took a row, a
 * column and a message and drew a gutter annotation; `@codemirror/lint` wants
 * absolute offsets, which is the one conversion this migration adds.
 *
 * The shape is structural on purpose: `SyntaxErrorData` is a class from
 * unicoen.ts, and nothing in the editor should depend on the interpreter. It
 * is plain data for a second reason since the interpreter moved into a Worker:
 * the class holds its accessor as an instance property, and a function is the
 * one thing `structuredClone` refuses to carry.
 */
export interface SyntaxError {
  line: number;
  charPositionInLine: number;
  msg: string;
}

/**
 * One diagnostic per error, from the reported column to the end of its line.
 * The parser points at the token it choked on and says nothing about how far
 * the problem extends, so the rest of the line is the honest span.
 */
export const diagnosticsFor = (
  doc: Text,
  errors: SyntaxError[]
): Diagnostic[] =>
  errors.map((error) => {
    const line = rowRange(doc, error.line - 1);
    const from = offsetAt(doc, error.line, error.charPositionInLine);
    return {
      from,
      to: Math.max(line.to, from),
      severity: 'error' as const,
      message: error.msg,
    };
  });

const errorLine = Decoration.line({ class: 'plivet-error-line' });

const setErrorLines = StateEffect.define<number[]>();

const decorationsFor = (state: EditorState, rows: number[]): DecorationSet =>
  Decoration.set(
    Array.from(new Set(rows))
      .sort((left, right) => left - right)
      .map((row) => errorLine.range(rowRange(state.doc, row).from)),
    true
  );

/**
 * The tinted line behind an error. The linter underlines the token; this keeps
 * the whole-line background Ace drew, which is what makes an error visible
 * when the editor is scrolled past the gutter marker.
 */
export const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, transaction) {
    let updated = lines.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setErrorLines)) {
        updated = decorationsFor(transaction.state, effect.value);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Replaces every diagnostic, and the lines tinted behind them, in a single
 * transaction. `setDiagnostics` returns effects of its own - and, the first
 * time it runs, the configuration that installs the linter - so ours are
 * appended to whatever it asked for rather than written over it.
 */
export const showDiagnostics = (
  view: EditorView,
  errors: SyntaxError[]
): void => {
  const diagnostics = diagnosticsFor(view.state.doc, errors);
  const spec = setDiagnostics(view.state, diagnostics);
  const asked = typeof spec.effects === 'undefined' ? [] : spec.effects;
  const effects = [
    ...(Array.isArray(asked) ? asked : [asked]),
    setErrorLines.of(errors.map((error) => error.line - 1)),
  ];
  view.dispatch({ ...spec, effects });
};
