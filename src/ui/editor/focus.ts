import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { SourceRange } from './positions';

/**
 * The declaration of the object the reader is pointing at on the canvas.
 *
 * This is the step highlight's opposite number, and it is deliberately a
 * second decoration rather than a reuse of that one: the step marker says
 * where execution stands and is the program's own business, while this says
 * what the reader's pointer is on and goes away the moment the pointer does.
 * Two facts, two marks, and neither can take the other's place.
 */

export const setFocusRange = StateEffect.define<SourceRange | null>();

const focusLine = Decoration.line({ class: 'plivet-focus-line' });
const focusRange = Decoration.mark({ class: 'plivet-focus-range' });

export const focusField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(focus, transaction) {
    let updated = focus.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setFocusRange)) {
        const range = effect.value;
        updated =
          range === null
            ? Decoration.none
            : Decoration.set(
                [
                  focusLine.range(
                    transaction.state.doc.lineAt(range.from).from
                  ),
                  ...(range.to > range.from
                    ? [focusRange.range(range.from, range.to)]
                    : []),
                ],
                true
              );
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Marks a declaration, or takes the mark off. Nothing scrolls: the reader is
 * looking at the canvas, and a page that moved under a pointer they are not
 * pointing with would be the editor answering a question nobody asked.
 */
export const showFocus = (
  view: EditorView,
  range: SourceRange | null
): void => {
  view.dispatch({ effects: setFocusRange.of(range) });
};
