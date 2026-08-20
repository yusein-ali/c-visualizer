import { EditorState, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { InlineValue, StepMark, setStepHighlight } from './stepHighlight';

/**
 * What the current statement's variables hold, printed where the reader is
 * already looking: at the end of the line the step marker is on.
 *
 * This is the step that used to be taken in the reader's head - find the line,
 * find the same names in the frame drawn beside it, and put the two together.
 * It reads the same effect as the step highlight, so the values cannot appear
 * against a statement other than the one they were computed for, and they
 * leave with it when the session stops.
 */

/** The separator between one variable and the next. */
const SEPARATOR = ', ';

const textOf = (values: InlineValue[]): string =>
  values.map((value) => `${value.name} = ${value.display}`).join(SEPARATOR);

class InlineValueWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  eq(other: InlineValueWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'plivet-inline-values';
    // The values are an annotation on the line rather than part of it: a
    // screen reader running through the document should read the program the
    // user typed, and the step announcement says where execution stands.
    dom.setAttribute('aria-hidden', 'true');
    dom.textContent = this.text;
    return dom;
  }

  /** Nothing in it is interactive, so the editor keeps every event. */
  ignoreEvent(): boolean {
    return false;
  }
}

const decorationsFor = (
  state: EditorState,
  mark: StepMark | null
): DecorationSet => {
  if (mark === null || mark.values.length === 0) {
    return Decoration.none;
  }
  const line = state.doc.lineAt(mark.range.from);
  return Decoration.set([
    Decoration.widget({
      widget: new InlineValueWidget(textOf(mark.values)),
      // After everything else on the line, including the step range's own
      // mark, so the annotation reads as a trailing comment would.
      side: 1,
    }).range(line.to),
  ]);
};

export const inlineValueField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(values, transaction) {
    let updated = values.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setStepHighlight)) {
        updated = decorationsFor(transaction.state, effect.value);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});
