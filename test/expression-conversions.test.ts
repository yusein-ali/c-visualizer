import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  EXPRESSION_MODEL_VERSION,
  ExpressionModel,
  ExpressionNodeModel,
  extractModel,
} from '../src/core';
import {
  canonicalType,
  commonType,
  convertedValue,
  literalType,
  promotedType,
} from '../src/interpreter/ExpressionTypes';

/*
 * Implicit conversions in the expression tree: the rules of C11 6.3.1 the
 * trace applies, and the conversion nodes it puts into the trees of real
 * programs.
 */

const run = (code: string): ExpressionModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const trees: ExpressionModel[] = [];
  try {
    const record = (state: Parameters<typeof extractModel>[0]) => {
      const expression = extractModel(state).expression;
      if (expression !== null) {
        trees.push(expression);
      }
    };
    record(interpreter.startStepExecution(code));
    for (
      let steps = 0;
      interpreter.isStepExecutionRunning() && steps < 2000;
      steps += 1
    ) {
      record(interpreter.stepExecute());
    }
    return trees;
  } finally {
    console.log = log;
  }
};

/** The tree drawn for the statement on a given line. */
const treeOn = (
  trees: ExpressionModel[],
  line: number
): ExpressionNodeModel => {
  const found = trees.find((tree) => tree.range.begin.y === line);
  expect(found).toBeDefined();
  return found!.root;
};

const nodesOf = (root: ExpressionNodeModel): ExpressionNodeModel[] => [
  root,
  ...root.children.flatMap(nodesOf),
];

/** A tree as `text:type`, nested, which is what these tests are about. */
const shape = (node: ExpressionNodeModel): unknown => {
  const label = `${node.text}${node.type === undefined ? '' : `:${node.type}`}`;
  return node.children.length === 0
    ? label
    : [label, ...node.children.map(shape)];
};

describe('the model version', () => {
  it('is 2, the version with conversion nodes and types', () => {
    expect(EXPRESSION_MODEL_VERSION).toBe(2);
  });
});

describe('the conversion rules', () => {
  it('spells every type one way', () => {
    expect(canonicalType('unsigned')).toBe('unsigned int');
    expect(canonicalType('unsignedchar')).toBe('unsigned char');
    expect(canonicalType('const long int')).toBe('long');
    expect(canonicalType('long long int')).toBe('long long');
    expect(canonicalType('int*')).toBe('int *');
    expect(canonicalType('char * *')).toBe('char **');
    expect(canonicalType('int[3]')).toBe('int[3]');
    expect(canonicalType('struct Node')).toBe('struct Node');
  });

  it('promotes everything narrower than int to int', () => {
    for (const narrow of [
      '_Bool',
      'char',
      'signed char',
      'unsigned char',
      'short',
      'unsigned short',
    ]) {
      expect(promotedType(narrow)).toBe('int');
    }
    expect(promotedType('unsigned int')).toBe('unsigned int');
    expect(promotedType('float')).toBe('float');
  });

  it('finds the common type of the usual arithmetic conversions', () => {
    expect(commonType('int', 'double')).toBe('double');
    expect(commonType('short', 'float')).toBe('float');
    expect(commonType('float', 'long double')).toBe('long double');
    expect(commonType('char', 'char')).toBe('int');
    expect(commonType('int', 'unsigned int')).toBe('unsigned int');
    expect(commonType('unsigned char', 'int')).toBe('int');
    expect(commonType('long', 'int')).toBe('long');
    expect(commonType('long long', 'unsigned int')).toBe('long long');
    // A long is no wider than an unsigned int in this engine, so it cannot
    // hold every value of one, and the two meet in unsigned long.
    expect(commonType('long', 'unsigned int')).toBe('unsigned long');
    expect(commonType('int *', 'int')).toBeNull();
  });

  it('types constants by suffix, base and value', () => {
    expect(literalType('5', false, 5)).toBe('int');
    expect(literalType('0u', false, 0)).toBe('unsigned int');
    expect(literalType('7L', false, 7)).toBe('long');
    expect(literalType('7ul', false, 7)).toBe('unsigned long');
    expect(literalType('1LL', false, 1)).toBe('long long');
    expect(literalType('3000000000', false, 3000000000)).toBe('long long');
    expect(literalType('0xFFFFFFFF', false, 0xffffffff)).toBe('unsigned int');
    expect(literalType('2.0', true, 2)).toBe('double');
    expect(literalType('1.5f', true, 1.5)).toBe('float');
  });

  it('converts values the way the machine does', () => {
    expect(convertedValue('5', 'int', 'double')).toBe('5.0');
    expect(convertedValue('2.75', 'double', 'int')).toBe('2');
    expect(convertedValue('-1', 'int', 'unsigned int')).toBe('4294967295');
    expect(convertedValue('300', 'int', 'char')).toBe('44');
    expect(convertedValue('200', 'int', 'signed char')).toBe('-56');
    expect(convertedValue('7', 'int', '_Bool')).toBe('1');
    expect(convertedValue("'a' (97)", 'char', 'int')).toBe('97');
    expect(convertedValue('1e40', 'double', 'int')).toBeNull();
    expect(convertedValue('[1, 2]', 'int', 'double')).toBeNull();
  });
});

describe('conversion nodes in the trace', () => {
  it('converts the int operand of a division by a double', () => {
    const trees = run(`
int main(void) {
  int i = 5;
  double d = i / 2.0;
  return 0;
}
`);
    const root = treeOn(trees, 4);
    expect(shape(root)).toEqual([
      '=:double',
      'd:double',
      ['/:double', ['int → double:double', 'i:int'], '2.0:double'],
    ]);
    const conversion = root.children[1].children[0];
    expect(conversion).toMatchObject({
      kind: 'conversion',
      type: 'double',
      // What `i` holds going in, converted.
      value: '5.0',
    });
    expect(conversion.children[0]).toMatchObject({ text: 'i', value: '5' });
  });

  it('converts a negative int compared with an unsigned constant', () => {
    const trees = run(`
int main(void) {
  int b = -1 < 0u;
  return b;
}
`);
    const root = treeOn(trees, 3);
    expect(shape(root)).toEqual([
      '=:int',
      'b:int',
      [
        '<:int',
        ['int → unsigned int:unsigned int', ['-:int', '1:int']],
        '0u:unsigned int',
      ],
    ]);
    // A constant's conversion is known before the statement runs.
    expect(root.children[1].children[0].value).toBe('4294967295');
  });

  it('converts an initialiser to the type of the object it initialises', () => {
    const trees = run(`
int main(void) {
  char c = 300;
  return 0;
}
`);
    const root = treeOn(trees, 3);
    expect(shape(root)).toEqual([
      '=:char',
      'c:char',
      ['int → char:char', '300:int'],
    ]);
    expect(root.children[1]).toMatchObject({ kind: 'conversion', value: '44' });
  });

  it('promotes narrow operands and leaves matching ones alone', () => {
    const trees = run(`
int main(void) {
  unsigned char uc = 200;
  short s = 2;
  float f = 1.5f;
  int i = 1;
  int x = uc + i;
  float g = f * s;
  int y = i + i;
  return 0;
}
`);
    expect(shape(treeOn(trees, 7).children[1])).toEqual([
      '+:int',
      ['unsigned char → int:int', 'uc:unsigned char'],
      'i:int',
    ]);
    // Floating beats integer outright: no promotion to int on the way.
    expect(shape(treeOn(trees, 8).children[1])).toEqual([
      '*:float',
      'f:float',
      ['short → float:float', 's:short'],
    ]);
    expect(
      nodesOf(treeOn(trees, 9)).some((node) => node.kind === 'conversion')
    ).toBe(false);
  });

  it('converts both arms of a conditional to their common type', () => {
    const trees = run(`
int main(void) {
  int flag = 1;
  double d = flag ? 1.5 : 2;
  return 0;
}
`);
    // The condition is only compared with zero, and is not converted.
    expect(shape(treeOn(trees, 4).children[1])).toEqual([
      '?::double',
      'flag:int',
      '1.5:double',
      ['int → double:double', '2:int'],
    ]);
  });

  it('types a member through its path and a pointer through its target', () => {
    const trees = run(`
struct P { int x; double y; };
int main(void) {
  struct P pt;
  int arr[2] = {1, 2};
  int *p = &arr[1];
  pt.x = 3;
  pt.y = pt.x;
  double d = *p;
  return 0;
}
`);
    expect(shape(treeOn(trees, 8))).toEqual([
      '=:double',
      ['.:double', 'pt:struct P', 'y'],
      ['int → double:double', ['.:int', 'pt:struct P', 'x']],
    ]);
    expect(shape(treeOn(trees, 9))).toEqual([
      '=:double',
      'd:double',
      ['int → double:double', ['*:int', 'p:int *']],
    ]);
  });

  it('reads constants with suffixes and in octal', () => {
    const trees = run(`
int main(void) {
  long l = 7L;
  float f = 1.5f;
  int oct = 017;
  int sum = oct + l + f;
  return 0;
}
`);
    const sum = treeOn(trees, 6);
    const names = nodesOf(sum).filter((node) => node.kind === 'operand');
    expect(names.map((node) => [node.text, node.value])).toEqual([
      ['sum', null],
      ['oct', '15'],
      ['l', '7'],
      ['f', '1.5'],
    ]);
  });

  it('keeps every key distinct when conversions are added', () => {
    const trees = run(`
int main(void) {
  int i = 5;
  short s = 2;
  double d = i / 2.0 + s * 1.5f;
  return 0;
}
`);
    const keys = nodesOf(treeOn(trees, 5)).map((node) => node.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
