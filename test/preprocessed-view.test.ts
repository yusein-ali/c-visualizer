import { PreprocessedDialog } from '../src/ui/preprocessed';
import { preprocess, preprocessFiles } from '../src/interpreter/preprocess';
import strings from '../src/strings';

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
  it('explains each omitted header at its include location, including nested headers', () => {
    const source = [
      '#include <stdio.h>',
      '#include "helpers.h"',
      '#if 0',
      '#include <math.h>',
      '#endif',
      '/*',
      '#include <string.h>',
      '*/',
      'int main(void) { return VALUE; }',
    ].join('\n');
    const files = [
      { path: 'main.c', text: source },
      {
        path: 'helpers.h',
        text: '#include "helpers.h"\n#include "stdlib.h"\n#define VALUE 3',
      },
    ];
    const after = preprocessFiles(files, 'main.c', source, (header) =>
      strings.preprocessedHeaderOmitted.replace('{header}', header)
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dialog = new PreprocessedDialog(host);
    dialog.open(source, after);

    const output = dialog.root.querySelectorAll('.cm-content')[1].textContent;
    expect(output).toContain(
      'The contents of <stdio.h> would normally be copied here by #include.'
    );
    expect(output).toContain(
      'The contents of "stdlib.h" would normally be copied here by #include.'
    );
    expect(
      after.match(/The visualizer omits them to avoid code clutter\./g)
    ).toHaveLength(2);
    expect(after.split('\n')[0]).toContain('<stdio.h>');
    expect(after.split('\n')[2]).toContain('"stdlib.h"');
    expect(after).not.toContain('The contents of "helpers.h"');
    expect(after).not.toContain('The contents of <math.h>');
    expect(after).not.toContain('The contents of <string.h>');
    expect(after).toContain('int main(void) { return 3; }');
    expect(preprocessFiles(files, 'main.c')).not.toContain('would normally');
    dialog.destroy();
    host.remove();
  });

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
