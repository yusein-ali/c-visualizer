import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  applyBreakpointStates,
  breakpointRows,
  breakpointStates,
} from './breakpoints';
import { unprotected } from './protected';
import { toggleWatch, watchField } from './watches';

/**
 * A session, as plain JSON: the program, where the cursor is, which lines are
 * marked and which names are pinned.
 *
 * The point of it is the handing over. A student who is stuck sends what they
 * have, breakpoints included, and a teacher opens the session they were
 * actually looking at rather than a paste of the source with the interesting
 * part - where they had stopped, and what they were watching - left out. It is
 * also what a course page stores between visits, and what an assignment
 * submission could carry beside the program.
 *
 * Deliberately not part of it: the run. A session restores the program and
 * what the reader marked on it, and then the program is run again from the
 * start, because a replayed run has to be a run of this interpreter over this
 * source rather than a recording somebody could have edited. `EditorState`
 * carries the first two through `toJSON`; the rest is asked of the fields
 * that hold it.
 */

/** The shape written out. `version` is what a later reader checks first. */
export interface SessionJSON {
  version: 1;
  /** What `EditorState.toJSON` produced: the document and the selection. */
  editor: unknown;
  /** Zero-based rows, as everything that talks to the interpreter is. */
  breakpoints: number[];
  /** Disabled rows stay visible and can be enabled again from the table. */
  disabledBreakpoints?: number[];
  /** The names the reader pinned, and where. */
  watches: { name: string; pos: number }[];
}

export const sessionOf = (state: EditorState): SessionJSON => ({
  version: 1,
  editor: state.toJSON(),
  breakpoints: breakpointRows(state),
  disabledBreakpoints: breakpointStates(state)
    .filter((breakpoint) => !breakpoint.enabled)
    .map((breakpoint) => breakpoint.row),
  watches: (state.field(watchField, false)?.pins ?? []).map((watch) => ({
    name: watch.name,
    pos: watch.pos,
  })),
});

/**
 * Whether a value is a session this version can read. A file that arrives
 * from outside is checked rather than trusted: it may be another version's,
 * another tool's, or half of one.
 */
export const isSession = (value: unknown): value is SessionJSON => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SessionJSON>;
  return (
    candidate.version === 1 &&
    typeof candidate.editor === 'object' &&
    candidate.editor !== null &&
    Array.isArray(candidate.breakpoints) &&
    (typeof candidate.disabledBreakpoints === 'undefined' ||
      Array.isArray(candidate.disabledBreakpoints)) &&
    Array.isArray(candidate.watches)
  );
};

/**
 * Puts a session back into an editor that already exists.
 *
 * The document is replaced rather than the view rebuilt: the debug extensions
 * are configured into that view, and rebuilding it to change its text would
 * take the debugger with it. The replacement is annotated as the
 * application's own, so a protected-region exercise can still be restored.
 */
export const restoreSession = (
  view: EditorView,
  session: SessionJSON
): void => {
  const editor = session.editor as { doc?: unknown; selection?: unknown };
  const doc = typeof editor.doc === 'string' ? editor.doc : '';
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
    annotations: unprotected.of(true),
  });
  const anchor = anchorOf(editor.selection, view.state.doc.length);
  if (anchor !== null) {
    view.dispatch({ selection: { anchor } });
  }
  applyBreakpointStates(view, [
    ...session.breakpoints.map((row) => ({ row, enabled: true })),
    ...(session.disabledBreakpoints ?? []).map((row) => ({
      row,
      enabled: false,
    })),
  ]);
  // Every pin is dropped before the saved ones go on, so restoring twice
  // leaves one set of watches rather than none.
  for (const name of (
    view.state.field(watchField, false)?.pins ?? []
  ).slice()) {
    view.dispatch({ effects: toggleWatch.of(name) });
  }
  for (const watch of session.watches) {
    view.dispatch({
      effects: toggleWatch.of({
        name: watch.name,
        pos: Math.min(Math.max(watch.pos, 0), view.state.doc.length),
      }),
    });
  }
};

/** Where the cursor was, if the saved selection says anything usable. */
const anchorOf = (selection: unknown, length: number): number | null => {
  if (selection === null || typeof selection !== 'object') {
    return null;
  }
  const ranges = (selection as { ranges?: { anchor?: number }[] }).ranges;
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return null;
  }
  const anchor = ranges[0].anchor;
  return typeof anchor === 'number'
    ? Math.min(Math.max(anchor, 0), length)
    : null;
};
