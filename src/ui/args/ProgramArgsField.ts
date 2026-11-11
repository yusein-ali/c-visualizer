import './args.css';
import strings from '../../strings';

/**
 * The program's arguments, right above the editor and below the task panel.
 *
 * The arguments are what the program is started with, so they sit with the
 * program: under the task that says what to write and over the code that
 * reads them, where the reader looks before pressing Start. The line is typed
 * as on a command line, and what is in it is read when a run starts, so an
 * edit applies at the next Start or Run and never to the run under way.
 */

export interface ProgramArgsFieldOptions {
  /** The field's text when it opens: arguments as on a command line. */
  args?: string;
  /** The field's text, on every change the reader makes to it. */
  onArgs?: (text: string) => void;
}

export class ProgramArgsField {
  readonly root: HTMLLabelElement;

  private readonly input: HTMLInputElement;

  constructor(parent: HTMLElement, options: ProgramArgsFieldOptions = {}) {
    this.root = document.createElement('label');
    this.root.className = 'plivet-args';
    this.root.title = strings.programArgsHint;

    const caption = document.createElement('span');
    caption.className = 'plivet-args__caption';
    caption.textContent = strings.programArgs;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'plivet-args__input';
    this.input.value = options.args ?? '';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', strings.programArgsLabel);
    this.input.addEventListener('input', () =>
      options.onArgs?.(this.input.value)
    );

    this.root.append(caption, this.input);
    parent.appendChild(this.root);
  }

  /** Replace the field's text, without reporting it as the reader's edit. */
  setArgs(text: string): void {
    this.input.value = text;
  }

  destroy(): void {
    this.root.remove();
  }
}
