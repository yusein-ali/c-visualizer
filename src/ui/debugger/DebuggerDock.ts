import strings from '../../strings';
import './debugger.css';

export type DebuggerPanel = 'console' | 'breakpoints';

/**
 * The utility dock below the editor, alongside the editor's other controls.
 *
 * It owns presentation only: which tab is visible and whether the dock is
 * collapsed. The console and breakpoint table mount into the two boxes it
 * exposes and keep their own behavior.
 */
export class DebuggerDock {
  readonly root: HTMLElement;
  readonly console: HTMLDivElement;
  readonly breakpoints: HTMLDivElement;

  private readonly consoleTab: HTMLButtonElement;
  private readonly breakpointsTab: HTMLButtonElement;
  private readonly count: HTMLSpanElement;
  private selected: DebuggerPanel = 'console';
  private expanded = false;

  constructor(parent: HTMLElement) {
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
    this.root.append(tabs, this.console, this.breakpoints);
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
