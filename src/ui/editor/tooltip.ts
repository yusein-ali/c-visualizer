import { EditorState } from '@codemirror/state';
import { EditorView, Tooltip, hoverTooltip } from '@codemirror/view';
import { rowAt } from './positions';
import { Explanation, Fact } from '../records';

/**
 * What the pointer is over, in the terms the rest of PLIVET speaks: a
 * zero-based row, a column, and the word under the cursor. The provider
 * returns a record, or null to show nothing.
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

/**
 * What a tooltip says, and one line of it.
 *
 * They are the records of `src/ui/records.ts` under the names the editor
 * calls them by: a hover is an explanation of the position under the pointer,
 * and the statement section on the canvas is an explanation of the statement
 * under the marker. One shape, so that a fact added for either shows up in
 * both.
 */
export type HoverFact = Fact;
export type HoverRecord = Explanation;

export type HoverText = (context: HoverContext) => HoverRecord | null;

export interface HoverTooltipOptions {
  /** What to say about the position under the pointer. */
  text: HoverText;
  /**
   * The object a tooltip is describing while it is open, and null when it
   * closes. The canvas listens for it.
   */
  onFocus?: (object: string | null) => void;
}

/** The record, as a small table: the headline, then a row per fact. */
export const hoverDom = (record: HoverRecord): HTMLElement => {
  const dom = document.createElement('div');
  dom.className = 'plivet-tooltip';

  const title = document.createElement('div');
  title.className = 'plivet-tooltip__title';
  title.textContent = record.title;
  dom.appendChild(title);

  const said = record.facts.filter(
    (fact) => fact.label !== '' || fact.value !== ''
  );
  if (said.length === 0) {
    return dom;
  }
  const table = document.createElement('table');
  table.className = 'plivet-tooltip__facts';
  for (const fact of said) {
    const row = document.createElement('tr');
    // A fact with nothing on its left is a sentence, and a sentence that
    // stops at the first column reads as a heading for a row that is not
    // there. It takes the width of the table instead.
    if (fact.label === '' || fact.value === '') {
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.className = 'plivet-tooltip__note';
      cell.textContent = fact.label === '' ? fact.value : fact.label;
      row.appendChild(cell);
    } else {
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = fact.label;
      const value = document.createElement('td');
      value.textContent = fact.value;
      if (fact.code === true) {
        value.className = 'plivet-tooltip__code';
      }
      row.append(label, value);
    }
    table.appendChild(row);
  }
  dom.appendChild(table);
  return dom;
};

/**
 * Ace had no tooltip of its own, so the old editor tracked `mousemove` on the
 * container, resolved the position through the renderer and positioned an
 * absolutely placed div by hand. `hoverTooltip` does all of that, including
 * staying out of the way of the pointer and closing on scroll.
 */
export const plivetHoverSource =
  (options: HoverTooltipOptions) =>
  (view: EditorView, pos: number): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const word = view.state.wordAt(pos);
    const record = options.text({
      state: view.state,
      pos,
      row: rowAt(view.state.doc, pos),
      column: pos - line.from,
      word: word === null ? '' : view.state.sliceDoc(word.from, word.to),
    });
    if (record === null || record.title === '') {
      return null;
    }
    return {
      pos: word === null ? pos : word.from,
      end: word === null ? undefined : word.to,
      above: true,
      create: () => ({
        dom: hoverDom(record),
        // The canvas is told while this tooltip stands, and told again when
        // it goes: a mark that outlived the thing that asked for it would be
        // a second pointer on the screen.
        mount: () => {
          if (typeof options.onFocus !== 'undefined') {
            options.onFocus(record.object ?? null);
          }
        },
        destroy: () => {
          if (typeof options.onFocus !== 'undefined') {
            options.onFocus(null);
          }
        },
      }),
    };
  };

export const plivetHoverTooltip = (options: HoverTooltipOptions) =>
  hoverTooltip(plivetHoverSource(options));
