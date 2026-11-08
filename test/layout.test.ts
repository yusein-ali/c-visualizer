import { Plivet, parseConfig } from '../src/index';
import type { PlivetLayout, PlivetOptions } from '../src/index';
import { LAYOUT_HYSTERESIS, PlivetShell, STACKED_BELOW } from '../src/ui/shell';
import type { PlivetShellOptions, ShellLayout } from '../src/ui/shell';
import { ControlBar } from '../src/ui/controls';

/* The canvas needs a browser; the arrangement around it does not. */
jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    constructor(container: HTMLElement) {
      const paper = document.createElement('div');
      paper.className = 'fake-graph';
      container.appendChild(paper);
    }
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    setFocus(): void {}
    setDiagnostics(): void {}
    setDiagnosticActivity(): void {}
    setRunStatus(): void {}
    setDebugState(): void {}
    destroy(): void {}
  },
}));

/**
 * The layout against the container (H4): the shell measures its own width,
 * not the window's, and below a threshold stacks editor, console and canvas
 * into one column - by a class on the root, without moving a box.
 *
 * jsdom lays nothing out and has no `ResizeObserver`. The width the shell
 * reads is stubbed on every `.plivet` root, and the observer is a fake whose
 * callback the test calls: a "resize" is a new width and a notification.
 */

class FakeResizeObserver {
  static observers: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.observers.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  static notify(target: Element): void {
    for (const observer of FakeResizeObserver.observers) {
      if (observer.targets.has(target)) {
        observer.callback([], observer as unknown as ResizeObserver);
      }
    }
  }
}

/** The width every `.plivet` root measures. Everything else measures 0. */
let width = 0;
/** And the width the canvas mount measures, for the stacked canvas' shape. */
let canvasWidth = 0;

const rect = (size: Partial<DOMRect>): DOMRect =>
  ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: size.width ?? 0,
    bottom: size.height ?? 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...size,
  }) as DOMRect;

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A new width, the observer told, and the frame the switch waits for. */
const resizeTo = async (root: HTMLElement, to: number): Promise<void> => {
  width = to;
  FakeResizeObserver.notify(root);
  await nextFrame();
};

const parentOf = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

const openShell = (options: PlivetShellOptions = {}) => {
  const heard: ShellLayout[] = [];
  const shell = new PlivetShell(parentOf(), {
    ...options,
    onLayoutChange: (layout) => heard.push(layout),
  });
  return { shell, heard };
};

const stacked = (root: HTMLElement) =>
  root.classList.contains('plivet--stacked');

let warnings: string[] = [];

beforeAll(() => {
  // A switch waits for a frame, and so does CodeMirror's measuring, with a
  // `Range` jsdom gives no rectangles: zero of them, as `smoke.test.ts` says,
  // is the honest answer for a document that was never laid out.
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

beforeEach(() => {
  width = 0;
  canvasWidth = 0;
  warnings = [];
  FakeResizeObserver.observers = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('plivet')) {
        return rect({ width });
      }
      if (this.classList.contains('plivet__main')) {
        return rect({ width: canvasWidth, height: 300 });
      }
      return rect({});
    });
  jest.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  document.body.innerHTML = '';
});

describe('the arrangement the shell opens in', () => {
  it('is two columns with room for them, and stacked without', () => {
    width = 1000;
    const wide = openShell();
    expect(wide.shell.layout()).toBe('columns');
    expect(stacked(wide.shell.root)).toBe(false);

    width = 600;
    const narrow = openShell();
    expect(narrow.shell.layout()).toBe('stacked');
    expect(stacked(narrow.shell.root)).toBe(true);

    // Opening is not a change: neither was told of one.
    expect(wide.heard).toEqual([]);
    expect(narrow.heard).toEqual([]);
  });

  it('is decided at the threshold: below it stacks, at it does not', () => {
    width = STACKED_BELOW;
    expect(openShell().shell.layout()).toBe('columns');
    width = STACKED_BELOW - 1;
    expect(openShell().shell.layout()).toBe('stacked');
  });

  it('waits for a width when it has none to measure', async () => {
    // Not laid out - attached to a closed panel, say - is not narrow.
    width = 0;
    const { shell, heard } = openShell();
    expect(shell.layout()).toBe('columns');

    await resizeTo(shell.root, 500);
    expect(shell.layout()).toBe('stacked');
    expect(heard).toEqual(['stacked']);
  });

  it('takes a threshold of the page’s own', () => {
    width = 600;
    expect(openShell({ stackedBelow: 500 }).shell.layout()).toBe('columns');
    width = 480;
    expect(openShell({ stackedBelow: 500 }).shell.layout()).toBe('stacked');
  });
});

describe('switching as the container changes', () => {
  it('stacks when the shell narrows and comes back when it widens', async () => {
    width = 1000;
    const { shell, heard } = openShell();

    width = 600;
    FakeResizeObserver.notify(shell.root);
    // Not inside the observer's callback: stacking changes the shell's
    // height, which there would be a resize loop.
    expect(shell.layout()).toBe('columns');
    await nextFrame();
    expect(shell.layout()).toBe('stacked');
    expect(stacked(shell.root)).toBe(true);

    await resizeTo(shell.root, 1000);
    expect(shell.layout()).toBe('columns');
    expect(stacked(shell.root)).toBe(false);
    expect(heard).toEqual(['stacked', 'columns']);
  });

  it('does not flap on the threshold', async () => {
    width = 1000;
    const { shell, heard } = openShell();
    const back = STACKED_BELOW + LAYOUT_HYSTERESIS;

    await resizeTo(shell.root, STACKED_BELOW - 1);
    expect(shell.layout()).toBe('stacked');

    // Hovering around the threshold, and up to just short of the margin,
    // keeps the arrangement it has.
    for (const to of [STACKED_BELOW, STACKED_BELOW - 1, back - 1]) {
      await resizeTo(shell.root, to);
      expect(shell.layout()).toBe('stacked');
    }

    await resizeTo(shell.root, back);
    expect(shell.layout()).toBe('columns');

    // And from two columns, anything from the threshold up keeps them.
    for (const to of [back - 1, STACKED_BELOW]) {
      await resizeTo(shell.root, to);
      expect(shell.layout()).toBe('columns');
    }
    await resizeTo(shell.root, STACKED_BELOW - 1);
    expect(shell.layout()).toBe('stacked');

    expect(heard).toEqual(['stacked', 'columns', 'stacked']);
  });

  it('switches once for a burst of notifications in one frame', async () => {
    width = 1000;
    const { shell, heard } = openShell();

    width = 600;
    FakeResizeObserver.notify(shell.root);
    FakeResizeObserver.notify(shell.root);
    width = 650;
    FakeResizeObserver.notify(shell.root);
    await nextFrame();

    expect(heard).toEqual(['stacked']);
  });

  it('goes by the width it has when the frame comes', async () => {
    width = 1000;
    const { shell, heard } = openShell();

    width = 600;
    FakeResizeObserver.notify(shell.root);
    width = 1000;
    await nextFrame();

    expect(shell.layout()).toBe('columns');
    expect(heard).toEqual([]);
  });

  it('ignores a container hidden mid-session', async () => {
    width = 600;
    const { shell, heard } = openShell();

    await resizeTo(shell.root, 0);
    expect(shell.layout()).toBe('stacked');
    expect(heard).toEqual([]);
  });

  it('drops a pending switch when it is destroyed', async () => {
    width = 1000;
    const { shell, heard } = openShell();

    width = 600;
    FakeResizeObserver.notify(shell.root);
    shell.destroy();
    await nextFrame();

    expect(heard).toEqual([]);
    expect(stacked(shell.root)).toBe(false);
  });
});

describe('an arrangement the page chose', () => {
  it('stays stacked however wide the shell is', async () => {
    width = 1400;
    const { shell, heard } = openShell({ layout: 'stacked' });
    expect(shell.layout()).toBe('stacked');

    await resizeTo(shell.root, 2000);
    expect(shell.layout()).toBe('stacked');
    expect(heard).toEqual([]);
  });

  it('stays in two columns however narrow the shell is', async () => {
    width = 300;
    const { shell, heard } = openShell({ layout: 'columns' });
    expect(shell.layout()).toBe('columns');
    expect(stacked(shell.root)).toBe(false);

    await resizeTo(shell.root, 200);
    expect(shell.layout()).toBe('columns');
    expect(heard).toEqual([]);
  });
});

describe('what switching leaves alone', () => {
  it('moves no box and rebuilds nothing in one', async () => {
    width = 1000;
    const { shell } = openShell();
    const editor = document.createElement('div');
    editor.className = 'fake-editor';
    shell.editor.appendChild(editor);
    const console = document.createElement('pre');
    shell.debugger.appendChild(console);
    const canvas = document.createElement('svg');
    shell.main.appendChild(canvas);
    const order = Array.from(shell.root.querySelectorAll('*'));

    const mutations = new MutationObserver(() => undefined);
    mutations.observe(shell.root, { childList: true, subtree: true });

    await resizeTo(shell.root, 600);
    expect(shell.layout()).toBe('stacked');
    await resizeTo(shell.root, 1000);
    expect(shell.layout()).toBe('columns');

    // Not one node was added, removed or moved anywhere under the root:
    // a node taken out of the document and put back loses its scroll
    // position, and a rebuilt editor its folds and its session.
    expect(mutations.takeRecords()).toEqual([]);
    mutations.disconnect();
    expect(shell.editor.firstChild).toBe(editor);
    expect(shell.debugger.firstChild).toBe(console);
    expect(shell.main.firstChild).toBe(canvas);
    expect(Array.from(shell.root.querySelectorAll('*'))).toEqual(order);
  });

  it('keeps the editor column a drag asked for, for two columns again', async () => {
    width = 1000;
    const { shell } = openShell();
    shell.setSideWidth(420);

    await resizeTo(shell.root, 600);
    expect(shell.root.style.getPropertyValue('--plivet-side-width')).not.toBe(
      ''
    );
    await resizeTo(shell.root, 1000);
    expect(shell.root.style.getPropertyValue('--plivet-side-width')).toBe(
      '420px'
    );
  });
});

describe('the stacked canvas', () => {
  const canvasHandle = (root: HTMLElement) =>
    root.querySelector('.plivet__column .plivet__splitter--y') as HTMLElement;

  const drag = (handle: HTMLElement, from: number, to: number): void => {
    for (const [type, clientY] of [
      ['pointerdown', from],
      ['pointermove', to],
      ['pointerup', to],
    ] as const) {
      handle.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY }));
    }
  };

  it('is resized to a shape, and each arrangement keeps its own', async () => {
    width = 1000;
    const { shell } = openShell();
    shell.setCanvasHeight(500);

    await resizeTo(shell.root, 600);
    canvasWidth = 590;
    // The mount measures 300 tall; the drag pulls it down by 160.
    drag(canvasHandle(shell.root), 300, 460);
    expect(shell.root.style.getPropertyValue('--plivet-canvas-ratio')).toBe(
      '590 / 460'
    );
    expect(shell.root.style.getPropertyValue('--plivet-graph-height')).toBe(
      '500px'
    );

    // A double-click hands back the stacked default and nothing else.
    canvasHandle(shell.root).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true })
    );
    expect(shell.root.style.getPropertyValue('--plivet-canvas-ratio')).toBe('');
    expect(shell.root.style.getPropertyValue('--plivet-graph-height')).toBe(
      '500px'
    );
  });

  it('is not dragged shut', async () => {
    width = 600;
    canvasWidth = 590;
    const { shell } = openShell();

    drag(canvasHandle(shell.root), 300, 10);
    expect(shell.root.style.getPropertyValue('--plivet-canvas-ratio')).toBe(
      '590 / 200'
    );
  });

  it('goes back to the stylesheet with the rest of the layout', () => {
    width = 600;
    canvasWidth = 590;
    const { shell } = openShell();
    shell.setCanvasHeight(400);
    expect(shell.root.style.getPropertyValue('--plivet-canvas-ratio')).toBe(
      '590 / 400'
    );

    shell.resetLayout();
    expect(shell.root.style.getPropertyValue('--plivet-canvas-ratio')).toBe('');
  });
});

describe('the floating debug toolbar after a switch', () => {
  const mountBar = () => {
    const parent = parentOf();
    const bar = new ControlBar(parent, {});
    const toolbar = parent.querySelector(
      '.plivet-controls__group--debug'
    ) as HTMLElement;
    const grip = parent.querySelector('.plivet-controls__drag') as HTMLElement;
    return { bar, toolbar, grip };
  };

  const move = (grip: HTMLElement, key: string) =>
    grip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('goes back over the editor and is fixed there anew', () => {
    const { bar, toolbar, grip } = mountBar();
    let left = 180;
    toolbar.getBoundingClientRect = () =>
      rect({ left, top: 60, width: 240, height: 36 });
    bar.setDebugState('Debugging');
    move(grip, 'ArrowRight');
    expect(toolbar.style.getPropertyValue('--plivet-debug-x')).not.toBe('');

    // Stacked, the editor is the whole width and the toolbar centred over it.
    left = 300;
    bar.relayout();
    expect(
      toolbar.classList.contains('plivet-controls__group--debug-active')
    ).toBe(true);
    expect(toolbar.style.getPropertyValue('--plivet-debug-x')).toBe('');
    expect(toolbar.style.getPropertyValue('--plivet-debug-fixed-left')).toBe(
      '300px'
    );
  });

  it('only forgets the drag when no session holds it', () => {
    const { bar, toolbar, grip } = mountBar();
    move(grip, 'ArrowDown');
    expect(toolbar.style.getPropertyValue('--plivet-debug-y')).not.toBe('');

    bar.relayout();
    expect(toolbar.style.getPropertyValue('--plivet-debug-y')).toBe('');
    expect(
      toolbar.classList.contains('plivet-controls__group--debug-active')
    ).toBe(false);
  });
});

describe('the layout of a whole instance', () => {
  const open = (options: PlivetOptions = {}) => {
    const parent = parentOf();
    return { parent, plivet: new Plivet(parent, options) };
  };

  it('reports the arrangement and every change to it', async () => {
    width = 1000;
    const { parent, plivet } = open();
    const root = parent.querySelector('.plivet') as HTMLElement;
    const editor = parent.querySelector('.cm-editor');
    const graph = parent.querySelector('.fake-graph');
    expect(editor).not.toBeNull();
    expect(plivet.getLayout()).toBe('columns');

    const heard: PlivetLayout[] = [];
    const stop = plivet.onLayoutChange((layout) => heard.push(layout));
    await resizeTo(root, 600);
    expect(plivet.getLayout()).toBe('stacked');
    expect(root.classList.contains('plivet--stacked')).toBe(true);
    // The same editor and canvas, not new ones.
    expect(parent.querySelector('.cm-editor')).toBe(editor);
    expect(parent.querySelector('.fake-graph')).toBe(graph);

    stop();
    await resizeTo(root, 1000);
    expect(plivet.getLayout()).toBe('columns');
    expect(heard).toEqual(['stacked']);
    plivet.destroy();
  });

  it('takes the arrangement and the threshold a host asks for', async () => {
    width = 600;
    const forced = open({ layout: 'columns' });
    expect(forced.plivet.getLayout()).toBe('columns');
    forced.plivet.destroy();

    const lowered = open({ stackedBelow: 480 });
    expect(lowered.plivet.getLayout()).toBe('columns');
    lowered.plivet.destroy();

    width = 1400;
    const narrowOnly = open({ layout: 'stacked' });
    expect(narrowOnly.plivet.getLayout()).toBe('stacked');
    narrowOnly.plivet.destroy();
    expect(warnings).toEqual([]);
  });

  it('drops what is not a layout, with a warning, and goes by the width', () => {
    width = 600;
    const { plivet } = open({
      layout: 'rows' as unknown as 'auto',
      stackedBelow: -5,
    });
    expect(plivet.getLayout()).toBe('stacked');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('layout');
    expect(warnings[1]).toContain('stackedBelow');
    plivet.destroy();
  });

  it('puts the debug toolbar back when the arrangement changes', async () => {
    width = 1000;
    const relayout = jest.spyOn(ControlBar.prototype, 'relayout');
    const { parent, plivet } = open();
    const root = parent.querySelector('.plivet') as HTMLElement;

    await resizeTo(root, 600);
    expect(relayout).toHaveBeenCalledTimes(1);
    plivet.destroy();
  });
});

describe('the layout keys of a configuration', () => {
  it('reads the arrangement and the threshold', () => {
    expect(parseConfig('{"layout": "stacked", "stackedBelow": 600}')).toEqual({
      layout: 'stacked',
      stackedBelow: 600,
    });
    expect(parseConfig('{"layout": "auto", "stackedBelow": 0}')).toEqual({
      layout: 'auto',
      stackedBelow: 0,
    });
    expect(parseConfig('{"layout": "columns"}')).toEqual({
      layout: 'columns',
    });
    expect(warnings).toEqual([]);
  });

  it('drops a value that is not one, and keeps the rest', () => {
    expect(
      parseConfig('{"layout": "rows", "stackedBelow": "600", "footer": false}')
    ).toEqual({ footer: false });
    expect(parseConfig('{"layout": 2, "stackedBelow": -1}')).toEqual({});
    expect(warnings).toHaveLength(4);
    expect(warnings.filter((w) => w.includes('layout'))).toHaveLength(2);
    expect(warnings.filter((w) => w.includes('stackedBelow'))).toHaveLength(2);
  });
});
