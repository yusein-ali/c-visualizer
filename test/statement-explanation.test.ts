import { EditorState } from '@codemirror/state';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { StepModel, emptyStepModel } from '../src/core';
import { HoverTextSource } from '../src/app/hoverText';
import { statementCard } from '../src/ui/graph';

/**
 * One explanation of the current statement.
 *
 * The separate expression view draws the operands and operators below this;
 * this view reads the whole statement - which kind it is, which branch or
 * which iteration this is. Nothing here describes a construct a second time,
 * which is what these tests are really checking: the lines are the tooltip's
 * own records, gathered.
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

  it('prints the valued parts of the expression being expanded now', () => {
    const stepped = steps.filter((step) => step.expression !== null);
    expect(stepped.length).toBeGreaterThan(0);
    const step = stepped.find((one) =>
      one.expression === null
        ? false
        : one.expression.root.children.some((child) => child.value !== null)
    )!;
    const explanation = explaining(PROGRAM, step);
    expect(explanation.parts.length).toBeGreaterThan(0);
    for (const part of explanation.parts) {
      expect(part.title).not.toBe('');
      expect(part.facts[0].label).toBe('value');
    }
  });

  it('does not carry values from the previous statement into the expansion', () => {
    const stepped = steps.find(
      (step) =>
        step.expression !== null &&
        step.evaluations.some(
          (evaluation) =>
            evaluation.range.begin.y !== step.expression!.range.begin.y
        )
    )!;
    const explanation = explaining(PROGRAM, stepped);
    const currentLine =
      PROGRAM.split('\n')[stepped.expression!.range.begin.y - 1];

    expect(explanation.parts.length).toBeGreaterThan(0);
    explanation.parts.forEach((part) => {
      expect(currentLine).toContain(part.title);
    });
  });

  it('uses the innermost activation when recursive ranges are equal', () => {
    const source = new HoverTextSource();
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 2, y: 4 },
      end: { x: 7, y: 4 },
    };
    const functionRange = {
      begin: { x: 0, y: 3 },
      end: { x: 1, y: 8 },
    };
    step.constructStates = [
      {
        kind: 'functionDec',
        range: functionRange,
        facts: [{ label: 'factArgument', value: 'n = 0' }],
      },
      {
        kind: 'functionDec',
        range: functionRange,
        facts: [{ label: 'factArgument', value: 'n = 1' }],
      },
    ];

    source.setStep(step);

    expect(source.explainStatement(PROGRAM).statement).toEqual({
      title: 'function definition',
      facts: [{ label: 'argument', value: 'n = 1', code: true }],
    });
  });
});

describe('the statement teaching card', () => {
  const steps = stepsOf(PROGRAM);

  it('leads with a friendly construct name and current line', () => {
    const step = stepOn(steps, 6);
    const card = statementCard(step, explaining(PROGRAM, step), false);

    expect(card.title).toBe('For loop');
    expect(card.context).toBe('Currently executing on line 6');
    expect(card.description).toContain('initialization `int i = 0`');
  });

  it('reads an evaluated if statement as one complete explanation', () => {
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 2, y: 4 },
      end: { x: 9, y: 4 },
    };
    const card = statementCard(
      step,
      {
        statement: {
          title: 'if statement',
          facts: [
            { label: 'controlling expression', value: 'n < 3', code: true },
            { label: 'evaluates to', value: '1', code: true },
            {
              label: 'which C reads as true, because it is not zero',
              value: '',
            },
            {
              label: 'the branch after `if` is the one running',
              value: '',
            },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'If statement with controlling expression `n < 3`, which evaluates to `1`. ' +
        'C reads the evaluated expression as true because it is not zero. ' +
        'The branch after `if` is the one running.'
    );
  });

  it('gives useful guidance before execution starts', () => {
    const card = statementCard(emptyStepModel(), explaining(PROGRAM), false);

    expect(card.title).toBe('No active statement');
    expect(card.context).toContain('Start or step through the program');
    expect(card.description).toBe('');
  });

  it('groups produced expression values only when requested', () => {
    const step = steps.find((one) => one.expression !== null)!;
    const explanation = explaining(PROGRAM, step);

    expect(statementCard(step, explanation, false).values).toEqual([]);
    expect(
      statementCard(step, explanation, true).values.length
    ).toBeGreaterThan(0);
    expect(statementCard(step, explanation, true).values[0]).toMatchObject({
      labelCode: true,
      valueCode: true,
    });
  });

  it('uses the expansion line as the shared current-statement line', () => {
    const step = steps.find((one) => one.expression !== null)!;
    step.codeRange = {
      begin: { x: 0, y: 1 },
      end: { x: 1, y: 1 },
    };
    const card = statementCard(step, explaining(PROGRAM, step), false);

    expect(card.context).toBe(
      `Currently executing on line ${step.expression!.range.begin.y}`
    );
  });
});
