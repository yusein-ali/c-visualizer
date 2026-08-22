import { readFileSync } from 'fs';
import { join } from 'path';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';

const source = readFileSync(
  join(__dirname, '..', 'baseline', 'programs', 's9-all-enriched-constructs.c'),
  'utf8'
);

describe('the all-enriched-constructs teaching program', () => {
  it('parses every construct kind that the visualizer names', () => {
    const interpreter = new PlivetCPP14Interpreter();
    expect(interpreter.checkSyntaxError(source)).toEqual([]);

    const kinds = new Set(
      interpreter.getConstructs(source).map((construct) => construct.kind)
    );
    expect(kinds).toEqual(
      new Set([
        'assignment',
        'break',
        'call',
        'cast',
        'continue',
        'doWhile',
        'enumerator',
        'for',
        'functionDec',
        'if',
        'recordField',
        'return',
        'switch',
        'ternary',
        'typeDec',
        'variableDec',
        'while',
      ])
    );

    const expansions = interpreter.getExpansions(source);
    expect(expansions.some((item) => item.kind === 'directive')).toBe(true);
    expect(expansions.some((item) => item.kind === 'excluded')).toBe(true);
    expect(expansions.some((item) => item.name === 'JOIN')).toBe(true);
    expect(interpreter.getLints(source)).toEqual([]);
  });

  it('runs to completion through direct, indirect, and recursive calls', () => {
    const interpreter = new PlivetCPP14Interpreter();
    interpreter.setFileList(new Map());
    const log = console.log;
    console.log = () => undefined;
    try {
      interpreter.startStepExecution(source);
      let steps = 0;
      while (interpreter.isStepExecutionRunning() && steps < 20000) {
        if (interpreter.getIsWaitingForStdin()) {
          interpreter.stdin('7');
        }
        interpreter.stepExecute();
        steps += 1;
      }

      expect(steps).toBeGreaterThan(0);
      expect(interpreter.isStepExecutionRunning()).toBe(false);
      expect(interpreter.getRuntimeDiagnostics()).toEqual([]);
      expect(interpreter.getStdout()).toContain('count=3 scaled=6');
      expect(interpreter.getStdout()).toContain(
        'flow=17 once=1 larger=20 widened=17 input=7\n'
      );
      expect(interpreter.getStdout()).toContain('calls=5/20/5 recursive=24\n');
      expect(interpreter.getStdout()).toContain(
        'aggregate=10/20/5 product=12 enum=3 heap=11->22 macro=5/5\n'
      );
      expect(interpreter.getStdout()).toContain(
        'file=written by the construct tour\n'
      );
    } finally {
      console.log = log;
    }
  });
});
