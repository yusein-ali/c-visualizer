import { EditorState } from '@codemirror/state';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { StepModel } from '../src/core';
import { HoverTextSource } from '../src/app/hoverText';

/**
 * One explanation of the current statement.
 *
 * It is the general case the expression expansion sits inside: the expansion
 * draws the operands and the operators, and this puts a reading of the whole
 * statement over it - which kind of statement it is, which branch or which
 * iteration this is. Nothing here describes a construct a second time, which
 * is what these tests are really checking: the lines are the tooltip's own
 * records, gathered.
 */

const PROGRAM = `int twice(int n) {
  return n * 2;
}
int main(void) {
  int total = 0;
  for (int i = 0; i < 3; i++) {
    total = total + twice(i);
  }
  return total;
}`;

const stepsOf = (code: string): StepModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const steps: StepModel[] = [];
  try {
    let state = interpreter.startStepExecution(code);
    let count = 0;
    while (interpreter.isStepExecutionRunning() && count < 400) {
      steps.push(extractModel(state));
      state = interpreter.stepExecute();
      count += 1;
    }
    steps.push(extractModel(state));
  } finally {
    console.log = log;
  }
  return steps;
};

const constructsOf = (code: string) => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(code);
};

/** The first step whose marker is on that line. */
const stepOn = (steps: StepModel[], line: number): StepModel =>
  steps.find(
    (step) => step.codeRange !== null && step.codeRange.begin.y === line
  )!;

const explaining = (code: string, step?: StepModel) => {
  const source = new HoverTextSource();
  source.setConstructs(constructsOf(code));
  if (typeof step !== 'undefined') {
    source.setStep(step);
  }
  return source.explainStatement(code);
};

describe('what the statement section says', () => {
  const steps = stepsOf(PROGRAM);

  it('says nothing at all when nothing is running', () => {
    const explanation = explaining(PROGRAM);
    expect(explanation.statement).toBeNull();
    expect(explanation.parts).toEqual([]);
  });

  it('names the statement under the marker and its clauses', () => {
    const explanation = explaining(PROGRAM, stepOn(steps, 6));
    expect(explanation.statement!.title).toBe('for loop');
    const said = explanation.statement!.facts.map(
      (fact) => `${fact.label}: ${fact.value}`
    );
    expect(said).toEqual(
      expect.arrayContaining([
        expect.stringContaining('initialization: int i = 0'),
        expect.stringContaining('controlling expression: i < 3'),
      ])
    );
  });

  it('reads the same records the tooltip reads', () => {
    // Not a second description of the construct: the same one, gathered.
    const step = stepOn(steps, 6);
    const source = new HoverTextSource();
    source.setConstructs(constructsOf(PROGRAM));
    source.setStep(step);
    const state = EditorState.create({ doc: PROGRAM });
    const hovered = source.describe({
      state,
      pos: state.doc.line(6).from + 2,
      row: 5,
      column: 2,
      word: '',
    })!;
    expect(source.explainStatement(PROGRAM).statement).toEqual(hovered);
  });

  it('prints the parts of the statement that came to something', () => {
    const stepped = steps.filter((step) => step.evaluations.length !== 0);
    expect(stepped.length).toBeGreaterThan(0);
    const explanation = explaining(PROGRAM, stepped[0]);
    expect(explanation.parts.length).toBeGreaterThan(0);
    for (const part of explanation.parts) {
      expect(part.title).not.toBe('');
      expect(part.facts[0].label).toBe('value');
    }
  });

  it('prints the parts in the order they are written', () => {
    const stepped = steps.find((step) => 1 < step.evaluations.length)!;
    const explanation = explaining(PROGRAM, stepped);
    const source = PROGRAM.split('\n');
    const positions = explanation.parts.map((part) =>
      source.findIndex((line) => line.includes(part.title))
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
