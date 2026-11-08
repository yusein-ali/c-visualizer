import {
  Annotation,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
} from '@codemirror/view';
import strings from '../../strings';

/**
 * Regions the reader may edit, and by omission the rest of the file they may
 * not.
 *
 * This is the shape an exercise usually takes: a program that is mostly given,
 * with the part under study left blank. Left to a comment saying "do not edit
 * below this line" it is an instruction; as a filter it is the editor's own
 * behaviour, and a student who does not read instructions gets the same
 * lesson as one who does.
 *
 * It composes with the read-only compartment rather than competing with it.
 * Read-only is the debugger holding the document while a program runs and is
 * about time; this is about place, and a running session freezes the blanks
 * along with everything else.
 *
 * A file with no regions declared is editable everywhere, which is what
 * PLIVET standalone is: the feature costs nothing until somebody asks for it.
 * Where some of a file is protected, the lines nothing of which may be edited
 * are shaded and carry a lock in a gutter of their own - the way the Sphinx
 * editor of the same course block draws them.
 *
 * Which regions a file has is the application's to work out (see
 * `segments.ts`): this field holds the answer for the document on screen,
 * and maps it through the reader's edits.
 */

/** One span the reader may type in, in document offsets. */
export interface EditableRegion {
  from: number;
  to: number;
}

/**
 * What the document on screen allows. `locked` holds the whole document:
 * the text has lost protected text it should have kept, and nothing is
 * editable until it is put back.
 */
export interface Protection {
  regions: EditableRegion[];
  locked?: boolean;
}

export const setEditableRegions = StateEffect.define<EditableRegion[]>();

/** Replace the regions and the lock together. */
export const setProtection = StateEffect.define<Protection>();

/**
 * The change the filter must let through whatever the regions say: the
 * application replacing the whole document. A host that hands PLIVET a new
 * program is not a student typing outside the blank.
 */
export const unprotected = Annotation.define<boolean>();

const blank = Decoration.mark({ class: 'plivet-editable' });
const protectedLine = Decoration.line({ class: 'plivet-protected-line' });

interface ProtectedState {
  regions: EditableRegion[];
  locked: boolean;
  marks: DecorationSet;
}

const marksFor = (regions: EditableRegion[]): DecorationSet =>
  Decoration.set(
    regions
      .filter((region) => region.to > region.from)
      .map((region) => blank.range(region.from, region.to)),
    true
  );

export const protectedField = StateField.define<ProtectedState>({
  create: () => ({ regions: [], locked: false, marks: Decoration.none }),
  update(protectedRegions, transaction) {
    let regions = protectedRegions.regions;
    let locked = protectedRegions.locked;
    if (transaction.docChanged && regions.length !== 0) {
      // A blank grows with what is typed into it: its start holds against
      // text inserted at that position and its end gives way to it, so an
      // edit at either edge lands inside rather than pushing the region off
      // the text it was drawn around.
      regions = regions.map((region) => ({
        from: transaction.changes.mapPos(region.from, -1),
        to: transaction.changes.mapPos(region.to, 1),
      }));
    }
    for (const effect of transaction.effects) {
      if (effect.is(setEditableRegions)) {
        regions = effect.value;
        locked = false;
      } else if (effect.is(setProtection)) {
        regions = effect.value.locked === true ? [] : effect.value.regions;
        locked = effect.value.locked === true;
      }
    }
    return regions === protectedRegions.regions &&
      locked === protectedRegions.locked
      ? protectedRegions
      : { regions, locked, marks: marksFor(regions) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (state) => state.marks),
});

/** Whether any of the document is held: some regions declared, or a lock. */
const isProtecting = (state: ProtectedState): boolean =>
  state.locked || state.regions.length !== 0;

/** Whether every change in a transaction falls inside one editable region. */
const allowed = (state: EditorState, transaction: Transaction): boolean => {
  const held = state.field(protectedField);
  if (!isProtecting(held)) {
    return true;
  }
  if (held.locked) {
    return false;
  }
  let ok = true;
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (
      !held.regions.some((region) => region.from <= fromA && toA <= region.to)
    ) {
      ok = false;
    }
  });
  return ok;
};

/**
 * The filter itself. A transaction that would change protected text is
 * dropped whole rather than stripped of its changes: the selection it carries
 * was worked out against the document the edit would have made, and moving
 * the cursor to a position that only exists in a refused edit is worse than
 * leaving it where the reader put it.
 */
export const protectedRegions = EditorState.transactionFilter.of(
  (transaction: Transaction) => {
    if (
      !transaction.docChanged ||
      transaction.annotation(unprotected) === true ||
      allowed(transaction.startState, transaction)
    ) {
      return transaction;
    }
    return [];
  }
);

/**
 * Whether no part of a line may be edited. A line some region reaches into,
 * even at one edge, is a line the reader can type on, so it is not locked:
 * a blank in the middle of a statement leaves that statement's line open.
 */
export const lineIsProtected = (
  state: EditorState,
  from: number,
  to: number
): boolean => {
  const held = state.field(protectedField, false);
  if (typeof held === 'undefined' || !isProtecting(held)) {
    return false;
  }
  return (
    held.locked ||
    !held.regions.some((region) => region.from <= to && from <= region.to)
  );
};

/** The protected lines, shaded across the whole width of the editor. */
const shading = EditorView.decorations.compute(
  ['doc', protectedField],
  (state) => {
    const held = state.field(protectedField);
    if (!isProtecting(held)) {
      return Decoration.none;
    }
    const builder = new RangeSetBuilder<Decoration>();
    for (let number = 1; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      if (lineIsProtected(state, line.from, line.to)) {
        builder.add(line.from, line.from, protectedLine);
      }
    }
    return builder.finish();
  }
);

class LockMarker extends GutterMarker {
  toDOM(): Node {
    const lock = document.createElement('span');
    lock.className = 'plivet-lock';
    lock.title = strings.protectedLine;
    lock.setAttribute('aria-hidden', 'true');
    return lock;
  }
}

const lock = new LockMarker();

/**
 * The lock beside each protected line. Low precedence puts it after the
 * line numbers, next to the code it is about, as the Sphinx editor places
 * its own. With no protection the gutter has no markers and takes no room.
 */
const lockGutter = Prec.low(
  gutter({
    class: 'plivet-lock-gutter',
    lineMarker: (view, line) =>
      lineIsProtected(view.state, line.from, line.to) ? lock : null,
    lineMarkerChange: (update) =>
      update.docChanged ||
      update.startState.field(protectedField) !==
        update.state.field(protectedField),
  })
);

/** The regions, their filter, the shading and the locks, in one array. */
export const protectedExtensions = [
  protectedField,
  protectedRegions,
  shading,
  lockGutter,
];

export const showEditableRegions = (
  view: EditorView,
  regions: EditableRegion[]
): void => {
  view.dispatch({ effects: setEditableRegions.of(regions) });
};

export const showProtection = (
  view: EditorView,
  protection: Protection
): void => {
  view.dispatch({ effects: setProtection.of(protection) });
};

export const editableRegions = (state: EditorState): EditableRegion[] =>
  state.field(protectedField, false)?.regions ?? [];

/** Whether the document on screen is held whole. */
export const protectionLocked = (state: EditorState): boolean =>
  state.field(protectedField, false)?.locked ?? false;
