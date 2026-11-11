import strings from '../../strings';
import './debugger.css';

export type DebuggerPanel = 'console' | 'breakpoints';

export interface DebuggerDockOptions {
  /**
   * Whether the dock's header carries the program-arguments field, where the
   * reader writes what `main` receives in `argv`. Default: it is not there.
   */
  programArgs?: boolean;
  /** The field's text when the dock opens: arguments as on a command line. */
  args?: string;
  /** The field's text, on every change the reader makes to it. */
  onArgs?: (text: string) => void;
}

/**
 * The utility dock below the editor, alongside the editor's other controls.
 *
 * It owns presentation only: which tab is visible and whether the dock is
 * collapsed. The console and breakpoint table mount into the two boxes it
 * exposes and keep their own behavior.
 *
 * The program's arguments are written in its header, beside the Console tab:
 * they are what the program is started with, as the console is what it reads
 * and prints, and the header stays in view while the dock is collapsed.
 */
export class DebuggerDock {
  readonly root: HTMLElement;
  readonly console: HTMLDivElement;
  readonly breakpoints: HTMLDivElement;

  private readonly consoleTab: HTMLButtonElement;
  private readonly breakpointsTab: HTMLButtonElement;
  private readonly count: HTMLSpanElement;
  /** Null unless the page asked for the program-arguments field. */
  private readonly args: HTMLInputElement | null = null;
  private readonly onArgs?: (text: string) => void;
  private selected: DebuggerPanel = 'console';
  private expanded = false;

  constructor(parent: HTMLElement, options: DebuggerDockOptions = {}) {
    this.onArgs = options.onArgs;
    this.root = document.createElement('section');
    this.root.className = 'plivet-debugger';
    this.root.setAttribute('aria-label', strings.debuggerPanels);

    const tabs = document.createElement('div');
    tabs.className = 'plivet-debugger__tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', strings.debuggerPanels);

    this.consoleTab = this.tab('console', strings.consoleTitle);
    this.breakpointsTab = this.tab('breakpoints', strings.breakpointsTitle);
    this.count = document.createElement('span');
    this.count.className = 'plivet-debugger__count';
    this.count.textContent = '0';
    this.breakpointsTab.appendChild(this.count);
    tabs.append(this.consoleTab, this.breakpointsTab);

    this.console = this.panel('console');
    this.breakpoints = this.panel('breakpoints');
    // The field is beside the tab list and not in it: a tab list holds tabs.
    const header = document.createElement('div');
    header.className = 'plivet-debugger__header';
    header.appendChild(tabs);
    if (options.programArgs === true) {
      const field = this.argsField(options.args ?? '');
      this.args = field.querySelector('input');
      header.appendChild(field);
    }
    this.root.append(header, this.console, this.breakpoints);
    parent.appendChild(this.root);
    this.render();
  }

  setBreakpointCount(count: number): void {
    this.count.textContent = String(Math.max(0, Math.trunc(count)));
  }

  showConsole(): void {
    this.show('console');
  }

  showBreakpoints(): void {
    this.show('breakpoints');
  }

  /** The program-arguments field's text; ignored where there is no field. */
  setArgs(text: string): void {
    if (this.args !== null) {
      this.args.value = text;
    }
  }

  destroy(): void {
    this.root.remove();
  }

  private tab(panel: DebuggerPanel, label: string): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'plivet-debugger__tab';
    tab.id = `plivet-debugger-${panel}-${DebuggerDock.nextId++}`;
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      if (this.selected === panel && this.expanded) {
        this.expanded = false;
        this.render();
        return;
      }
      this.show(panel);
    });
    return tab;
  }

  /**
   * The program's arguments, as a line typed on a command line. What is in
   * it is read when a run starts, so an edit applies at the next Start or
   * Run and never to the run under way.
   */
  private argsField(text: string): HTMLLabelElement {
    const field = document.createElement('label');
    field.className = 'plivet-debugger__args';
    field.title = strings.programArgsHint;
    const caption = document.createElement('span');
    caption.className = 'plivet-debugger__args-caption';
    caption.textContent = strings.programArgs;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'plivet-debugger__args-input';
    input.value = text;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', strings.programArgsLabel);
    input.addEventListener('input', () => this.onArgs?.(input.value));
    field.append(caption, input);
    return field;
  }

  private panel(panel: DebuggerPanel): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'plivet-debugger__panel';
    element.dataset.panel = panel;
    element.setAttribute('role', 'tabpanel');
    element.setAttribute(
      'aria-labelledby',
      panel === 'console' ? this.consoleTab.id : this.breakpointsTab.id
    );
    return element;
  }

  private show(panel: DebuggerPanel): void {
    this.selected = panel;
    this.expanded = true;
    this.render();
  }

  private render(): void {
    this.root.classList.toggle('plivet-debugger--collapsed', !this.expanded);
    for (const [panel, tab, content] of [
      ['console', this.consoleTab, this.console],
      ['breakpoints', this.breakpointsTab, this.breakpoints],
    ] as const) {
      const selected = panel === this.selected;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      content.hidden = !this.expanded || !selected;
    }
  }

  private static nextId = 1;
}
