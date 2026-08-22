import { Extension, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  keymap,
} from '@codemirror/view';
import { SourceRange } from './positions';
import { setFocusRange } from './focus';
import { rowAt } from './positions';

/**
 * Hold Ctrl/Command while hovering a declared name and it becomes a link;
 * follow it to the declaration.
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

/** A declaration the owning application must reveal outside this document. */
export interface DeclarationNavigation {
  navigate: () => void;
}

/** Where that name was declared, or null when nothing here declares it. */
export type DeclarationDestination = SourceRange | DeclarationNavigation;

export type DeclarationSource = (
  request: DeclarationRequest
) => DeclarationDestination | null;

/** How long the declaration stays marked after the jump, in milliseconds. */
const FLASH = 1400;

/** The one identifier currently offered as a declaration link. */
const setDeclarationLink = StateEffect.define<SourceRange | null>();

const declarationLink = Decoration.mark({
  class: 'plivet-declaration-link',
});

const declarationLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(link, transaction) {
    let updated = link.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setDeclarationLink)) {
        const range = effect.value;
        updated =
          range === null || range.to <= range.from
            ? Decoration.none
            : Decoration.set([declarationLink.range(range.from, range.to)]);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Which platform this is, asked per event rather than once: it costs nothing,
 * and a module-level answer is one a test cannot change.
 */
const onMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/**
 * Command on a Mac, Ctrl everywhere else - the same key VS Code uses, and for
 * the same reason: on macOS Ctrl-click *is* the secondary click. The system
 * opens a context menu from it, so a gesture bound to Ctrl there is not a
 * gesture that occasionally fails, it is one that can never be made to work
 * without stealing the platform's own click.
 *
 * Alt is excluded on both: alt-click pins a watch.
 */
const modifierHeld = (event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean => {
  if (event.altKey) {
    return false;
  }
  return onMac()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
};

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

/** The word occupied by the declaration link, if one is being shown. */
const linkedRange = (view: EditorView): SourceRange | null => {
  let found: SourceRange | null = null;
  view.state
    .field(declarationLinkField)
    .between(0, view.state.doc.length, (from, to) => {
      found = { from, to };
    });
  return found;
};

const showLink = (view: EditorView, range: SourceRange | null): void => {
  const shown = linkedRange(view);
  if (
    (shown === null && range === null) ||
    (shown !== null &&
      range !== null &&
      shown.from === range.from &&
      shown.to === range.to)
  ) {
    return;
  }
  view.dispatch({ effects: setDeclarationLink.of(range) });
};

/** Resolve the identifier under a pointer and show only resolvable names. */
const updateLink = (
  pointer: { x: number; y: number } | null,
  held: boolean,
  view: EditorView,
  find: DeclarationSource
): void => {
  if (pointer === null || !held) {
    showLink(view, null);
    return;
  }
  const pos = view.posAtCoords(pointer);
  if (pos === null) {
    showLink(view, null);
    return;
  }
  const word = view.state.wordAt(pos);
  const request = requestAt(view, pos);
  showLink(
    view,
    word !== null && request !== null && find(request) !== null
      ? { from: word.from, to: word.to }
      : null
  );
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

/** Follow a declaration in this document or let its owner reveal another. */
const follow = (
  view: EditorView,
  destination: DeclarationDestination
): void => {
  if ('navigate' in destination) {
    destination.navigate();
  } else {
    goTo(view, destination);
  }
};

/**
 * A resolvable identifier becomes a link while Ctrl/Command and the pointer
 * are both over it. The modifier-click follows that link, and F12 does the
 * same from the keyboard.
 */
export const gotoDeclaration = (find: DeclarationSource): Extension => {
  // Kept per extension instance, never at module scope: each editor has its
  // own pointer, and pressing the modifier while that pointer is stationary
  // must still turn the identifier beneath it into a link.
  let pointer: { x: number; y: number } | null = null;
  const modifierTracker = ViewPlugin.fromClass(
    class {
      private readonly document: Document;
      private readonly window: Window | null;

      constructor(private readonly view: EditorView) {
        this.document = view.dom.ownerDocument;
        this.window = this.document.defaultView;
        this.document.addEventListener('keydown', this.modifierChanged);
        this.document.addEventListener('keyup', this.modifierChanged);
        this.window?.addEventListener('blur', this.blurred);
      }

      destroy(): void {
        this.document.removeEventListener('keydown', this.modifierChanged);
        this.document.removeEventListener('keyup', this.modifierChanged);
        this.window?.removeEventListener('blur', this.blurred);
      }

      private readonly modifierChanged = (event: KeyboardEvent): void => {
        updateLink(pointer, modifierHeld(event), this.view, find);
      };

      private readonly blurred = (): void => {
        showLink(this.view, null);
      };
    }
  );

  return [
    declarationLinkField,
    modifierTracker,
    EditorView.domEventHandlers({
      mousemove(event: MouseEvent, view: EditorView) {
        pointer = { x: event.clientX, y: event.clientY };
        updateLink(pointer, modifierHeld(event), view, find);
        return false;
      },
      mousedown(event: MouseEvent, view: EditorView) {
        // The primary button only. A secondary click is the reader asking for a
        // menu, and on a Mac that is exactly what a ctrl-click is.
        if (event.button !== 0 || !modifierHeld(event)) {
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
          // Not handled: a name nothing declares should still behave like the
          // click it is, rather than swallowing itself.
          return false;
        }
        event.preventDefault();
        follow(view, found);
        showLink(view, null);
        return true;
      },
      mouseleave(_event: MouseEvent, view: EditorView) {
        pointer = null;
        showLink(view, null);
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
          follow(view, found);
          return true;
        },
      },
    ]),
  ];
};
