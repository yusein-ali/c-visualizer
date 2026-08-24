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
  constructor(readonly enabled: boolean) {
    super();
  }

  toDOM(): Node {
    const marker = document.createElement('span');
    marker.className = 'plivet-breakpoint';
    marker.classList.toggle('plivet-breakpoint--disabled', !this.enabled);
    return marker;
  }

  eq(other: BreakpointMarker): boolean {
    return other.enabled === this.enabled;
  }
}

const enabledMarker = new BreakpointMarker(true);
const disabledMarker = new BreakpointMarker(false);

export interface BreakpointState {
  /** Zero-based row, as the interpreter expects it. */
  row: number;
  /** Disabled breakpoints remain visible but do not stop execution. */
  enabled: boolean;
}

/** Toggle the breakpoint on the line containing this offset. */
export const toggleBreakpoint = StateEffect.define<number>();
/** Replace every breakpoint, given as zero-based rows. */
export const setBreakpoints = StateEffect.define<number[]>();
/** Replace enabled and disabled breakpoints together. */
export const setBreakpointStates = StateEffect.define<BreakpointState[]>();

const setOfStates = (
  doc: Text,
  states: BreakpointState[]
): RangeSet<GutterMarker> => {
  const byOffset = new Map<number, boolean>();
  for (const state of states) {
    const offset = startOfRow(doc, state.row);
    byOffset.set(offset, (byOffset.get(offset) ?? false) || state.enabled);
  }
  const entries = [...byOffset.entries()].sort(
    ([left], [right]) => left - right
  );
  return RangeSet.of(
    entries.map(([offset, enabled]) =>
      (enabled ? enabledMarker : disabledMarker).range(offset)
    ),
    true
  );
};

const setOfRows = (doc: Text, rows: number[]): RangeSet<GutterMarker> =>
  setOfStates(
    doc,
    rows.map((row) => ({ row, enabled: true }))
  );

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(breakpoints, transaction) {
    let updated = breakpoints.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setBreakpoints)) {
        updated = setOfRows(transaction.state.doc, effect.value);
      } else if (effect.is(setBreakpointStates)) {
        updated = setOfStates(transaction.state.doc, effect.value);
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
          : updated.update({ add: [enabledMarker.range(start)] });
      }
    }
    return updated;
  },
});

/** The breakpoints as the interpreter wants them: zero-based rows, ascending. */
export const breakpointRows = (state: EditorState): number[] => {
  return breakpointStates(state)
    .filter((breakpoint) => breakpoint.enabled)
    .map((breakpoint) => breakpoint.row);
};

/** Every breakpoint, including the disabled markers retained in the gutter. */
export const breakpointStates = (state: EditorState): BreakpointState[] => {
  const byRow = new Map<number, boolean>();
  const cursor = state.field(breakpointField, false)?.iter();
  if (typeof cursor === 'undefined') {
    return [];
  }
  while (cursor.value !== null) {
    const row = rowAt(state.doc, cursor.from);
    const enabled =
      cursor.value instanceof BreakpointMarker && cursor.value.enabled;
    byRow.set(row, (byRow.get(row) ?? false) || enabled);
    cursor.next();
  }
  return [...byRow.entries()]
    .map(([row, enabled]) => ({ row, enabled }))
    .sort((left, right) => left.row - right.row);
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
    initialSpacer: () => enabledMarker,
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

/** Replaces enabled and disabled breakpoints without rebuilding the editor. */
export const applyBreakpointStates = (
  view: EditorView,
  states: BreakpointState[]
): void => {
  view.dispatch({ effects: setBreakpointStates.of(states) });
};
