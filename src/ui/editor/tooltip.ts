import { EditorState } from '@codemirror/state';
import { EditorView, Tooltip, hoverTooltip } from '@codemirror/view';
import { rowAt } from './positions';

/**
 * What the pointer is over, in the terms the rest of PLIVET speaks: a
 * zero-based row, a column, and the word under the cursor. The provider
 * returns plain text, one fact per line, or null to show nothing.
 */
export interface HoverContext {
  state: EditorState;
  pos: number;
  /** Zero-based, as everything that talks to the interpreter is. */
  row: number;
  column: number;
  /** The identifier under the pointer, empty when it is not over one. */
  word: string;
}

export type HoverText = (context: HoverContext) => string | null;

/**
 * Ace had no tooltip of its own, so the old editor tracked `mousemove` on the
 * container, resolved the position through the renderer and positioned an
 * absolutely placed div by hand. `hoverTooltip` does all of that, including
 * staying out of the way of the pointer and closing on scroll.
 */
export const plivetHoverTooltip = (text: HoverText) =>
  hoverTooltip((view: EditorView, pos: number): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const word = view.state.wordAt(pos);
    const content = text({
      state: view.state,
      pos,
      row: rowAt(view.state.doc, pos),
      column: pos - line.from,
      word: word === null ? '' : view.state.sliceDoc(word.from, word.to),
    });
    if (content === null || content === '') {
      return null;
    }
    return {
      pos: word === null ? pos : word.from,
      end: word === null ? undefined : word.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'plivet-tooltip';
        dom.textContent = content;
        return { dom };
      },
    };
  });
