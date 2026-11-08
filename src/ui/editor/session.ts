import { EditorState, Transaction } from '@codemirror/state';
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
 * source rather than a recording somebody could have edited.
 *
 * Two versions exist. Version 1 is one document: what `EditorState.toJSON`
 * produced plus the marks on it. It is still what a tab remembers while the
 * reader looks at another one, and still read from a file saved by an older
 * release. Version 2 is the whole program - every file with its text and its
 * marks, the entry and the file on screen - and is what a session is written
 * as now.
 */

/** A pinned name and where it was pinned. */
export interface SessionWatch {
  name: string;
  pos: number;
}

/** Version 1: one document. `version` is what a later reader checks first. */
export interface DocumentSessionJSON {
  version: 1;
  /** What `EditorState.toJSON` produced: the document and the selection. */
  editor: unknown;
  /** Zero-based rows, as everything that talks to the interpreter is. */
  breakpoints: number[];
  /** Disabled rows stay visible and can be enabled again from the table. */
  disabledBreakpoints?: number[];
  /** The names the reader pinned, and where. */
  watches: SessionWatch[];
}

/** Where the cursor is: offsets, `head` being the end that moves. */
export interface SessionSelection {
  anchor: number;
  head: number;
}

/**
 * One file of a version 2 session.
 *
 * A session written by c-visualizer carries every field. One written by a
 * host may leave any of them out but the path: a course page that supplies
 * the cursor and the breakpoints but not the text - because the text is the
 * page's own, or the reader's restored submission - writes no `text`, and
 * the marks are applied to whatever text the file has.
 */
export interface SessionFileJSON {
  path: string;
  text?: string;
  selection?: SessionSelection;
  /** Zero-based rows of the breakpoints that stop a run. */
  breakpoints?: number[];
  /** Zero-based rows of breakpoints kept in the gutter but switched off. */
  disabledBreakpoints?: number[];
  watches?: SessionWatch[];
}

/** Version 2: the whole program. */
export interface ProgramSessionJSON {
  version: 2;
  files: SessionFileJSON[];
  /** The file that runs. */
  entry?: string;
  /** The file on screen. */
  active?: string;
}

/** Either version, as `restoreSession` reads them. */
export type SessionJSON = DocumentSessionJSON | ProgramSessionJSON;

export const sessionOf = (state: EditorState): DocumentSessionJSON => ({
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isRows = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(isOffset);

const isWatches = (value: unknown): value is SessionWatch[] =>
  Array.isArray(value) &&
  value.every(
    (watch) =>
      isRecord(watch) && typeof watch.name === 'string' && isOffset(watch.pos)
  );

const isSelection = (value: unknown): value is SessionSelection =>
  isRecord(value) &&
  isOffset(value.anchor) &&
  (typeof value.head === 'undefined' || isOffset(value.head));

const isOptional = <T>(
  value: unknown,
  check: (value: unknown) => value is T
): boolean => typeof value === 'undefined' || check(value);

const isSessionFile = (value: unknown): value is SessionFileJSON =>
  isRecord(value) &&
  typeof value.path === 'string' &&
  value.path !== '' &&
  isOptional(
    value.text,
    (text: unknown): text is string => typeof text === 'string'
  ) &&
  isOptional(value.selection, isSelection) &&
  isOptional(value.breakpoints, isRows) &&
  isOptional(value.disabledBreakpoints, isRows) &&
  isOptional(value.watches, isWatches);

/** Whether a value is a version 1 session. */
export const isDocumentSession = (
  value: unknown
): value is DocumentSessionJSON => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === 1 &&
    typeof value.editor === 'object' &&
    value.editor !== null &&
    Array.isArray(value.breakpoints) &&
    (typeof value.disabledBreakpoints === 'undefined' ||
      Array.isArray(value.disabledBreakpoints)) &&
    Array.isArray(value.watches)
  );
};

/** Whether a value is a version 2 session. */
export const isProgramSession = (value: unknown): value is ProgramSessionJSON =>
  isRecord(value) &&
  value.version === 2 &&
  Array.isArray(value.files) &&
  value.files.every(isSessionFile) &&
  isOptional(
    value.entry,
    (entry: unknown): entry is string => typeof entry === 'string'
  ) &&
  isOptional(
    value.active,
    (active: unknown): active is string => typeof active === 'string'
  );

/**
 * Whether a value is a session this version can read. A file that arrives
 * from outside is checked rather than trusted: it may be another version's,
 * another tool's, or half of one, and a session with one malformed file is
 * refused whole rather than half applied.
 */
export const isSession = (value: unknown): value is SessionJSON =>
  isDocumentSession(value) || isProgramSession(value);

/** The text a version 1 session holds, if it holds one. */
export const documentText = (session: DocumentSessionJSON): string | null => {
  const editor = session.editor as { doc?: unknown };
  return typeof editor.doc === 'string' ? editor.doc : null;
};

/** The main selection a version 1 session holds, if it says anything usable. */
export const documentSelection = (
  session: DocumentSessionJSON
): SessionSelection | null => {
  const selection = (session.editor as { selection?: unknown }).selection;
  if (!isRecord(selection) || !Array.isArray(selection.ranges)) {
    return null;
  }
  const main = isOffset(selection.main) ? selection.main : 0;
  const range: unknown = selection.ranges[main] ?? selection.ranges[0];
  if (!isRecord(range) || !isOffset(range.anchor)) {
    return null;
  }
  return {
    anchor: range.anchor,
    head: isOffset(range.head) ? range.head : range.anchor,
  };
};

/**
 * One file of a version 2 session as the version 1 document a tab
 * remembers, over the text the file ends up with.
 */
export const documentSessionFor = (
  text: string,
  file: Omit<SessionFileJSON, 'path' | 'text'>
): DocumentSessionJSON => ({
  version: 1,
  editor:
    typeof file.selection === 'undefined'
      ? { doc: text }
      : {
          doc: text,
          selection: {
            ranges: [
              {
                anchor: file.selection.anchor,
                head: file.selection.head ?? file.selection.anchor,
              },
            ],
            main: 0,
          },
        },
  breakpoints: file.breakpoints ?? [],
  disabledBreakpoints: file.disabledBreakpoints ?? [],
  watches: file.watches ?? [],
});

/** The number of lines of a text, as CodeMirror counts them. */
const linesIn = (text: string): number => text.split('\n').length;

/**
 * Puts a session back into an editor that already exists.
 *
 * The document is replaced rather than the view rebuilt: the debug extensions
 * are configured into that view, and rebuilding it to change its text would
 * take the debugger with it. The replacement is annotated as the
 * application's own, so a protected-region exercise can still be restored;
 * whether the text may replace the old one is decided before this is called.
 *
 * Positions that no longer fit the text are dropped rather than moved: a
 * cursor past the end, a breakpoint below the last line, a watch whose name
 * is no longer where it was pinned. Moved, each would be a mark on a line the
 * reader never marked.
 */
export const restoreSession = (
  view: EditorView,
  session: DocumentSessionJSON
): void => {
  const text = documentText(session);
  if (text !== null) {
    // Kept out of the undo history for the reason `PlivetEditor.replaceCode`
    // keeps its replacement out: undo is not filtered.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: [unprotected.of(true), Transaction.addToHistory.of(false)],
    });
  }
  const doc = view.state.doc.toString();
  const length = doc.length;
  const lines = linesIn(doc);
  // A selection that does not fit is not moved onto the nearest text: the
  // cursor goes to the start, as it would in a file just opened, rather
  // than staying wherever the replaced document mapped it.
  const selection = documentSelection(session);
  const fitting =
    selection !== null &&
    selection.anchor <= length &&
    selection.head <= length;
  if (fitting || text !== null) {
    view.dispatch({
      selection: fitting
        ? { anchor: selection.anchor, head: selection.head }
        : { anchor: 0 },
    });
  }
  const fits = (row: unknown) => isOffset(row) && row < lines;
  applyBreakpointStates(view, [
    ...session.breakpoints.filter(fits).map((row) => ({ row, enabled: true })),
    ...(session.disabledBreakpoints ?? []).filter(fits).map((row) => ({
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
    if (
      !isRecord(watch) ||
      typeof watch.name !== 'string' ||
      !isOffset(watch.pos) ||
      doc.slice(watch.pos, watch.pos + watch.name.length) !== watch.name
    ) {
      continue;
    }
    view.dispatch({
      effects: toggleWatch.of({ name: watch.name, pos: watch.pos }),
    });
  }
};
