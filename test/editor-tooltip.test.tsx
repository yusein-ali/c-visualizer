import Editor, {
  formatAddress,
  formatFunctionDeclaration,
  formatEnumerator,
  formatTypeDeclaration,
  formatVariableDeclaration,
} from '../src/components/Editor';

describe('editor tooltip addresses', () => {
  it('formats addresses as uppercase hexadecimal', () => {
    expect(formatAddress(0)).toBe('0x0');
    expect(formatAddress(0xabcd)).toBe('0xABCD');
  });

  it('formats both a pointer value and its own address as hexadecimal', () => {
    const editor: any = new Editor({ lang: 'en', progLang: 'c_cpp' });
    const variable = {
      name: 'pointer',
      type: 'int *',
      address: 0x1234,
      getValue: () => 0xabcd,
    };

    expect(editor.variableText(variable)).toBe(
      'pointer : int * = 0xABCD\naddress 0x1234'
    );
  });

  it('formats variable declarations as labelled lines', () => {
    expect(
      formatVariableDeclaration(
        {
          type: 'Counter',
          storageClasses: ['static'],
          qualifiers: ['const', 'volatile'],
          identifier: 'count',
          initialValue: '1',
        },
        'en'
      )
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
      formatFunctionDeclaration(
        {
          returnType: 'const char *',
          identifier: 'label',
          parameters: [
            { identifier: 'c', type: 'enum Color' },
            { identifier: 'values', type: 'const int * const' },
          ],
        },
        'en'
      )
    ).toBe(
      'return type: const char *\n' +
        'identifier: label\n' +
        'parameters:\n' +
        '  c: enum Color\n' +
        '  values: const int * const'
    );
  });

  it('says none for a function that takes no parameters', () => {
    expect(
      formatFunctionDeclaration(
        { returnType: 'int', identifier: 'main', parameters: [] },
        'en'
      )
    ).toBe('return type: int\nidentifier: main\nparameters: none');
  });

  it('formats type declarations as labelled lines', () => {
    expect(
      formatTypeDeclaration(
        {
          storageClasses: ['typedef'],
          qualifiers: ['const'],
          type: 'enum Mode',
          nameKind: 'typedefName',
          name: 'ReadOnlyMode',
        },
        'en'
      )
    ).toBe(
      'type: enum Mode\n' +
        'storage class: typedef\n' +
        'qualifiers: const\n' +
        'typedef name: ReadOnlyMode'
    );
  });

  it('calls the name a record definition introduces a tag', () => {
    expect(
      formatTypeDeclaration(
        {
          storageClasses: [],
          qualifiers: [],
          type: 'struct Point',
          nameKind: 'tag',
          name: 'Point',
        },
        'en'
      )
    ).toBe(
      'type: struct Point\n' +
        'storage class: none\n' +
        'qualifiers: none\n' +
        'tag: Point'
    );
  });

  it('says none for the specifiers a type declaration leaves out', () => {
    expect(
      formatTypeDeclaration(
        {
          storageClasses: [],
          qualifiers: [],
          type: 'struct without a tag',
          nameKind: 'typedefName',
          name: 'Point',
        },
        'en'
      )
    ).toBe(
      'type: struct without a tag\n' +
        'storage class: none\n' +
        'qualifiers: none\n' +
        'typedef name: Point'
    );
  });

  it('formats an enumeration constant as labelled lines', () => {
    expect(
      formatEnumerator(
        {
          type: 'int',
          enumeration: 'enum Mode',
          identifier: 'FAULT',
          value: 5,
        },
        'en'
      )
    ).toBe(
      'type: int\n' +
        'enumeration: enum Mode\n' +
        'identifier: FAULT\n' +
        'value: 5'
    );
  });
});
