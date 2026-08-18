import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { libraryHelp, libraryNames } from '../src/components/libraryHelp';

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
  expect(run('#include<stdio.h>\nint main(){ printf("%s\\n", "abc"); return 0; }')).toBe(
    'abc\n'
  );
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
    expect(found.find((c) => c.kind === 'functionDec')!.detail).toBe('int main');
    expect(found.find((c) => c.kind === 'variableDec')!.detail).toBe('int');
    expect(found.find((c) => c.kind === 'call')!.detail).toBe('sqrt');
  });

  it('tells a do-while from a while', () => {
    const code = 'int main(){ int i = 0; do { i++; } while (i < 3); return 0; }';
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
      .map((call: string) => call.replace(/global\.setTop\('/, '').replace(/'/, ''))
      .filter((name: string, i: number, all: string[]) => all.indexOf(name) === i);
    expect(registered.length).toBeGreaterThan(20);
    expect(registered.filter((name: string) => libraryHelp(name) === null)).toEqual(
      []
    );
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
