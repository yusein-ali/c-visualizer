import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { LintDiagnostic } from '../src/interpreter/TeachingLint';
import { Server } from '../src/core/server';
import { defaultProgram } from '../src/defaultProgram';

/**
 * The teaching rules, over programs that parse. Every case is a program a
 * beginner writes: what is checked is that the rule fires where a compiler
 * would warn, and stays quiet where the code is idiomatic C.
 */

const lint = (code: string): LintDiagnostic[] => {
  const interpreter = new PlivetCPP14Interpreter();
  const error = console.error;
  console.error = () => undefined;
  try {
    return interpreter.getLints(code);
  } finally {
    console.error = error;
  }
};

const rules = (code: string): string[] =>
  lint(code).map((diagnostic) => diagnostic.rule);

const only = (code: string, rule: string): LintDiagnostic[] =>
  lint(code).filter((diagnostic) => diagnostic.rule === rule);

describe('scanf without a pointer to its destination object', () => {
  it('reports the argument, and offers the & as a fix', () => {
    const code = `int main(void) {
  int n;
  scanf("%d", n);
  return n;
}
`;
    const [found] = only(code, 'scanf-address');
    expect(found).toBeDefined();
    expect(found.severity).toBe('error');
    expect(found.line).toBe(3);
    expect(found.message).toContain('&n');
    expect(found.help).toBe('scanf');
    expect(found.fix).toEqual({
      label: 'Pass &n',
      line: 3,
      column: 14,
      endLine: 3,
      endColumn: 15,
      text: '&n',
    });
  });

  it('says nothing when the address is passed', () => {
    const code = `int main(void) {
  int n;
  scanf("%d", &n);
  return n;
}
`;
    expect(rules(code)).not.toContain('scanf-address');
  });

  it('accepts an array argument, which is converted to a pointer here', () => {
    const code = `int main(void) {
  char name[8];
  scanf("%s", name);
  return 0;
}
`;
    expect(rules(code)).not.toContain('scanf-address');
  });
});

describe('an assignment used as a controlling expression', () => {
  it('reports it, and offers == as a fix', () => {
    const code = `int main(void) {
  int n = 0;
  if (n = 3) { return 1; }
  return 0;
}
`;
    const [found] = only(code, 'assignment-as-condition');
    expect(found).toBeDefined();
    expect(found.line).toBe(3);
    expect(found.message).toContain('== is the equality operator');
    expect(found.fix).toEqual({
      label: 'Compare with ==',
      line: 3,
      column: 8,
      endLine: 3,
      endColumn: 9,
      text: '==',
    });
  });

  it('reports one in a while statement as well as in an if statement', () => {
    const code = `int main(void) {
  int n = 0;
  while (n = 1) { break; }
  return 0;
}
`;
    expect(only(code, 'assignment-as-condition').length).toBe(1);
  });

  it('leaves the idiom alone, where the assignment is inside a comparison', () => {
    const code = `int main(void) {
  int c = 0;
  while ((c = getchar()) != -1) { }
  return 0;
}
`;
    expect(rules(code)).not.toContain('assignment-as-condition');
  });
});

describe('a format string that disagrees with its arguments', () => {
  it('counts the conversions against the arguments', () => {
    const code = `int main(void) {
  int a = 1;
  printf("%d %d\\n", a);
  return 0;
}
`;
    const [found] = only(code, 'format-arguments');
    expect(found).toBeDefined();
    expect(found.message).toContain('2 conversion specifications');
    expect(found.message).toContain('1 corresponding argument');
  });

  it('does not count a doubled per cent sign as a conversion', () => {
    const code = `int main(void) {
  printf("100%%\\n");
  return 0;
}
`;
    expect(rules(code)).not.toContain('format-arguments');
  });

  it('reports a conversion that does not match the argument it is given', () => {
    const code = `int main(void) {
  double d = 0.5;
  printf("%d\\n", d);
  return 0;
}
`;
    const [found] = only(code, 'format-arguments');
    expect(found).toBeDefined();
    expect(found.message).toContain('%d');
    expect(found.line).toBe(3);
  });

  it('accepts a character array where a string is asked for', () => {
    const code = `int main(void) {
  char name[8];
  printf("%s\\n", name);
  return 0;
}
`;
    expect(rules(code)).not.toContain('format-arguments');
  });

  it('checks the type of the object a scanf argument points to', () => {
    const code = `int main(void) {
  double d = 0.0;
  scanf("%d", &d);
  return 0;
}
`;
    const [found] = only(code, 'format-arguments');
    expect(found).toBeDefined();
    expect(found.message).toContain('points to');
  });
});

describe('an object evaluated while its value is indeterminate', () => {
  it('reports the evaluation', () => {
    const code = `int main(void) {
  int n;
  return n + 1;
}
`;
    const [found] = only(code, 'uninitialized-read');
    expect(found).toBeDefined();
    expect(found.line).toBe(3);
    expect(found.message).toContain('undefined behavior');
  });

  it('counts an assignment in either arm of a branch', () => {
    const code = `int main(void) {
  int a = 1;
  int b = 2;
  int max;
  if (a > b) { max = a; } else { max = b; }
  return max;
}
`;
    expect(rules(code)).not.toContain('uninitialized-read');
  });

  it('treats taking its address as a possible store through the pointer', () => {
    const code = `int main(void) {
  int n;
  scanf("%d", &n);
  return n;
}
`;
    expect(rules(code)).not.toContain('uninitialized-read');
  });

  it('still reports the read on the right of its own assignment', () => {
    const code = `int main(void) {
  int n;
  n = n + 1;
  return n;
}
`;
    expect(only(code, 'uninitialized-read').length).toBe(1);
  });

  it('says nothing about a parameter, which receives an argument value', () => {
    const code = `int twice(int n) { return n * 2; }
int main(void) { return twice(2); }
`;
    expect(rules(code)).not.toContain('uninitialized-read');
  });

  it('does not mistake a member name for an object-identifier evaluation', () => {
    const code = `struct Pair { int left; int right; };
union Number { int whole; char byte; };
int main(void) {
  struct Pair pair = {1, 2};
  struct Pair *pointer = &pair;
  union Number number = {0};
  number.whole = pointer->left;
  return number.whole;
}
`;
    expect(rules(code)).not.toContain('uninitialized-read');
  });

  it('does not put record-member declarations in lexical scope', () => {
    const code = `struct Pair { int left; };
int main(void) { return left; }
`;
    expect(rules(code)).not.toContain('uninitialized-read');
  });
});

describe('a name used as a value that nothing declares', () => {
  it('reports it, where the engine used to run the program and print nothing', () => {
    const code = `#include <stdio.h>

int main(void) {
  int a = 10;
  printf(f);
  return 0;
}
`;
    const [found] = only(code, 'undeclared-identifier');
    expect(found).toBeDefined();
    expect(found.severity).toBe('error');
    expect(found.line).toBe(5);
    expect(found.message).toContain('f is not declared');
  });

  it('reports a misspelled name at the use, not at the declaration', () => {
    const code = `#include <stdio.h>
int main(void) {
  int count = 1;
  printf("%d", cuont);
  return 0;
}
`;
    const [found] = only(code, 'undeclared-identifier');
    expect(found.line).toBe(4);
    expect(found.message).toContain('cuont');
  });

  it('reports a record member used as though it were an object', () => {
    // The member is real, but it is not in any lexical scope: `left` alone
    // names nothing. The same fixture proves `uninitialized-read` stays quiet.
    const code = `struct Pair { int left; };
int main(void) { return left; }
`;
    expect(rules(code)).toContain('undeclared-identifier');
  });

  it('says nothing about a library function it cannot see declared', () => {
    const code = `#include <stdio.h>
int main(void) { printf("hi"); return 0; }
`;
    expect(rules(code)).not.toContain('undeclared-identifier');
  });

  it('says nothing about a library object it cannot see declared', () => {
    const code = `#include <stdio.h>
int main(void) { fprintf(stdout, "hi"); return 0; }
`;
    expect(rules(code)).not.toContain('undeclared-identifier');
  });

  it('says nothing about a macro it has no header to expand', () => {
    // PLIVET does not read stdio.h, so `NULL` and `EOF` arrive as bare
    // identifiers. Refusing them would refuse a program that is not wrong.
    const code = `#include <stdio.h>
int main(void) { int *p = NULL; int c = EOF; return p == NULL ? c : 0; }
`;
    expect(rules(code)).not.toContain('undeclared-identifier');
  });

  it('says nothing about a function used as a value', () => {
    const code = `#include <stdio.h>
void greet(void) { printf("hi"); }
int main(void) { void (*g)(void) = greet; g(); return 0; }
`;
    expect(rules(code)).not.toContain('undeclared-identifier');
  });

  it('says nothing about a function called before it is defined', () => {
    const code = `int later(void);
int main(void) { return later(); }
int later(void) { return 1; }
`;
    expect(rules(code)).not.toContain('undeclared-identifier');
  });

  it('says nothing about a type named in sizeof', () => {
    const code = `struct Pair { int a; };
int main(void) { return sizeof(int) + sizeof(struct Pair); }
`;
    expect(rules(code)).not.toContain('undeclared-identifier');
  });
});

describe('a non-void function whose closing brace is reachable', () => {
  it('does not treat a function prototype as a body with no return', () => {
    const code = `int helper(int value);
int main(void) { return helper(3); }
`;
    expect(rules(code)).not.toContain('missing-return');
  });

  it('reports the signature', () => {
    const code = `int pick(int n) {
  if (n) { return 1; }
}
int main(void) { return pick(0); }
`;
    const [found] = only(code, 'missing-return');
    expect(found).toBeDefined();
    expect(found.line).toBe(1);
    expect(found.endLine).toBe(1);
    expect(found.message).toContain('pick');
  });

  it('accepts a function that returns down every branch', () => {
    const code = `int pick(int n) {
  if (n) { return 1; } else { return 2; }
}
int main(void) { return pick(0); }
`;
    expect(rules(code)).not.toContain('missing-return');
  });

  it('accepts a loop that cannot be left', () => {
    const code = `int spin(void) {
  while (1) { }
}
int main(void) { return 0; }
`;
    expect(rules(code)).not.toContain('missing-return');
  });

  it('says nothing about main, whose closing brace returns zero', () => {
    const code = `int main(void) {
  int n = 1;
  n = n + 1;
}
`;
    expect(rules(code)).not.toContain('missing-return');
  });

  it('says nothing about a void function', () => {
    const code = `void show(int n) {
  printf("%d\\n", n);
}
int main(void) { show(1); return 0; }
`;
    expect(rules(code)).not.toContain('missing-return');
  });

  it('keeps quiet about a switch it cannot read, rather than guessing', () => {
    const code = `int pick(int n) {
  switch (n) {
    case 0:
    case 1: return 1;
    default: return 0;
  }
}
int main(void) { return pick(0); }
`;
    expect(rules(code)).not.toContain('missing-return');
  });
});

describe('a program the parser could not read', () => {
  it('produces no teaching diagnostics at all', () => {
    expect(lint('int main(void) { return')).toEqual([]);
  });
});

describe('the rules over a program with nothing wrong with it', () => {
  it('say nothing', () => {
    const code = `#include <stdio.h>

int add(int a, int b) {
  return a + b;
}

int main(void) {
  int total = 0;
  for (int i = 0; i < 3; i++) {
    total = add(total, i);
  }
  printf("%d\\n", total);
  return 0;
}
`;
    expect(lint(code)).toEqual([]);
  });
});

describe('a program that names something nothing declares', () => {
  const bad = `#include <stdio.h>

int main(void) {
  int a = 10;
  printf(f);
  return 0;
}
`;

  /**
   * A teaching rule marks a program that runs badly, and the reader has to be
   * able to run one and watch it. This is the other kind: no compiler would
   * translate it, so there is nothing to step through. PLIVET used to run it,
   * print nothing, and report success.
   */
  it.each(['Exec', 'Start'] as const)(
    'refuses %s',
    async (controlEvent) => {
      const response = await new Server().send({
        controlEvent,
        sourcecode: bad,
        entry: 'main.c',
        active: 'main.c',
      });
      expect(response.debugState).toBe('Stop');
      expect(response.diagnosticPath).toBe('main.c');
      expect(response.errors).toEqual([
        {
          line: 5,
          charPositionInLine: 9,
          msg: expect.stringContaining('f is not declared'),
        },
      ]);
    },
    30000
  );

  it('refuses it after a syntax check has already passed the program', async () => {
    // The clean check arms a cached parse that Start may consume. A refusal
    // is not a syntax error, so the cache has to be told about it separately.
    const server = new Server();
    await server.send({
      controlEvent: 'SyntaxCheck',
      sourcecode: bad,
      entry: 'main.c',
      active: 'main.c',
    });
    const response = await server.send({
      controlEvent: 'Start',
      sourcecode: bad,
      entry: 'main.c',
      active: 'main.c',
    });
    expect(response.debugState).toBe('Stop');
    expect(response.errors).toHaveLength(1);
  }, 30000);

  it('says nothing about a name one file declares and another uses', async () => {
    // Asked per file, `main.c` reported ten names that `tour.h` declares.
    const files = defaultProgram().files.map((file) => ({ ...file }));
    const response = await new Server().send({
      controlEvent: 'Start',
      sourcecode: files[0].text,
      files,
      entry: 'main.c',
      active: 'main.c',
    });
    expect(response.errors).toEqual([]);
    expect(response.debugState).not.toBe('Stop');
  }, 30000);
});
