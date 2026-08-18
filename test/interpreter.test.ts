import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';

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
