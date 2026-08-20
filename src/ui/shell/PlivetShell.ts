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

  constructor(parent: HTMLElement, options: PlivetShellOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'plivet';

    const side = document.createElement('div');
    side.className = 'plivet__side';

    this.controls = document.createElement('div');
    this.controls.className = 'plivet__controls';
    this.editor = document.createElement('div');
    this.editor.className = 'plivet__editor';
    this.console = document.createElement('div');
    this.console.className = 'plivet__console';
    this.files = document.createElement('div');
    this.files.className = 'plivet__files';
    side.append(this.controls, this.editor, this.console, this.files);

    this.main = document.createElement('div');
    this.main.className = 'plivet__main';

    this.root.append(side, this.main, this.footer(options));
    parent.appendChild(this.root);

    this.setDark(options.dark === true);
  }

  setDark(dark: boolean): void {
    this.root.classList.toggle('plivet--dark', dark);
  }

  destroy(): void {
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
