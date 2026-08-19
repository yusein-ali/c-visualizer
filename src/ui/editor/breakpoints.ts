import { RangeSet, StateEffect, StateField, Text } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { rowAt, startOfRow } from './positions';

/**
 * Breakpoints live in a `RangeSet` rather than in an array of line numbers so
 * that editing above a breakpoint moves it: a range set maps itself through
 * every document change. PLIVET's protocol still speaks zero-based rows, so
 * rows are what goes in and what comes out; offsets exist only in here.
 */

class BreakpointMarker extends GutterMarker {
  toDOM(): Node {
    const marker = document.createElement('span');
    marker.className = 'plivet-breakpoint';
    return marker;
  }
}

const breakpointMarker = new BreakpointMarker();

/** Toggle the breakpoint on the line containing this offset. */
export const toggleBreakpoint = StateEffect.define<number>();
/** Replace every breakpoint, given as zero-based rows. */
export const setBreakpoints = StateEffect.define<number[]>();

const setOfRows = (doc: Text, rows: number[]): RangeSet<GutterMarker> => {
  const offsets = Array.from(new Set(rows.map((row) => startOfRow(doc, row))));
  offsets.sort((left, right) => left - right);
  return RangeSet.of(
    offsets.map((offset) => breakpointMarker.range(offset)),
    true
  );
};

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(breakpoints, transaction) {
    let updated = breakpoints.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setBreakpoints)) {
        updated = setOfRows(transaction.state.doc, effect.value);
      } else if (effect.is(toggleBreakpoint)) {
        const start = startOfRow(
          transaction.state.doc,
          rowAt(transaction.state.doc, effect.value)
        );
        let marked = false;
        updated.between(start, start, () => {
          marked = true;
          return false;
        });
        updated = marked
          ? updated.update({ filter: (from) => from !== start })
          : updated.update({ add: [breakpointMarker.range(start)] });
      }
    }
    return updated;
  },
});

/** The breakpoints as the interpreter wants them: zero-based rows, ascending. */
export const breakpointRows = (state: EditorState): number[] => {
  const rows: number[] = [];
  const cursor = state.field(breakpointField, false)?.iter();
  if (typeof cursor === 'undefined') {
    return rows;
  }
  while (cursor.value !== null) {
    rows.push(rowAt(state.doc, cursor.from));
    cursor.next();
  }
  return rows;
};

/**
 * A gutter of its own, to the left of the line numbers. Under Ace a click
 * anywhere in the single gutter could toggle a breakpoint, so the old code
 * measured 25 pixels from its left edge to tell a breakpoint click from a
 * line-number one. A separate narrow gutter makes that rule structural: the
 * breakpoint column is the only thing that answers to a click.
 */
export const breakpointGutter = [
  breakpointField,
  gutter({
    class: 'plivet-breakpoint-gutter',
    markers: (view) => view.state.field(breakpointField),
    initialSpacer: () => breakpointMarker,
    domEventHandlers: {
      mousedown: (view: EditorView, line) => {
        view.dispatch({ effects: toggleBreakpoint.of(line.from) });
        return true;
      },
    },
  }),
];

/** Replaces the breakpoint set, for a host that keeps them somewhere else. */
export const applyBreakpoints = (view: EditorView, rows: number[]): void => {
  view.dispatch({ effects: setBreakpoints.of(rows) });
};
