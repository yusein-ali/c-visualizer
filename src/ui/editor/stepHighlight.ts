import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { SourceRange } from './positions';
import strings from '../../strings';

/**
 * Where execution stands. Ace showed this by moving the selection, which meant
 * the step marker and the user's own selection were the same object; a
 * decoration keeps them apart, so a reader can select text while stepping
 * without losing sight of the current expression.
 */

/** A variable the current statement reads or assigns, and what it holds. */
export interface InlineValue {
  name: string;
  display: string;
}

/**
 * Everything one step says about the line it stopped on: where the statement
 * is, and what its variables hold going into it. The two travel on one effect
 * because they are one fact - the values belong to that statement and to no
 * other - and a reader must never see the marker on one line and the values
 * of another.
 */
export interface StepMark {
  range: SourceRange;
  values: InlineValue[];
}

export const setStepHighlight = StateEffect.define<StepMark | null>();

const stepLine = Decoration.line({ class: 'plivet-step-line' });
const stepRange = Decoration.mark({ class: 'plivet-step-range' });

const decorationsFor = (
  state: EditorState,
  mark: StepMark | null
): DecorationSet => {
  if (mark === null) {
    return Decoration.none;
  }
  const { range } = mark;
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
 * Shows the step and brings it into view. The scroll is part of the same
 * transaction so the editor never paints the new highlight off-screen first.
 */
export const showStep = (
  view: EditorView,
  mark: StepMark | null,
  scroll: boolean = true
): void => {
  const effects: StateEffect<unknown>[] = [setStepHighlight.of(mark)];
  if (mark !== null && scroll) {
    effects.push(EditorView.scrollIntoView(mark.range.from, { y: 'center' }));
  }
  if (mark !== null) {
    effects.push(EditorView.announce.of(announcement(view, mark)));
  }
  view.dispatch({ effects });
};

/**
 * What a screen reader is told at each step.
 *
 * A highlight and a scroll say where the program is to a reader who can see
 * the page. Everything else PLIVET does is narrated by the control bar's live
 * regions - the step counter, the console - and the one thing that was not
 * was the statement itself, which is the thing the run is about. The line is
 * read out with what its variables hold, because that is what the reader
 * would otherwise hover every name on the line to learn.
 */
const announcement = (view: EditorView, mark: StepMark): string => {
  const line = view.state.doc.lineAt(mark.range.from);
  const said = mark.values
    .map((value) => `${value.name} ${value.display}`)
    .join(', ');
  const statement = line.text.trim();
  return said === ''
    ? `${strings.announceStep} ${line.number}: ${statement}`
    : `${strings.announceStep} ${line.number}: ${statement}. ${said}`;
};
