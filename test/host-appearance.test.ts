import { Plivet } from '../src';
import type { PlivetOptions, Theme } from '../src';
import { ControlBar } from '../src/ui/controls';
import strings from '../src/strings';

jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    setFocus(): void {}
    setDiagnostics(): void {}
    setDiagnosticActivity(): void {}
    setRunStatus(): void {}
    setDebugState(): void {}
    destroy(): void {}
  },
}));

/**
 * What a host that keeps the visualizer in step with its own page asks of
 * it (H3): the text size, the theme and when it changes, and a control bar
 * without the switches the host drives itself.
 */

const open = (options: PlivetOptions = {}) => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return { parent, plivet: new Plivet(parent, options) };
};

const zoom = (parent: HTMLElement, command: 'In' | 'Out' | 'Reset') =>
  parent
    .querySelectorAll<HTMLButtonElement>(
      '.plivet-controls__group--zoom .plivet-controls__button'
    )
    [['Out', 'Reset', 'In'].indexOf(command)].click();

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the text size', () => {
  it('is what the host sets, and what Reset returns to after', () => {
    const { parent, plivet } = open({ codeMirror: { font_size: 16 } });
    expect(plivet.getFontSize()).toBe(16);

    expect(plivet.setFontSize(20)).toBe(true);
    expect(plivet.getFontSize()).toBe(20);
    zoom(parent, 'In');
    expect(plivet.getFontSize()).toBe(21);
    zoom(parent, 'Reset');
    expect(plivet.getFontSize()).toBe(20);
    plivet.destroy();
  });

  it('refuses a size that is not a positive number', () => {
    const { plivet } = open();
    expect(plivet.setFontSize(0)).toBe(false);
    expect(plivet.setFontSize(Number.NaN)).toBe(false);
    expect(plivet.getFontSize()).toBe(14);
    plivet.destroy();
  });
});

describe('the theme', () => {
  it('reports changes from the control bar and from setTheme, once each', () => {
    const { parent, plivet } = open({ theme: 'light' });
    const heard: Theme[] = [];
    const stop = plivet.onThemeChange((theme) => heard.push(theme));
    expect(plivet.getTheme()).toBe('light');

    const select = parent.querySelector<HTMLSelectElement>(
      '.plivet-controls__theme'
    )!;
    select.value = 'dark';
    select.dispatchEvent(new Event('change'));
    expect(plivet.getTheme()).toBe('dark');

    plivet.setTheme('light');
    // Not a change, so not reported: a host that answers a change by calling
    // setTheme back is not told twice.
    plivet.setTheme('light');
    expect(heard).toEqual(['dark', 'light']);

    stop();
    plivet.setTheme('dark');
    expect(heard).toEqual(['dark', 'light']);
    expect(select.value).toBe('dark');
    plivet.destroy();
  });
});

describe('controls a host drives itself', () => {
  it('leaves the theme switch and the text-size buttons out of the DOM', () => {
    const { parent, plivet } = open({
      controls: { theme: false, textSize: false },
    });
    expect(parent.querySelector('.plivet-controls__theme')).toBeNull();
    expect(parent.querySelector('.plivet-controls__group--zoom')).toBeNull();
    // No rule is left with nothing beside it.
    const bar = parent.querySelector('.plivet-controls')!;
    const children = Array.from(bar.children);
    const last = children[children.length - 1];
    expect(last.classList.contains('plivet-controls__divider')).toBe(false);
    expect(
      parent.querySelector(`[aria-label="${strings.howToUse}"]`)
    ).not.toBeNull();

    // The methods behind them still work.
    plivet.setTheme('dark');
    expect(plivet.getTheme()).toBe('dark');
    expect(parent.querySelector('.plivet--dark')).not.toBeNull();
    plivet.setFontSize(18);
    expect(plivet.getFontSize()).toBe(18);
    plivet.destroy();
  });

  it('keeps both where nothing says otherwise', () => {
    const parent = document.createElement('div');
    const bar = new ControlBar(parent, { theme: true });
    expect(parent.querySelector('.plivet-controls__theme')).not.toBeNull();
    expect(
      parent.querySelector('.plivet-controls__group--zoom')
    ).not.toBeNull();
    bar.setDark(true);
    bar.destroy();

    const hidden = new ControlBar(parent, { theme: false });
    expect(() => hidden.setDark(true)).not.toThrow();
    hidden.destroy();
  });
});
