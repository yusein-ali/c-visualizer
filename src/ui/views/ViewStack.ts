import { StepModel } from '../../core';
import strings from '../../strings';
import { CallStackView } from './CallStackView';
import { MutationView } from './MutationView';
import './views.css';

/**
 * The panes under the canvas, and the panel that switches them on and off.
 *
 * They are separate from the canvas because they answer questions the canvas
 * does not: the map draws the memory of one step, and these two draw the
 * shape of the run - the calls it is inside, and the writes it has made. A
 * reader watching either is watching something the map cannot show without
 * becoming a second map.
 *
 * The switches sit here rather than in the canvas toolbar, with the panes
 * they switch. The canvas's own disclosure decides what the canvas draws, and
 * a control that turned off a pane somewhere else on the page would be a
 * switch a reader has to go looking for.
 *
 * Both panes start off. A view that is worth having is not worth having by
 * default, and the two columns a reader opens PLIVET for are the editor and
 * the map: these open when a reader asks a question they answer.
 */

interface Pane {
  key: 'callStack' | 'mutations';
  label: string;
  element: HTMLElement;
  shown: boolean;
  input: HTMLInputElement;
}

export class ViewStack {
  readonly root: HTMLDivElement;

  private readonly panel: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly callStack: CallStackView;
  private readonly mutations: MutationView;
  private readonly panes: Pane[] = [];
  private model: StepModel | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'plivet-views';

    this.panel = document.createElement('div');
    this.panel.className = 'plivet-views__panel';
    this.panel.setAttribute('role', 'group');
    this.panel.setAttribute('aria-label', strings.viewsPanelTitle);
    const title = document.createElement('span');
    title.className = 'plivet-views__title';
    title.textContent = strings.viewsPanelTitle;
    this.panel.appendChild(title);

    this.body = document.createElement('div');
    this.body.className = 'plivet-views__body';

    this.callStack = new CallStackView(this.body);
    this.mutations = new MutationView(this.body);

    this.addPane('callStack', strings.viewCallStack, this.callStack.root);
    this.addPane('mutations', strings.viewMutations, this.mutations.root);

    this.root.append(this.panel, this.body);
    parent.appendChild(this.root);
  }

  /** The step to show. Kept, so switching a pane on fills it immediately. */
  render(model: StepModel): void {
    this.model = model;
    this.refresh();
  }

  /** Whether a pane is on, for a page that wants to open one itself. */
  showPane(key: Pane['key'], shown: boolean): void {
    const pane = this.panes.find((one) => one.key === key);
    if (typeof pane === 'undefined') {
      return;
    }
    pane.shown = shown;
    pane.input.checked = shown;
    this.refresh();
  }

  isPaneShown(key: Pane['key']): boolean {
    return this.panes.some((pane) => pane.key === key && pane.shown);
  }

  destroy(): void {
    this.callStack.destroy();
    this.mutations.destroy();
    this.root.remove();
  }

  private addPane(key: Pane['key'], label: string, element: HTMLElement): void {
    const wrapper = document.createElement('label');
    wrapper.className = 'plivet-views__switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => this.showPane(key, input.checked));
    wrapper.append(input, document.createTextNode(label));
    this.panel.appendChild(wrapper);
    this.panes.push({ key, label, element, shown: false, input });
    element.hidden = true;
  }

  /**
   * A pane that is off is filled with nothing as well as hidden: a run of a
   * hundred thousand writes should cost a reader who is not looking at them
   * no rows at all.
   */
  private refresh(): void {
    const model = this.model;
    for (const pane of this.panes) {
      pane.element.hidden = !pane.shown;
    }
    this.callStack.setFrames(
      this.isPaneShown('callStack') && model !== null ? model.frames : []
    );
    this.mutations.setMutations(
      this.isPaneShown('mutations') && model !== null ? model.mutations : []
    );
    this.root.classList.toggle(
      'plivet-views--open',
      this.panes.some((pane) => pane.shown)
    );
  }
}
