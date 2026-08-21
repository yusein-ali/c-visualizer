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
    status: parent.querySelector('.plivet-controls__status') as HTMLElement,
    theme: parent.querySelector('select') as HTMLSelectElement,
    help: parent.querySelector('.plivet-controls__help') as HTMLButtonElement,
    helped: () => helped,
  };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the debug controls', () => {
  it('enables exactly what the debug state allows', () => {
    const { bar, debug } = mount();

    // No session: the two forward buttons are what starts one.
    expect(debug.map((button) => button.disabled)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);

    bar.setDebugState('Debugging', 4);
    expect(debug.every((button) => !button.disabled)).toBe(true);

    bar.setDebugState('EOF', 9);
    expect(debug.map((button) => button.disabled)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('sends the command the state binds the forward buttons to', () => {
    const { bar, debug, commands } = mount();

    debug[4].click();
    debug[5].click();
    expect(commands).toEqual(['Start', 'Exec']);

    bar.setDebugState('Debugging', 1);
    debug[4].click();
    debug[5].click();
    expect(commands.slice(2)).toEqual(['Step', 'StepAll']);
  });

  it('titles a button with the command it currently carries', () => {
    const { bar, debug } = mount();

    expect(debug[5].title).toBe(strings.debugExec);
    bar.setDebugState('First', 0);
    expect(debug[5].title).toBe(strings.debugStepAll);
    // The title is the button's accessible name: the icon inside it is
    // decorative, and there is no text.
    expect(debug[5].getAttribute('aria-label')).toBe(strings.debugStepAll);
  });

  it('counts steps only while there are steps to count', () => {
    const { bar, status } = mount();

    expect(status.textContent).toBe(`${strings.debugStatus}: Stop`);
    bar.setDebugState('Debugging', 12);
    expect(status.textContent).toBe(`${strings.debugStatus}: Step 12`);
    bar.setDebugState('EOF', 12);
    expect(status.textContent).toBe(`${strings.debugStatus}: EOF`);
  });

  it('answers for every debug state', () => {
    const { bar, status } = mount();
    const states: DEBUG_STATE[] = [
      'Stop',
      'First',
      'Debugging',
      'stdin',
      'Executing',
      'EOF',
    ];
    for (const state of states) {
      bar.setDebugState(state, 1);
      expect(status.textContent).not.toBe('');
    }
  });
});

describe('the rest of the bar', () => {
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
