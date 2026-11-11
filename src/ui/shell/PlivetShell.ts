import strings from '../../strings';
import { Splitter } from './Splitter';
import './shell.css';

/**
 * The frame the application hangs in: two columns, a footer, and six boxes
 * for the widgets to mount into.
 *
 * It was `App`, `EditorSide`, `Menu` and `Footer` - four React class
 * components whose whole content was a Bootstrap `Grid`/`Row`/`Col` tree and
 * a copyright line. None of that needed a framework: the layout is static
 * markup and a CSS grid, and the only thing that ever changed at runtime was
 * the theme class.
 *
 * What does change at runtime now is the size of the three boxes a reader
 * spends the session looking at - the editor, the two columns and the canvas.
 * Each boundary carries a `Splitter`, and what a drag produces is a length on
 * a custom property of the root. The stylesheet still holds the proportions
 * the layout opens with, as the fallback of each `var()`, so a shell nobody
 * has dragged is the shell as it always was, and Enter or a double-click on a
 * handle puts it back.
 *
 * How the boxes are arranged is decided against the shell's own width, not
 * the window's: a course chapter's column on a wide screen is as narrow as a
 * phone. Below `stackedBelow` the two columns become one - editor, console,
 * canvas - by a class on the root and nothing else. No box is moved, so
 * nothing in one loses what it holds: the editor keeps its scroll position
 * and its folds, the canvas its drawing, and a debug session goes on.
 *
 * Like every other module under `src/ui/`, it knows nothing about the
 * interpreter or the event bus. It hands out the mount points and lets the
 * caller decide what goes in them.
 */

/** How the boxes are arranged: side by side, or one above the other. */
export type ShellLayout = 'columns' | 'stacked';

/**
 * What a page asks for: one arrangement whatever the room, or `auto` -
 * whichever the width the shell is given suits.
 */
export type ShellLayoutMode = 'auto' | ShellLayout;

export interface PlivetShellOptions {
  /** Shown in the footer. The application reads it from `package.json`. */
  version?: string;
  /** The first year in the copyright range. */
  fromYear?: number;
  dark?: boolean;
  /**
   * Where the third-party licence report is, if it is not next to the page.
   * The deployed bundle ships it beside itself rather than beside its host, so
   * the embed entry passes the address it was served from. Default: the
   * standalone page's own copy.
   */
  licenses?: string;
  /**
   * Whether the column keeps a box for the upload panel. A page whose programs
   * read no files has no use for the box, and the editor and console take the
   * room back. Default: it is there.
   */
  files?: boolean;
  /** Whether to append the copyright and licence footer. Default: true. */
  footer?: boolean;
  /**
   * Side by side, one above the other, or - `auto` - stacked whenever the
   * shell is narrower than `stackedBelow`. Default: `auto`.
   */
  layout?: ShellLayoutMode;
  /**
   * The width, in pixels, below which `auto` stacks the boxes. Default:
   * `STACKED_BELOW`. Going back to two columns takes `LAYOUT_HYSTERESIS`
   * more, so a width that sits on the threshold does not flap between them.
   */
  stackedBelow?: number;
  /**
   * Called after the arrangement has changed, with the one it changed to -
   * never for the one the shell opens with, which `layout()` reports.
   */
  onLayoutChange?: (layout: ShellLayout) => void;
}

/** Below this many pixels of its own width, `auto` stacks the shell. */
export const STACKED_BELOW = 720;

/**
 * How much wider than the threshold a stacked shell must grow before it goes
 * back to two columns. A layout change can itself move the width a little -
 * a page that grows a scrollbar, a container sized by its content - and
 * without the margin a width at the threshold would switch on every frame.
 */
export const LAYOUT_HYSTERESIS = 48;

const REPOSITORY = 'https://github.com/yusein-ali/c-visualizer';
const UPSTREAM = 'https://github.com/RYOSKATE/PLIVET';
const LICENSES = './licenses.html';

/**
 * How small a drag may make each box. The two columns are bounded against
 * each other: the editor cannot be widened until the canvas has gone, and the
 * canvas cannot be widened until the editor has.
 */
const MIN_SIDE = 220;
const MIN_MAIN = 280;
const MIN_EDITOR = 120;
const MIN_CANVAS = 200;

const SIDE_WIDTH = '--plivet-side-width';
const EDITOR_HEIGHT = '--plivet-editor-height';
const CANVAS_HEIGHT = '--plivet-graph-height';
/** The stacked canvas' shape, width over height, as `aspect-ratio` reads it. */
const CANVAS_RATIO = '--plivet-canvas-ratio';
const STACKED = 'plivet--stacked';

const copyrightYears = (fromYear: number | undefined): string => {
  const thisYear = new Date().getFullYear();
  if (fromYear === undefined || fromYear === thisYear) {
    return `${thisYear}`;
  }
  return `${fromYear} - ${thisYear}`;
};

export class PlivetShell {
  readonly root: HTMLDivElement;
  /** Where the utility controls and floating debug toolbar go. */
  readonly controls: HTMLDivElement;
  /** The task the host describes, between the controls and the editor. */
  readonly description: HTMLDivElement;
  /** The program's arguments, between the task and the editor. */
  readonly args: HTMLDivElement;
  readonly editor: HTMLDivElement;
  readonly files: HTMLDivElement;
  /** The right-hand column: the visualization. */
  readonly main: HTMLDivElement;
  /** The Console/Breakpoints dock below the editor. */
  readonly debugger: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly splitters: Splitter[];
  private readonly observer: ResizeObserver | null;
  /** The width the last drag asked for, before any clamping. */
  private wanted: number | null = null;
  private readonly mode: ShellLayoutMode;
  private readonly stackedBelow: number;
  private readonly onLayoutChange?: (layout: ShellLayout) => void;
  private arrangement: ShellLayout = 'columns';
  /** The frame a layout change is waiting for, if one is. */
  private frame: number | null = null;

  constructor(parent: HTMLElement, options: PlivetShellOptions = {}) {
    this.mode = options.layout ?? 'auto';
    this.stackedBelow = options.stackedBelow ?? STACKED_BELOW;
    this.onLayoutChange = options.onLayoutChange;
    this.root = document.createElement('div');
    this.root.className = 'plivet';

    this.side = document.createElement('div');
    this.side.className = 'plivet__side';

    this.controls = document.createElement('div');
    this.controls.className = 'plivet__controls';
    this.description = document.createElement('div');
    this.description.className = 'plivet__description';
    this.args = document.createElement('div');
    this.args.className = 'plivet__args';
    this.editor = document.createElement('div');
    this.editor.className = 'plivet__editor';
    this.debugger = document.createElement('div');
    this.debugger.className = 'plivet__debugger';
    this.files = document.createElement('div');
    this.files.className = 'plivet__files';

    const editorSplit = new Splitter({
      axis: 'y',
      label: strings.resizeEditor,
      size: () => this.editor.getBoundingClientRect().height,
      resize: (height) => this.setEditorHeight(height),
      reset: () => this.root.style.removeProperty(EDITOR_HEIGHT),
    });
    this.side.append(
      this.controls,
      this.description,
      this.args,
      this.editor,
      editorSplit.element,
      this.debugger,
      ...(options.files === false ? [] : [this.files])
    );

    const columnSplit = new Splitter({
      axis: 'x',
      label: strings.resizeColumns,
      size: () => this.side.getBoundingClientRect().width,
      resize: (width) => this.setSideWidth(width),
      reset: () => this.clearSideWidth(),
    });

    this.main = document.createElement('div');
    this.main.className = 'plivet__main';
    const canvasSplit = new Splitter({
      axis: 'y',
      label: strings.resizeCanvas,
      size: () => this.main.getBoundingClientRect().height,
      resize: (height) => this.setCanvasHeight(height),
      reset: () => this.resetCanvas(),
    });
    const column = document.createElement('div');
    column.className = 'plivet__column';
    // Statement, call stack, memory and history now share the graph mount;
    // the handle changes the height of that one visualization workspace.
    column.append(this.main, canvasSplit.element);

    this.splitters = [editorSplit, columnSplit, canvasSplit];
    this.root.append(
      this.side,
      columnSplit.element,
      column,
      ...(options.footer === false ? [] : [this.footer(options)])
    );
    parent.appendChild(this.root);

    // The first arrangement is decided now, before any widget is mounted,
    // so that nothing is drawn in the wrong one first.
    this.arrangement = this.layoutFor(this.width());
    this.root.classList.toggle(STACKED, this.arrangement === 'stacked');

    // A width dragged at one window size is still a width at the next one, and
    // a canvas the window has squeezed out is not what the reader asked for.
    // What a drag stores is a preference; what the shell draws is that
    // preference clamped to the room there is now. And the room there is now
    // is also what decides whether there is room for two columns at all.
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(this.resized);
    if (this.observer !== null) {
      this.observer.observe(this.root);
    }

    this.setDark(options.dark === true);
  }

  /** How the boxes are arranged now. */
  layout(): ShellLayout {
    return this.arrangement;
  }

  setDark(dark: boolean): void {
    this.root.classList.toggle('plivet--dark', dark);
  }

  /** How wide the editor column is drawn. The canvas takes what is left. */
  setSideWidth(width: number): void {
    this.wanted = width;
    this.applySideWidth();
  }

  /** How tall the code editor is drawn, above the console. */
  setEditorHeight(height: number): void {
    this.root.style.setProperty(
      EDITOR_HEIGHT,
      `${Math.round(Math.max(height, MIN_EDITOR))}px`
    );
  }

  /**
   * How tall the visualization is drawn. It is a window onto the drawing
   * rather than the drawing itself: the canvas scrolls whatever does not fit.
   *
   * Stacked, the canvas has a shape rather than a height - its width is the
   * shell's, and changes with it - so what is stored is the shape this height
   * gives it at the width it has now. Each arrangement keeps its own: going
   * back to two columns gives back the height the canvas had there.
   */
  setCanvasHeight(height: number): void {
    const tall = Math.round(Math.max(height, MIN_CANVAS));
    const wide = Math.round(this.main.getBoundingClientRect().width);
    if (this.arrangement === 'stacked' && wide > 0) {
      this.root.style.setProperty(CANVAS_RATIO, `${wide} / ${tall}`);
      return;
    }
    this.root.style.setProperty(CANVAS_HEIGHT, `${tall}px`);
  }

  /** Back to the proportions the stylesheet opens with. */
  resetLayout(): void {
    this.clearSideWidth();
    for (const property of [EDITOR_HEIGHT, CANVAS_HEIGHT, CANVAS_RATIO]) {
      this.root.style.removeProperty(property);
    }
  }

  destroy(): void {
    if (this.observer !== null) {
      this.observer.disconnect();
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    for (const splitter of this.splitters) {
      splitter.destroy();
    }
    this.root.remove();
  }

  /**
   * The width that was asked for, against the width there is. What is stored
   * is the request rather than what was drawn from it, so a window that
   * narrows and widens again gives the column back rather than keeping the
   * squeezed width it was clamped to on the way past.
   */
  private applySideWidth(): void {
    if (this.wanted === null) {
      return;
    }
    const total = this.root.getBoundingClientRect().width;
    const most = Math.max(
      MIN_SIDE,
      total === 0 ? this.wanted : total - MIN_MAIN
    );
    this.root.style.setProperty(
      SIDE_WIDTH,
      `${Math.round(Math.min(Math.max(this.wanted, MIN_SIDE), most))}px`
    );
  }

  private clearSideWidth(): void {
    this.wanted = null;
    this.root.style.removeProperty(SIDE_WIDTH);
  }

  /** The canvas handle's reset: the default of the arrangement it is in. */
  private resetCanvas(): void {
    this.root.style.removeProperty(
      this.arrangement === 'stacked' ? CANVAS_RATIO : CANVAS_HEIGHT
    );
  }

  /** The shell's own width: the room its container gives it. */
  private width(): number {
    return this.root.getBoundingClientRect().width;
  }

  /**
   * The arrangement a width calls for. Narrower than the threshold is
   * stacked; back to columns takes the threshold and the margin, so a shell
   * that stacked at 719 pixels stays stacked until it has 768.
   */
  private layoutFor(width: number): ShellLayout {
    if (this.mode !== 'auto') {
      return this.mode;
    }
    // A shell that is not laid out - not yet attached, or inside a closed
    // panel - measures nothing, and nothing is not narrow: it keeps what it
    // has until it is shown and measured.
    if (width <= 0) {
      return this.arrangement;
    }
    const threshold =
      this.arrangement === 'stacked'
        ? this.stackedBelow + LAYOUT_HYSTERESIS
        : this.stackedBelow;
    return width < threshold ? 'stacked' : 'columns';
  }

  private readonly resized = (): void => {
    this.applySideWidth();
    if (this.layoutFor(this.width()) !== this.arrangement) {
      this.scheduleLayout();
    }
  };

  /**
   * Change the arrangement on the next frame rather than in the observer's
   * callback. Stacking changes the shell's height, and a size change to an
   * observed box made inside its own callback is the loop `ResizeObserver`
   * reports as an error - on the window, where a host page's error handler
   * and the development server's overlay both see it. One frame later it is
   * an ordinary resize, which the observer answers with the arrangement it
   * has just been given.
   */
  private scheduleLayout(): void {
    if (this.frame !== null) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.applyLayout(this.layoutFor(this.width()));
    });
  }

  private applyLayout(layout: ShellLayout): void {
    if (layout === this.arrangement) {
      return;
    }
    this.arrangement = layout;
    this.root.classList.toggle(STACKED, layout === 'stacked');
    this.onLayoutChange?.(layout);
  }

  private footer(options: PlivetShellOptions): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'plivet__footer';

    const version = options.version === undefined ? '' : ` v${options.version}`;
    const copyright = document.createElement('span');
    copyright.textContent = `c-visualizer${version} © ${copyrightYears(options.fromYear)} Yusein R. Ali`;

    const links = document.createElement('span');
    links.append(
      this.link(REPOSITORY, 'GitHub'),
      document.createTextNode(' '),
      this.link(UPSTREAM, 'PLIVET upstream'),
      document.createTextNode(' '),
      this.link(options.licenses ?? LICENSES, 'LICENSES')
    );

    footer.append(copyright, document.createElement('br'), links);
    return footer;
  }

  private link(href: string, text: string): HTMLAnchorElement {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    return anchor;
  }
}
