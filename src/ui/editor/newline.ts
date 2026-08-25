import { insertNewlineAndIndent } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { Command, EditorView, KeyBinding, keymap } from '@codemirror/view';

/**
 * Enter, without leaving the start of the new line off the screen.
 *
 * Lines are not wrapped, so a long statement scrolls the editor sideways and
 * the reader ends up looking at the right-hand end of it. Pressing Enter there
 * puts the caret back at the indentation of a new line - a couple of columns
 * from the left of the document, and far to the left of what is on screen -
 * and CodeMirror's own reveal moves the viewport by the smallest amount that
 * brings the caret back into it. The smallest amount leaves the caret flush
 * against the left edge, so the reader begins the new line with the first
 * columns of it, and of every line around it, still cut off to the left.
 *
 * The caret has to be visible; how much of the line before it is visible is
 * the part that was being decided badly. Revealing the caret at the *right*
 * edge instead asks for the smallest horizontal scroll position that still
 * shows it, which is the one that shows the most of what lies to its left -
 * and in the ordinary case, where a new line's indentation is narrower than
 * the editor, that position is zero and the document snaps back to its own
 * left margin, which is where a reader who has just started a line is looking.
 *
 * Only Enter is treated this way. The arrow keys and the mouse move the caret
 * to somewhere the reader is pointing at, and reframing the whole viewport
 * around each such step would be worse than the flush-left reveal this
 * replaces; there, CodeMirror's `nearest` is right.
 */

/** Kept between the caret and the right edge, so it is not flush against it. */
const CARET_MARGIN = 24;

export const insertNewlineKeepingLineStart: Command = (view) => {
  if (!insertNewlineAndIndent(view)) {
    return false;
  }
  // A second transaction rather than a scroll effect on the first, because the
  // first is `insertNewlineAndIndent`'s to build: where its caret ends up is
  // the language's indentation decision and is only known once it has run.
  // An effect-only transaction adds nothing to the history.
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, {
      x: 'end',
      xMargin: CARET_MARGIN,
      y: 'nearest',
    }),
  });
  return true;
};

const newlineBinding: KeyBinding = {
  key: 'Enter',
  run: insertNewlineKeepingLineStart,
  shift: insertNewlineKeepingLineStart,
};

/**
 * Above `defaultKeymap`, whose Enter this stands in for, and below the
 * completion keymap, which takes `Prec.highest` so that Enter accepts the
 * highlighted completion while the list is open. That order is what keeps this
 * a change to how a newline is revealed rather than a change to what Enter
 * does.
 */
export const newlineKeymap = Prec.high(keymap.of([newlineBinding]));
