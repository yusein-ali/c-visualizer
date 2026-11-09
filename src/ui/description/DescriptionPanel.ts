import './description.css';
import strings from '../../strings';

/**
 * The task the program is written for, above the editor.
 *
 * A course page that opens the visualizer in a window of its own leaves the
 * task behind in the chapter, and the reader writing the program is the one
 * who needs it in front of them. So the host hands the task over as markup
 * and it is shown here: a disclosure, open to begin with, that the reader
 * folds away once they know what to write and opens again to check.
 *
 * The markup is the host's and is trusted: it is set as HTML, as written, the
 * way a course page renders its own text. A link in it leaves for a new tab
 * rather than taking the window the session is in along with it; a link to a
 * place within the description stays where it is.
 *
 * No description, or a blank one, is no panel: the disclosure is hidden and
 * takes no room from the editor.
 */

export interface DescriptionPanelOptions {
  /** The task, as HTML. Left out or blank, the panel is hidden. */
  html?: string;
  /** Whether the panel starts open. Defaults to open. */
  open?: boolean;
}

export class DescriptionPanel {
  readonly root: HTMLDetailsElement;

  private readonly body: HTMLDivElement;

  constructor(parent: HTMLElement, options: DescriptionPanelOptions = {}) {
    this.root = document.createElement('details');
    this.root.className = 'plivet-description';
    this.root.open = options.open ?? true;

    const summary = document.createElement('summary');
    summary.className = 'plivet-description__summary';
    summary.textContent = strings.taskDescription;

    this.body = document.createElement('div');
    this.body.className = 'plivet-description__body';

    this.root.append(summary, this.body);
    parent.appendChild(this.root);

    this.setDescription(options.html ?? '');
  }

  /**
   * Replace the task. A blank one hides the panel; the reader's choice of
   * open or folded is kept across a change.
   */
  setDescription(html: string): void {
    this.body.innerHTML = html;
    for (const link of this.body.querySelectorAll<HTMLAnchorElement>(
      'a[href]'
    )) {
      if (!(link.getAttribute('href') ?? '').startsWith('#')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
    this.root.hidden = html.trim() === '';
  }

  destroy(): void {
    this.root.remove();
  }
}
