import { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { SourceRange } from './positions';
import { setFocusRange } from './focus';
import { rowAt } from './positions';

/**
 * Ctrl-click a name, and the editor goes to where it was declared.
 *
 * It is the one navigation a reader of an unfamiliar program asks for
 * constantly - what is this, where did it come from, what does this function
 * actually do - and until now the only answer PLIVET gave was a tooltip,
 * which says what a declaration is without ever showing it in place. A
 * beginner reading a call to `factorial` wants to see the body.
 *
 * Nothing here knows what a declaration is. The gesture reports the name, the
 * position and whether it is being called; the application resolves it
 * against the constructs of the last syntax check and hands back a range, or
 * nothing. That is the same division as the hover: the editor knows where the
 * pointer is, and the application knows what the program says.
 */

export interface DeclarationRequest {
  /** The identifier under the pointer. */
  word: string;
  /** 1-based line and 0-based column, as everything interpreter-side is. */
  line: number;
  column: number;
  /**
   * Whether the name is being called here. `f(` and `f` are two questions:
   * one asks for the function's body, and the other might be an object of
   * that name in a nearer scope.
   */
  isCall: boolean;
}

/** Where that name was declared, or null when nothing here declares it. */
export type DeclarationSource = (
  request: DeclarationRequest
) => SourceRange | null;

/** How long the declaration stays marked after the jump, in milliseconds. */
const FLASH = 1400;

/** Ctrl on a PC, Command on a Mac - and never Alt, which pins a watch. */
const modifierHeld = (event: MouseEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey;

/** Whether an open parenthesis follows the name, spaces aside. */
const callAt = (view: EditorView, to: number): boolean => {
  const line = view.state.doc.lineAt(to);
  const after = line.text.slice(to - line.from);
  return /^\s*\(/.test(after);
};

const requestAt = (
  view: EditorView,
  pos: number
): DeclarationRequest | null => {
  const word = view.state.wordAt(pos);
  if (word === null) {
    return null;
  }
  const line = view.state.doc.lineAt(word.from);
  return {
    word: view.state.sliceDoc(word.from, word.to),
    line: rowAt(view.state.doc, word.from) + 1,
    column: word.from - line.from,
    isCall: callAt(view, word.to),
  };
};

/**
 * Puts the cursor on the declaration, brings it into view, and marks it for a
 * moment.
 *
 * The mark matters more than the scroll. A jump that lands silently leaves a
 * reader working out what moved and why; the same highlight the canvas uses
 * to point at a declaration says "this is what you asked for", and then goes,
 * because a permanent mark would compete with the step marker.
 */
export const goTo = (view: EditorView, range: SourceRange): void => {
  view.dispatch({
    selection: { anchor: range.from },
    effects: [
      EditorView.scrollIntoView(range.from, { y: 'center' }),
      setFocusRange.of(range),
    ],
  });
  view.focus();
  setTimeout(() => {
    // Only if nothing else has claimed the mark in the meantime: a reader who
    // moved the pointer onto the canvas is being shown something else now.
    view.dispatch({ effects: setFocusRange.of(null) });
  }, FLASH);
};

/**
 * The gesture: ctrl-click, and F12 on the word under the cursor for a reader
 * who is not using a pointer at all.
 */
export const gotoDeclaration = (find: DeclarationSource): Extension => [
  EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (!modifierHeld(event)) {
        return false;
      }
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        return false;
      }
      const request = requestAt(view, pos);
      if (request === null) {
        return false;
      }
      const found = find(request);
      if (found === null) {
        // Not handled: a ctrl-click on a name nothing declares should still
        // behave like the click it is, rather than swallowing itself.
        return false;
      }
      event.preventDefault();
      goTo(view, found);
      return true;
    },
    // The pointer says what the modifier would do, which is the only sign a
    // reader gets that the gesture exists at all.
    keydown(event: KeyboardEvent, view: EditorView) {
      view.dom.classList.toggle(
        'plivet-goto-ready',
        (event.ctrlKey || event.metaKey) && !event.altKey
      );
      return false;
    },
    keyup(_event: KeyboardEvent, view: EditorView) {
      view.dom.classList.remove('plivet-goto-ready');
      return false;
    },
    mouseleave(_event: MouseEvent, view: EditorView) {
      view.dom.classList.remove('plivet-goto-ready');
      return false;
    },
  }),
  keymap.of([
    {
      key: 'F12',
      run: (view: EditorView) => {
        const request = requestAt(view, view.state.selection.main.head);
        if (request === null) {
          return false;
        }
        const found = find(request);
        if (found === null) {
          return false;
        }
        goTo(view, found);
        return true;
      },
    },
  ]),
];
