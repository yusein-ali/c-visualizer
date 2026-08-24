import strings from '../../strings';
import './breakpoints.css';

export interface BreakpointEntry {
  path: string;
  /** One-based source line shown to the reader. */
  line: number;
  enabled: boolean;
  statement: string;
  hits: number;
}

export interface BreakpointTableOptions {
  onEnabled?: (path: string, line: number, enabled: boolean) => void;
  onRemove?: (path: string, line: number) => void;
  onNavigate?: (path: string, line: number) => void;
  onAllEnabled?: (enabled: boolean) => void;
}

/** A source-aware, instance-local view of every breakpoint in open files. */
export class BreakpointTable {
  readonly root: HTMLElement;

  private readonly body: HTMLTableSectionElement;
  private readonly empty: HTMLParagraphElement;
  private readonly allEnabled: HTMLButtonElement;
  private entries: BreakpointEntry[] = [];

  constructor(
    parent: HTMLElement,
    private readonly options: BreakpointTableOptions = {}
  ) {
    this.root = document.createElement('section');
    this.root.className = 'plivet-breakpoints';
    this.root.setAttribute('aria-label', strings.breakpointsTitle);

    const toolbar = document.createElement('div');
    toolbar.className = 'plivet-breakpoints__toolbar';
    const hint = document.createElement('span');
    hint.className = 'plivet-breakpoints__hint';
    hint.textContent = strings.breakpointsNavigateHint;
    this.allEnabled = document.createElement('button');
    this.allEnabled.type = 'button';
    this.allEnabled.className = 'plivet-breakpoints__all';
    this.allEnabled.addEventListener('click', this.toggleAll);
    toolbar.append(hint, this.allEnabled);

    const table = document.createElement('table');
    table.className = 'plivet-breakpoints__table';
    const head = document.createElement('thead');
    const headings = document.createElement('tr');
    headings.append(
      this.heading(strings.breakpointsEnabled, 'enabled'),
      this.heading(strings.breakpointsLocation, 'location'),
      this.heading(strings.breakpointsStatement, 'statement'),
      this.heading(strings.breakpointsHits, 'hits'),
      this.heading(strings.breakpointsActions, 'actions')
    );
    head.appendChild(headings);
    this.body = document.createElement('tbody');
    table.append(head, this.body);

    this.empty = document.createElement('p');
    this.empty.className = 'plivet-breakpoints__empty';
    this.empty.textContent = strings.breakpointsEmpty;
    this.root.append(toolbar, table, this.empty);
    parent.appendChild(this.root);
    this.render();
  }

  setBreakpoints(entries: BreakpointEntry[]): void {
    this.entries = entries.map((entry) => ({ ...entry }));
    this.render();
  }

  destroy(): void {
    this.allEnabled.removeEventListener('click', this.toggleAll);
    this.root.remove();
  }

  private heading(text: string, column: string): HTMLTableCellElement {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.className = `plivet-breakpoints__${column}`;
    heading.textContent = text;
    return heading;
  }

  private row(entry: BreakpointEntry): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.className = 'plivet-breakpoints__row';
    row.addEventListener('click', () => {
      for (const candidate of this.body.rows) {
        candidate.classList.toggle(
          'plivet-breakpoints__row--selected',
          candidate === row
        );
      }
    });
    row.addEventListener('dblclick', (event) => {
      if ((event.target as Element).closest('button, input') === null) {
        this.options.onNavigate?.(entry.path, entry.line);
      }
    });
    row.tabIndex = 0;
    row.addEventListener('keydown', (event) => {
      if (event.target === row && event.key === 'Enter') {
        this.options.onNavigate?.(entry.path, entry.line);
      }
    });

    const enabledCell = document.createElement('td');
    enabledCell.className = 'plivet-breakpoints__enabled';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = entry.enabled;
    enabled.setAttribute(
      'aria-label',
      `${entry.enabled ? strings.breakpointsDisable : strings.breakpointsEnable} @ ${entry.path}: ${entry.line}`
    );
    enabled.addEventListener('change', () =>
      this.options.onEnabled?.(entry.path, entry.line, enabled.checked)
    );
    enabledCell.appendChild(enabled);

    const location = document.createElement('td');
    location.className = 'plivet-breakpoints__location';
    location.textContent = `@ ${entry.path}: ${entry.line}`;

    const statement = document.createElement('td');
    statement.className = 'plivet-breakpoints__statement';
    const code = document.createElement('code');
    code.textContent = entry.statement || strings.breakpointsBlankLine;
    statement.appendChild(code);

    const hits = document.createElement('td');
    hits.className = 'plivet-breakpoints__hits';
    hits.textContent = String(entry.hits);

    const actions = document.createElement('td');
    actions.className = 'plivet-breakpoints__actions';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'plivet-breakpoints__remove';
    remove.textContent = strings.remove;
    remove.setAttribute(
      'aria-label',
      `${strings.breakpointsRemove} @ ${entry.path}: ${entry.line}`
    );
    remove.addEventListener('click', () =>
      this.options.onRemove?.(entry.path, entry.line)
    );
    actions.appendChild(remove);
    row.append(enabledCell, location, statement, hits, actions);
    return row;
  }

  private readonly toggleAll = (): void => {
    const enable = !this.entries.some((entry) => entry.enabled);
    this.options.onAllEnabled?.(enable);
  };

  private render(): void {
    this.body.replaceChildren(...this.entries.map((entry) => this.row(entry)));
    this.empty.hidden = this.entries.length !== 0;
    const table = this.body.parentElement as HTMLTableElement;
    table.hidden = this.entries.length === 0;
    const enable = !this.entries.some((entry) => entry.enabled);
    this.allEnabled.textContent = enable
      ? strings.breakpointsEnableAll
      : strings.breakpointsDisableAll;
    this.allEnabled.disabled = this.entries.length === 0;
  }
}
