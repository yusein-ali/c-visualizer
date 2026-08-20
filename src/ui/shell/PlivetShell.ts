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
}

const REPOSITORY = 'https://github.com/RYOSKATE/PLIVET';
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
  /** Where the debug controls, the step counter and the theme switch go. */
  readonly controls: HTMLDivElement;
  readonly editor: HTMLDivElement;
  readonly console: HTMLDivElement;
  readonly files: HTMLDivElement;
  /** The right-hand column: the visualization. */
  readonly main: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly splitters: Splitter[];

  constructor(parent: HTMLElement, options: PlivetShellOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'plivet';

    this.side = document.createElement('div');
    this.side.className = 'plivet__side';

    this.controls = document.createElement('div');
    this.controls.className = 'plivet__controls';
    this.editor = document.createElement('div');
    this.editor.className = 'plivet__editor';
    this.console = document.createElement('div');
    this.console.className = 'plivet__console';
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
      this.console,
      this.files
    );

    const columnSplit = new Splitter({
      axis: 'x',
      label: strings.resizeColumns,
      size: () => this.side.getBoundingClientRect().width,
      resize: (width) => this.setSideWidth(width),
      reset: () => this.root.style.removeProperty(SIDE_WIDTH),
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
    // The canvas mount is handed out whole - the graph widget takes the
    // element over, class and children - so the handle under it hangs in a
    // column beside it rather than inside it.
    const column = document.createElement('div');
    column.className = 'plivet__column';
    column.append(this.main, canvasSplit.element);

    this.splitters = [editorSplit, columnSplit, canvasSplit];
    this.root.append(
      this.side,
      columnSplit.element,
      column,
      this.footer(options)
    );
    parent.appendChild(this.root);

    this.setDark(options.dark === true);
  }

  setDark(dark: boolean): void {
    this.root.classList.toggle('plivet--dark', dark);
  }

  /** How wide the editor column is drawn. The canvas takes what is left. */
  setSideWidth(width: number): void {
    const total = this.root.getBoundingClientRect().width;
    const most = Math.max(MIN_SIDE, total === 0 ? width : total - MIN_MAIN);
    this.root.style.setProperty(
      SIDE_WIDTH,
      `${Math.round(Math.min(Math.max(width, MIN_SIDE), most))}px`
    );
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
    for (const property of [SIDE_WIDTH, EDITOR_HEIGHT, CANVAS_HEIGHT]) {
      this.root.style.removeProperty(property);
    }
  }

  destroy(): void {
    for (const splitter of this.splitters) {
      splitter.destroy();
    }
    this.root.remove();
  }

  private footer(options: PlivetShellOptions): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'plivet__footer';

    const version = options.version === undefined ? '' : ` v${options.version}`;
    const copyright = document.createElement('span');
    copyright.textContent = `PLIVET${version} © ${copyrightYears(options.fromYear)} @RYOSKATE`;

    const links = document.createElement('span');
    links.append(
      this.link(REPOSITORY, 'GitHub'),
      document.createTextNode(' '),
      this.link(LICENSES, 'LICENSES')
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
