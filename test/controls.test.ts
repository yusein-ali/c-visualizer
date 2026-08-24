import { ControlBar } from '../src/ui/controls';
import { CONTROL_EVENT, DEBUG_STATE } from '../src/core';
import strings from '../src/strings';

const mount = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const commands: CONTROL_EVENT[] = [];
  const zooms: string[] = [];
  const themes: boolean[] = [];
  let helped = 0;
  const bar = new ControlBar(parent, {
    onDebug: (command) => commands.push(command),
    onZoom: (command) => zooms.push(command),
    onTheme: (dark) => themes.push(dark),
    onHelp: () => (helped += 1),
  });
  const inGroup = (name: string) =>
    Array.from(
      parent.querySelectorAll<HTMLButtonElement>(
        `.plivet-controls__group--${name} .plivet-controls__button`
      )
    );
  return {
    bar,
    parent,
    commands,
    zooms,
    themes,
    files: inGroup('files'),
    debug: inGroup('debug'),
    zoom: inGroup('zoom'),
    toolbar: parent.querySelector(
      '.plivet-controls__group--debug'
    ) as HTMLElement,
    dragHandle: parent.querySelector(
      '.plivet-controls__drag'
    ) as HTMLButtonElement,
    theme: parent.querySelector('select') as HTMLSelectElement,
    help: parent.querySelector(
      `[aria-label="${strings.howToUse}"]`
    ) as HTMLButtonElement,
    helped: () => helped,
  };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the debug controls', () => {
  it('moves from its grip and resets to its centred position', () => {
    const { toolbar, dragHandle } = mount();
    const owner = toolbar.closest('.plivet-controls')
      ?.parentElement as HTMLElement;
    owner.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 400,
        width: 600,
        height: 400,
      }) as DOMRect;
    toolbar.getBoundingClientRect = () =>
      ({
        left: 180,
        top: 60,
        right: 420,
        bottom: 96,
        width: 240,
        height: 36,
      }) as DOMRect;

    dragHandle.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 200,
        clientY: 70,
      })
    );
    dragHandle.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 280,
        clientY: 120,
      })
    );
    dragHandle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    expect(toolbar.style.getPropertyValue('--plivet-debug-x')).toBe('80px');
    expect(toolbar.style.getPropertyValue('--plivet-debug-y')).toBe('50px');

    dragHandle.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })
    );
    expect(toolbar.style.getPropertyValue('--plivet-debug-x')).toBe('');
    expect(toolbar.style.getPropertyValue('--plivet-debug-y')).toBe('');
  });

  it('opens below the rendered file tabs', () => {
    const { bar, toolbar } = mount();
    const tabs = document.createElement('div');
    tabs.getBoundingClientRect = () => ({ height: 42 }) as DOMRect;

    bar.setDebugToolbarTabs(tabs);

    expect(toolbar.style.getPropertyValue('--plivet-debug-tabs-height')).toBe(
      '42px'
    );
  });

  it('offers keyboard movement from a named grip', () => {
    const { toolbar, dragHandle } = mount();

    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe(strings.debugToolbar);
    expect(dragHandle.getAttribute('aria-label')).toBe(
      strings.moveDebugToolbar
    );
    dragHandle.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })
    );
    dragHandle.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
    );

    expect(toolbar.style.getPropertyValue('--plivet-debug-x')).toBe('16px');
    expect(toolbar.style.getPropertyValue('--plivet-debug-y')).toBe('16px');
  });

  it('enables exactly what the debug state allows', () => {
    const { bar, debug } = mount();

    // No session: the two forward buttons are what starts one.
    expect(debug.map((button) => button.disabled)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);

    bar.setDebugState('Debugging');
    expect(debug.every((button) => !button.disabled)).toBe(true);

    bar.setDebugState('EOF');
    expect(debug.map((button) => button.disabled)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('sends the command the state binds the forward buttons to', () => {
    const { bar, debug, commands } = mount();

    debug[5].click();
    debug[6].click();
    expect(commands).toEqual(['Start', 'Exec']);

    bar.setDebugState('Debugging');
    debug[5].click();
    debug[6].click();
    expect(commands.slice(2)).toEqual(['Step', 'StepAll']);
  });

  it('titles a button with the command it currently carries', () => {
    const { bar, debug } = mount();

    expect(debug[6].title).toBe(strings.debugExec);
    bar.setDebugState('First');
    expect(debug[6].title).toBe(strings.debugStepAll);
    // The title is the button's accessible name: the icon inside it is
    // decorative, and there is no text.
    expect(debug[6].getAttribute('aria-label')).toBe(strings.debugStepAll);
  });

  it('sends Step Over as its own debug command', () => {
    const { bar, debug, commands } = mount();
    bar.setDebugState('Debugging');

    expect(debug[4].title).toBe(strings.debugStepOver);
    debug[4].click();
    expect(commands).toEqual(['StepOver']);
  });

  it('does not repeat the canvas debug status in the control bar', () => {
    const { bar, parent } = mount();
    const states: DEBUG_STATE[] = [
      'Stop',
      'First',
      'Debugging',
      'stdin',
      'Executing',
      'EOF',
    ];
    for (const state of states) {
      bar.setDebugState(state);
    }
    expect(parent.querySelector('.plivet-controls__status')).toBeNull();
    expect(parent.textContent).not.toContain('DebugStatus');
  });
});

describe('the rest of the bar', () => {
  it('orders the utility groups with theme last and separates them', () => {
    const { parent } = mount();
    const root = parent.querySelector('.plivet-controls')!;
    const utilityOrder = Array.from(root.children)
      .filter(
        (element) =>
          element.classList.contains('plivet-controls__group--files') ||
          element.getAttribute('aria-label') === strings.preprocessedButton ||
          element.classList.contains('plivet-controls__group--zoom') ||
          element.getAttribute('aria-label') === strings.howToUse ||
          element.getAttribute('aria-label') === strings.theme
      )
      .map(
        (element) =>
          Array.from(element.classList).find((name) =>
            name.startsWith('plivet-controls__group--')
          ) ?? element.getAttribute('aria-label')
      );

    expect(utilityOrder).toEqual([
      'plivet-controls__group--files',
      strings.preprocessedButton,
      'plivet-controls__group--zoom',
      strings.howToUse,
      strings.theme,
    ]);
    expect(
      parent.querySelectorAll('.plivet-controls > .plivet-controls__divider')
    ).toHaveLength(4);
  });

  it('adds Build only when a host-backed build is configured', () => {
    const parent = document.createElement('div');
    let builds = 0;
    const without = new ControlBar(parent);
    expect(parent.querySelector('[aria-label="Build"]')).toBeNull();
    without.destroy();

    const withBuild = new ControlBar(parent, {
      build: true,
      onBuild: () => (builds += 1),
    });
    const button = parent.querySelector<HTMLButtonElement>(
      '[aria-label="Build"]'
    );
    const groups = Array.from(
      parent.querySelectorAll<HTMLElement>('.plivet-controls__group')
    ).map((group) =>
      Array.from(group.classList).find((name) =>
        name.startsWith('plivet-controls__group--')
      )
    );
    expect(groups).toEqual([
      'plivet-controls__group--files',
      'plivet-controls__group--debug',
      'plivet-controls__group--zoom',
    ]);
    expect(button?.closest('.plivet-controls__group--debug')).not.toBeNull();
    expect(
      button?.previousElementSibling?.classList.contains(
        'plivet-controls__divider--debug'
      )
    ).toBe(true);
    button?.click();
    expect(builds).toBe(1);
    withBuild.destroy();
  });

  it('reports the editor text size the user asked for', () => {
    const { zoom, zooms } = mount();
    for (const button of zoom) {
      button.click();
    }
    expect(zooms).toEqual(['Out', 'Reset', 'In']);
  });

  it('reports a theme chosen from the switch', () => {
    const { theme, themes } = mount();

    theme.value = 'dark';
    theme.dispatchEvent(new Event('change'));
    expect(themes).toEqual([true]);

    theme.value = 'light';
    theme.dispatchEvent(new Event('change'));
    expect(themes).toEqual([true, false]);
  });

  it('follows a theme it did not choose', () => {
    const { bar, theme } = mount();
    bar.setDark(true);
    expect(theme.value).toBe('dark');
  });

  it('opens the instructions', () => {
    const { help, helped } = mount();
    help.click();
    expect(helped()).toBe(1);
  });
});
