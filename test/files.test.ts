import { FilePanel } from '../src/ui/files';
import strings from '../src/strings';

const parentOf = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the upload panel', () => {
  // jsdom has no TextEncoder, and the panel never reads the bytes: what it
  // holds is whatever the interpreter client read the file into.
  const bytes = (length: number) => new ArrayBuffer(length);

  it('starts collapsed unless requested open', () => {
    const parent = parentOf();
    const collapsed = new FilePanel(parent);
    const expanded = new FilePanel(parent, { open: true });

    expect(collapsed.root.open).toBe(false);
    expect(expanded.root.open).toBe(true);
  });

  it('says where uploads will appear before there are any', () => {
    const parent = parentOf();
    new FilePanel(parent);
    const items = parent.querySelectorAll('.plivet-files__item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe(strings.uploadFile);
  });

  it('lists what has been uploaded, in the order the client holds it', () => {
    const parent = parentOf();
    const panel = new FilePanel(parent);

    panel.setFiles(
      new Map([
        ['first.txt', bytes(3)],
        ['second.txt', bytes(3)],
      ])
    );

    const names = Array.from(
      parent.querySelectorAll('.plivet-files__name')
    ).map((node) => node.textContent);
    expect(names).toEqual(['first.txt', 'second.txt']);
  });

  it('names both buttons after the file they act on', () => {
    const parent = parentOf();
    const panel = new FilePanel(parent);
    panel.setFiles(new Map([['data.bin', bytes(1)]]));

    const labels = Array.from(
      parent.querySelectorAll('.plivet-files__button')
    ).map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual([
      `${strings.downloadFile} data.bin`,
      `${strings.removeFile} data.bin`,
    ]);
  });

  it('reports which file the user asked to remove', () => {
    const parent = parentOf();
    const removed: string[] = [];
    const panel = new FilePanel(parent, {
      onDelete: (filename) => removed.push(filename),
    });
    panel.setFiles(
      new Map([
        ['first.txt', bytes(3)],
        ['second.txt', bytes(3)],
      ])
    );

    const buttons = parent.querySelectorAll<HTMLButtonElement>(
      '.plivet-files__button'
    );
    // Two buttons per row: download, then remove.
    buttons[3].click();
    expect(removed).toEqual(['second.txt']);
  });

  it('forgets the selection so the same file can be uploaded twice', () => {
    const parent = parentOf();
    const panel = new FilePanel(parent);
    const input = parent.querySelector('input') as HTMLInputElement;
    panel.clearSelection();
    expect(input.value).toBe('');
  });

  it('expands to reveal a file created by the program', () => {
    const panel = new FilePanel(parentOf());
    expect(panel.root.open).toBe(false);

    panel.setFiles(new Map([['result.txt', bytes(2)]]));
    panel.expand();

    expect(panel.root.open).toBe(true);
  });
});
