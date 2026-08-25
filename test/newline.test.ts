import { defaultKeymap } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import {
  insertNewlineKeepingLineStart,
  newlineKeymap,
} from '../src/ui/editor/newline';

const long =
  '  printf("a line long enough that the editor has to scroll sideways");';
const doc = ['int main() {', long, '}'].join('\n');

/** A view over that program, its caret where the reader put it. */
const viewWith = (head: number) => {
  const seen: Transaction[] = [];
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: head },
      extensions: [cpp(), newlineKeymap],
    }),
    dispatchTransactions: (transactions, self) => {
      seen.push(...transactions);
      self.update(transactions);
    },
  });
  return { view, seen };
};

/** What a transaction asked the view to reveal, where it asked for anything. */
const scrollTarget = (
  transaction: Transaction
): { x?: string; xMargin?: number } | null => {
  for (const effect of transaction.effects) {
    const value = effect.value as { x?: string } | null;
    if (value !== null && typeof value === 'object' && 'x' in value) {
      return value;
    }
  }
  return null;
};

/** The end of the long line, which is where the sideways scroll comes from. */
const endOfLongLine = doc.indexOf(long) + long.length;

describe('Enter', () => {
  it('breaks the line and keeps the indentation, as the default command does', () => {
    const { view } = viewWith(endOfLongLine);

    expect(insertNewlineKeepingLineStart(view)).toBe(true);
    expect(view.state.doc.line(3).text).toBe('  ');
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to);

    view.destroy();
  });

  it('reveals the new caret at the right edge, so the line start stays in view', () => {
    const { view, seen } = viewWith(endOfLongLine);

    insertNewlineKeepingLineStart(view);

    const revealed = seen.map(scrollTarget).filter((it) => it !== null);
    expect(revealed).toHaveLength(1);
    // `end` is the smallest horizontal scroll position that still shows the
    // caret, which is the one that shows the most of the line before it.
    expect(revealed[0]).toMatchObject({ x: 'end' });
    expect(revealed[0]!.xMargin).toBeGreaterThan(0);

    view.destroy();
  });

  it('leaves the document alone where nothing can be inserted', () => {
    const state = EditorState.create({
      doc,
      extensions: [cpp(), newlineKeymap, EditorState.readOnly.of(true)],
    });
    const view = new EditorView({ state });

    expect(insertNewlineKeepingLineStart(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });

  it('is bound to Enter above the default keymap', () => {
    const state = EditorState.create({
      doc,
      extensions: [newlineKeymap, keymap.of(defaultKeymap)],
    });

    const bindings = state.facet(keymap);
    const ours = bindings.findIndex((group) =>
      group.some((binding) => binding.run === insertNewlineKeepingLineStart)
    );
    const theirs = bindings.findIndex((group) =>
      group.some((binding) => binding.key === 'Enter' && binding.run !== null)
    );
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(ours).toBeLessThanOrEqual(theirs);
  });
});
