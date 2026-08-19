import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { libraryHelp, libraryNames } from '../src/components/libraryHelp';
import { constructAt } from '../src/interpreter/Construct';

/**
 * End-to-end checks for the two overrides in PlivetCPP14Interpreter: the
 * preprocessor pass and the printf that can format a string literal. The
 * probe matrix in baseline/scripts/probe-preprocessor.js covers the full
 * feature list; these are the cases worth having in CI.
 */
const run = (code: string): string => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined; // the engine dumps every stack frame it builds
  try {
    interpreter.startStepExecution(code);
    let steps = 0;
    while (interpreter.isStepExecutionRunning() && steps < 20000) {
      interpreter.stepExecute();
      steps += 1;
    }
    return interpreter.getStdout();
  } finally {
    console.log = log;
  }
};

it('formats a string literal passed to %s', () => {
  expect(
    run('#include<stdio.h>\nint main(){ printf("%s\\n", "abc"); return 0; }')
  ).toBe('abc\n');
});

it('prints a stringified macro argument', () => {
  const code = `#include<stdio.h>
#define SHOW(e) printf("%s\\n", #e)
int main(){ SHOW(x + y); return 0; }`;
  expect(run(code)).toBe('x + y\n');
});

it('compiles only the branch a conditional selects', () => {
  const code = `#include<stdio.h>
#define LEVEL 2
int main(){
#if LEVEL > 1
  printf("high\\n");
#else
  printf("low\\n");
#endif
  return 0; }`;
  expect(run(code)).toBe('high\n');
});

it('runs a variadic logging macro', () => {
  const code = `#include<stdio.h>
#define LOG(fmt, ...) printf(fmt, ##__VA_ARGS__)
int main(){ LOG("%d %d\\n", 1, 2); LOG("done\\n"); return 0; }`;
  expect(run(code)).toBe('1 2\ndone\n');
});

it('does not expand a macro name inside a string literal', () => {
  const code = `#include<stdio.h>
#define N 7
int main(){ printf("N=%d\\n", N); return 0; }`;
  expect(run(code)).toBe('N=7\n');
});

describe('constructs for the editor', () => {
  const constructs = (code: string) =>
    new PlivetCPP14Interpreter().getConstructs(code);

  it('lists statements with their positions', () => {
    const code = `int main(){
  int x = 1;
  if (x > 0) { x = 2; }
  return x;
}`;
    const found = constructs(code).map((c) => [c.kind, c.line]);
    expect(found).toEqual(
      expect.arrayContaining([
        ['functionDec', 1],
        ['variableDec', 2],
        ['if', 3],
        ['return', 4],
      ])
    );
  });

  it('names what the construct is about', () => {
    const code = 'int main(){ int n = 1; return sqrt(n); }';
    const found = constructs(code);
    expect(found.find((c) => c.kind === 'functionDec')!.detail).toBe(
      ['return type: int', 'identifier: main', 'parameters: none'].join('\n')
    );
    expect(found.find((c) => c.kind === 'variableDec')!.detail).toBe(
      [
        'type: int',
        'storage class: auto',
        'qualifiers: none',
        'identifier: n',
        'value: 1',
      ].join('\n')
    );
    expect(found.find((c) => c.kind === 'call')!.detail).toBe('sqrt');
  });

  it('labels aggregate definitions as type declarations', () => {
    for (const declaration of [
      'struct Point { int x; };',
      'union Value { int whole; char letter; };',
      'enum Mode { OFF, ON };',
    ]) {
      const found = constructAt(constructs(declaration), 1, 1);
      expect(found).not.toBeNull();
      expect(found!.kind).toBe('typeDec');
    }
  });

  it('uses source enum names instead of runtime identifiers in tooltips', () => {
    const code = `enum Mode { OFF, ON };
typedef const enum Mode ReadOnlyMode;
int main(){
  enum Mode current = ON;
  return current;
}`;
    const found = constructs(code);
    expect(found.map((construct) => construct.detail).join(' ')).not.toMatch(
      /\b_e\d+\b/
    );
    expect(
      found.find(
        (construct) => construct.kind === 'typeDec' && construct.line === 2
      )!.declaredTypes
    ).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: ['const'],
        type: 'enum Mode',
        nameKind: 'typedefName',
        name: 'ReadOnlyMode',
      },
    ]);
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 4
      )!.detail
    ).toBe(
      [
        'type: enum Mode',
        'storage class: auto',
        'qualifiers: none',
        'identifier: current',
        'value: ON',
      ].join('\n')
    );
  });

  it('describes complete variable declarations and initialization', () => {
    const code = `struct Point { int x; };
int main(){
  static const int * volatile pointer = 0;
  register volatile int pending;
  int first = 1, second;
  int values[2] = {1, 2};
  struct Point point;
}`;
    const found = constructs(code);
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 3
      )!.detail
    ).toBe(
      [
        'type: int *',
        'storage class: static',
        'qualifiers: const, volatile',
        'identifier: pointer',
        'value: 0',
      ].join('\n')
    );
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 4
      )!.detail
    ).toContain('value: uninitialized');

    const second = constructAt(found, 5, code.split('\n')[4].indexOf('second'));
    expect(second).not.toBeNull();
    expect(second!.detail).toContain(
      'identifier: second\nvalue: uninitialized'
    );
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 6
      )!.detail
    ).toContain('type: int[2]\n');
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 7
      )!.detail
    ).toContain('type: struct Point\n');
  });

  it('defaults block-scope storage class to auto', () => {
    const found = constructs(`int globalValue;
int main(){ int localValue; }`);
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 1
      )!.variableDeclarations![0].storageClasses
    ).toEqual([]);
    expect(
      found.find(
        (construct) =>
          construct.kind === 'variableDec' &&
          construct.line === 2 &&
          construct.variableDeclarations![0].identifier === 'localValue'
      )!.variableDeclarations![0].storageClasses
    ).toEqual(['auto']);
  });

  it('retains storage classes and qualifiers from typedef types', () => {
    const code = `typedef const int ReadOnly;
typedef int * const ConstPointer;
int main(){
  static ReadOnly item;
  ConstPointer pointer = 0;
}`;
    const found = constructs(code);
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 4
      )!.variableDeclarations![0]
    ).toEqual({
      type: 'ReadOnly',
      storageClasses: ['static'],
      qualifiers: ['const'],
      identifier: 'item',
      initialValue: null,
    });
    expect(
      found.find(
        (construct) => construct.kind === 'variableDec' && construct.line === 5
      )!.variableDeclarations![0]
    ).toMatchObject({
      type: 'ConstPointer',
      qualifiers: ['const'],
      identifier: 'pointer',
      initialValue: '0',
    });
  });

  it('labels typedefs as type declarations', () => {
    for (const declaration of [
      'typedef int Count;',
      'typedef struct Point { int x; } Point;',
      'typedef enum { OFF, ON } Mode;',
    ]) {
      const found = constructAt(constructs(declaration), 1, 1);
      expect(found).not.toBeNull();
      expect(found!.kind).toBe('typeDec');
    }
  });

  it('names what a typedef declares and the type it stands for', () => {
    const declared = (code: string) =>
      constructAt(constructs(code), 1, 1)!.declaredTypes;
    expect(declared('typedef volatile struct Sensor LiveSensor;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: ['volatile'],
        type: 'struct Sensor',
        nameKind: 'typedefName',
        name: 'LiveSensor',
      },
    ]);
    expect(declared('typedef int * const ConstPointer;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: ['const'],
        type: 'int *',
        nameKind: 'typedefName',
        name: 'ConstPointer',
      },
    ]);
    expect(declared('typedef _Atomic(int) Counter;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: ['_Atomic'],
        type: 'int',
        nameKind: 'typedefName',
        name: 'Counter',
      },
    ]);
    expect(declared('typedef int Grid[3][3];')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: [],
        type: 'int[3][3]',
        nameKind: 'typedefName',
        name: 'Grid',
      },
    ]);
    // `const` binds to the pointer declarator, so it is no part of Q's type.
    expect(declared('typedef int * const P, Q;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: ['const'],
        type: 'int *',
        nameKind: 'typedefName',
        name: 'P',
      },
      {
        storageClasses: ['typedef'],
        qualifiers: [],
        type: 'int',
        nameKind: 'typedefName',
        name: 'Q',
      },
    ]);
  });

  it('names the alias a record body is typedefed to', () => {
    const declared = (code: string) =>
      constructAt(constructs(code), 1, 1)!.declaredTypes;
    expect(declared('typedef struct Point { int x; } PointAlias;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: [],
        type: 'struct Point',
        nameKind: 'typedefName',
        name: 'PointAlias',
      },
    ]);
    expect(declared('typedef const enum Color { RED, BLUE } Shade;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: ['const'],
        type: 'enum Color',
        nameKind: 'typedefName',
        name: 'Shade',
      },
    ]);
    expect(declared('typedef struct { int x; } Point;')).toEqual([
      {
        storageClasses: ['typedef'],
        qualifiers: [],
        type: 'struct without a tag',
        nameKind: 'typedefName',
        name: 'Point',
      },
    ]);
  });

  it('calls the name a definition introduces a tag, not a typedef name', () => {
    expect(
      constructAt(constructs('struct Point { int x; };'), 1, 1)!.declaredTypes
    ).toEqual([
      {
        storageClasses: [],
        qualifiers: [],
        type: 'struct Point',
        nameKind: 'tag',
        name: 'Point',
      },
    ]);
    expect(
      constructAt(constructs('union Value { int whole; };'), 1, 1)!.detail
    ).toBe(
      [
        'type: union Value',
        'storage class: none',
        'qualifiers: none',
        'tag: Value',
      ].join('\n')
    );
  });

  it('reports a record with no tag as one written without a tag', () => {
    // C reserves "anonymous structure" for an unnamed member of a struct or
    // union, which this is not.
    expect(
      constructAt(constructs('typedef struct { int x; } Point;'), 1, 1)!
        .declaredTypes![0].type
    ).toBe('struct without a tag');
  });

  it('explains each enumeration constant where it is declared', () => {
    const code = `enum Mode {
  OFF,
  ON = 4,
  FAULT
};
int main(){ return OFF + FAULT; }`;
    const found = constructs(code);
    // The value is what a reader cannot see: FAULT counts on from ON.
    expect(
      found
        .filter((construct) => construct.kind === 'enumerator')
        .map((construct) => construct.enumerator)
    ).toEqual([
      { type: 'int', enumeration: 'enum Mode', identifier: 'OFF', value: 0 },
      { type: 'int', enumeration: 'enum Mode', identifier: 'ON', value: 4 },
      { type: 'int', enumeration: 'enum Mode', identifier: 'FAULT', value: 5 },
    ]);
    const hovered = constructAt(found, 3, 3);
    expect(hovered!.kind).toBe('enumerator');
    expect(hovered!.detail).toBe(
      [
        'type: int',
        'enumeration: enum Mode',
        'identifier: ON',
        'value: 4',
      ].join('\n')
    );
  });

  it('answers for the enum itself away from an enumerator', () => {
    const found = constructs('enum Mode { OFF, ON };');
    expect(constructAt(found, 1, 2)!.kind).toBe('typeDec');
    expect(constructAt(found, 1, 13)!.kind).toBe('enumerator');
  });

  it('names a tagless enum by the typedef a reader would recognise', () => {
    const found = constructs('typedef enum { RED, GREEN } Shade;');
    expect(
      found.find((construct) => construct.kind === 'enumerator')!.enumerator
    ).toEqual({
      type: 'int',
      enumeration: 'Shade',
      identifier: 'RED',
      value: 0,
    });
  });

  it('spells out what a function declaration declares', () => {
    const code = `enum Color { RED };
struct Point { int x; };
static const char *label(enum Color c, int (*op)(int, int),
                         struct Point *p, const int *const values){
  return "x";
}
int main(){ return 0; }`;
    const found = constructs(code);
    expect(
      found.find((construct) => construct.kind === 'functionDec')!
        .declaredFunction
    ).toEqual({
      // `static` gives the function internal linkage; it is not part of the
      // type the function returns.
      returnType: 'const char *',
      identifier: 'label',
      parameters: [
        { identifier: 'c', type: 'enum Color' },
        { identifier: 'op', type: 'int (*)(int, int)' },
        { identifier: 'p', type: 'struct Point *' },
        // A const pointer to a const int: both consts have to survive, and in
        // the places they were written.
        { identifier: 'values', type: 'const int * const' },
      ],
    });
  });

  it('reports a parameter list of void as no parameters', () => {
    // 6.7.6.3: `void` alone specifies that the function has no parameters.
    const found = constructs('int main(void){ return 0; }');
    expect(
      found.find((construct) => construct.kind === 'functionDec')!
        .declaredFunction
    ).toEqual({ returnType: 'int', identifier: 'main', parameters: [] });
  });

  it('answers for the function on the line its definition opens', () => {
    const code = `struct Point { int x; };
struct Point makePoint(void){
  struct Point p = {1};
  return p;
}`;
    const hovered = constructAt(constructs(code), 2, 'struct Point m'.length);
    expect(hovered!.kind).toBe('functionDec');
    expect(hovered!.declaredFunction!.returnType).toBe('struct Point');
  });

  it('keeps an object declared after a record body a variable declaration', () => {
    const code = 'struct Point { int x; }point;';
    const found = constructAt(constructs(code), 1, code.indexOf('point'));
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('variableDec');
  });

  it('tells a do-while from a while', () => {
    const code =
      'int main(){ int i = 0; do { i++; } while (i < 3); return 0; }';
    const kinds = constructs(code).map((c) => c.kind);
    expect(kinds).toContain('doWhile');
    expect(kinds).not.toContain('while');
  });

  it('reports positions in the source the user typed, not the preprocessed one', () => {
    const code = `#define N 3
int main(){
  int x = N;
  return x;
}`;
    const declaration = constructs(code).find((c) => c.kind === 'variableDec');
    expect(declaration!.line).toBe(3);
  });

  it('returns nothing rather than throwing on code that does not parse', () => {
    expect(constructs('int main(){ this is not C ;;; }')).toEqual([]);
  });
});

describe('library help', () => {
  it('documents every function the engine registers', () => {
    const engine = require.resolve(
      'unicoen.ts/dist/interpreter/CPP14/CPP14Engine'
    );
    const source = require('fs').readFileSync(engine, 'utf8');
    const registered = (source.match(/global\.setTop\('([a-zA-Z_]+)'/g) || [])
      .map((call: string) =>
        call.replace(/global\.setTop\('/, '').replace(/'/, '')
      )
      .filter(
        (name: string, i: number, all: string[]) => all.indexOf(name) === i
      );
    expect(registered.length).toBeGreaterThan(20);
    expect(
      registered.filter((name: string) => libraryHelp(name) === null)
    ).toEqual([]);
  });

  it('has a signature and both languages for every entry', () => {
    for (const name of libraryNames()) {
      const entry = libraryHelp(name)!;
      expect(entry.signature).toContain(name);
      expect(entry.en.length).toBeGreaterThan(3);
      expect(entry.ja.length).toBeGreaterThan(1);
    }
  });
});
