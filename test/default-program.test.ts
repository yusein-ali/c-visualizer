import { ExecutionSource } from '../src/core';
import { defaultProgram } from '../src/defaultProgram';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';

describe('the default three-file construct tour', () => {
  it('runs scanf and browser-side file I/O to completion', () => {
    const program = defaultProgram();
    const entry = program.files.find((file) => file.path === program.entry)!;
    const source = new ExecutionSource(program.files, program.entry, entry.text)
      .code;
    const interpreter = new PlivetCPP14Interpreter();
    interpreter.setFileList(new Map());
    const logged = console.log;
    console.log = () => undefined;

    try {
      expect(interpreter.checkSyntaxError(source)).toEqual([]);
      interpreter.startStepExecution(source);
      let steps = 0;
      while (interpreter.isStepExecutionRunning() && steps < 20000) {
        if (interpreter.getIsWaitingForStdin()) {
          interpreter.stdin('7');
        }
        interpreter.stepExecute();
        steps += 1;
      }

      expect(interpreter.isStepExecutionRunning()).toBe(false);
      expect(interpreter.getRuntimeDiagnostics()).toEqual([]);
      expect(interpreter.getStdout()).toContain('input=7\n');
      expect(interpreter.getStdout()).toContain('calls=5/20/5 recursive=24\n');
      expect(interpreter.getStdout()).toContain(
        'memory=1/2/1/4/8/8/9 text=PLIVET'
      );
      expect(interpreter.getStdout()).toContain(
        'file=written by the construct tour\n'
      );
    } finally {
      console.log = logged;
    }
  });

  it('returns fresh source files for every visualizer instance', () => {
    const first = defaultProgram();
    first.files[0].text = 'changed';

    expect(defaultProgram().files[0].text).toContain('int main(void)');
  });
});
