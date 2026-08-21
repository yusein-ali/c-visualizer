import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

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
 */

/** One span the reader may type in, in document offsets. */
export interface EditableRegion {
  from: number;
  to: number;
}

export const setEditableRegions = StateEffect.define<EditableRegion[]>();

/**
 * The change the filter must let through whatever the regions say: the
 * application replacing the whole document. A host that hands PLIVET a new
 * program is not a student typing outside the blank.
 */
export const unprotected = Annotation.define<boolean>();

const blank = Decoration.mark({ class: 'plivet-editable' });

interface ProtectedState {
  regions: EditableRegion[];
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
  create: () => ({ regions: [], marks: Decoration.none }),
  update(protectedRegions, transaction) {
    let regions = protectedRegions.regions;
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
      }
    }
    return regions === protectedRegions.regions
      ? protectedRegions
      : { regions, marks: marksFor(regions) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (state) => state.marks),
});

/** Whether every change in a transaction falls inside one editable region. */
const allowed = (state: EditorState, transaction: Transaction): boolean => {
  const { regions } = state.field(protectedField);
  if (regions.length === 0) {
    return true;
  }
  let ok = true;
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (!regions.some((region) => region.from <= fromA && toA <= region.to)) {
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

export const showEditableRegions = (
  view: EditorView,
  regions: EditableRegion[]
): void => {
  view.dispatch({ effects: setEditableRegions.of(regions) });
};

export const editableRegions = (state: EditorState): EditableRegion[] =>
  state.field(protectedField, false)?.regions ?? [];
