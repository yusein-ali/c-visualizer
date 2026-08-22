import { MutationModel } from '../../core';
import strings from '../../strings';
import './views.css';

/**
 * What the run has written, newest first, with the frame it happened in.
 *
 * Every other view says what memory holds now. This says what it held before,
 * which is the question a reader asks when a value is wrong and they are
 * looking for the statement that made it wrong. The frame is the column that
 * makes it worth a view of its own: it helps distinguish assignment to a
 * parameter object from assignment through a pointer to an object whose
 * lifetime began in a caller.
 */
export class MutationView {
  readonly root: HTMLDetailsElement;

  private readonly body: HTMLDivElement;
  private readonly onToggle = (): void => this.refresh();
  private mutations: MutationModel[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('details');
    this.root.className =
      'plivet-view plivet-view--mutations plivet-graph__history';
    this.root.open = true;

    const title = document.createElement('summary');
    title.className = 'plivet-view__title';
    title.textContent = strings.viewMutations;

    this.body = document.createElement('div');
    this.body.className = 'plivet-view__body';

    this.root.append(title, this.body);
    parent.appendChild(this.root);
    this.root.addEventListener('toggle', this.onToggle);
    this.setMutations([]);
  }

  setMutations(mutations: MutationModel[]): void {
    this.mutations = mutations;
    this.refresh();
  }

  setShown(shown: boolean): void {
    this.root.hidden = !shown;
    this.refresh();
  }

  private refresh(): void {
    if (this.root.hidden || !this.root.open) {
      this.body.replaceChildren();
      return;
    }
    const { mutations } = this;
    if (mutations.length === 0) {
      this.body.replaceChildren(empty(strings.viewNothingWritten));
      return;
    }
    const table = document.createElement('table');
    table.className = 'plivet-view__table';
    table.appendChild(
      headerRow([
        strings.viewColumnFrame,
        strings.viewColumnObject,
        strings.viewColumnBefore,
        strings.viewColumnAfter,
        strings.viewColumnLine,
      ])
    );
    // Newest first: the write a reader is looking for is the one that just
    // happened, and a log that grows downwards puts it where they have to
    // scroll for it.
    for (const mutation of mutations.slice().reverse()) {
      table.appendChild(
        dataRow([
          mutation.frame,
          mutation.target,
          mutation.before,
          mutation.after,
          String(mutation.line),
        ])
      );
    }
    this.body.replaceChildren(table);
  }

  destroy(): void {
    this.root.removeEventListener('toggle', this.onToggle);
    this.root.remove();
  }
}

const empty = (text: string): HTMLElement => {
  const line = document.createElement('p');
  line.className = 'plivet-view__empty';
  line.textContent = text;
  return line;
};

const headerRow = (titles: string[]): HTMLTableRowElement => {
  const row = document.createElement('tr');
  for (const title of titles) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = title;
    row.appendChild(cell);
  }
  return row;
};

const dataRow = (values: string[]): HTMLTableRowElement => {
  const row = document.createElement('tr');
  values.forEach((value, index) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    // The frame is prose, everything else is the program's own text.
    if (0 < index) {
      cell.className = 'plivet-view__code';
    }
    row.appendChild(cell);
  });
  return row;
};
