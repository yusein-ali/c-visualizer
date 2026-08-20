import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';

/**
 * What the user sees when the engine refuses an operation C does not allow.
 *
 * `Engine.execFunc` swallows every exception a statement throws, so each of
 * these programs used to stop mid-run with nothing printed and nothing said:
 * the output ended, the canvas held the last state, and the reason was lost.
 * `PlivetCPP14Engine.refuse` writes the reason to the console first, which is
 * the surface the student is already reading, and blames the line the engine
 * stopped at.
 */
const run = (code: string): string => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
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

describe('refusing an operation', () => {
  it('names the line and the reason, after everything already printed', () => {
    expect(
      run(`#include <stdio.h>
int main(){
  printf("before\\n");
  const int x = 1;
  x = 2;
  printf("after\\n");
  return 0;
}`)
    ).toBe(
      'before\nPLIVET stopped the program on line 5: ' +
        'assignment of a read-only variable\n'
    );
  });

  it('starts on a line of its own when the program left one open', () => {
    // `printf("start ")` prints no newline; the diagnostic is not part of it.
    expect(
      run(`#include <stdio.h>
int main(){
  const int x = 1;
  printf("start ");
  x = 2;
  return 0;
}`)
    ).toBe(
      'start \nPLIVET stopped the program on line 5: ' +
        'assignment of a read-only variable\n'
    );
  });

  it('reports a const member by the name the program gives it', () => {
    expect(
      run(`#include <stdio.h>
struct Reading { const int raw; };
struct Sensor { struct Reading reading; int scale; };
int main(){
  struct Sensor a;
  struct Sensor b;
  b = a;
  return 0;
}`)
    ).toBe(
      'PLIVET stopped the program on line 7: assignment of a record ' +
        'with the read-only member reading.raw\n'
    );
  });

  it('reports an aggregate index that is not in the array', () => {
    expect(
      run(`#include <stdio.h>
struct Point { int x; };
int main(){
  struct Point points[2];
  points[5].x = 1;
  return 0;
}`)
    ).toBe(
      'PLIVET stopped the program on line 5: ' +
        'aggregate array index out of bounds\n'
    );
  });

  it('reports the address of a register variable', () => {
    expect(
      run(`#include <stdio.h>
int main(){
  register int value = 1;
  int* p = &value;
  return 0;
}`)
    ).toBe(
      'PLIVET stopped the program on line 4: ' +
        'cannot take the address of a register variable\n'
    );
  });

  it('says nothing when the program runs', () => {
    expect(
      run(`#include <stdio.h>
int main(){ printf("done\\n"); return 0; }`)
    ).toBe('done\n');
  });
});
