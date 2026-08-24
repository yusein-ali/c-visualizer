import { Plivet } from '../src/index';

/*
 * The visualization is stubbed, and only here. JointJS turns its vectorizer
 * off when `window.SVGAngle` is missing, which is jsdom - `V.prototype` ends
 * up empty and constructing a `dia.Paper` throws. The canvas is checked in a
 * browser; what this file is about is one instance's wiring not reaching
 * another's, and the graph is a widget like the rest of them here.
 */
jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    constructor(
      private readonly container: HTMLElement,
      options: { dark?: boolean } = {}
    ) {
      this.container.classList.add('plivet-graph');
      this.setDark(options.dark ?? false);
    }
    render(): void {}
    setScale(): void {}
    setDiagnostics(): void {}
    setDiagnosticActivity(): void {}
    setRunStatus(): void {}
    setDebugState(): void {}
    setDark(dark: boolean): void {
      this.container.classList.toggle('plivet-graph--dark', dark);
    }
    destroy(): void {
      this.container.classList.remove('plivet-graph');
    }
  },
}));

/**
 * Phase 10's exit criterion, as far as jsdom can carry it: two instances on
 * one page that do not touch each other. What needs a Worker - stepping one
 * program while the other runs - is checked in a browser against `dev.html`;
 * what is checked here is that the wiring above the Worker is per instance.
 */

const parentOf = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

const themeSwitchOf = (parent: HTMLElement) =>
  parent.querySelector('.plivet-controls__theme') as HTMLSelectElement;

const isDark = (parent: HTMLElement) =>
  (parent.querySelector('.plivet') as HTMLElement).classList.contains(
    'plivet--dark'
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('two instances on one page', () => {
  it('each build their own interface, in their own element', () => {
    const first = parentOf();
    const second = parentOf();
    const a = new Plivet(first);
    const b = new Plivet(second);

    expect(first.querySelectorAll('.plivet')).toHaveLength(1);
    expect(second.querySelectorAll('.plivet')).toHaveLength(1);
    expect(document.querySelectorAll('.plivet-controls')).toHaveLength(2);
    expect(document.querySelectorAll('.cm-editor')).toHaveLength(2);

    a.destroy();
    b.destroy();
  });

  it('open with the program and the theme they were given', () => {
    const first = parentOf();
    const second = parentOf();
    const a = new Plivet(first, { sourceCode: 'int main(void) { return 1; }' });
    const b = new Plivet(second, { theme: 'dark' });

    expect(first.textContent).toContain('return 1;');
    expect(second.textContent).not.toContain('return 1;');
    expect(isDark(first)).toBe(false);
    expect(isDark(second)).toBe(true);
    expect(first.querySelector('.plivet-graph--dark')).toBeNull();
    expect(second.querySelector('.plivet-graph--dark')).not.toBeNull();

    a.destroy();
    b.destroy();
  });

  /** The bus is the instance's own, so a theme chosen in one stays in one. */
  it('do not re-theme each other', () => {
    const first = parentOf();
    const second = parentOf();
    const a = new Plivet(first);
    const b = new Plivet(second);

    const theme = themeSwitchOf(first);
    theme.value = 'dark';
    theme.dispatchEvent(new Event('change'));

    expect(isDark(first)).toBe(true);
    expect(isDark(second)).toBe(false);
    expect(first.querySelector('.plivet-graph--dark')).not.toBeNull();
    expect(second.querySelector('.plivet-graph--dark')).toBeNull();
    expect(themeSwitchOf(second).value).toBe('light');

    a.destroy();
    b.destroy();
  });

  it('leave the other one standing when destroyed', () => {
    const first = parentOf();
    const second = parentOf();
    const a = new Plivet(first);
    const b = new Plivet(second);

    a.destroy();

    expect(first.querySelectorAll('.plivet')).toHaveLength(0);
    expect(second.querySelectorAll('.plivet')).toHaveLength(1);

    const theme = themeSwitchOf(second);
    theme.value = 'dark';
    theme.dispatchEvent(new Event('change'));
    expect(isDark(second)).toBe(true);

    b.destroy();
  });
});
