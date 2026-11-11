import { Plivet } from '../src';
import { DescriptionPanel } from '../src/ui/description';
import strings from '../src/strings';

/* The canvas needs a browser; the panel above the editor does not. */
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
 * The task a host hands over, shown above the editor: the widget on its own,
 * then the option and the method a host reaches it through.
 */

const TASK =
  '<p><strong>Complete the loop.</strong> Store every reading in ' +
  '<code>samples</code>.</p>' +
  '<ol><li>See <a href="https://example.org/manual.html">the manual</a>.</li>' +
  '<li>Read <a href="#limits">the limits</a>.</li></ol>' +
  '<p id="limits">At most 16 channels.</p>';

const parentOf = (): HTMLDivElement => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

const bodyOf = (root: ParentNode): HTMLElement =>
  root.querySelector<HTMLElement>('.plivet-description__body')!;

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('DescriptionPanel', () => {
  it('shows the markup under a Task heading, open to begin with', () => {
    const panel = new DescriptionPanel(parentOf(), { html: TASK });

    expect(panel.root.hidden).toBe(false);
    expect(panel.root.open).toBe(true);
    expect(
      panel.root.querySelector('.plivet-description__summary')?.textContent
    ).toBe(strings.taskDescription);
    expect(bodyOf(panel.root).querySelector('code')?.textContent).toBe(
      'samples'
    );
    panel.destroy();
  });

  it('starts folded when asked to', () => {
    const panel = new DescriptionPanel(parentOf(), {
      html: TASK,
      open: false,
    });
    expect(panel.root.open).toBe(false);
    panel.destroy();
  });

  it('is hidden while there is no task, or only whitespace', () => {
    const panel = new DescriptionPanel(parentOf());
    expect(panel.root.hidden).toBe(true);

    panel.setDescription('  \n ');
    expect(panel.root.hidden).toBe(true);

    panel.setDescription(TASK);
    expect(panel.root.hidden).toBe(false);

    panel.setDescription('');
    expect(panel.root.hidden).toBe(true);
    expect(bodyOf(panel.root).childNodes).toHaveLength(0);
    panel.destroy();
  });

  it('sends links to a new tab, and keeps links within the task', () => {
    const panel = new DescriptionPanel(parentOf(), { html: TASK });
    const [away, within] = Array.from(bodyOf(panel.root).querySelectorAll('a'));

    expect(away.target).toBe('_blank');
    expect(away.rel).toBe('noopener noreferrer');
    expect(within.hasAttribute('target')).toBe(false);
    panel.destroy();
  });

  it('keeps the reader folding it away across a new task', () => {
    const panel = new DescriptionPanel(parentOf(), { html: TASK });
    panel.root.open = false;

    panel.setDescription('<p>Now sort them.</p>');
    expect(panel.root.open).toBe(false);
    expect(bodyOf(panel.root).textContent).toBe('Now sort them.');
    panel.destroy();
  });

  it('takes its element with it', () => {
    const parent = parentOf();
    const panel = new DescriptionPanel(parent, { html: TASK });
    panel.destroy();
    expect(parent.querySelector('.plivet-description')).toBeNull();
  });
});

describe('the description option', () => {
  it('puts the task between the control bar and the editor', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, { description: TASK });

    const side = parent.querySelector('.plivet__side')!;
    const boxes = Array.from(side.children).map((box) => box.className);
    expect(boxes.indexOf('plivet__description')).toBe(
      boxes.indexOf('plivet__controls') + 1
    );
    // The program's arguments, when the page asks for them, come between
    // the task and the editor; without them their box is empty.
    expect(boxes.indexOf('plivet__args')).toBe(
      boxes.indexOf('plivet__description') + 1
    );
    expect(boxes.indexOf('plivet__editor')).toBe(
      boxes.indexOf('plivet__args') + 1
    );
    expect(side.querySelector('.plivet__args')!.children).toHaveLength(0);
    const panel = parent.querySelector<HTMLDetailsElement>(
      '.plivet__description > .plivet-description'
    )!;
    expect(panel.hidden).toBe(false);
    expect(bodyOf(panel).querySelector('strong')?.textContent).toBe(
      'Complete the loop.'
    );
    plivet.destroy();
  });

  it('builds a hidden panel when there is no task', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent);

    expect(
      parent.querySelector<HTMLDetailsElement>('.plivet-description')?.hidden
    ).toBe(true);
    plivet.destroy();
  });

  it('is replaced by setDescription, and hidden by a blank one', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent);
    const panel = parent.querySelector<HTMLDetailsElement>(
      '.plivet-description'
    )!;

    plivet.setDescription('<p>Sum the readings.</p>');
    expect(panel.hidden).toBe(false);
    expect(bodyOf(panel).textContent).toBe('Sum the readings.');

    plivet.setDescription('');
    expect(panel.hidden).toBe(true);
    plivet.destroy();
  });

  it('drops a description that is not a string, with a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const parent = parentOf();
    const plivet = new Plivet(parent, {
      description: 42 as unknown as string,
    });

    expect(
      parent.querySelector<HTMLDetailsElement>('.plivet-description')?.hidden
    ).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'c-visualizer: description must be a string of HTML and was ignored'
    );

    warn.mockClear();
    plivet.setDescription(null as unknown as string);
    expect(warn).not.toHaveBeenCalled();
    plivet.destroy();
  });
});
