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
  it('always identifies the panel as the STDIO Console', () => {
    const { parent } = mount();
    const title = parent.querySelector('.plivet-console-title');

    expect(title?.textContent).toBe('STDIO Console');
    expect(
      parent.querySelector('.plivet-console')?.getAttribute('aria-label')
    ).toBe('STDIO Console');
  });

  it('shows what the program printed, as text', () => {
    const { console, output } = mount();
    console.setOutput('<not markup>\n');
    expect(output.textContent).toBe('<not markup>\n');
    expect(output.querySelector('*')).toBeNull();
  });
});

describe('input', () => {
  it('is typable exactly while the program is blocked on a read', () => {
    const { console, field } = mount();
    expect(field.disabled).toBe(true);
    console.setAccepting(true);
    expect(field.disabled).toBe(false);
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

describe('lifecycle', () => {
  it('takes its markup with it', () => {
    const { console, parent } = mount();
    console.destroy();
    expect(parent.childElementCount).toBe(0);
  });
});
