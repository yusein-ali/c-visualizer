import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import * as fs from 'fs';
import * as path from 'path';
import { extractModel } from '../src/core';
import { EnumTable } from '../src/interpreter/EnumTable';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { StructTable } from '../src/interpreter/StructTable';
import { UnionTable } from '../src/interpreter/UnionTable';

/**
 * The cases mirror `baseline/scripts/probe-aggregates.js`, which records what
 * the stock unicoen.ts pipeline does with `enum`, `struct` and `union`.
 * Everything asserted here is either something that pipeline got wrong or
 * behaviour that has to keep working once these tables are wired in.
 *
 * Unit checks keep the source readers honest; the final group verifies that
 * their answers reach the parser and runtime used by PLIVET.
 */

const rewrite = (code: string) => new EnumTable().rewrite(code).code;
const lineCount = (code: string) => code.split('\n').length;
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
const run = (code: string): string => execute(code).output;
const canvasRowsForState = (state: ExecState): string[][] => {
  const rows: string[][] = [];
  for (const stack of extractModel(state).stacks) {
    rows.push(...stack.rows.map((row) => row.map((cell) => cell.text)));
  }
  return rows;
};
const canvasRows = (states: ExecState[]): string[][] =>
  states.reduce<string[][]>((all, state) => {
    all.push(...canvasRowsForState(state));
    return all;
  }, []);
const canvasAddress = (row: string[]): string =>
  row.join(' ').match(/0x[0-9A-F]+/)![0];
const numericCanvasAddress = (row: string[]): number =>
  Number.parseInt(canvasAddress(row).slice(2), 16);

describe('EnumTable: reading declarations', () => {
  it('numbers enumerators from zero', () => {
    const table = new EnumTable().read('enum Color { RED, GREEN, BLUE };');
    expect(table.valueOf('RED')).toBe(0);
    expect(table.valueOf('GREEN')).toBe(1);
    expect(table.valueOf('BLUE')).toBe(2);
  });

  it('carries on counting after an explicit value', () => {
    const table = new EnumTable().read('enum E { A = 5, B, C = 10, D };');
    expect(table.valueOf('A')).toBe(5);
    expect(table.valueOf('B')).toBe(6);
    expect(table.valueOf('C')).toBe(10);
    expect(table.valueOf('D')).toBe(11);
  });

  it('evaluates a value that names an earlier enumerator', () => {
    const table = new EnumTable().read(
      'enum E { A = 2, B = A * 3, C = B + 1 };'
    );
    expect(table.valueOf('B')).toBe(6);
    expect(table.valueOf('C')).toBe(7);
  });

  it('accepts a character literal as a value', () => {
    const table = new EnumTable().read("enum E { A = 'A' };");
    expect(table.valueOf('A')).toBe(65);
  });

  it('reads an enum without a tag, and a trailing comma', () => {
    const table = new EnumTable().read('enum { ONE = 1, TWO, };');
    expect(table.valueOf('ONE')).toBe(1);
    expect(table.valueOf('TWO')).toBe(2);
    expect(table.tagNames()).toEqual([]);
  });

  it('records the tag and the line each enumerator came from', () => {
    const table = new EnumTable().read(
      'int x;\nenum Color {\n  RED,\n  GREEN\n};'
    );
    expect(table.tagNames()).toEqual(['Color']);
    expect(table.valueOf('GREEN')).toBe(1);
  });
});

describe('EnumTable: rewriting', () => {
  it('replaces a use with the integer it stands for', () => {
    const out = rewrite('enum Color { RED, GREEN };\nint x = RED;');
    expect(out.split('\n')[1].trim()).toBe('int x = 0  ;');
  });

  it('removes the declaration without moving a line', () => {
    const code = 'enum Color {\n  RED,\n  GREEN\n};\nint x = GREEN;';
    const out = rewrite(code);
    expect(lineCount(out)).toBe(lineCount(code));
    expect(out.split('\n').slice(0, 4).join('').trim()).toBe('');
    expect(out.split('\n')[4].trim()).toBe('int x = 1    ;');
  });

  it('retains a synthetic type for an enum variable', () => {
    const out = rewrite('enum Color { RED };\nenum Color c = RED;');
    expect(out.split('\n')[1].replace(/\s+/g, ' ').trim()).toBe('_e0 c = 0 ;');
  });

  it('keeps variables declared with the enum body', () => {
    const out = rewrite('enum Color { RED, GREEN } c;\nint x = c;');
    expect(out.split('\n')[0].trim()).toBe('_e0                       c;');
  });

  it('handles typedef enum', () => {
    const out = rewrite('typedef enum { A, B } Flag;\nFlag f = B;');
    expect(out.split('\n')[0].replace(/\s+/g, ' ').trim()).toBe(
      'typedef int Flag;'
    );
    expect(out.split('\n')[1].trim()).toBe('Flag f = 1;');
  });

  it('substitutes inside a case label', () => {
    const out = rewrite(
      'enum C { RED, GREEN };\nswitch(c){ case GREEN: break; }'
    );
    expect(out.split('\n')[1]).toContain('case 1    :');
  });

  it('leaves an enumerator named inside a string alone', () => {
    const out = rewrite('enum C { RED };\nputs("RED is RED");');
    expect(out.split('\n')[1]).toBe('puts("RED is RED");');
  });

  it('leaves an enumerator named inside a comment alone', () => {
    const out = rewrite('enum C { RED };\nint x = 1; /* RED */');
    expect(out.split('\n')[1]).toBe('int x = 1; /* RED */');
  });

  it('does not touch a longer identifier that starts with the name', () => {
    const out = rewrite('enum C { RED };\nint REDx = 1;');
    expect(out.split('\n')[1]).toBe('int REDx = 1;');
  });

  it('does not touch a struct member of the same name', () => {
    const out = rewrite('enum C { RED };\nint x = s.RED;');
    expect(out.split('\n')[1]).toBe('int x = s.RED;');
  });

  it('reports what it replaced, where the user typed it', () => {
    const { expansions } = new EnumTable().rewrite(
      'enum Color { RED, GREEN };\nint x = GREEN;'
    );
    expect(expansions).toHaveLength(1);
    expect(expansions[0]).toMatchObject({
      kind: 'enum',
      line: 2,
      column: 8,
      length: 5,
      name: 'GREEN',
      text: '1',
      definedAt: 1,
    });
  });

  it('retains display names and enumerators for the canvas', () => {
    const table = new EnumTable();
    table.rewrite(
      'enum Color { RED, GREEN }; typedef enum { OFF, ON } Switch;'
    );
    expect(table.runtimeTypes()).toMatchObject({
      _e0: {
        displayType: 'enum Color',
        namesByValue: { '0': ['RED'], '1': ['GREEN'] },
      },
      Switch: {
        displayType: 'Switch (enum)',
        namesByValue: { '0': ['OFF'], '1': ['ON'] },
      },
    });
  });

  it('names an enum with no tag as one written without a tag', () => {
    const table = new EnumTable();
    table.rewrite('enum { ONE = 1 }; int x = ONE;');
    expect(table.runtimeTypes()._e0.displayType).toBe('enum without a tag');
  });
});

describe('StructTable', () => {
  it('reads members in order', () => {
    const table = new StructTable().read('struct P { int x; int y; };');
    expect(table.membersOf('P')).toEqual([
      {
        name: 'x',
        type: 'int',
        lengths: [],
        baseQualifiers: [],
        pointerQualifiers: [],
      },
      {
        name: 'y',
        type: 'int',
        lengths: [],
        baseQualifiers: [],
        pointerQualifiers: [],
      },
    ]);
  });

  it('lays members out one after another', () => {
    const table = new StructTable().read('struct P { int x; int y; };');
    expect(table.layoutOf('P')).toEqual(
      new Map([
        ['x', [0, 'int', 4]],
        ['y', [4, 'int', 4]],
      ])
    );
    expect(table.sizeOf('P')).toBe(8);
  });

  it('sizes an array member, which the parser cannot even keep', () => {
    const table = new StructTable().read('struct S { char name[8]; int n; };');
    expect(table.membersOf('S')).toEqual([
      {
        name: 'name',
        type: 'char',
        lengths: [8],
        baseQualifiers: [],
        pointerQualifiers: [],
      },
      {
        name: 'n',
        type: 'int',
        lengths: [],
        baseQualifiers: [],
        pointerQualifiers: [],
      },
    ]);
    expect(table.layoutOf('S')!.get('n')).toEqual([8, 'int', 4]);
    expect(table.sizeOf('S')).toBe(12);
  });

  it('gives the parser a scalar placeholder for an array member', () => {
    const table = new StructTable().read(
      'struct S { char name[8]; int n; };\nint main(){ return 0; }'
    );
    expect(table.rewriteForParser('struct S { char name[8]; int n; };')).toBe(
      'struct S { char name   ; int n; };'
    );
  });

  it('treats a pointer member as a pointer, not as what it points at', () => {
    const table = new StructTable().read(
      'struct Node { int v; struct Node* next; };'
    );
    expect(table.layoutOf('Node')).toEqual(
      new Map([
        ['v', [0, 'int', 4]],
        ['next', [4, 'struct Node *', 4]],
      ])
    );
  });

  it('shares one type across several declarators', () => {
    const table = new StructTable().read('struct P { int x, y; double d; };');
    expect(table.layoutOf('P')).toEqual(
      new Map([
        ['x', [0, 'int', 4]],
        ['y', [4, 'int', 4]],
        ['d', [8, 'double', 8]],
      ])
    );
  });

  it('counts a nested record with the bookkeeping the engine adds', () => {
    const table = new StructTable().read(
      'struct Inner { int v; };\nstruct Outer { struct Inner in; int k; };'
    );
    expect(table.layoutOf('Outer')).toEqual(
      new Map([
        ['in', [0, 'struct Inner', 8]],
        ['k', [8, 'int', 4]],
      ])
    );
  });

  it('sizes repeated nested records independently', () => {
    const table = new StructTable().read(
      'struct Inner { int v; }; struct Pair { struct Inner a, b; };'
    );
    expect(table.layoutOf('Pair')).toEqual(
      new Map([
        ['a', [0, 'struct Inner', 8]],
        ['b', [8, 'struct Inner', 8]],
      ])
    );
  });

  it('files a tagless typedef under the only name it has', () => {
    const table = new StructTable().read('typedef struct { int x; } P;');
    expect(table.has('P')).toBe(true);
    expect(table.layoutOf('P')!.get('x')).toEqual([0, 'int', 4]);
  });

  it('answers to the tag and to the typedef name alike', () => {
    const table = new StructTable().read('typedef struct Pt { int x; } P;');
    expect(table.has('Pt')).toBe(true);
    expect(table.has('P')).toBe(true);
    expect(table.has('struct Pt')).toBe(true);
  });

  it('describes tags and typedef aliases for the canvas', () => {
    const table = new StructTable().read(
      'typedef struct Point { int x; } PointAlias;'
    );
    expect(table.runtimeTypes()).toMatchObject({
      Point: { displayType: 'struct Point', kind: 'struct' },
      PointAlias: { displayType: 'PointAlias (struct)', kind: 'struct' },
    });
  });

  it('does not mistake a use of a struct for a declaration', () => {
    const table = new StructTable().read(
      'struct P { int x; };\nint f(struct P p){ struct P q; return 0; }'
    );
    expect(table.names()).toEqual(['P']);
  });

  it('ignores a struct named in a string or a comment', () => {
    const table = new StructTable().read(
      'puts("struct Fake { int x; };");\n/* struct Ghost { int y; }; */'
    );
    expect(table.names()).toEqual([]);
  });
});

describe('UnionTable', () => {
  it('starts every member at the same offset', () => {
    const table = new UnionTable().read('union U { int i; char c; };');
    expect(table.layoutOf('U')).toEqual(
      new Map([
        ['i', [0, 'int', 4]],
        ['c', [0, 'char', 1]],
      ])
    );
  });

  it('is as wide as its widest member', () => {
    const table = new UnionTable().read(
      'union U { char c; double d; int i; };'
    );
    expect(table.sizeOf('U')).toBe(8);
  });

  it('reads a tagless typedef union', () => {
    const table = new UnionTable().read('typedef union { int i; char c; } U;');
    expect(table.layoutOf('U')!.get('c')).toEqual([0, 'char', 1]);
  });
});

describe('struct and union together', () => {
  const source =
    'union U { int i; double d; };\nstruct S { union U u; int n; };';

  it('lays a union nested in a struct out by the union rule', () => {
    const structs = new StructTable();
    const unions = new UnionTable();
    structs.link(unions);
    structs.read(source);
    unions.read(source);
    // 8 for the widest union member, 4 for the engine's own bookkeeping.
    expect(structs.layoutOf('S')).toEqual(
      new Map([
        ['u', [0, 'union U', 12]],
        ['n', [12, 'int', 4]],
      ])
    );
  });

  it('each table reads only its own keyword', () => {
    const structs = new StructTable().read(source);
    const unions = new UnionTable().read(source);
    expect(structs.names()).toEqual(['S']);
    expect(unions.names()).toEqual(['U']);
  });
});

describe('aggregate interpreter integration', () => {
  it('runs the aggregate-types teaching fixture', () => {
    const code = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        'baseline',
        'programs',
        's6-aggregate-types.cpp'
      ),
      'utf8'
    );
    const result = execute(code);
    expect(result.output).toBe(
      'light=3 power=1 point=(3,4) marker=7 reading=65/A counter=2\n'
    );
    const rows = canvasRows(result.states);
    expect(rows).toContainEqual(
      expect.arrayContaining(['enum TrafficLight', 'light', 'GREEN (3)'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['PowerState (enum)', 'power', 'POWER_ON (1)'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['struct Point', 'point'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['Marker (struct)', 'marker'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['union Reading', 'reading'])
    );
    expect(rows).toContainEqual(expect.arrayContaining(['Counter', 'counter']));

    const completeRows = result.states
      .slice()
      .reverse()
      .map(canvasRowsForState)
      .find((stateRows) => stateRows.some((row) => row.includes('counter')))!;
    const addressOf = (type: string, name: string) =>
      numericCanvasAddress(
        completeRows.find((row) => row.includes(type) && row.includes(name))!
      );
    const light = addressOf('enum TrafficLight', 'light');
    const power = addressOf('PowerState (enum)', 'power');
    const point = addressOf('struct Point', 'point');
    const marker = addressOf('Marker (struct)', 'marker');
    const reading = addressOf('union Reading', 'reading');
    const counter = addressOf('Counter', 'counter');
    expect([light, power, point, marker, reading, counter]).toEqual([
      light,
      light + 4,
      light + 8,
      light + 16,
      light + 28,
      light + 32,
    ]);
    expect(counter % 4).toBe(0);
  });

  it('executes enumerators and an enum-typed variable', () => {
    const code = `enum Color { RED = 3, GREEN };
int main(){ enum Color c = GREEN; printf("%d\\n", c); return 0; }`;
    expect(run(code)).toBe('4\n');
  });

  it('uses source-derived layout for typedef structs and array members', () => {
    const code = `typedef struct Point { char label[8]; int x; } Point;
int main(){ Point p; p.x = 5; printf("%d\\n", p.x); return 0; }`;
    expect(run(code)).toBe('5\n');
  });

  it('executes positional and designated arrays of structs', () => {
    const positional = `struct Point { int x; int y; };
int main(){ struct Point points[2] = {{1, 10}, {2, 20}};
  points[1].y = 21;
  printf("%d %d %d\\n", points[0].x, points[1].x, points[1].y); return 0; }`;
    expect(run(positional)).toBe('1 2 21\n');

    const designated = `struct Point { int x; int y; };
int main(){ struct Point points[4] = {
  [2] = {20, 200}, [0] = {5, 50}, {6, 60}
};
  printf("%d %d %d %d\\n", points[0].x, points[1].x,
         points[2].x, points[3].x); return 0; }`;
    expect(run(designated)).toBe('5 6 20 0\n');
  });

  it('preserves C designator ordering for primitive arrays too', () => {
    const code = `int main(){ int values[4] = {[2] = 20, [0] = 5, 6};
  printf("%d %d %d %d\\n", values[0], values[1], values[2], values[3]);
  return 0; }`;
    expect(run(code)).toBe('5 6 20 0\n');
  });

  it('keeps designated arrays of struct pointers as pointer arrays', () => {
    const code = `struct Point { int x; };
int main(){ struct Point point = {7};
  struct Point *pointers[2] = {[1] = &point};
  printf("%d %d\\n", pointers[0] == 0, pointers[1]->x); return 0; }`;
    expect(run(code)).toBe('1 7\n');
  });

  it('supports pointers to struct array elements and reports array size', () => {
    const code = `struct Point { int x; int y; };
int main(){ struct Point points[2] = {{1, 10}, {2, 20}};
  struct Point *point = &points[1];
  int *member = &points[1].y;
  printf("%d %d %d\\n", point->x, *member, (int)sizeof(points));
  return 0;
}`;
    expect(run(code)).toBe('2 20 16\n');
  });

  it('executes and visualizes qualified designated struct arrays', () => {
    const code = `struct Sensor {
  const int id;
  volatile int reading;
  int * const fixedTarget;
  const int * readOnlyTarget;
};
typedef volatile struct Sensor LiveSensor;
int main(){
  int raw = 42;
  LiveSensor sensors[3] = {
    [0] = {2, raw, &raw, &raw},
    [1] = {0},
    [2] = {0}
  };
  printf("%d %d %d %d\\n", sensors[0].id, sensors[0].reading,
         sensors[1].id, sensors[2].id);
  return 0;
}`;
    const result = execute(code);
    expect(result.output).toBe('2 42 0 0\n');
    const rows = canvasRows(result.states);
    expect(rows).toContainEqual(
      expect.arrayContaining(['volatile LiveSensor (struct)[3]', 'sensors'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['volatile LiveSensor (struct)', 'sensors[0]'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['const volatile int', 'id', '2'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['volatile int', 'reading', '42'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['volatile int * const', 'fixedTarget'])
    );
    expect(rows).toContainEqual(
      expect.arrayContaining(['const volatile int *', 'readOnlyTarget'])
    );

    const completeRows = result.states
      .slice()
      .reverse()
      .map(canvasRowsForState)
      .find((stateRows) =>
        stateRows.some((row) => row.includes('sensors[2]'))
      )!;
    const elementRows = [0, 1, 2].map(
      (index) => completeRows.find((row) => row.includes(`sensors[${index}]`))!
    );
    const idRows = completeRows.filter(
      (row) => row.includes('const volatile int') && row.includes('id')
    );
    const elementAddresses = elementRows.map(numericCanvasAddress);
    expect(elementAddresses).toEqual([
      elementAddresses[0],
      elementAddresses[0] + 16,
      elementAddresses[0] + 32,
    ]);
    expect(idRows.map(numericCanvasAddress)).toEqual(elementAddresses);
    const rawRow = completeRows.find(
      (row) => row.includes('raw') && row.includes('42')
    )!;
    const fixedTargetRow = completeRows.find((row) =>
      row.includes('fixedTarget')
    )!;
    expect(canvasAddress(fixedTargetRow)).toBe(canvasAddress(rawRow));
  });

  it('uses shared member storage for every element of a union array', () => {
    const code = `union Payload { int whole; char letter; };
int main(){ union Payload payloads[2] = {{65}, {66}};
  printf("%d %c %d %c\\n", payloads[0].whole, payloads[0].letter,
         payloads[1].whole, payloads[1].letter); return 0; }`;
    expect(run(code)).toBe('65 A 66 B\n');
  });

  it('shows member alignment and trailing padding in addresses and sizeof', () => {
    const code = `struct Padded { char c; int value; };
int main(){ struct Padded p; p.c = 1; p.value = 7; int after = 9;
  printf("%d\\n", (int)sizeof(p)); return 0; }`;
    const result = execute(code);
    expect(result.output).toBe('8\n');
    const rows = canvasRows(result.states);
    const structRow = rows.find(
      (row) => row.includes('struct Padded') && row.includes('p')
    )!;
    const charRow = rows.find(
      (row) => row.includes('char') && row.includes('c')
    )!;
    const valueRow = rows.find(
      (row) => row.includes('value') && row.includes('7')
    )!;
    const afterRow = rows.find(
      (row) => row.includes('after') && row.includes('9')
    )!;
    const base = numericCanvasAddress(structRow);
    expect(numericCanvasAddress(charRow)).toBe(base);
    expect(numericCanvasAddress(valueRow)).toBe(base + 4);
    expect(numericCanvasAddress(afterRow)).toBe(base + 8);
  });

  it('makes union members share storage and reports the widest size', () => {
    const code = `union Value { int i; double d; };
int main(){ union Value v; v.i = 65;
  printf("%d %d\\n", v.i, (int)sizeof(v)); return 0; }`;
    expect(run(code)).toBe('65 8\n');
  });

  it('leaves a C++ class on the stock interpreter path', () => {
    const code = `class Box { int value; };
int main(){ Box b; b.value = 7; printf("%d\\n", b.value); return 0; }`;
    expect(run(code)).toBe('7\n');
  });

  it('shows an enum type and symbolic value on the canvas', () => {
    const code = `enum Color { RED, GREEN };
int main(){ enum Color c = GREEN; return 0; }`;
    const rows = canvasRows(execute(code).states);
    expect(rows).toContainEqual(
      expect.arrayContaining(['enum Color', 'c', 'GREEN (1)'])
    );
  });

  it('labels structs explicitly on the canvas', () => {
    const code = `struct Point { int x; int y; };
int main(){ struct Point p; p.x = 3; p.y = 4; return 0; }`;
    const rows = canvasRows(execute(code).states);
    const structRow = rows.find(
      (row) => row.includes('struct Point') && row.includes('p')
    )!;
    const firstMemberRow = rows.find(
      (row) => row.includes('x') && row.includes('3')
    )!;
    expect(structRow).toBeDefined();
    expect(firstMemberRow).toBeDefined();
    expect(canvasAddress(firstMemberRow)).toBe(canvasAddress(structRow));
  });

  it('labels a union and shows its members at one shared address', () => {
    const code = `union Value { int i; char c; };
int main(){ union Value v; v.i = 65; return 0; }`;
    const rows = canvasRows(execute(code).states);
    expect(rows).toContainEqual(expect.arrayContaining(['union Value', 'v']));
    const intRow = rows.find((row) => row.includes('i') && row.includes('65'))!;
    const charRow = rows.find(
      (row) => row.includes('c') && row.some((cell) => cell.includes("'A'"))
    )!;
    const unionRow = rows.find(
      (row) => row.includes('union Value') && row.includes('v')
    )!;
    expect(canvasAddress(intRow)).toBe(canvasAddress(unionRow));
    expect(canvasAddress(charRow)).toBe(canvasAddress(unionRow));
  });

  it('remaps pointers to the aligned displayed address of a struct member', () => {
    const code = `struct Point { int x; int y; };
int main(){ struct Point p; p.x = 3; p.y = 4; int* q = &p.y; return 0; }`;
    const rows = canvasRows(execute(code).states);
    const memberRow = rows.find(
      (row) => row.includes('y') && row.includes('4')
    )!;
    const pointerRow = rows.find(
      (row) => row.includes('q') && row.some((cell) => cell.includes('0x'))
    )!;
    expect(pointerRow).toContain(canvasAddress(memberRow));
  });
});
