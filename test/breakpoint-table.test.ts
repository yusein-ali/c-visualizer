import { BreakpointTable } from '../src/ui/breakpoints';
import { DebuggerDock } from '../src/ui/debugger';
import strings from '../src/strings';

const parentOf = (): HTMLDivElement => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the breakpoint table', () => {
  const entries = [
    {
      path: 'main.c',
      line: 9,
      enabled: true,
      statement: 'for (int i = 0; i < ITEM_COUNT; i += 1) {',
      hits: 2,
    },
    {
      path: 'helper.c',
      line: 4,
      enabled: false,
      statement: 'return value;',
      hits: 0,
    },
  ];

  it('shows each source location as @ file: line', () => {
    const parent = parentOf();
    const table = new BreakpointTable(parent);
    table.setBreakpoints(entries);

    const locations = Array.from(
      parent.querySelectorAll('tbody .plivet-breakpoints__location')
    ).map((cell) => cell.textContent);
    expect(locations).toEqual(['@ main.c: 9', '@ helper.c: 4']);
    expect(parent.textContent).toContain('ITEM_COUNT');
    expect(parent.textContent).toContain('2');
    table.destroy();
  });

  it('navigates on a double-click but not a single click', () => {
    const parent = parentOf();
    const navigate = jest.fn();
    const table = new BreakpointTable(parent, { onNavigate: navigate });
    table.setBreakpoints(entries);
    const row = parent.querySelector('tbody tr') as HTMLTableRowElement;

    row.click();
    expect(navigate).not.toHaveBeenCalled();
    expect(row.classList).toContain('plivet-breakpoints__row--selected');

    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(navigate).toHaveBeenCalledWith('main.c', 9);
    table.destroy();
  });

  it('offers keyboard navigation, enablement and removal without a redundant action', () => {
    const parent = parentOf();
    const enabled = jest.fn();
    const remove = jest.fn();
    const navigate = jest.fn();
    const table = new BreakpointTable(parent, {
      onEnabled: enabled,
      onRemove: remove,
      onNavigate: navigate,
    });
    table.setBreakpoints(entries);

    const checkbox = parent.querySelector('tbody input') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(enabled).toHaveBeenCalledWith('main.c', 9, false);

    const row = parent.querySelector('tbody tr') as HTMLTableRowElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenCalledWith('main.c', 9);
    expect(parent.textContent).not.toContain('Go to');

    const removeButton = parent.querySelector(
      '.plivet-breakpoints__remove'
    ) as HTMLButtonElement;
    removeButton.click();
    expect(remove).toHaveBeenCalledWith('main.c', 9);
    table.destroy();
  });

  it('switches all rows to the opposite collective state', () => {
    const parent = parentOf();
    const allEnabled = jest.fn();
    const table = new BreakpointTable(parent, { onAllEnabled: allEnabled });
    table.setBreakpoints(entries);

    const toggle = parent.querySelector(
      '.plivet-breakpoints__all'
    ) as HTMLButtonElement;
    expect(toggle.textContent).toBe('Disable all');
    toggle.click();
    expect(allEnabled).toHaveBeenCalledWith(false);

    table.setBreakpoints(
      entries.map((entry) => ({ ...entry, enabled: false }))
    );
    expect(toggle.textContent).toBe('Enable all');
    toggle.click();
    expect(allEnabled).toHaveBeenLastCalledWith(true);
    table.destroy();
  });
});

describe('the debugger dock', () => {
  it('shares one collapsible region between Console and Breakpoints', () => {
    const parent = parentOf();
    const dock = new DebuggerDock(parent);
    const tabs = parent.querySelectorAll<HTMLButtonElement>(
      '.plivet-debugger__tab'
    );

    expect(dock.console.hidden).toBe(true);
    expect(dock.breakpoints.hidden).toBe(true);

    dock.setBreakpointCount(3);
    tabs[1].click();
    expect(dock.breakpoints.hidden).toBe(false);
    expect(dock.console.hidden).toBe(true);
    expect(tabs[1].textContent).toContain('3');

    tabs[1].click();
    expect(dock.breakpoints.hidden).toBe(true);

    dock.showConsole();
    expect(dock.console.hidden).toBe(false);
    expect(dock.breakpoints.hidden).toBe(true);
    dock.destroy();
  });

  it('carries no program-arguments field unless asked for one', () => {
    const parent = parentOf();
    const dock = new DebuggerDock(parent);
    expect(parent.querySelector('.plivet-debugger__args')).toBeNull();
    dock.destroy();
  });

  it('holds the program arguments in its header and reports each edit', () => {
    const parent = parentOf();
    const edits: string[] = [];
    const dock = new DebuggerDock(parent, {
      programArgs: true,
      args: 'one "two words"',
      onArgs: (text) => edits.push(text),
    });
    const input = parent.querySelector(
      '.plivet-debugger__args input'
    ) as HTMLInputElement;
    expect(input.value).toBe('one "two words"');
    expect(input.getAttribute('aria-label')).toBe(strings.programArgsLabel);
    expect(
      parent.querySelector('.plivet-debugger__args')!.textContent
    ).toContain(strings.programArgs);
    // Beside the tab list, not inside it, and in view while it is collapsed.
    expect(input.closest('[role="tablist"]')).toBeNull();
    expect(input.closest('.plivet-debugger__header')).not.toBeNull();
    expect(dock.console.hidden).toBe(true);

    input.value = 'three';
    input.dispatchEvent(new Event('input'));
    expect(edits).toEqual(['three']);

    dock.setArgs('four five');
    expect(input.value).toBe('four five');
    expect(edits).toEqual(['three']);
    dock.destroy();
  });
});
