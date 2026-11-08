import { PlivetConsole } from '../src/ui/console';

const mount = (onInput?: (text: string) => void) => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const console = new PlivetConsole(parent, { onInput });
  const output = parent.querySelector('pre') as HTMLPreElement;
  const field = parent.querySelector('textarea') as HTMLTextAreaElement;
  return { console, parent, output, field };
};

const press = (field: HTMLTextAreaElement, init: KeyboardEventInit) =>
  field.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('output', () => {
  it('identifies the panel as the standard streams', () => {
    const { parent } = mount();
    const title = parent.querySelector('.plivet-console-title');

    expect(title?.textContent).toBe('Standard streams');
    expect(
      parent.querySelector('.plivet-console')?.getAttribute('aria-label')
    ).toBe('Standard streams');
  });

  it('starts collapsed and can be toggled from its summary', () => {
    const { console, parent } = mount();
    const disclosure = console.root as HTMLDetailsElement;

    expect(disclosure.open).toBe(false);
    expect(parent.querySelector('summary')?.textContent).toBe(
      'Standard streams'
    );
    disclosure.open = true;
    expect(disclosure.open).toBe(true);
    disclosure.open = false;
    expect(disclosure.open).toBe(false);
  });

  it('shows what the program printed, as text', () => {
    const { console, output } = mount();
    console.setOutput('<not markup>\n');
    expect(output.textContent).toBe('<not markup>\n');
    expect(output.querySelector('*')).toBeNull();
    expect((console.root as HTMLDetailsElement).open).toBe(true);
  });

  it('lets a tabbed dock provide the heading and reveal new output', () => {
    const parent = document.createElement('div');
    const reveal = jest.fn();
    const console = new PlivetConsole(parent, {
      heading: false,
      onReveal: reveal,
    });

    expect(parent.querySelector('summary')).toBeNull();
    expect(console.root.tagName).toBe('SECTION');
    expect(console.root.textContent).not.toContain('Details');
    console.setOutput('printed');
    expect(reveal).toHaveBeenCalledTimes(1);
    console.setOutput('');
    expect(reveal).toHaveBeenCalledTimes(1);
    console.setAccepting(true);
    expect(reveal).toHaveBeenCalledTimes(2);
    console.destroy();
  });
});

describe('input', () => {
  it('is typable exactly while the program is blocked on a read', () => {
    const { console, field } = mount();
    expect(field.disabled).toBe(true);
    console.setAccepting(true);
    expect(field.disabled).toBe(false);
    expect((console.root as HTMLDetailsElement).open).toBe(true);
    console.setAccepting(false);
    expect(field.disabled).toBe(true);
  });

  it('submits the typed line on Enter and clears the field', () => {
    const submitted: string[] = [];
    const { console, field } = mount((text) => submitted.push(text));
    console.setAccepting(true);
    field.value = '42';
    press(field, { key: 'Enter' });
    expect(submitted).toEqual(['42']);
    expect(field.value).toBe('');
    // Nothing is waiting for a second value until the next response says so.
    expect(field.disabled).toBe(true);
  });

  it('submits an empty line, which is a legitimate answer to a read', () => {
    const submitted: string[] = [];
    const { console, field } = mount((text) => submitted.push(text));
    console.setAccepting(true);
    press(field, { key: 'Enter' });
    expect(submitted).toEqual(['']);
  });

  it('keeps Shift+Enter for the several values one read can consume', () => {
    const submitted: string[] = [];
    const { console, field } = mount((text) => submitted.push(text));
    console.setAccepting(true);
    field.value = '3';
    expect(press(field, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(submitted).toEqual([]);
  });

  it('ignores the Enter that commits an IME candidate', () => {
    const submitted: string[] = [];
    const { console, field } = mount((text) => submitted.push(text));
    console.setAccepting(true);
    field.value = 'あ';
    press(field, { key: 'Enter', isComposing: true } as KeyboardEventInit);
    expect(submitted).toEqual([]);
  });

  it('sends nothing when the field is not accepting input', () => {
    const submitted: string[] = [];
    const { field } = mount((text) => submitted.push(text));
    field.value = 'typed anyway';
    press(field, { key: 'Enter' });
    expect(submitted).toEqual([]);
  });

  it('drops a half-typed line when the program stops waiting', () => {
    const { console, field } = mount();
    console.setAccepting(true);
    field.value = 'half';
    console.setAccepting(false);
    expect(field.value).toBe('');
  });
});

describe('the end of input', () => {
  const mountEnding = () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const lines: string[] = [];
    const ended: string[] = [];
    const console = new PlivetConsole(parent, {
      onInput: (text) => lines.push(text),
      onEndOfInput: (text) => ended.push(text),
    });
    const field = parent.querySelector('textarea') as HTMLTextAreaElement;
    const button = parent.querySelector(
      '.plivet-console-end'
    ) as HTMLButtonElement;
    return { console, field, button, lines, ended };
  };

  it('offers a button beside the field, usable only while a read waits', () => {
    const { console, field, button, ended } = mountEnding();
    expect(button.parentElement).toBe(field.parentElement);
    expect(button.type).toBe('button');
    expect(button.title).toContain('Ctrl+D');
    expect(button.disabled).toBe(true);
    button.click();
    expect(ended).toEqual([]);

    console.setAccepting(true);
    expect(button.disabled).toBe(false);
    button.click();
    expect(ended).toEqual(['']);
    // Nothing is waiting any more, until the next response says so.
    expect(button.disabled).toBe(true);
    expect(field.disabled).toBe(true);
  });

  it('ends the input on Ctrl+D, with whatever was typed before it', () => {
    const { console, field, lines, ended } = mountEnding();
    console.setAccepting(true);
    field.value = 'partial';
    expect(press(field, { key: 'd', ctrlKey: true })).toBe(false);
    expect(ended).toEqual(['partial']);
    expect(lines).toEqual([]);
    expect(field.value).toBe('');
  });

  it('leaves Command+D and Ctrl+Shift+D to the browser', () => {
    const { console, field, ended } = mountEnding();
    console.setAccepting(true);
    expect(press(field, { key: 'd', metaKey: true })).toBe(true);
    expect(press(field, { key: 'D', ctrlKey: true, shiftKey: true })).toBe(
      true
    );
    expect(ended).toEqual([]);
  });

  it('does nothing on Ctrl+D when no read is waiting', () => {
    const { field, ended } = mountEnding();
    press(field, { key: 'd', ctrlKey: true });
    expect(ended).toEqual([]);
  });
});

describe('standard error', () => {
  it('draws the spans the program wrote to stderr in the error colour', () => {
    const { console, output } = mount();
    console.setOutput('one\nbad\ntwo\nworse', [
      { start: 4, end: 8 },
      { start: 12, end: 17 },
    ]);
    expect(output.textContent).toBe('one\nbad\ntwo\nworse');
    const errors = Array.from(
      output.querySelectorAll('.plivet-console-stderr')
    ).map((span) => span.textContent);
    expect(errors).toEqual(['bad\n', 'worse']);
  });

  it('redraws when only the spans change, and drops them when they go', () => {
    const { console, output } = mount();
    console.setOutput('same', []);
    console.setOutput('same', [{ start: 0, end: 4 }]);
    expect(output.querySelectorAll('.plivet-console-stderr')).toHaveLength(1);
    console.setOutput('same');
    expect(output.querySelectorAll('.plivet-console-stderr')).toHaveLength(0);
    expect(output.textContent).toBe('same');
  });

  it('clips a span that runs past the output', () => {
    const { console, output } = mount();
    console.setOutput('ab', [{ start: 1, end: 9 }]);
    expect(output.textContent).toBe('ab');
    expect(output.querySelector('.plivet-console-stderr')!.textContent).toBe(
      'b'
    );
  });
});

describe('lifecycle', () => {
  it('takes its markup with it', () => {
    const { console, parent } = mount();
    console.destroy();
    expect(parent.childElementCount).toBe(0);
  });
});
