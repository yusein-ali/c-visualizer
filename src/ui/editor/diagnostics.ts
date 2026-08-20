import { EditorState, StateEffect, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { Action, Diagnostic, setDiagnostics } from '@codemirror/lint';
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

/**
 * What a teaching rule found, in the terms this file already speaks: lines,
 * columns and text. Structural rather than imported, for the same reason
 * `SyntaxError` above is - the editor describes what it is given and knows
 * nothing about the interpreter that found it.
 *
 * The library entry arrives looked up rather than named: `libraryHelp` belongs
 * to the application, and formatting it belongs here.
 */
export interface TeachingDiagnostic {
  rule: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** 1-based line, 0-based column; the end is exclusive. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fix?: {
    label: string;
    text: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  };
  help?: { signature: string; description: string };
}

/**
 * The message, and the library entry it points at.
 *
 * A rule about `scanf` that does not say what `scanf` is leaves the reader to
 * look it up somewhere else, which for a beginner means not looking it up.
 */
const renderMessage = (diagnostic: TeachingDiagnostic) => () => {
  const dom = document.createElement('div');
  dom.className = 'plivet-lint-message';
  const text = document.createElement('div');
  text.textContent = diagnostic.message;
  dom.appendChild(text);
  if (typeof diagnostic.help !== 'undefined') {
    const signature = document.createElement('code');
    signature.className = 'plivet-lint-signature';
    signature.textContent = diagnostic.help.signature;
    const description = document.createElement('div');
    description.className = 'plivet-lint-description';
    description.textContent = diagnostic.help.description;
    dom.appendChild(signature);
    dom.appendChild(description);
  }
  return dom;
};

/**
 * The one-click fix, where a rule is sure enough of one to offer it.
 *
 * The edit is kept as an offset from the start of the diagnostic rather than
 * as an absolute position: CodeMirror maps a diagnostic through every change
 * that lands while it is shown, and `apply` is handed where it ended up, so an
 * edit above the warning moves the fix with it.
 */
const actionsFor = (
  doc: Text,
  diagnostic: TeachingDiagnostic,
  from: number
): Action[] | undefined => {
  const { fix } = diagnostic;
  if (typeof fix === 'undefined') {
    return undefined;
  }
  const start = offsetAt(doc, fix.line, fix.column) - from;
  const end = offsetAt(doc, fix.endLine, fix.endColumn) - from;
  return [
    {
      name: fix.label,
      apply: (view: EditorView, at: number) => {
        view.dispatch({
          changes: { from: at + start, to: at + end, insert: fix.text },
        });
      },
    },
  ];
};

/** One diagnostic per finding, over the range the rule reported. */
export const teachingDiagnosticsFor = (
  doc: Text,
  found: TeachingDiagnostic[]
): Diagnostic[] =>
  found.map((diagnostic) => {
    const from = offsetAt(doc, diagnostic.line, diagnostic.column);
    const to = Math.max(
      offsetAt(doc, diagnostic.endLine, diagnostic.endColumn),
      from
    );
    return {
      from,
      to,
      severity: diagnostic.severity,
      source: `plivet/${diagnostic.rule}`,
      message: diagnostic.message,
      renderMessage: renderMessage(diagnostic),
      actions: actionsFor(doc, diagnostic, from),
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
 *
 * Syntax errors and teaching findings go in together because the linter holds
 * one set: showing them in two calls would mean each replacing the other. Only
 * the errors tint their line - a warning about a program that runs should not
 * look like a program that will not compile.
 */
export const showDiagnostics = (
  view: EditorView,
  errors: SyntaxError[],
  found: TeachingDiagnostic[] = []
): void => {
  const diagnostics = diagnosticsFor(view.state.doc, errors).concat(
    teachingDiagnosticsFor(view.state.doc, found)
  );
  const spec = setDiagnostics(view.state, diagnostics);
  const asked = typeof spec.effects === 'undefined' ? [] : spec.effects;
  const effects = [
    ...(Array.isArray(asked) ? asked : [asked]),
    setErrorLines.of(errors.map((error) => error.line - 1)),
  ];
  view.dispatch({ ...spec, effects });
};
