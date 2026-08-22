import { highlightingFor } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { PlivetEditor } from '../src/ui/editor';

const token = (parent: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(parent.querySelectorAll<HTMLElement>('.cm-content span')).find(
    (span) => span.textContent === text
  );

describe('C syntax highlighting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives C functions, variables, operators and literals distinct styles', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = new PlivetEditor(parent, {
      doc: 'int total = printf("%d", count + 1);',
    });
    const state = editor.view.state;
    const functionClass = highlightingFor(state, [
      tags.function(tags.variableName),
    ]);
    const variableClass = highlightingFor(state, [tags.variableName]);
    const operatorClass = highlightingFor(state, [tags.operator]);
    const numberClass = highlightingFor(state, [tags.number]);

    expect(functionClass).not.toBeNull();
    expect(variableClass).not.toBeNull();
    expect(operatorClass).not.toBeNull();
    expect(numberClass).not.toBeNull();
    expect(
      new Set([functionClass, variableClass, operatorClass, numberClass]).size
    ).toBe(4);
    expect(token(parent, 'printf')?.classList.contains(functionClass!)).toBe(
      true
    );
    expect(token(parent, 'count')?.classList.contains(variableClass!)).toBe(
      true
    );
    expect(token(parent, '+')?.classList.contains(operatorClass!)).toBe(true);
    expect(token(parent, '1')?.classList.contains(numberClass!)).toBe(true);

    editor.destroy();
  });

  it('keeps syntax highlighting when the theme changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = new PlivetEditor(parent, {
      doc: 'int main(void) { return 0; }',
    });

    expect(token(parent, 'return')).toBeDefined();
    editor.setDark(true);
    expect(token(parent, 'return')).toBeDefined();
    editor.setDark(false);
    expect(token(parent, 'return')).toBeDefined();

    editor.destroy();
  });
});
