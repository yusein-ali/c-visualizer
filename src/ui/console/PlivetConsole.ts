import './console.css';
import strings from '../../strings';

/**
 * The program's console: what it printed, and what the user types when it
 * blocks on a read.
 *
 * It was a second Ace editor, and everything awkward about it followed from
 * that one buffer holding both halves. Output and input arriving in the same
 * document meant the caret could be left inside already-printed text, so a
 * typed value was parsed as whatever followed it; printing moved the caret
 * because react-ace restored the pre-print selection; and telling apart what
 * the user typed from what the program printed was a prefix comparison. A
 * `pre` the user cannot reach and a `textarea` that only ever holds the
 * current line delete all three problems rather than fixing them.
 *
 * The class knows nothing about the interpreter or the event bus: it reports a
 * submitted line through `onInput` and is told what to show. That is what lets
 * it move out of the React shell in Phase 9 without changing.
 */

export interface PlivetConsoleOptions {
  /** Initial transcript. */
  output?: string;
  /** Collapsible heading above input and output. */
  title?: string;
  /** Draw the collapsible title when the console is not inside a tabbed dock. */
  heading?: boolean;
  /**
   * A line the user submitted, without its terminating newline. Empty is a
   * legitimate submission: it is how a program is told to read nothing.
   */
  onInput?: (text: string) => void;
  /** Placeholder shown while the program is blocked on a read. */
  inputHint?: string;
  /** Accessible name for the input field. */
  inputLabel?: string;
  dark?: boolean;
  fontSize?: number;
  /** Ask the containing layout to reveal the console for new output/input. */
  onReveal?: () => void;
}

const defaults = {
  output: '',
  title: strings.consoleTitle,
  inputHint: 'Enter to submit, Shift+Enter for another line',
  inputLabel: 'standard input',
  dark: false,
  fontSize: 14,
  heading: true,
};

export class PlivetConsole {
  readonly root: HTMLElement;

  private readonly disclosure?: HTMLDetailsElement;
  private readonly transcript: HTMLPreElement;
  private readonly field: HTMLTextAreaElement;
  private readonly onInput?: (text: string) => void;
  private readonly onReveal?: () => void;
  private readonly inputHint: string;
  private accepting = false;

  constructor(parent: HTMLElement, options: PlivetConsoleOptions = {}) {
    const config = { ...defaults, ...options };
    this.onInput = options.onInput;
    this.onReveal = options.onReveal;
    this.inputHint = config.inputHint;

    this.root = document.createElement(config.heading ? 'details' : 'section');
    this.disclosure =
      this.root instanceof HTMLDetailsElement ? this.root : undefined;
    this.root.className = 'plivet-console';
    this.root.classList.toggle('plivet-console--embedded', !config.heading);
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', config.title);

    const title = document.createElement('summary');
    title.className = 'plivet-console-title';
    title.textContent = config.title;

    this.transcript = document.createElement('pre');
    this.transcript.className = 'plivet-console-output';
    this.transcript.textContent = config.output;
    // A screen reader hears the program's output as it arrives, which is the
    // whole of what a console tells a user who cannot see it.
    this.transcript.setAttribute('role', 'log');
    this.transcript.setAttribute('aria-live', 'polite');

    this.field = document.createElement('textarea');
    this.field.className = 'plivet-console-input';
    this.field.rows = 1;
    this.field.spellcheck = false;
    this.field.autocapitalize = 'off';
    this.field.setAttribute('autocomplete', 'off');
    this.field.setAttribute('autocorrect', 'off');
    this.field.setAttribute('aria-label', config.inputLabel);
    this.field.addEventListener('keydown', this.keydown);
    this.field.addEventListener('input', this.fitField);

    this.root.append(
      ...(config.heading ? [title] : []),
      this.transcript,
      this.field
    );
    parent.appendChild(this.root);

    // Output supplied at construction represents program I/O already in
    // progress, so it follows the same expansion rule as later stdout.
    if (config.output !== '') {
      this.expand();
    }

    this.setDark(config.dark);
    this.setFontSize(config.fontSize);
    this.setAccepting(false);
  }

  /** The program's output, as the interpreter reports it after every step. */
  setOutput(output: string): void {
    if (this.transcript.textContent === output) {
      return;
    }
    this.transcript.textContent = output;
    this.expand();
    if (output !== '') {
      this.onReveal?.();
    }
    this.scrollToEnd();
  }

  /**
   * Typable exactly while the program is blocked on a read. Any other state
   * would let a value be typed that nothing is waiting to consume.
   */
  setAccepting(accepting: boolean): void {
    this.accepting = accepting;
    this.field.disabled = !accepting;
    this.field.placeholder = accepting ? this.inputHint : '';
    this.root.classList.toggle('plivet-console--accepting', accepting);
    if (!accepting) {
      this.field.value = '';
      this.fitField();
      return;
    }
    this.expand();
    this.onReveal?.();
    // The program is waiting, and the editor is read-only for the duration of
    // the session, so there is nothing else the keyboard could usefully do.
    this.field.focus();
    this.scrollToEnd();
  }

  setDark(dark: boolean): void {
    this.root.classList.toggle('plivet-console--dark', dark);
  }

  setFontSize(fontSize: number): void {
    this.root.style.fontSize = `${fontSize}px`;
  }

  destroy(): void {
    this.field.removeEventListener('keydown', this.keydown);
    this.field.removeEventListener('input', this.fitField);
    this.root.remove();
  }

  private readonly keydown = (event: KeyboardEvent) => {
    // Shift+Enter is the escape hatch for the several values one read can
    // consume: the interpreter keeps whatever a read leaves over, so `3\n4`
    // answers two scanfs. `isComposing` guards the Enter that commits an IME
    // candidate, which is not a submission.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    this.submit();
  };

  private submit(): void {
    if (!this.accepting) {
      return;
    }
    const text = this.field.value;
    this.setAccepting(false);
    if (typeof this.onInput !== 'undefined') {
      this.onInput(text);
    }
  }

  /** Grows the field with what is typed, up to the cap in the stylesheet. */
  private readonly fitField = () => {
    this.field.style.height = 'auto';
    const height = this.field.scrollHeight;
    if (0 < height) {
      this.field.style.height = `${height}px`;
    }
  };

  private scrollToEnd(): void {
    this.root.scrollTop = this.root.scrollHeight;
  }

  private expand(): void {
    if (typeof this.disclosure !== 'undefined') {
      this.disclosure.open = true;
    }
  }
}
