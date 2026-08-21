import { ControlBar } from '../src/ui/controls';
import { download } from '../src/ui/files';
import strings from '../src/strings';

/**
 * Opening a program, and writing one out.
 *
 * The picker is the browser's own and cannot be opened without an input, so
 * the bar keeps one and puts a button of its own shape in front of it. What
 * is checked here is the two things that are the widget's: that choosing a
 * file reports it once and clears the input, and that a save hands the
 * browser a file with the text in it.
 */

const mounted = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return { host };
};

/* The two are pictures now, so what names them is the accessible name. */
const buttonNamed = (root: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(root.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === text
  )!;

describe('opening a program', () => {
  it('reports the file the picker came back with', () => {
    const { host } = mounted();
    const opened: File[] = [];
    const bar = new ControlBar(host, {
      onOpenFile: (file) => opened.push(file),
    });
    const input = bar.root.querySelector<HTMLInputElement>(
      '.plivet-controls__file'
    )!;

    const file = new File(['int main(){}'], 'exercise.c', {
      type: 'text/plain',
    });
    Object.defineProperty(input, 'files', { value: [file], writable: true });
    input.dispatchEvent(new Event('change'));

    expect(opened).toHaveLength(1);
    expect(opened[0].name).toBe('exercise.c');
    // Cleared, so choosing the same file again still raises a change.
    expect(input.value).toBe('');
    bar.destroy();
    host.remove();
  });

  it('opens the picker from a button of the bar’s own shape', () => {
    const { host } = mounted();
    const bar = new ControlBar(host, {});
    const input = bar.root.querySelector<HTMLInputElement>(
      '.plivet-controls__file'
    )!;
    let clicked = 0;
    input.click = () => {
      clicked += 1;
    };
    buttonNamed(bar.root, strings.openCode).click();
    expect(clicked).toBe(1);
    bar.destroy();
    host.remove();
  });

  it('says nothing when the picker was dismissed', () => {
    const { host } = mounted();
    const opened: File[] = [];
    const bar = new ControlBar(host, {
      onOpenFile: (file) => opened.push(file),
    });
    const input = bar.root.querySelector<HTMLInputElement>(
      '.plivet-controls__file'
    )!;
    Object.defineProperty(input, 'files', { value: [], writable: true });
    input.dispatchEvent(new Event('change'));
    expect(opened).toEqual([]);
    bar.destroy();
    host.remove();
  });
});

describe('saving a program', () => {
  it('asks for a save when the button is pressed', () => {
    const { host } = mounted();
    let asked = 0;
    const bar = new ControlBar(host, { onSaveCode: () => (asked += 1) });
    buttonNamed(bar.root, strings.saveCode).click();
    expect(asked).toBe(1);
    bar.destroy();
    host.remove();
  });

  it('hands the browser a named file with the program in it', () => {
    const created: string[] = [];
    const original = URL.createObjectURL;
    (URL as any).createObjectURL = (blob: Blob) => {
      created.push(blob.type);
      return 'blob:test';
    };
    const clicks: HTMLAnchorElement[] = [];
    const anchor = document.createElement('a');
    const create = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        anchor.click = () => clicks.push(anchor);
        return anchor;
      }
      return create(tag);
    });

    download('program.c', 'int main(){}', 'text/x-csrc');

    expect(anchor.download).toBe('program.c');
    expect(created).toEqual(['text/x-csrc']);
    expect(clicks).toHaveLength(1);
    (document.createElement as jest.Mock).mockRestore();
    (URL as any).createObjectURL = original;
  });
});

describe('the file buttons', () => {
  it('are pictures that keep a name and say what they do', () => {
    const { host } = mounted();
    const bar = new ControlBar(host, {});
    const buttons = Array.from(
      bar.root.querySelectorAll<HTMLButtonElement>(
        '.plivet-controls__group--files .plivet-controls__button'
      )
    );

    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      strings.openCode,
      strings.saveCode,
    ]);
    // The tooltip is the sentence, for a reader the picture did not reach.
    expect(buttons[0].title).toContain(strings.openCodeHint);
    expect(buttons[1].title).toContain(strings.saveCodeHint);
    // Nothing is spelled out: the label would be back to taking the room.
    expect(buttons.map((button) => button.textContent)).toEqual(['', '']);
    for (const button of buttons) {
      const icon = button.querySelector('svg')!;
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    bar.destroy();
    host.remove();
  });
});
