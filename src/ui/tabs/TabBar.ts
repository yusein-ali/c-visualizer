import strings from '../../strings';
import './tabs.css';

/**
 * The files a reader has open, as a strip of tabs over the editor.
 *
 * C compiles one translation unit, so exactly one of them is the file that
 * runs: it is marked, and pressing another file's marker makes that one the
 * entry instead. This is the shape the interactive-code directive PLIVET is
 * meant to embed in already has - the parts of a block are tabs, one of them
 * is the main file, and every part is submitted together - which is why the
 * protocol carries the whole set even while only the entry is compiled.
 *
 * With one file open the strip is not drawn at all. A reader who has never
 * opened a second file should not be paying a line of the page to be told
 * they have one file.
 */

export interface TabModel {
  path: string;
  /** The file that runs. Exactly one of them is. */
  entry: boolean;
  active: boolean;
  /** Whether the text differs from what was opened or last saved. */
  edited?: boolean;
}

export interface TabBarOptions {
  onSelect?: (path: string) => void;
  onClose?: (path: string) => void;
  /** Make this file the one that runs. */
  onEntry?: (path: string) => void;
}

export class TabBar {
  readonly root: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly options: TabBarOptions = {}
  ) {
    this.root = document.createElement('div');
    this.root.className = 'plivet-tabs';
    this.root.setAttribute('role', 'tablist');
    this.root.setAttribute('aria-label', strings.tabsLabel);
    parent.appendChild(this.root);
    this.setTabs([]);
  }

  setTabs(tabs: TabModel[]): void {
    this.root.hidden = tabs.length < 2;
    this.root.replaceChildren(...tabs.map((tab) => this.tab(tab)));
  }

  destroy(): void {
    this.root.remove();
  }

  private tab(tab: TabModel): HTMLElement {
    const element = document.createElement('div');
    element.className = 'plivet-tabs__tab';
    element.classList.toggle('plivet-tabs__tab--active', tab.active);

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'plivet-tabs__select';
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(tab.active));
    select.textContent = tab.edited === true ? `${tab.path} •` : tab.path;
    select.addEventListener('click', () => this.options.onSelect?.(tab.path));

    // The entry marker is a button rather than a badge: what it says - this
    // is the file that runs - is also the only way to change which one does.
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'plivet-tabs__entry';
    entry.classList.toggle('plivet-tabs__entry--on', tab.entry);
    entry.textContent = tab.entry ? '▶' : '▷';
    entry.title = tab.entry ? strings.tabRuns : strings.tabMakeEntry;
    entry.setAttribute(
      'aria-label',
      `${tab.entry ? strings.tabRuns : strings.tabMakeEntry}: ${tab.path}`
    );
    entry.disabled = tab.entry;
    entry.addEventListener('click', () => this.options.onEntry?.(tab.path));

    element.append(entry, select);
    // The file that runs cannot be closed: a session with no translation unit
    // is not a session, and the reader would have to open one to get back.
    if (!tab.entry) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'plivet-tabs__close';
      close.textContent = '×';
      close.title = `${strings.tabClose}: ${tab.path}`;
      close.setAttribute('aria-label', close.title);
      close.addEventListener('click', () => this.options.onClose?.(tab.path));
      element.appendChild(close);
    }
    return element;
  }
}
