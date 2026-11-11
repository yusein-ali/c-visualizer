import { ProgramArgsField } from '../src/ui/args';
import strings from '../src/strings';

const parentOf = (): HTMLDivElement => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

describe('the program-arguments field', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('holds the arguments as written and reports each edit', () => {
    const parent = parentOf();
    const edits: string[] = [];
    const field = new ProgramArgsField(parent, {
      args: 'one "two words"',
      onArgs: (text) => edits.push(text),
    });
    const input = parent.querySelector(
      '.plivet-args input'
    ) as HTMLInputElement;
    expect(input.value).toBe('one "two words"');
    expect(input.getAttribute('aria-label')).toBe(strings.programArgsLabel);
    expect(parent.querySelector('.plivet-args')!.textContent).toContain(
      strings.programArgs
    );
    expect(field.root.title).toBe(strings.programArgsHint);

    input.value = 'three';
    input.dispatchEvent(new Event('input'));
    expect(edits).toEqual(['three']);

    // A change made for the reader is not reported as the reader's edit.
    field.setArgs('four five');
    expect(input.value).toBe('four five');
    expect(edits).toEqual(['three']);

    field.destroy();
    expect(parent.querySelector('.plivet-args')).toBeNull();
  });

  it('opens empty without arguments', () => {
    const parent = parentOf();
    new ProgramArgsField(parent);
    expect(
      (parent.querySelector('.plivet-args input') as HTMLInputElement).value
    ).toBe('');
  });
});
