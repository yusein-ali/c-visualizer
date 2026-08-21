import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { LintDiagnostic } from '../src/interpreter/TeachingLint';

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

describe('scanf without the address of its target', () => {
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

  it('says nothing about an array, which is already an address', () => {
    const code = `int main(void) {
  char name[8];
  scanf("%s", name);
  return 0;
}
`;
    expect(rules(code)).not.toContain('scanf-address');
  });
});

describe('an assignment used as a condition', () => {
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
    expect(found.message).toContain('== compares');
    expect(found.fix).toEqual({
      label: 'Compare with ==',
      line: 3,
      column: 8,
      endLine: 3,
      endColumn: 9,
      text: '==',
    });
  });

  it('reports one in a while as well as in an if', () => {
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
    expect(found.message).toContain('2 conversions');
    expect(found.message).toContain('1 argument');
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

  it('reads what a scanf argument points at, not the pointer itself', () => {
    const code = `int main(void) {
  double d = 0.0;
  scanf("%d", &d);
  return 0;
}
`;
    const [found] = only(code, 'format-arguments');
    expect(found).toBeDefined();
    expect(found.message).toContain('points at');
  });
});

describe('a variable read before it holds anything', () => {
  it('reports the read', () => {
    const code = `int main(void) {
  int n;
  return n + 1;
}
`;
    const [found] = only(code, 'uninitialized-read');
    expect(found).toBeDefined();
    expect(found.line).toBe(3);
    expect(found.message).toContain('not defined');
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

  it('counts having its address taken as a value arriving', () => {
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

  it('says nothing about an argument, which arrives with a value', () => {
    const code = `int twice(int n) { return n * 2; }
int main(void) { return twice(2); }
`;
    expect(rules(code)).not.toContain('uninitialized-read');
  });

  it('does not mistake a structure or union member for a variable read', () => {
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

describe('a function that can reach its end without returning', () => {
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

  it('says nothing about main, which returns zero on its own', () => {
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
