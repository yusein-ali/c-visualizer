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
    expect(card.description).toContain('Initialization: int i = 0');
  });

  it('puts every part of an if/else statement on its own line', () => {
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
            { label: 'evaluates to', value: '0', code: true },
            {
              label: 'which C reads as false, because it is zero',
              value: '',
            },
            {
              label: 'the `else` branch is the one running',
              value: '',
            },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'Controlling expression: n < 3\n' +
        'Evaluates to: 0\n' +
        'C reads the evaluated expression as false because it is zero.\n' +
        'The else branch is the one running.'
    );
  });

  it('puts every part of a switch statement on its own line', () => {
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 2, y: 10 },
      end: { x: 15, y: 10 },
    };
    const card = statementCard(
      step,
      {
        statement: {
          title: 'switch statement',
          facts: [
            {
              label: 'controlling expression',
              value: 'choice + 1',
              code: true,
            },
            { label: 'evaluates to', value: '3', code: true },
            { label: 'label selected', value: 'case 3', code: true },
            {
              label: 'control fell through from an earlier label',
              value: '',
            },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'Controlling expression: choice + 1\n' +
        'Evaluates to: 3\n' +
        'Label selected: case 3\n' +
        'Control fell through from an earlier label.'
    );
  });

  it('puts every part of a for loop on its own line', () => {
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 2, y: 6 },
      end: { x: 30, y: 6 },
    };
    const card = statementCard(
      step,
      {
        statement: {
          title: 'for loop',
          facts: [
            { label: 'initialization', value: 'int i = 0', code: true },
            { label: 'controlling expression', value: 'i < 3', code: true },
            { label: 'iteration expression', value: 'i++', code: true },
            { label: 'evaluates to', value: '1', code: true },
            {
              label: 'which C reads as true, because it is not zero',
              value: '',
            },
            { label: 'iterations begun so far', value: '3', code: true },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'Initialization: int i = 0\n' +
        'Controlling expression: i < 3\n' +
        'Iteration expression: i++\n' +
        'Evaluates to: 1\n' +
        'C reads the evaluated expression as true because it is not zero.\n' +
        'Iterations begun so far: 3'
    );
  });

  it('puts every part of a function call on its own line', () => {
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 20, y: 7 },
      end: { x: 28, y: 7 },
    };
    const card = statementCard(
      step,
      {
        statement: {
          title: 'function call — twice',
          facts: [
            { label: 'argument', value: 'int n = i', code: true },
            { label: 'argument', value: 'n = 1', code: true },
            { label: 'returns', value: '2', code: true },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'Argument: int n = i\nArgument: n = 1\nReturns: 2'
    );
  });

  it('puts every assignment fact on its own line', () => {
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 2, y: 4 },
      end: { x: 12, y: 4 },
    };
    const card = statementCard(
      step,
      {
        statement: {
          title: 'assignment statement',
          facts: [
            { label: 'assigned object', value: 'arr[i]', code: true },
            { label: 'assigned value', value: 'source + 1', code: true },
            {
              label: 'assigned object at this step',
              value: 'arr[2]',
              code: true,
            },
            { label: 'previous value', value: '0', code: true },
            { label: 'value stored', value: '7', code: true },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'Assigned object: arr[i]\n' +
        'Assigned value: source + 1\n' +
        'Assigned object at this step: arr[2]\n' +
        'Previous value: 0\n' +
        'Value stored: 7'
    );
  });

  it('preserves declaration facts as informative lines in the single cell', () => {
    const step = emptyStepModel();
    step.codeRange = {
      begin: { x: 2, y: 41 },
      end: { x: 10, y: 41 },
    };
    const card = statementCard(
      step,
      {
        statement: {
          title: 'variable declaration',
          facts: [
            { label: 'type', value: 'int[4]', code: true },
            { label: 'storage class', value: 'auto', code: true },
            { label: 'qualifiers', value: 'none', code: true },
            { label: 'identifier', value: 'a', code: true },
            { label: 'value', value: 'uninitialized', code: true },
          ],
        },
        parts: [],
      },
      false
    );

    expect(card.description).toBe(
      'Type: int[4]\n' +
        'Storage class: auto\n' +
        'Qualifiers: none\n' +
        'Identifier: a\n' +
        'Value: uninitialized'
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
