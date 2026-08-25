import strings from '../../strings';
import { Splitter } from './Splitter';
import './shell.css';

/**
 * The frame the application hangs in: two columns, a footer, and five boxes
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
 * Like every other module under `src/ui/`, it knows nothing about the
 * interpreter or the event bus. It hands out the mount points and lets the
 * caller decide what goes in them.
 */

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
}

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

  constructor(parent: HTMLElement, options: PlivetShellOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'plivet';

    this.side = document.createElement('div');
    this.side.className = 'plivet__side';

    this.controls = document.createElement('div');
    this.controls.className = 'plivet__controls';
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
      reset: () => this.root.style.removeProperty(CANVAS_HEIGHT),
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

    // A width dragged at one window size is still a width at the next one, and
    // a canvas the window has squeezed out is not what the reader asked for.
    // What a drag stores is a preference; what the shell draws is that
    // preference clamped to the room there is now.
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.applySideWidth());
    if (this.observer !== null) {
      this.observer.observe(this.root);
    }

    this.setDark(options.dark === true);
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
   */
  setCanvasHeight(height: number): void {
    this.root.style.setProperty(
      CANVAS_HEIGHT,
      `${Math.round(Math.max(height, MIN_CANVAS))}px`
    );
  }

  /** Back to the proportions the stylesheet opens with. */
  resetLayout(): void {
    this.clearSideWidth();
    for (const property of [EDITOR_HEIGHT, CANVAS_HEIGHT]) {
      this.root.style.removeProperty(property);
    }
  }

  destroy(): void {
    if (this.observer !== null) {
      this.observer.disconnect();
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
