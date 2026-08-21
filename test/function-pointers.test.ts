import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { extractModel, extractVariables, VariableModel } from '../src/core';
import { HoverTextSource } from '../src/app/hoverText';
import { linesOf } from './records';
import { constructAt } from '../src/interpreter/Construct';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { FunctionPointerTable } from '../src/interpreter/FunctionPointerTable';

/**
 * The cases mirror `baseline/scripts/probe-function-pointers.js`, which records
 * what the stock unicoen.ts pipeline does with a function pointer: nothing.
 * `int (*op)(int, int) = add;` collapses into a bare `"int"` in the block body
 * and the run stops after one step with no output and no syntax error.
 *
 * Unit checks keep the source pass honest; the execution and canvas groups
 * verify that its answers reach the engine and the visualizer.
 */

const rewrite = (code: string) => new FunctionPointerTable().rewrite(code);
const execute = (code: string): { output: string; states: ExecState[] } => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined; // the engine dumps every stack frame it builds
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
const canvasRows = (states: ExecState[]): string[][] => {
  const rows: string[][] = [];
  for (const state of states) {
    for (const stack of extractModel(state).stacks) {
      rows.push(...stack.rows.map((row) => row.map((cell) => cell.text)));
    }
  }
  return rows;
};
const rowFor = (states: ExecState[], name: string): string[] => {
  const found = canvasRows(states).filter((row) => row.indexOf(name) !== -1);
  return found[found.length - 1] || [];
};
/** The last state a named variable appears in, as the editor would find it. */
const variableNamed = (
  states: ExecState[],
  name: string
): VariableModel | null => {
  let found: VariableModel | null = null;
  for (const state of states) {
    for (const variable of extractVariables(state)) {
      if (variable.name === name) {
        found = variable;
      }
    }
  }
  return found;
};
const hoverText = (states: ExecState[], name: string): string => {
  const hover: any = new HoverTextSource();
  return linesOf(hover.variableRecord(variableNamed(states, name)));
};

const constructs = (code: string) => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(code);
};

const ADD = 'int add(int a, int b){ return a + b; }\n';
const SUB = 'int sub(int a, int b){ return a - b; }\n';
const H = `#include<stdio.h>\n${ADD}${SUB}`;

describe('FunctionPointerTable: reading declarators', () => {
  it('replaces a declarator with a synthetic type of the same width', () => {
    const code = 'int (*op)(int, int) = add;';
    expect(rewrite(code)).toBe('_fp0 op             = add;');
    expect(rewrite(code)).toHaveLength(code.length);
  });

  it('keeps the signature it replaced', () => {
    const table = new FunctionPointerTable().read('int (*op)(int, int);');
    expect(table.runtimeTypes()._fp0.displayType).toBe('int (*)(int, int)');
  });

  it('keeps the array bounds outside the parameter list', () => {
    expect(rewrite('int (*ops[2])(int, int);')).toBe(
      '_fp0 ops[2]            ;'
    );
  });

  it('reads a pointer returned by value', () => {
    const table = new FunctionPointerTable().read('char *(*f)(const char *);');
    expect(table.runtimeTypes()._fp0.displayType).toBe(
      'char *(*)(const char *)'
    );
  });

  it('reads a declarator with more than one star', () => {
    const table = new FunctionPointerTable().read('int (**pp)(void);');
    expect(table.runtimeTypes()._fp0.displayType).toBe('int (**)(void)');
  });

  it('rewrites a parameter without moving the ones beside it', () => {
    expect(rewrite('int apply(int (*f)(int, int), int a){ return 0; }')).toBe(
      'int apply(_fp0 f            , int a){ return 0; }'
    );
  });

  it('substitutes a typedef alias and blanks its declaration', () => {
    const code = 'typedef int (*BinOp)(int, int);\nBinOp op = add;';
    expect(rewrite(code)).toBe(
      '                              ;\n_fp0  op = add;'
    );
  });

  it('recognises a return type named by a record typedef', () => {
    const table = new FunctionPointerTable().read(
      'typedef struct { int x; } Point;\nPoint (*make)(int);'
    );
    expect(table.runtimeTypes()._fp0.displayType).toBe('Point (*)(int)');
  });

  it('leaves an abstract declarator with no name', () => {
    expect(rewrite('void qsort(int (*)(int, int));')).toBe(
      'void qsort(_fp0             );'
    );
  });

  it('never moves a line', () => {
    const code = 'int (*op)(int,\n  int) = add;\nint x = 1;';
    expect(rewrite(code).split('\n')).toHaveLength(code.split('\n').length);
  });

  it('leaves a multiplication that looks like a declarator alone', () => {
    // `a * (*op)(1, 2)` has parentheses, a star, a name and an argument list.
    // Only the missing type tells it apart from a declaration.
    const code = 'x = a * (*op)(1, 2);';
    expect(rewrite(code)).toBe(code);
  });

  it('leaves a call that looks like a declarator alone', () => {
    expect(rewrite('return (*op)(2, 3);')).toBe('return (*op)(2, 3);');
    expect(rewrite('int y = (*op)(2, 3);')).toBe('int y = (*op)(2, 3);');
  });

  it('rewrites a cast to a function-pointer type', () => {
    expect(rewrite('p = (int (*)(int, int))q;')).toBe(
      'p = (_fp0             )q;'
    );
  });
});

describe('FunctionPointerTable: rewriting indirect calls', () => {
  it('spells an indexed call as a dereference', () => {
    const code = 'int (*ops[2])(int, int);\nops[1](7, 3);';
    expect(rewrite(code).split('\n')[1]).toBe('(*ops[1])(7, 3);');
  });

  it('spells a member call as a dereference', () => {
    const code = 'int (*fn)(int, int);\no.fn(2, 3);';
    expect(rewrite(code).split('\n')[1]).toBe('(*o.fn)(2, 3);');
  });

  it('spells an arrow call as a dereference', () => {
    const code = 'int (*fn)(int, int);\np->fn(2, 3);';
    expect(rewrite(code).split('\n')[1]).toBe('(*p->fn)(2, 3);');
  });

  it('leaves a direct call alone, which the mapper already handles', () => {
    const code = 'int (*op)(int, int);\nop(2, 3);';
    expect(rewrite(code).split('\n')[1]).toBe('op(2, 3);');
  });

  it('leaves an indexed call on something else alone', () => {
    const code = 'int (*op)(int, int);\ntable[1](7, 3);';
    expect(rewrite(code).split('\n')[1]).toBe('table[1](7, 3);');
  });

  it('reports the columns it added so a position can be corrected', () => {
    const table = new FunctionPointerTable().read(
      'int (*ops[2])(int, int);\n  ops[1](7, 3);'
    );
    // `  ops[1](7, 3);` becomes `  (*ops[1])(7, 3);`
    expect(table.columnShift(2, 4)).toBe(2); // the `o` of ops
    expect(table.columnShift(2, 12)).toBe(9); // the `(` of the argument list
    expect(table.columnShift(1, 4)).toBe(4); // an untouched line is untouched
  });
});

describe('function pointers: execution', () => {
  it('calls through a pointer initialized with a function', () => {
    expect(
      run(`${H}int main(){ int (*op)(int, int) = add;
  printf("%d\\n", op(2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('accepts the address-of spelling of the same initializer', () => {
    expect(
      run(`${H}int main(){ int (*op)(int, int) = &add;
  printf("%d\\n", op(2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('accepts the dereference spelling of the same call', () => {
    expect(
      run(`${H}int main(){ int (*op)(int, int) = add;
  printf("%d\\n", (*op)(2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('assigns after declaring, and reassigns', () => {
    expect(
      run(`${H}int main(){ int (*op)(int, int);
  op = add; printf("%d\\n", op(2, 3));
  op = sub; printf("%d\\n", op(7, 3)); return 0; }`)
    ).toBe('5\n4\n');
  });

  it('takes a function pointer as a parameter', () => {
    expect(
      run(`${H}int apply(int (*f)(int, int), int a, int b){ return f(a, b); }
int main(){ printf("%d\\n", apply(add, 2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('passes a pointer variable on to another function', () => {
    expect(
      run(`${H}int apply(int (*f)(int, int), int a, int b){ return f(a, b); }
int main(){ int (*op)(int, int) = sub;
  printf("%d\\n", apply(op, 7, 3)); return 0; }`)
    ).toBe('4\n');
  });

  it('dispatches through an array of function pointers', () => {
    expect(
      run(`${H}int main(){ int (*ops[2])(int, int) = {add, sub};
  printf("%d %d\\n", ops[0](2, 3), ops[1](7, 3)); return 0; }`)
    ).toBe('5 4\n');
  });

  it('dispatches through a struct member', () => {
    expect(
      run(`${H}struct Op { int (*fn)(int, int); };
int main(){ struct Op o; o.fn = add;
  printf("%d\\n", o.fn(2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('resolves a typedef of a function-pointer type', () => {
    expect(
      run(`#include<stdio.h>\ntypedef int (*BinOp)(int, int);
${ADD}int main(){ BinOp op = add; printf("%d\\n", op(2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('calls a pointer to a function taking and returning nothing', () => {
    expect(
      run(`#include<stdio.h>\nvoid greet(void){ printf("hi\\n"); }
int main(){ void (*g)(void) = greet; g(); return 0; }`)
    ).toBe('hi\n');
  });

  it('holds a pointer in a global', () => {
    expect(
      run(`${H}int (*gop)(int, int) = add;
int main(){ printf("%d\\n", gop(2, 3)); return 0; }`)
    ).toBe('5\n');
  });

  it('selects a function with a conditional', () => {
    expect(
      run(`${H}int main(){ int wide = 1;
  int (*op)(int, int) = wide ? add : sub;
  printf("%d\\n", op(7, 3)); return 0; }`)
    ).toBe('10\n');
  });

  it('compares a pointer with the function it points at', () => {
    expect(
      run(`${H}int main(){ int (*op)(int, int) = add;
  printf("%d %d\\n", op == add, op == sub); return 0; }`)
    ).toBe('1 0\n');
  });

  it('is true in a condition, and false when it holds nothing', () => {
    expect(
      run(`${H}int main(){ int (*op)(int, int) = add;
  if (op) { printf("set\\n"); }
  op = 0;
  if (!op) { printf("clear\\n"); }
  return 0; }`)
    ).toBe('set\nclear\n');
  });

  it('never gives a function the null address', () => {
    // The code segment starts at 0, so the first function defined would
    // otherwise be indistinguishable from a null pointer.
    expect(
      run(`${H}int main(){ int (*op)(int, int) = add;
  printf("%d\\n", op == 0); return 0; }`)
    ).toBe('0\n');
  });

  it('leaves an ordinary pointer dereference working', () => {
    expect(
      run(`#include<stdio.h>
int main(){ int x = 5; int *p = &x; printf("%d\\n", *p); return 0; }`)
    ).toBe('5\n');
  });
});

describe('function pointers: on the canvas', () => {
  it('shows the signature, the function it points at and its address', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = add; return 0; }`
    );
    const row = rowFor(states, 'op');
    expect(row[0]).toBe('int (*)(int, int)');
    expect(row[2]).toBe('add (0x1000)');
  });

  it('follows a reassignment', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = add; op = sub; return 0; }`
    );
    expect(rowFor(states, 'op')[2]).toBe('sub (0x1004)');
  });

  it('shows each element of an array of function pointers', () => {
    const { states } = execute(
      `${H}int main(){ int (*ops[2])(int, int) = {add, sub}; return 0; }`
    );
    expect(rowFor(states, 'ops')[0]).toBe('int (*[2])(int, int)');
    expect(rowFor(states, 'ops[0]')[3]).toBe('add (0x1000)');
    expect(rowFor(states, 'ops[1]')[3]).toBe('sub (0x1004)');
  });

  it('says nothing about a pointer that holds nothing', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = 0; return 0; }`
    );
    expect(rowFor(states, 'op')[0]).toBe('int (*)(int, int)');
    expect(rowFor(states, 'op')[2]).not.toContain('add');
  });
});

describe('function pointers: hovering a variable', () => {
  it('shows the signature rather than the synthetic runtime type', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = add; return 0; }`
    );
    expect(hoverText(states, 'op')).toContain('type: int (*)(int, int)');
    expect(hoverText(states, 'op')).not.toContain('_fp');
  });

  it('shows the value as an address, named with the function it holds', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = sub; return 0; }`
    );
    expect(hoverText(states, 'op')).toContain('value: sub (0x1004)');
  });

  it('shows an address rather than a decimal for a pointer holding none', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = 0; return 0; }`
    );
    expect(hoverText(states, 'op')).toContain('value: 0x0');
  });

  it('names every function in a table of them', () => {
    const { states } = execute(
      `${H}int main(){ int (*ops[2])(int, int) = {add, sub}; return 0; }`
    );
    const text = hoverText(states, 'ops');
    expect(text).toContain('type: int (*[2])(int, int)');
    expect(text).toContain('[add (0x1000), sub (0x1004)]');
  });

  it('reports the same address the canvas draws', () => {
    const { states } = execute(
      `${H}int main(){ int (*op)(int, int) = add; return 0; }`
    );
    const drawn = rowFor(states, 'op')[3];
    const hovered = hoverText(states, 'op').split('address: ')[1];
    expect(drawn).toContain(hovered);
  });
});

describe('function pointers: editor tooltips', () => {
  it('describes the declaration with the signature, not the synthetic type', () => {
    const code = `${H}int main(){\n  int (*op)(int, int) = add;\n  return 0;\n}`;
    const found = constructAt(constructs(code), 5, 2);
    expect(found).not.toBeNull();
    expect(found!.detail).toContain('int (*)(int, int)');
    expect(found!.detail).not.toContain('_fp');
  });

  it('puts the array bounds inside the declarator', () => {
    const code = `${H}int main(){\n  int (*ops[2])(int, int) = {add, sub};\n  return 0;\n}`;
    expect(constructAt(constructs(code), 5, 2)!.detail).toContain(
      'int (*[2])(int, int)'
    );
  });

  it('names the pointer an indirect call goes through', () => {
    const code = `${H}int main(){\n  int (*ops[2])(int, int) = {add, sub};\n  ops[1](7, 3);\n  return 0;\n}`;
    const found = constructAt(constructs(code), 6, 2);
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('call');
    expect(found!.detail).toBe('ops');
  });
});
