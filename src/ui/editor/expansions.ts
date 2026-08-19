import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { Expansion } from '../../interpreter/Expansion';
import { offsetAt } from './positions';

/**
 * The marks under everything the preprocessor touched. The pass keeps line
 * numbers, so a recorded position still refers to the line the user is looking
 * at and the mark can sit directly under the macro they wrote.
 */

export const setExpansions = StateEffect.define<Expansion[]>();

// `enum` falls to the same grey as an excluded region, which is where Ace's
// three-way choice of style left it. The tooltip still names what it became.
const markFor = (kind: Expansion['kind']) =>
  Decoration.mark({
    class:
      kind === 'macro'
        ? 'plivet-macro-expansion'
        : kind === 'directive'
        ? 'plivet-directive-line'
        : 'plivet-excluded-region',
  });

const decorationsFor = (
  state: EditorState,
  expansions: Expansion[]
): DecorationSet =>
  Decoration.set(
    expansions
      .map((expansion) => {
        const from = offsetAt(state.doc, expansion.line, expansion.column);
        const to = offsetAt(
          state.doc,
          expansion.line,
          expansion.column + expansion.length
        );
        return { from, to, kind: expansion.kind };
      })
      // A zero-length mark is not a decoration CodeMirror will accept, and a
      // replacement that fell off the end of an edited line has no width.
      .filter((span) => span.to > span.from)
      .map((span) => markFor(span.kind).range(span.from, span.to)),
    true
  );

export const expansionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let updated = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setExpansions)) {
        updated = decorationsFor(transaction.state, effect.value);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const showExpansions = (
  view: EditorView,
  expansions: Expansion[]
): void => {
  view.dispatch({ effects: setExpansions.of(expansions) });
};

/**
 * The replacement covering a position, narrowest first: a macro named inside a
 * directive sits within the span of the directive itself, and it is the more
 * specific answer.
 */
export const expansionAt = (
  expansions: Expansion[],
  line: number,
  column: number
): Expansion | null => {
  let found: Expansion | null = null;
  for (const expansion of expansions) {
    if (
      expansion.line === line &&
      expansion.column <= column &&
      column < expansion.column + expansion.length &&
      (found === null || expansion.length < found.length)
    ) {
      found = expansion;
    }
  }
  return found;
};
