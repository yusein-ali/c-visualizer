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
 * The debug controls: seven buttons, the two that open and save a program, the
 * three that size the editor's text, the theme switch, and the button that
 * opens the instructions.
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
  /** The editor's text size, which is what `zoom` has meant since the
   * canvas was rewritten. */
  onZoom?: (command: ZOOM_COMMAND) => void;
  onTheme?: (dark: boolean) => void;
  onHelp?: () => void;
  /** Show the source the compiler actually sees, beside the one written. */
  onPreprocessed?: () => void;
  /**
   * Whether the bar carries that button at all. A course page that has not
   * taught the preprocessor yet leaves it out, and the reader is not offered a
   * view of a pass they have not met. Default: it is there.
   */
  preprocessor?: boolean;
  /** A file the reader chose to open: a program, or a saved session. */
  onOpenFile?: (file: File) => void;
  /** Whether Load may replace the current source. Default: enabled. */
  load?: boolean;
  /** Write the program out. What it is called is the caller's business. */
  onSaveCode?: () => void;
  /** Compile every source file through the diagnostic providers of the host. */
  onBuild?: () => void;
  /** Whether the host-backed Build button is present. */
  build?: boolean;
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
  private readonly debugToolbar: HTMLDivElement;
  private readonly dragHandle: HTMLButtonElement;
  private readonly theme: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;
  /** The tab strip whose height keeps the toolbar below the file names. */
  private toolbarTabs: HTMLElement | null = null;
  private toolbarTabsObserver: ResizeObserver | null = null;
  /** The pointer that currently owns the toolbar drag. */
  private pointer: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private startX = 0;
  private startY = 0;
  /** Translation from the toolbar's centred opening position. */
  private x = 0;
  private y = 0;
  /**
   * While a session has the toolbar fixed, where its undragged position sits
   * inside the visualizer, so that every placement can be measured from the
   * visualizer's corner rather than from the window's. Null when the toolbar
   * is laid out in the bar as usual.
   */
  private debugHome: { x: number; y: number } | null = null;
  /** The frame a scroll has already asked for a placement in. */
  private placement: number | null = null;

  constructor(parent: HTMLElement, options: ControlBarOptions = {}) {
    this.options = options;

    this.root = document.createElement('div');
    this.root.className = 'plivet-controls';

    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'plivet-controls__button';
    help.title = strings.howToUse;
    help.setAttribute('aria-label', strings.howToUse);
    help.appendChild(iconFor('help'));
    help.addEventListener('click', () => this.options.onHelp?.());

    // A button the page has switched off is never built, rather than built
    // and hidden: nothing on the bar is reachable by a keyboard or a screen
    // reader that the reader cannot use.
    const preprocessed = document.createElement('button');
    preprocessed.type = 'button';
    preprocessed.className = 'plivet-controls__button';
    preprocessed.title = strings.preprocessedHint;
    preprocessed.setAttribute('aria-label', strings.preprocessedButton);
    preprocessed.appendChild(iconFor('preprocessed'));
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
    this.fileInput.disabled = options.load !== true;
    this.fileInput.addEventListener('change', this.chosen);

    this.theme = this.themeSwitch();
    this.dragHandle = this.toolbarHandle();
    this.debugToolbar = this.debugGroup();

    // Left to right: save/load, the compiler's source, text size, help and the
    // theme. The run controls float independently over the editor. A configured
    // Build action belongs to that debug group, after the execution controls.
    this.root.append(
      this.fileGroup(),
      this.fileInput,
      this.debugToolbar,
      ...(options.preprocessor === false ? [] : [this.divider(), preprocessed]),
      this.divider(),
      this.zoomGroup(),
      this.divider(),
      help,
      this.divider(),
      this.theme
    );
    parent.appendChild(this.root);

    this.setDark(options.dark === true);
    this.setDebugState('Stop');
  }

  /**
   * Which buttons work and what the two forward buttons mean. Both are a
   * function of the debug state alone; the canvas presents that state.
   */
  setDebugState(debugState: DEBUG_STATE): void {
    this.keepDebugToolbarVisible(debugState !== 'Stop');
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
  }

  /**
   * Keep execution controls reachable for the lifetime of a session, without
   * letting them leave the visualizer.
   *
   * A sticky ancestor works in the standalone page, but an embedding may put
   * the visualizer below an element with `overflow`, which makes that element
   * the sticky container even when it never scrolls. Fixing the toolbar once
   * a run starts avoids that trap, at the price of a position the window,
   * rather than the visualizer, would otherwise hold still. `placeDebugToolbar`
   * pays that price back: it puts the toolbar where the visualizer is now,
   * every time the page or a container around it scrolls. Its normal
   * in-visualizer position returns when the session stops.
   */
  private keepDebugToolbarVisible(active: boolean): void {
    const className = 'plivet-controls__group--debug-active';
    if (active === this.debugToolbar.classList.contains(className)) {
      return;
    }
    if (!active) {
      this.debugToolbar.classList.remove(className);
      this.debugHome = null;
      this.debugToolbar.style.removeProperty('--plivet-debug-fixed-left');
      this.debugToolbar.style.removeProperty('--plivet-debug-fixed-top');
      window.removeEventListener('scroll', this.schedulePlacement, true);
      window.removeEventListener('resize', this.schedulePlacement);
      if (this.placement !== null) {
        cancelAnimationFrame(this.placement);
        this.placement = null;
      }
      return;
    }

    // Where the toolbar sits inside the visualizer at this moment, with any
    // drag taken back out: fixing it must not move it, and every later
    // placement is measured from that corner of the visualizer.
    const owner = this.boundary().getBoundingClientRect();
    const bounds = this.debugToolbar.getBoundingClientRect();
    this.debugHome = {
      x: bounds.left - owner.left - this.x,
      y: bounds.top - owner.top - this.y,
    };
    this.debugToolbar.classList.add(className);
    this.placeDebugToolbar();
    // Capture, because the scroller may be a container of the host page's
    // making and scrolling it does not reach the window any other way.
    window.addEventListener('scroll', this.schedulePlacement, true);
    window.addEventListener('resize', this.schedulePlacement);
  }

  /**
   * One placement per frame, however many scroll events ask for it. Placing
   * the toolbar reads the layout and then writes to it, which is the pair a
   * scroll handler must not repeat at the rate the events arrive.
   */
  private readonly schedulePlacement = (): void => {
    if (this.placement !== null) {
      return;
    }
    this.placement = requestAnimationFrame(() => {
      this.placement = null;
      this.placeDebugToolbar();
    });
  };

  /**
   * Put the fixed toolbar back over the visualizer.
   *
   * A fixed element is placed in window coordinates, so scrolling moves the
   * visualizer out from under a toolbar that stays where it was. The corner
   * recorded when the session started is re-read against the visualizer's
   * current position, and the result is held inside it.
   */
  private readonly placeDebugToolbar = (): void => {
    const home = this.debugHome;
    if (home === null) {
      return;
    }
    const owner = this.boundary().getBoundingClientRect();
    const toolbar = this.debugToolbar.getBoundingClientRect();
    const room = this.roomFor(owner, toolbar);
    const left = owner.left + home.x;
    const top = owner.top + home.y;

    // It is the drag that a boundary limits, not the placement: a drag that
    // would take the toolbar out of the visualizer stops at the edge and stays
    // there while the reader keeps pulling. jsdom and a detached widget have no
    // layout, and an axis the owner reports no room on is left alone.
    if (owner.width > 0) {
      this.x = this.clamp(left + this.x, room.left, room.right) - left;
    }
    if (owner.height > 0) {
      this.y = this.clamp(top + this.y, room.top, room.bottom) - top;
    }
    this.debugToolbar.style.setProperty(
      '--plivet-debug-fixed-left',
      `${left + this.x}px`
    );
    this.debugToolbar.style.setProperty(
      '--plivet-debug-fixed-top',
      `${top + this.y}px`
    );
  };

  /**
   * Where the fixed toolbar's top-left corner may go: inside the visualizer,
   * and inside the window as well for as long as those two agree. The
   * visualizer is the boundary. Once the page has scrolled it out of sight the
   * toolbar leaves with it rather than staying behind over the chapter, which
   * is the one thing a window-bound toolbar cannot do.
   */
  private roomFor(
    owner: DOMRect,
    toolbar: DOMRect
  ): { left: number; right: number; top: number; bottom: number } {
    const span = (
      start: number,
      end: number,
      size: number,
      viewport: number
    ): [number, number] => {
      const inOwner: [number, number] = [start, end - size];
      const seen: [number, number] = [
        Math.max(inOwner[0], 0),
        Math.min(inOwner[1], viewport - size),
      ];
      return seen[1] >= seen[0] ? seen : inOwner;
    };
    const [left, right] = span(
      owner.left,
      owner.right,
      toolbar.width,
      window.innerWidth
    );
    const [top, bottom] = span(
      owner.top,
      owner.bottom,
      toolbar.height,
      window.innerHeight
    );
    return { left, right, top, bottom };
  }

  setDark(dark: boolean): void {
    this.theme.value = dark ? 'dark' : 'light';
  }

  /** Keep the toolbar's CSS opening position below a possibly wrapped tab bar. */
  setDebugToolbarTabs(tabs: HTMLElement): void {
    this.toolbarTabsObserver?.disconnect();
    this.toolbarTabs = tabs;
    this.syncDebugToolbarTabs();

    if (typeof ResizeObserver !== 'undefined') {
      this.toolbarTabsObserver = new ResizeObserver(this.syncDebugToolbarTabs);
      this.toolbarTabsObserver.observe(tabs);
    }
  }

  destroy(): void {
    this.keepDebugToolbarVisible(false);
    this.toolbarTabsObserver?.disconnect();
    this.fileInput.removeEventListener('change', this.chosen);
    this.root.remove();
  }

  private readonly syncDebugToolbarTabs = (): void => {
    const height = this.toolbarTabs?.getBoundingClientRect().height ?? 0;
    this.debugToolbar.style.setProperty(
      '--plivet-debug-tabs-height',
      `${height}px`
    );
  };

  /**
   * The file the picker came back with. The input is cleared afterwards, so
   * opening the same file twice in a row still raises a `change` - the same
   * thing the upload panel does for the same reason.
   */
  private readonly chosen = () => {
    if (this.fileInput.disabled) {
      return;
    }
    const files = this.fileInput.files;
    if (files === null || files.length === 0) {
      return;
    }
    this.options.onOpenFile?.(files[0]);
    this.fileInput.value = '';
  };

  /**
   * The rule between one kind of control and the next. It is decoration and
   * says nothing a reader of the markup does not already get from the groups,
   * so it is hidden from assistive technology.
   */
  private divider(): HTMLSpanElement {
    const rule = document.createElement('span');
    rule.className = 'plivet-controls__divider';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }

  /**
   * A row of related buttons, named after what they do rather than left to be
   * found by the order the bar happens to append them in.
   */
  private group(name: 'files' | 'debug' | 'zoom'): HTMLDivElement {
    const group = document.createElement('div');
    group.className = `plivet-controls__group plivet-controls__group--${name}`;
    return group;
  }

  /**
   * Open and Save, drawn rather than spelled. The bar's other pictures earned
   * the room they saved; these two are the last labels wide enough to push the
   * run controls onto a second line in a narrow embedding.
   */
  private fileGroup(): HTMLDivElement {
    const group = this.group('files');
    const save = this.fileButton(
      'save',
      strings.saveCode,
      strings.saveCodeHint,
      () => this.options.onSaveCode?.()
    );
    const load = this.fileButton(
      'open',
      strings.openCode,
      strings.openCodeHint,
      () => this.fileInput.click()
    );
    load.disabled = this.options.load !== true;
    group.append(save, load);
    return group;
  }

  /**
   * The name and the tooltip are not the same sentence: a picture needs a name
   * short enough to be read out with the others, and a reader who does not
   * recognise the picture needs the sentence that says what it opens or writes.
   */
  private fileButton(
    icon: IconName,
    label: string,
    hint: string,
    action: () => void
  ): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'plivet-controls__button';
    element.title = `${label} - ${hint}`;
    element.setAttribute('aria-label', label);
    element.appendChild(iconFor(icon));
    element.addEventListener('click', action);
    return element;
  }

  private debugGroup(): HTMLDivElement {
    const group = this.group('debug');
    group.setAttribute('role', 'toolbar');
    group.setAttribute('aria-label', strings.debugToolbar);
    group.append(
      this.dragHandle,
      this.debugButton('Start', 'Start', 'restart', 'start'),
      this.debugButton('Stop', 'Stop', 'stop', 'stop'),
      this.debugButton('BackAll', 'BackAll', 'rewind', 'move'),
      this.debugButton('StepBack', 'StepBack', 'stepBack', 'move'),
      this.debugButton('StepOver', 'StepOver', 'stepOver', 'move'),
      this.debugButton('Step', 'Step', 'stepInto', 'move'),
      this.debugButton('StepAll', 'StepAll', 'run', 'move')
    );
    if (this.options.build === true) {
      const divider = this.divider();
      divider.classList.add('plivet-controls__divider--debug');
      group.append(
        divider,
        this.fileButton('build', strings.buildCode, strings.buildCodeHint, () =>
          this.options.onBuild?.()
        )
      );
    }
    return group;
  }

  /**
   * The dotted grip at the left of the floating run controls. Pointer drags
   * move it freely inside this PLIVET instance; arrow keys provide the same
   * operation without a pointer, and Enter or a double-click puts it back.
   */
  private toolbarHandle(): HTMLButtonElement {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'plivet-controls__drag';
    handle.title = strings.moveDebugToolbar;
    handle.setAttribute('aria-label', strings.moveDebugToolbar);
    handle.addEventListener('pointerdown', this.dragStart);
    handle.addEventListener('pointermove', this.dragMove);
    handle.addEventListener('pointerup', this.dragEnd);
    handle.addEventListener('pointercancel', this.dragEnd);
    handle.addEventListener('keydown', this.dragKey);
    handle.addEventListener('dblclick', this.resetToolbarPosition);
    return handle;
  }

  private dragStart = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.pointer = event.pointerId ?? 0;
    if (typeof this.dragHandle.setPointerCapture === 'function') {
      this.dragHandle.setPointerCapture(this.pointer);
    }
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.startX = this.x;
    this.startY = this.y;
    this.debugToolbar.classList.add('plivet-controls__group--debug-dragging');
    event.preventDefault();
  };

  private dragMove = (event: PointerEvent): void => {
    if (this.pointer === null || (event.pointerId ?? 0) !== this.pointer) {
      return;
    }
    this.moveToolbar(
      this.startX + event.clientX - this.pointerX,
      this.startY + event.clientY - this.pointerY
    );
    event.preventDefault();
  };

  private dragEnd = (event: PointerEvent): void => {
    if (this.pointer === null || (event.pointerId ?? 0) !== this.pointer) {
      return;
    }
    if (typeof this.dragHandle.releasePointerCapture === 'function') {
      this.dragHandle.releasePointerCapture(this.pointer);
    }
    this.pointer = null;
    this.debugToolbar.classList.remove(
      'plivet-controls__group--debug-dragging'
    );
  };

  private dragKey = (event: KeyboardEvent): void => {
    const movement: Record<string, readonly [number, number]> = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    };
    const delta = movement[event.key];
    if (delta !== undefined) {
      this.moveToolbar(this.x + delta[0], this.y + delta[1]);
      event.preventDefault();
    } else if (event.key === 'Enter') {
      this.resetToolbarPosition();
      event.preventDefault();
    }
  };

  /** The visualizer the floating controls belong to and stay inside. */
  private boundary(): HTMLElement {
    return (
      this.root.closest<HTMLElement>('.plivet') ??
      this.root.parentElement ??
      this.root
    );
  }

  /** Keep the floating controls inside the application that owns them. */
  private moveToolbar(x: number, y: number): void {
    if (this.debugHome !== null) {
      // Fixed for the session: one placement holds the toolbar to the
      // visualizer, and a drag is an offset it clamps like any other.
      this.x = x;
      this.y = y;
      this.placeDebugToolbar();
    } else {
      const bounds = this.boundary().getBoundingClientRect();
      const toolbar = this.debugToolbar.getBoundingClientRect();
      const base = {
        left: toolbar.left - this.x,
        right: toolbar.right - this.x,
        top: toolbar.top - this.y,
        bottom: toolbar.bottom - this.y,
      };

      // jsdom and a detached widget have no layout. In a browser, clamp only on
      // an axis for which the owner has a measurable amount of room.
      this.x =
        bounds.width > 0
          ? this.clamp(x, bounds.left - base.left, bounds.right - base.right)
          : x;
      this.y =
        bounds.height > 0
          ? this.clamp(y, bounds.top - base.top, bounds.bottom - base.bottom)
          : y;
    }
    this.debugToolbar.style.setProperty('--plivet-debug-x', `${this.x}px`);
    this.debugToolbar.style.setProperty('--plivet-debug-y', `${this.y}px`);
  }

  private clamp(value: number, least: number, most: number): number {
    // An embedding narrower than the toolbar cannot contain both edges. Keep
    // its grip reachable at the nearer boundary instead of producing NaN or
    // making movement reverse direction.
    return most < least ? least : Math.min(Math.max(value, least), most);
  }

  private resetToolbarPosition = (): void => {
    this.x = 0;
    this.y = 0;
    this.debugToolbar.style.removeProperty('--plivet-debug-x');
    this.debugToolbar.style.removeProperty('--plivet-debug-y');
    this.placeDebugToolbar();
  };

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
    const group = this.group('zoom');
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
