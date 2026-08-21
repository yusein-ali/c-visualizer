import { PreprocessedDialog } from '../src/ui/preprocessed';
import { preprocess } from '../src/interpreter/preprocess';

/**
 * The before and the after, side by side.
 *
 * The editor already marks each replacement and says what it became on hover,
 * one at a time. What that cannot show is an absence: a `#if 0` block leaves
 * nothing behind to point at, and the only way to read what a conditional
 * kept out is to see the two texts beside each other.
 */

const SOURCE = [
  '#define TWICE(x) ((x) * 2)',
  '#if 0',
  'int unused = 1;',
  '#endif',
  'int main(void) { return TWICE(3); }',
].join('\n');

describe('the preprocessed source', () => {
  it('shows what the macro became and what the conditional took out', () => {
    const after = preprocess(SOURCE);
    expect(after).toContain('((3) * 2)');
    expect(after).not.toContain('int unused = 1;');
  });

  it('opens with both halves and neither of them editable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dialog = new PreprocessedDialog(host);
    dialog.open(SOURCE, preprocess(SOURCE));

    const editors = dialog.root.querySelectorAll('.cm-content');
    expect(editors).toHaveLength(2);
    for (const editor of Array.from(editors)) {
      expect(editor.getAttribute('contenteditable')).not.toBe('true');
    }
    expect(dialog.root.textContent).toContain('TWICE');
    dialog.destroy();
    host.remove();
  });

  it('rebuilds the comparison at every opening', () => {
    // The source changes while the dialog is closed, and a merge view holding
    // a stale half is worse than none.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dialog = new PreprocessedDialog(host);
    dialog.open('int a = 1;', 'int a = 1;');
    expect(dialog.root.textContent).toContain('int a = 1;');
    dialog.close();
    dialog.open('int b = 2;', 'int b = 2;');
    expect(dialog.root.textContent).toContain('int b = 2;');
    expect(dialog.root.textContent).not.toContain('int a = 1;');
    dialog.destroy();
    host.remove();
  });
});
