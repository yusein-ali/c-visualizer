import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { LintDiagnostic } from '../src/interpreter/TeachingLint';

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

const only = (code: string, rule: string): LintDiagnostic[] =>
  lint(code).filter((diagnostic) => diagnostic.rule === rule);

const linked = (entry: string, complete: string): LintDiagnostic[] => {
  const interpreter = new PlivetCPP14Interpreter();
  const error = console.error;
  console.error = () => undefined;
  try {
    return interpreter.getLints(entry, complete);
  } finally {
    console.error = error;
  }
};

describe('linker diagnostics', () => {
  it('reports the second function definition and points back to the first', () => {
    const [found] = only(
      `int twice(int n) { return n * 2; }
int twice(int n) { return n + n; }
int main(void) { return twice(2); }
`,
      'multipleDefinition'
    );

    expect(found).toBeDefined();
    expect(found.line).toBe(2);
    expect(found.message).toContain('first definition is on line 1');
  });

  it('reports two initialized definitions of one file-scope object', () => {
    const found = only(
      `int answer = 41;
int answer = 42;
int main(void) { return answer; }
`,
      'multipleDefinition'
    );

    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
    expect(found[0].message).toContain('object `answer`');
  });

  it('accepts repeated tentative definitions and an extern declaration', () => {
    const code = `extern int count;
int count;
int count;
int main(void) { return count; }
`;

    expect(only(code, 'multipleDefinition')).toEqual([]);
  });

  it('reports a called prototype that has no definition', () => {
    const [found] = only(
      `int calculate(int n);
int main(void) { return calculate(3); }
`,
      'undefinedReference'
    );

    expect(found).toBeDefined();
    expect(found.line).toBe(2);
    expect(found.message).toContain('declared on line 1');
  });

  it('accepts a prototype whose definition appears later', () => {
    const code = `int calculate(int n);
int main(void) { return calculate(3); }
int calculate(int n) { return n + 1; }
`;

    expect(only(code, 'undefinedReference')).toEqual([]);
  });

  it('accepts a prototype whose definition is in another source file', () => {
    const entry = `int helper(int value);
int main(void) { return helper(3); }
`;
    const helper = `int helper(int value) { return value + 2; }
`;

    expect(
      linked(entry, `${entry}\n${helper}`).filter(
        (diagnostic) => diagnostic.rule === 'undefinedReference'
      )
    ).toEqual([]);
  });

  it('does not mistake an undeclared library call for an undefined reference', () => {
    const code = `int main(void) {
  printf("hello\\n");
  return 0;
}
`;

    expect(only(code, 'undefinedReference')).toEqual([]);
  });

  it('reports a translation unit with no main definition', () => {
    const [found] = only(
      `int main(void);
int helper(void) { return 1; }
`,
      'noEntryPoint'
    );

    expect(found).toBeDefined();
    expect(found.message).toContain('defines no `main`');
  });

  it('leaves an empty editor alone', () => {
    expect(lint('')).toEqual([]);
  });
});
