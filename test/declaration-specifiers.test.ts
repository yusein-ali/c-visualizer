import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import * as fs from 'fs';
import * as path from 'path';
import { extractModel } from '../src/core';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { DeclarationSpecifiers } from '../src/interpreter/DeclarationSpecifiers';
import { declarationInfoOf } from '../src/interpreter/RuntimeTypeInfo';

const program = `#include<stdio.h>
const int globalConst = 10;
volatile int globalVolatile = 20;
static const int globalStatic = 30;

int main(){
  register int reg = 1;
  const volatile int localCV = 2;
  static int localStatic = 3;
  auto int localAuto = 4;
  printf("%d\\n", globalConst + globalVolatile + globalStatic +
                    reg + localCV + localStatic + localAuto);
  return 0;
}`;

const execute = (code: string): { output: string; states: ExecState[] } => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const states: ExecState[] = [];
  try {
    states.push(interpreter.startStepExecution(code));
    let steps = 0;
    while (interpreter.isStepExecutionRunning() && steps < 20000) {
      states.push(interpreter.stepExecute());
      steps += 1;
    }
    return { output: interpreter.getStdout(), states };
  } finally {
    console.log = log;
  }
};

const findVariable = (states: ExecState[], name: string): Variable => {
  for (let i = states.length - 1; i >= 0; i -= 1) {
    for (const stack of states[i].getStacks()) {
      const variable = stack.getVariables().find((item) => item.name === name);
      if (typeof variable !== 'undefined') {
        return variable;
      }
    }
  }
  throw new Error(`variable ${name} was not visualized`);
};

const findNestedVariable = (
  variable: Variable,
  name: string
): Variable | null => {
  if (variable.name === name) {
    return variable;
  }
  const value = variable.getValue();
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findNestedVariable(child, name);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
};

describe('declaration specifier source pass', () => {
  it('blanks unsupported qualifiers without moving source positions', () => {
    const source = 'const volatile int x = 1;\nregister int y = 2;';
    const rewritten = new DeclarationSpecifiers().rewrite(source);
    expect(rewritten).toHaveLength(source.length);
    expect(rewritten.split('\n')).toHaveLength(source.split('\n').length);
    expect(rewritten).toBe('               int x = 1;\nregister int y = 2;');
  });

  /**
   * C's declaration specifiers are an unordered set, so `int register a;` is
   * the same declaration as `register int a;`. ANTLR's C++14 grammar reads
   * only the leading form: the trailing one produced a tree with no statement
   * the interpreter could place, and the run ended on its first step with no
   * output, no location and no diagnostic - the reader was told nothing at
   * all about a line that had stopped their program.
   */
  it('blanks a storage class the type specifier has already passed', () => {
    const source = 'int register a = 1;';
    const rewritten = new DeclarationSpecifiers().rewrite(source);
    expect(rewritten).toHaveLength(source.length);
    expect(rewritten).toBe('int          a = 1;');
  });

  it('leaves a storage class that leads its declaration alone', () => {
    // What the mapper already reads, and what every ordinary program writes.
    expect(new DeclarationSpecifiers().rewrite('static int a = 1;')).toBe(
      'static int a = 1;'
    );
  });

  it('reads each declaration on its own', () => {
    // The type specifier of one declaration must not blank the storage class
    // leading the next: the scan resets at every boundary between them.
    const source = 'int a = 1;\nstatic int b = 2;\nint static c = 3;';
    expect(new DeclarationSpecifiers().rewrite(source)).toBe(
      'int a = 1;\nstatic int b = 2;\nint        c = 3;'
    );
  });

  it('blanks one in a parameter list, and not one that leads it', () => {
    const source = 'void f(int register p, register int q) { (void)p; }';
    expect(new DeclarationSpecifiers().rewrite(source)).toBe(
      'void f(int          p, register int q) { (void)p; }'
    );
  });
});

describe('a type specifier of more than one word', () => {
  /**
   * unicoen's mapper reads one base type, optionally preceded by `unsigned`,
   * and fails to map every other combination C allows. `long long a = 7;`
   * came back as a bare `UniExpr` naming nothing: the object was never
   * created, `printf` printed nothing, and the run reported success over a
   * program that had not declared its variable. Reducing the sequence to the
   * one word the mapper reads is what makes these programs run at all.
   */
  it.each([
    ['long long', 'long long a = 1;', 'long      a = 1;'],
    ['long long int', 'long long int a = 1;', 'long          a = 1;'],
    ['short int', 'short int a = 1;', 'short     a = 1;'],
    ['long int', 'long int a = 1;', 'long     a = 1;'],
    ['signed int', 'signed int a = 1;', '       int a = 1;'],
    ['signed char', 'signed char a = 1;', '       char a = 1;'],
    ['long double', 'long double a = 1;', '     double a = 1;'],
    [
      'unsigned long long',
      'unsigned long long a = 1;',
      'unsigned long      a = 1;',
    ],
  ])('reduces %s without moving a source position', (_name, source, expected) => {
    const rewritten = new DeclarationSpecifiers().rewrite(source);
    expect(rewritten).toHaveLength(source.length);
    expect(rewritten).toBe(expected);
  });

  it.each([
    ['int', 'int a = 1;'],
    ['unsigned int', 'unsigned int a = 1;'],
    ['unsigned', 'unsigned a = 1;'],
    ['signed', 'signed a = 1;'],
    ['long', 'long a = 1;'],
    ['double', 'double a = 1;'],
    ['a struct tag', 'struct S s;'],
    ['a typedef name', 'Num n = 1;'],
  ])('leaves %s exactly as written', (_name, source) => {
    expect(new DeclarationSpecifiers().rewrite(source)).toBe(source);
  });

  /**
   * Every form C can spell a scalar with. The declaration is the whole test:
   * before the reduction, more than half of these printed nothing at all.
   */
  const TYPES = [
    'char',
    'signed char',
    'unsigned char',
    'short',
    'short int',
    'signed short',
    'unsigned short',
    'int',
    'signed',
    'signed int',
    'unsigned',
    'unsigned int',
    'long',
    'long int',
    'signed long',
    'unsigned long',
    'long long',
    'long long int',
    'unsigned long long',
    'signed long long',
    'float',
    'double',
    'long double',
    '_Bool',
  ];

  /**
   * The reduction is for the mapper, not for the reader: the engine holds a
   * `long` and the declaration said `long long`, and the canvas has no
   * business repeating that compromise. `unsigned int` is in here because the
   * mapper joins it into `unsignedint`, which is nobody's spelling of a type.
   */
  it('spells the type on the canvas the way it was written', () => {
    const canvas = execute(`#include<stdio.h>
int main(){
  long long wide = 1;
  short int narrow = 2;
  signed char tiny = 3;
  unsigned int counted = 4;
  const long long fixed = 5;
  long long *pointed = &wide;
  printf("%d\\n", (int)(wide + narrow + tiny + counted + fixed + *pointed));
  return 0;
}`);
    const labels: string[] = [];
    for (const state of canvas.states) {
      for (const stack of extractModel(state).stacks) {
        for (const row of stack.rows) {
          labels.push(row[0].text);
        }
      }
    }

    expect(labels).toEqual(
      expect.arrayContaining([
        'long long',
        'short int',
        'signed char',
        'unsigned int',
        'const long long',
        'long long *',
      ])
    );
  });

  it.each(TYPES.map((type): [string] => [type]))(
    'declares and prints a %s',
    (type) => {
      expect(
        execute(
          `#include<stdio.h>\nint main(){ ${type} a = 7; printf("%d\\n", (int)a); return 0; }`
        ).output
      ).toBe('7\n');
    }
  );
});

describe('a storage class written after the type', () => {
  /**
   * The declaration the reader typed, run end to end. The pass above proves
   * the word is blanked; this proves the program the reader gets back is the
   * one they wrote - it steps, and the object is still in its own region.
   */
  const trailing = execute(`#include<stdio.h>
int main(){
  int register volatile const fast = 1;
  int static visits = 2;
  printf("%d\\n", fast + visits);
  return 0;
}`);

  it('runs the program rather than ending on the first step', () => {
    expect(trailing.output).toBe('3\n');
  });

  it('keeps the storage class the blanked word carried', () => {
    expect(
      declarationInfoOf(findVariable(trailing.states, 'fast'))
    ).toMatchObject({
      storageClasses: ['register'],
      qualifiers: ['volatile', 'const'],
      region: 'register',
    });
    expect(
      declarationInfoOf(findVariable(trailing.states, 'visits'))
    ).toMatchObject({
      storageClasses: ['static'],
      region: 'static',
    });
  });
});

describe('storage classes and type qualifiers', () => {
  const result = execute(program);

  it('executes declarations the stock mapper used to discard', () => {
    expect(result.output).toBe('70\n');
  });

  it('classifies global, stack, static and register storage', () => {
    expect(
      declarationInfoOf(findVariable(result.states, 'globalConst'))
    ).toMatchObject({
      storageClasses: [],
      qualifiers: ['const'],
      region: 'global',
    });
    expect(
      declarationInfoOf(findVariable(result.states, 'globalStatic'))
    ).toMatchObject({
      storageClasses: ['static'],
      qualifiers: ['const'],
      region: 'static',
    });
    expect(declarationInfoOf(findVariable(result.states, 'reg'))).toMatchObject(
      {
        storageClasses: ['register'],
        qualifiers: [],
        region: 'register',
      }
    );
    expect(
      declarationInfoOf(findVariable(result.states, 'localCV'))
    ).toMatchObject({
      storageClasses: [],
      qualifiers: ['const', 'volatile'],
      region: 'stack',
    });
    expect(
      declarationInfoOf(findVariable(result.states, 'localAuto'))
    ).toMatchObject({
      storageClasses: ['auto'],
      qualifiers: [],
      region: 'stack',
    });
  });

  it('shows declaration specifiers in canvas type labels', () => {
    const labels: string[] = [];
    for (const state of result.states) {
      for (const stack of extractModel(state).stacks) {
        for (const row of stack.rows) {
          labels.push(row[0].text);
        }
      }
    }
    expect(labels).toEqual(
      expect.arrayContaining([
        'const int',
        'volatile int',
        'static const int',
        'register int',
        'const volatile int',
        'static int',
        'auto int',
      ])
    );
  });

  it('accepts both C atomic qualifier spellings', () => {
    const atomic = execute(`#include<stdio.h>
int main(){ _Atomic int first = 2; _Atomic(int) second = 3;
  printf("%d\\n", first + second); return 0; }`);
    expect(atomic.output).toBe('5\n');
    expect(
      declarationInfoOf(findVariable(atomic.states, 'first'))
    ).toMatchObject({ qualifiers: ['_Atomic'] });
    expect(
      declarationInfoOf(findVariable(atomic.states, 'second'))
    ).toMatchObject({ qualifiers: ['_Atomic'] });
  });
});

describe('qualifiers combined with aggregate types', () => {
  const aggregateProgram = `#include<stdio.h>
enum Mode { OFF, ON };
typedef const enum Mode ReadOnlyMode;

struct Qualified {
  const int fixed;
  volatile int live;
  int * const fixedPointer;
  const int * readOnlyPointer;
};
typedef volatile struct Qualified LiveQualified;

union Data { int whole; char letter; };
typedef const union Data ReadOnlyData;

int main(){
  int target = 9;
  ReadOnlyMode mode = ON;
  LiveQualified qualified;
  ReadOnlyData data = {65};
  const int *readOnly = &target;
  int * const fixedPointer = &target;
  int * restrict restricted = &target;
  printf("%d %d\\n", mode, data.whole);
  return 0;
}`;
  const aggregateResult = execute(aggregateProgram);

  it('executes qualified enum, struct and union typedefs', () => {
    expect(aggregateResult.output).toBe('1 65\n');
  });

  it('retains typedef and pointer-level qualifier placement', () => {
    const labels: string[] = [];
    for (const state of aggregateResult.states) {
      for (const stack of extractModel(state).stacks) {
        for (const row of stack.rows) {
          labels.push(...row.map((cell) => cell.text));
        }
      }
    }
    expect(labels).toEqual(
      expect.arrayContaining([
        'const ReadOnlyMode (enum)',
        'volatile LiveQualified (struct)',
        'const ReadOnlyData (union)',
        'const volatile int',
        'volatile int',
        'int * const',
        'const int *',
        'int * restrict',
      ])
    );
  });

  it('prevents writes to const scalars and const aggregate members', () => {
    const scalar = execute('int main(){ const int x = 1; x = 2; return 0; }');
    expect(findVariable(scalar.states, 'x').getValue().valueOf()).toBe(1);

    const aggregate = execute(
      'struct P { int x; };\nint main(){ const struct P p = {1}; p.x = 2; return 0; }'
    );
    const member = findNestedVariable(
      findVariable(aggregate.states, 'p'),
      'x'
    )!;
    expect(member.getValue().valueOf()).toBe(1);

    const aggregateArray = execute(`struct P { const int x; };
int main(){ struct P points[1] = {{1}}; points[0].x = 2; return 0; }`);
    const arrayMember = findNestedVariable(
      findVariable(aggregateArray.states, 'points'),
      'x'
    )!;
    expect(arrayMember.getValue().valueOf()).toBe(1);

    const pointerTypedef = execute(`typedef int *IntPointer;
int main(){ int first = 1; int second = 2; const IntPointer pointer = &first;
  pointer = &second; return 0; }`);
    expect(
      findVariable(pointerTypedef.states, 'pointer').getValue().valueOf()
    ).toBe(findVariable(pointerTypedef.states, 'first').address);
  });

  it('prevents taking the address of a register variable', () => {
    const register = execute(
      'int main(){ int reached = 0; register int value = 1; int* p = &value; reached = 1; return 0; }'
    );
    expect(findVariable(register.states, 'reached').getValue().valueOf()).toBe(
      0
    );
  });
});

describe('qualified aggregate teaching fixture', () => {
  const code = fs.readFileSync(
    path.join(__dirname, 'programs', 's7-qualified-aggregates.c'),
    'utf8'
  );
  const fixture = execute(code);

  it('executes the complete fixture', () => {
    expect(fixture.output).toBe(
      'mode=2 sensor=101/42 payload=65/A fast=7 calibration=5 flag=1 samples=2 raw=42 sensors=2/0/0\n'
    );
  });

  it('visualizes aggregate and qualifier combinations', () => {
    const labels: string[] = [];
    for (const state of fixture.states) {
      for (const stack of extractModel(state).stacks) {
        for (const row of stack.rows) {
          labels.push(...row.map((cell) => cell.text));
        }
      }
    }
    expect(labels).toEqual(
      expect.arrayContaining([
        'const ReadOnlyMode (enum)',
        'volatile LiveSensor (struct)',
        'const ReadOnlyPayload (union)',
        'const volatile int',
        'volatile int * const',
        'const volatile int *',
        'register int',
        'static const int',
        'int * restrict',
        '_Atomic int',
      ])
    );
  });
});
