import { MutationModel } from '../../core';
import strings from '../../strings';
import { empty } from './CallStackView';

/**
 * What the run has written, newest first, with the frame it happened in.
 *
 * Every other view says what memory holds now. This says what it held before,
 * which is the question a reader asks when a value is wrong and they are
 * looking for the statement that made it wrong. The frame is the column that
 * makes it worth a view of its own: a write inside a callee is a write to the
 * callee's own copy, and a log that names the frame shows C's by-value
 * passing happening rather than asserting it.
 */
export class MutationView {
  readonly root: HTMLElement;

  private readonly body: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'plivet-view plivet-view--mutations';

    const title = document.createElement('h3');
    title.className = 'plivet-view__title';
    title.textContent = strings.viewMutations;

    this.body = document.createElement('div');
    this.body.className = 'plivet-view__body';

    this.root.append(title, this.body);
    parent.appendChild(this.root);
    this.setMutations([]);
  }

  setMutations(mutations: MutationModel[]): void {
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
    this.root.remove();
  }
}

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
