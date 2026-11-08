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
 * submitted line through `onInput`, the end of the input through
 * `onEndOfInput`, and is told what to show. That is what lets it move out of
 * the React shell without changing.
 */

/** A stretch of the transcript the program wrote to `stderr`, as offsets. */
export interface ConsoleSpan {
  start: number;
  end: number;
}

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
  /**
   * The user ended the input - Ctrl+D in the field, or the button beside it -
   * with whatever was typed before it, which has no newline after it and may
   * be empty. The read the program is waiting on then finds the end of input.
   */
  onEndOfInput?: (text: string) => void;
  /** Placeholder shown while the program is blocked on a read. */
  inputHint?: string;
  /** Accessible name for the input field. */
  inputLabel?: string;
  /** The end-of-input button's text, and its tooltip. */
  endInputLabel?: string;
  endInputHint?: string;
  dark?: boolean;
  fontSize?: number;
  /** Ask the containing layout to reveal the console for new output/input. */
  onReveal?: () => void;
}

const defaults = {
  output: '',
  title: strings.consoleTitle,
  inputHint: strings.consoleInputHint,
  inputLabel: 'standard input',
  endInputLabel: strings.consoleEndInput,
  endInputHint: strings.consoleEndInputHint,
  dark: false,
  fontSize: 14,
  heading: true,
};

export class PlivetConsole {
  readonly root: HTMLElement;

  private readonly disclosure?: HTMLDetailsElement;
  private readonly transcript: HTMLPreElement;
  private readonly field: HTMLTextAreaElement;
  private readonly endButton: HTMLButtonElement;
  private readonly onInput?: (text: string) => void;
  private readonly onEndOfInput?: (text: string) => void;
  /** The spans `setOutput` last drew, to skip an identical redraw. */
  private spansShown = '';
  private readonly onReveal?: () => void;
  private readonly inputHint: string;
  private accepting = false;

  constructor(parent: HTMLElement, options: PlivetConsoleOptions = {}) {
    const config = { ...defaults, ...options };
    this.onInput = options.onInput;
    this.onEndOfInput = options.onEndOfInput;
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
    this.field.wrap = 'off';
    this.field.spellcheck = false;
    this.field.autocapitalize = 'off';
    this.field.setAttribute('autocomplete', 'off');
    this.field.setAttribute('autocorrect', 'off');
    this.field.setAttribute('aria-label', config.inputLabel);
    this.field.addEventListener('keydown', this.keydown);
    this.field.addEventListener('input', this.fitField);

    // Ctrl+D at a terminal, as a button for a reader who does not know it.
    this.endButton = document.createElement('button');
    this.endButton.type = 'button';
    this.endButton.className = 'plivet-console-end';
    this.endButton.textContent = config.endInputLabel;
    this.endButton.title = config.endInputHint;
    this.endButton.addEventListener('click', this.endClicked);

    const entry = document.createElement('div');
    entry.className = 'plivet-console-entry';
    entry.append(this.field, this.endButton);

    this.root.append(
      ...(config.heading ? [title] : []),
      this.transcript,
      entry
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

  /**
   * The program's output, as the interpreter reports it after every step,
   * and which spans of it came from `stderr`: those are drawn in the error
   * colour, the rest as ordinary text.
   */
  setOutput(output: string, errorSpans: ConsoleSpan[] = []): void {
    const spans = JSON.stringify(errorSpans);
    if (this.transcript.textContent === output && this.spansShown === spans) {
      return;
    }
    this.spansShown = spans;
    this.transcript.textContent = '';
    let at = 0;
    for (const span of errorSpans) {
      const start = Math.max(at, Math.min(span.start, output.length));
      const end = Math.max(start, Math.min(span.end, output.length));
      if (at < start) {
        this.transcript.append(output.slice(at, start));
      }
      if (start < end) {
        const error = document.createElement('span');
        error.className = 'plivet-console-stderr';
        error.textContent = output.slice(start, end);
        this.transcript.append(error);
      }
      at = end;
    }
    if (at < output.length) {
      this.transcript.append(output.slice(at));
    }
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
    this.endButton.disabled = !accepting;
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
    this.endButton.removeEventListener('click', this.endClicked);
    this.root.remove();
  }

  private readonly keydown = (event: KeyboardEvent) => {
    // Ctrl+D is how a terminal ends its input, on every platform: macOS uses
    // Control here too, and Command+D belongs to the browser.
    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'd'
    ) {
      event.preventDefault();
      this.endInput();
      return;
    }
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

  private readonly endClicked = () => this.endInput();

  private endInput(): void {
    if (!this.accepting) {
      return;
    }
    const text = this.field.value;
    this.setAccepting(false);
    this.onEndOfInput?.(text);
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
