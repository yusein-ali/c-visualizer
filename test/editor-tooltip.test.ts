import { formatAddress } from '../src/core';
import { hoverDom } from '../src/ui/editor';
import { factLines, linesOf } from './records';
import {
  HoverTextSource,
  formatFunctionDeclaration,
  formatEnumerator,
  formatRecordField,
  formatTypeDeclaration,
  formatVariableDeclaration,
} from '../src/app/hoverText';

describe('editor tooltip addresses', () => {
  it('formats addresses as uppercase hexadecimal', () => {
    expect(formatAddress(0)).toBe('0x0');
    expect(formatAddress(0xabcd)).toBe('0xABCD');
  });

  it('says what a variable holds and where it lives', () => {
    const editor: any = new HoverTextSource();

    expect(
      linesOf(
        editor.variableRecord({
          name: 'pointer',
          key: 'main-pointer',
          type: 'int *',
          value: '0xABCD',
          address: 0x1234,
        })
      )
    ).toBe('pointer\ntype: int *\nvalue: 0xABCD\naddress: 0x1234');
  });

  it('follows a pointer to the variable it points at', () => {
    const editor: any = new HoverTextSource();

    expect(
      linesOf(
        editor.variableRecord({
          name: 'pointer',
          key: 'main-pointer',
          type: 'int *',
          value: '0xABCD',
          address: 0x1234,
          target: { name: 'count', value: '7' },
        })
      )
    ).toBe(
      'pointer\ntype: int *\nvalue: 0xABCD\npoints to: count = 7\naddress: 0x1234'
    );
  });

  it('formats object declarations as labelled lines', () => {
    expect(
      factLines(
        formatVariableDeclaration({
          type: 'Counter',
          storageClasses: ['static'],
          qualifiers: ['const', 'volatile'],
          identifier: 'count',
          initialValue: '1',
        })
      )
    ).toBe(
      'type: Counter\n' +
        'storage-class specifiers: static\n' +
        'type qualifiers: const, volatile\n' +
        'identifier: count\n' +
        'initializer: 1'
    );
  });

  it('formats a function declaration as its return type, name and parameters', () => {
    expect(
      factLines(
        formatFunctionDeclaration({
          returnType: 'const char *',
          identifier: 'label',
          parameters: [
            { identifier: 'c', type: 'enum Color' },
            { identifier: 'values', type: 'const int * const' },
          ],
          isDefinition: true,
          storageClasses: ['static'],
        })
      )
    ).toBe(
      'return type: const char *\n' +
        'identifier: label\n' +
        // One row per parameter, each named before the type it has: a table
        // has no room for a list inside a cell.
        'parameter: c: enum Color\n' +
        'parameter: values: const int * const\n' +
        'storage-class / function specifiers: static\n' +
        'declares: a function definition, with a body'
    );
  });

  it('tells a declaration with no body from a definition', () => {
    // A prototype and the definition it belongs to read the same up to the
    // brace, which can be a screen away from the name being hovered.
    expect(
      factLines(
        formatFunctionDeclaration({
          returnType: 'int',
          identifier: 'add',
          parameters: [{ identifier: 'a', type: 'int' }],
          isDefinition: false,
          storageClasses: [],
        })
      )
    ).toContain('declares: a function declaration, not a definition');
  });

  it('says none for a function that takes no parameters', () => {
    expect(
      factLines(
        formatFunctionDeclaration({
          returnType: 'int',
          identifier: 'main',
          parameters: [],
          isDefinition: true,
          storageClasses: [],
        })
      )
    ).toBe(
      'return type: int\n' +
        'identifier: main\n' +
        'parameters: none\n' +
        'storage-class / function specifiers: none\n' +
        'declares: a function definition, with a body'
    );
  });

  it('identifies a typedef name without assigning it a storage-class specifier', () => {
    expect(
      factLines(
        formatTypeDeclaration({
          qualifiers: ['const'],
          type: 'enum Mode',
          nameKind: 'typedefName',
          name: 'ReadOnlyMode',
        })
      )
    ).toBe(
      'type: enum Mode\n' +
        'type qualifiers: const\n' +
        'typedef name: ReadOnlyMode'
    );
  });

  it('calls the name a record definition introduces a tag', () => {
    expect(
      factLines(
        formatTypeDeclaration({
          qualifiers: [],
          type: 'struct Point',
          nameKind: 'tag',
          name: 'Point',
        })
      )
    ).toBe('type: struct Point\n' + 'type qualifiers: none\n' + 'tag: Point');
  });

  it('says none when a type declaration has no qualifiers', () => {
    expect(
      factLines(
        formatTypeDeclaration({
          qualifiers: [],
          type: 'struct without a tag',
          nameKind: 'typedefName',
          name: 'Point',
        })
      )
    ).toBe(
      'type: struct without a tag\n' +
        'type qualifiers: none\n' +
        'typedef name: Point'
    );
  });

  it('formats an enumeration constant as labelled lines', () => {
    expect(
      factLines(
        formatEnumerator({
          type: 'int',
          enumeration: 'enum Mode',
          identifier: 'FAULT',
          value: 5,
        })
      )
    ).toBe(
      'type: int\n' +
        'enumeration: enum Mode\n' +
        'identifier: FAULT\n' +
        'value: 5'
    );
  });

  it('formats a structure or union member as labelled lines', () => {
    expect(
      factLines(
        formatRecordField({
          type: 'const int * const',
          record: 'struct Device',
          identifier: 'status',
        })
      )
    ).toBe(
      'type: const int * const\n' +
        'containing structure or union type: struct Device\n' +
        'identifier: status'
    );
  });
});

describe('the tooltip as a table', () => {
  it('sets the headline apart from the facts under it', () => {
    const dom = hoverDom({
      title: 'count',
      facts: [
        { label: 'type', value: 'int', code: true },
        { label: 'value', value: '7', code: true },
      ],
    });
    expect(dom.querySelector('.plivet-tooltip__title')!.textContent).toBe(
      'count'
    );
    const rows = dom.querySelectorAll('tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('th')!.textContent).toBe('type');
    expect(rows[0].querySelector('td')!.textContent).toBe('int');
    // Program text is set in the editor's own font, prose is not.
    expect(rows[0].querySelector('td')!.className).toBe('plivet-tooltip__code');
  });

  it('gives a sentence the width of the table rather than a heading', () => {
    // A note about the language has no left-hand column to stand in.
    const dom = hoverDom({
      title: 'do-while statement',
      facts: [
        {
          label:
            'the body is executed before the controlling expression is first evaluated',
          value: '',
        },
      ],
    });
    const cell = dom.querySelector('td')!;
    expect(cell.colSpan).toBe(2);
    expect(cell.textContent).toBe(
      'the body is executed before the controlling expression is first evaluated'
    );
    expect(dom.querySelector('th')).toBeNull();
  });

  it('says the headline alone when there is nothing else to say', () => {
    const dom = hoverDom({ title: 'break statement', facts: [] });
    expect(dom.querySelector('table')).toBeNull();
  });
});
