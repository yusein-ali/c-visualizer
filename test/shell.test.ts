import { PlivetShell } from '../src/ui/shell';
import { HowToDialog } from '../src/ui/help';
import strings from '../src/strings';

const parentOf = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

/**
 * jsdom lays nothing out, so every box measures zero. A splitter starts from
 * the size the box has now, which is the one thing the drag needs to be told.
 */
const measures = (element: Element, size: Partial<DOMRect>): void => {
  element.getBoundingClientRect = () =>
    ({ width: 0, height: 0, ...size }) as DOMRect;
};

// jsdom has no `PointerEvent`; a `MouseEvent` under the pointer event's name
// carries the coordinates the handle reads, which is all it reads.
const pointer = (
  element: Element,
  type: string,
  at: { clientX?: number; clientY?: number }
): void => {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, ...at }));
};

const drag = (
  element: Element,
  axis: 'clientX' | 'clientY',
  from: number,
  to: number
): void => {
  pointer(element, 'pointerdown', { [axis]: from });
  pointer(element, 'pointermove', { [axis]: to });
  pointer(element, 'pointerup', { [axis]: to });
};

const handlesOf = (parent: HTMLElement) => ({
  columns: parent.querySelector('.plivet__splitter--x') as HTMLElement,
  editor: parent.querySelector(
    '.plivet__side .plivet__splitter--y'
  ) as HTMLElement,
  canvas: parent.querySelector(
    '.plivet__column .plivet__splitter--y'
  ) as HTMLElement,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the shell', () => {
  it('hands out one mount point per widget', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent, { version: '1.0.0', fromYear: 2018 });

    for (const mount of [
      shell.controls,
      shell.editor,
      shell.console,
      shell.files,
      shell.main,
    ]) {
      expect(shell.root.contains(mount)).toBe(true);
    }
  });

  it('carries the theme on the root, where the widgets inherit it', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);

    expect(shell.root.classList.contains('plivet--dark')).toBe(false);
    shell.setDark(true);
    expect(shell.root.classList.contains('plivet--dark')).toBe(true);
  });

  it('dates the copyright from the year given to the year it is', () => {
    const parent = parentOf();
    new PlivetShell(parent, { version: '1.0.0', fromYear: 2018 });
    const thisYear = new Date().getFullYear();

    const footer = parent.querySelector('.plivet__footer') as HTMLElement;
    expect(footer.textContent).toContain('c-visualizer v1.0.0');
    expect(footer.textContent).toContain(`2018 - ${thisYear}`);
  });
});

describe('the instructions', () => {
  it('shows every section and instruction as text', () => {
    const parent = parentOf();
    const dialog = new HowToDialog(parent);
    dialog.open();

    const intro = dialog.root.querySelector('.plivet-help__intro');
    const headings = dialog.root.querySelectorAll('.plivet-help__body h3');
    const items = dialog.root.querySelectorAll('.plivet-help__body li');
    expect(intro?.textContent).toBe(strings.howToIntro);
    expect(headings).toHaveLength(strings.howToSections.length);
    expect(items).toHaveLength(
      strings.howToSections.flatMap((section) => section.items).length
    );
    expect(headings[0].textContent).toBe(strings.howToSections[0].title);
    expect(items[0].textContent).toBe(strings.howToSections[0].items[0]);
  });

  it('closes from the button', () => {
    const parent = parentOf();
    const dialog = new HowToDialog(parent);
    dialog.open();
    expect(dialog.root.hasAttribute('open')).toBe(true);

    const close = dialog.root.querySelector(
      '.plivet-help__close'
    ) as HTMLButtonElement;
    close.click();
    expect(dialog.root.hasAttribute('open')).toBe(false);
  });
});

describe('the handles between the boxes', () => {
  it('moves the boundary the drag moved, and no further', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.root, { width: 1000 });
    measures(parent.querySelector('.plivet__side') as Element, { width: 300 });

    drag(handlesOf(parent).columns, 'clientX', 300, 420);

    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '420px'
    );
  });

  it('leaves the canvas a column to be drawn in', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.root, { width: 1000 });
    measures(parent.querySelector('.plivet__side') as Element, { width: 300 });

    drag(handlesOf(parent).columns, 'clientX', 300, 1400);

    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '720px'
    );
  });

  it('gives the editor the height it was dragged to', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.editor, { height: 400 });

    drag(handlesOf(parent).editor, 'clientY', 400, 530);

    expect(shell.root.style.getPropertyValue('--plivet-editor-height')).toBe(
      '530px'
    );
  });

  it('will not let a box be dragged shut', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.main, { height: 700 });

    drag(handlesOf(parent).canvas, 'clientY', 700, 20);

    expect(shell.root.style.getPropertyValue('--plivet-graph-height')).toBe(
      '200px'
    );
  });

  it('ignores a pointer that never went down on it', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.editor, { height: 400 });

    pointer(handlesOf(parent).editor, 'pointermove', { clientY: 900 });

    expect(shell.root.style.getPropertyValue('--plivet-editor-height')).toBe(
      ''
    );
  });

  it('moves a step at a time from the keyboard', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.root, { width: 1000 });
    measures(parent.querySelector('.plivet__side') as Element, { width: 300 });
    const columns = handlesOf(parent).columns;

    columns.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );

    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '324px'
    );
  });

  it('hands one box back on Enter and all of them on request', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    shell.setSideWidth(400);
    shell.setEditorHeight(300);
    shell.setCanvasHeight(500);
    const handles = handlesOf(parent);

    handles.editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(shell.root.style.getPropertyValue('--plivet-editor-height')).toBe(
      ''
    );

    handles.canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(shell.root.style.getPropertyValue('--plivet-graph-height')).toBe('');

    shell.resetLayout();
    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe('');
  });

  it('keeps the width that was asked for when the window squeezes it', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);
    measures(shell.root, { width: 1400 });
    shell.setSideWidth(900);
    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '900px'
    );

    // The window narrows: the canvas keeps its floor, and the column gives.
    measures(shell.root, { width: 800 });
    shell.setSideWidth(900);
    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '520px'
    );

    // And widens again: what comes back is what was asked for, not what the
    // narrow window clamped it to.
    measures(shell.root, { width: 1400 });
    shell.setSideWidth(900);
    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '900px'
    );
  });

  it('is a separator the keyboard can reach and a reader can name', () => {
    const parent = parentOf();
    new PlivetShell(parent);
    const handles = handlesOf(parent);

    expect(handles.columns.getAttribute('role')).toBe('separator');
    expect(handles.columns.getAttribute('aria-orientation')).toBe('vertical');
    expect(handles.editor.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handles.editor.getAttribute('aria-label')).toBe(
      strings.resizeEditor
    );
    expect(handles.canvas.tabIndex).toBe(0);
  });
});
