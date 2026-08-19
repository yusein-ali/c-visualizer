import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { SourceRange } from './positions';

/**
 * Where execution stands. Ace showed this by moving the selection, which meant
 * the step marker and the user's own selection were the same object; a
 * decoration keeps them apart, so a reader can select text while stepping
 * without losing sight of the current expression.
 */

export const setStepHighlight = StateEffect.define<SourceRange | null>();

const stepLine = Decoration.line({ class: 'plivet-step-line' });
const stepRange = Decoration.mark({ class: 'plivet-step-range' });

const decorationsFor = (
  state: EditorState,
  range: SourceRange | null
): DecorationSet => {
  if (range === null) {
    return Decoration.none;
  }
  const decorations = [stepLine.range(state.doc.lineAt(range.from).from)];
  if (range.to > range.from) {
    decorations.push(stepRange.range(range.from, range.to));
  }
  return Decoration.set(decorations, true);
};

export const stepHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlight, transaction) {
    let updated = highlight.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setStepHighlight)) {
        updated = decorationsFor(transaction.state, effect.value);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Shows the range and brings it into view. The scroll is part of the same
 * transaction so the editor never paints the new highlight off-screen first.
 */
export const showStep = (
  view: EditorView,
  range: SourceRange | null,
  scroll: boolean = true
): void => {
  const effects: StateEffect<unknown>[] = [setStepHighlight.of(range)];
  if (range !== null && scroll) {
    effects.push(EditorView.scrollIntoView(range.from, { y: 'center' }));
  }
  view.dispatch({ effects });
};
