import { formatAddress } from '../src/core';
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
      editor.variableText({
        name: 'pointer',
        type: 'int *',
        value: '0xABCD',
        address: 0x1234,
      })
    ).toBe('pointer : int * = 0xABCD\naddress 0x1234');
  });

  it('follows a pointer to the variable it points at', () => {
    const editor: any = new HoverTextSource();

    expect(
      editor.variableText({
        name: 'pointer',
        type: 'int *',
        value: '0xABCD',
        address: 0x1234,
        target: { name: 'count', value: '7' },
      })
    ).toBe('pointer : int * = 0xABCD → count = 7\naddress 0x1234');
  });

  it('formats variable declarations as labelled lines', () => {
    expect(
      formatVariableDeclaration({
        type: 'Counter',
        storageClasses: ['static'],
        qualifiers: ['const', 'volatile'],
        identifier: 'count',
        initialValue: '1',
      })
    ).toBe(
      'type: Counter\n' +
        'storage class: static\n' +
        'qualifiers: const, volatile\n' +
        'identifier: count\n' +
        'value: 1'
    );
  });

  it('formats a function declaration as its return type, name and parameters', () => {
    expect(
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
    ).toBe(
      'return type: const char *\n' +
        'identifier: label\n' +
        'parameters:\n' +
        '  c: enum Color\n' +
        '  values: const int * const\n' +
        'storage class: static\n' +
        'declares: a definition, with a body'
    );
  });

  it('tells a declaration with no body from a definition', () => {
    // A prototype and the definition it belongs to read the same up to the
    // brace, which can be a screen away from the name being hovered.
    expect(
      formatFunctionDeclaration({
        returnType: 'int',
        identifier: 'add',
        parameters: [{ identifier: 'a', type: 'int' }],
        isDefinition: false,
        storageClasses: [],
      })
    ).toContain('declares: a declaration, with no body');
  });

  it('says none for a function that takes no parameters', () => {
    expect(
      formatFunctionDeclaration({
        returnType: 'int',
        identifier: 'main',
        parameters: [],
        isDefinition: true,
        storageClasses: [],
      })
    ).toBe(
      'return type: int\n' +
        'identifier: main\n' +
        'parameters: none\n' +
        'storage class: none\n' +
        'declares: a definition, with a body'
    );
  });

  it('identifies a typedef name without assigning it a storage class', () => {
    expect(
      formatTypeDeclaration({
        qualifiers: ['const'],
        type: 'enum Mode',
        nameKind: 'typedefName',
        name: 'ReadOnlyMode',
      })
    ).toBe(
      'type: enum Mode\n' + 'qualifiers: const\n' + 'typedef name: ReadOnlyMode'
    );
  });

  it('calls the name a record definition introduces a tag', () => {
    expect(
      formatTypeDeclaration({
        qualifiers: [],
        type: 'struct Point',
        nameKind: 'tag',
        name: 'Point',
      })
    ).toBe('type: struct Point\n' + 'qualifiers: none\n' + 'tag: Point');
  });

  it('says none when a type declaration has no qualifiers', () => {
    expect(
      formatTypeDeclaration({
        qualifiers: [],
        type: 'struct without a tag',
        nameKind: 'typedefName',
        name: 'Point',
      })
    ).toBe(
      'type: struct without a tag\n' +
        'qualifiers: none\n' +
        'typedef name: Point'
    );
  });

  it('formats an enumeration constant as labelled lines', () => {
    expect(
      formatEnumerator({
        type: 'int',
        enumeration: 'enum Mode',
        identifier: 'FAULT',
        value: 5,
      })
    ).toBe(
      'type: int\n' +
        'enumeration: enum Mode\n' +
        'identifier: FAULT\n' +
        'value: 5'
    );
  });

  it('formats a structure or union member as labelled lines', () => {
    expect(
      formatRecordField({
        type: 'const int * const',
        record: 'struct Device',
        identifier: 'status',
      })
    ).toBe(
      'type: const int * const\n' +
        'structure or union: struct Device\n' +
        'identifier: status'
    );
  });
});
