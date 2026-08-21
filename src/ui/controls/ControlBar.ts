import './controls.css';
import { CONTROL_EVENT, DEBUG_STATE } from '../../core';
import strings, { stringFor } from '../../strings';
import {
  Enablement,
  enablementFor,
  runCommand,
  stepCommand,
} from './enablement';
import { IconName, iconFor } from './icons';

/**
 * The debug controls: six buttons, the three that size the editor's text, the
 * theme switch, the button that opens the instructions, and the step counter.
 *
 * It was `Menu`, `CtrlButtons`, `CtrlButton`, `ThemeButton` and
 * `HowToUseButton` - five React components holding, between them, one piece of
 * logic: which buttons a debug state enables. That logic came out into
 * `enablement.ts` before React did, and this class is what is left once the
 * components around it are markup.
 *
 * `ThemeButton` was never rendered by anything, so the theme it broadcast
 * could not be chosen. The switch that replaces it is in the bar.
 */

export type ZOOM_COMMAND = 'In' | 'Out' | 'Reset';

export interface ControlBarOptions {
  /** A debug command the user asked for. */
  onDebug?: (command: CONTROL_EVENT) => void;
  /** The editor's text size, which is what `zoom` has meant since Phase 8. */
  onZoom?: (command: ZOOM_COMMAND) => void;
  onTheme?: (dark: boolean) => void;
  onHelp?: () => void;
  /** Show the source the compiler actually sees, beside the one written. */
  onPreprocessed?: () => void;
  /** A file the reader chose to open: a program, or a saved session. */
  onOpenFile?: (file: File) => void;
  /** Write the program out. What it is called is the caller's business. */
  onSaveCode?: () => void;
  dark?: boolean;
}

/** A debug button: which slot of the enablement table decides it works. */
interface DebugButton {
  slot: keyof Enablement;
  element: HTMLButtonElement;
  /** Fixed for four of the six; the two forward buttons change with state. */
  command: CONTROL_EVENT;
}

export class ControlBar {
  readonly root: HTMLDivElement;

  private readonly options: ControlBarOptions;
  private readonly buttons: DebugButton[] = [];
  private readonly status: HTMLSpanElement;
  private readonly theme: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;

  constructor(parent: HTMLElement, options: ControlBarOptions = {}) {
    this.options = options;

    this.root = document.createElement('div');
    this.root.className = 'plivet-controls';

    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'plivet-controls__help';
    help.textContent = strings.howToUse;
    help.addEventListener('click', () => this.options.onHelp?.());

    const preprocessed = document.createElement('button');
    preprocessed.type = 'button';
    preprocessed.className = 'plivet-controls__help';
    preprocessed.textContent = strings.preprocessedButton;
    preprocessed.title = strings.preprocessedHint;
    preprocessed.addEventListener('click', () =>
      this.options.onPreprocessed?.()
    );

    // The file input is the browser's own picker and cannot be opened
    // without one; it is hidden and a button of the bar's own shape stands in
    // front of it, so the row does not carry a control drawn by the platform.
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.c,.h,.txt,.json';
    this.fileInput.className = 'plivet-controls__file';
    this.fileInput.setAttribute('aria-label', strings.openCode);
    this.fileInput.addEventListener('change', this.chosen);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'plivet-controls__help';
    open.textContent = strings.openCode;
    open.title = strings.openCodeHint;
    open.addEventListener('click', () => this.fileInput.click());

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'plivet-controls__help';
    save.textContent = strings.saveCode;
    save.title = strings.saveCodeHint;
    save.addEventListener('click', () => this.options.onSaveCode?.());

    this.status = document.createElement('span');
    this.status.className = 'plivet-controls__status';
    // The counter is the only thing on the page that says a step happened, so
    // it is announced rather than merely displayed.
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.theme = this.themeSwitch();

    this.root.append(
      help,
      preprocessed,
      open,
      save,
      this.fileInput,
      this.debugGroup(),
      this.zoomGroup(),
      this.theme,
      this.status
    );
    parent.appendChild(this.root);

    this.setDark(options.dark === true);
    this.setDebugState('Stop', 0);
  }

  /**
   * Which buttons work, what the two forward buttons mean, and what the step
   * counter says. All three are a function of the debug state alone.
   */
  setDebugState(debugState: DEBUG_STATE, step: number): void {
    const enabled = enablementFor(debugState);
    for (const button of this.buttons) {
      if (button.slot === 'Step') {
        button.command = stepCommand(debugState);
      } else if (button.slot === 'StepAll') {
        button.command = runCommand(debugState);
      }
      button.element.disabled = !enabled[button.slot];
      button.element.title = stringFor(`debug${button.command}`);
      button.element.setAttribute('aria-label', button.element.title);
    }
    const state =
      debugState === 'Debugging' ? `${strings.step} ${step}` : debugState;
    this.status.textContent = `${strings.debugStatus}: ${state}`;
  }

  setDark(dark: boolean): void {
    this.theme.value = dark ? 'dark' : 'light';
  }

  destroy(): void {
    this.fileInput.removeEventListener('change', this.chosen);
    this.root.remove();
  }

  /**
   * The file the picker came back with. The input is cleared afterwards, so
   * opening the same file twice in a row still raises a `change` - the same
   * thing the upload panel does for the same reason.
   */
  private readonly chosen = () => {
    const files = this.fileInput.files;
    if (files === null || files.length === 0) {
      return;
    }
    this.options.onOpenFile?.(files[0]);
    this.fileInput.value = '';
  };

  private debugGroup(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'plivet-controls__group';
    group.append(
      this.debugButton('Start', 'Start', 'restart', 'start'),
      this.debugButton('Stop', 'Stop', 'stop', 'stop'),
      this.debugButton('BackAll', 'BackAll', 'rewind', 'move'),
      this.debugButton('StepBack', 'StepBack', 'stepBack', 'move'),
      this.debugButton('Step', 'Step', 'stepForward', 'move'),
      this.debugButton('StepAll', 'StepAll', 'run', 'move')
    );
    return group;
  }

  private debugButton(
    slot: keyof Enablement,
    command: CONTROL_EVENT,
    icon: IconName,
    tone: 'start' | 'stop' | 'move'
  ): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `plivet-controls__button plivet-controls__button--${tone}`;
    element.appendChild(iconFor(icon));
    const button: DebugButton = { slot, element, command };
    element.addEventListener('click', () =>
      this.options.onDebug?.(button.command)
    );
    this.buttons.push(button);
    return element;
  }

  private zoomGroup(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'plivet-controls__group';
    group.append(
      this.zoomButton('Out', 'zoomOut'),
      this.zoomButton('Reset', 'zoomReset'),
      this.zoomButton('In', 'zoomIn')
    );
    return group;
  }

  private zoomButton(command: ZOOM_COMMAND, icon: IconName): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'plivet-controls__button';
    element.title = stringFor(`zoom${command}`);
    element.setAttribute('aria-label', element.title);
    element.appendChild(iconFor(icon));
    element.addEventListener('click', () => this.options.onZoom?.(command));
    return element;
  }

  private themeSwitch(): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'plivet-controls__theme';
    select.setAttribute('aria-label', strings.theme);
    for (const [value, label] of [
      ['light', strings.themeLight],
      ['dark', strings.themeDark],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.addEventListener('change', () =>
      this.options.onTheme?.(select.value === 'dark')
    );
    return select;
  }
}
