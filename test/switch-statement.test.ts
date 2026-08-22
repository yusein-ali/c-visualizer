import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { StepModel } from '../src/core';
import { HoverTextSource } from '../src/app/hoverText';

/**
 * What the statement view says about a `switch`.
 *
 * A `switch` is its labels as much as its controlling expression, and the
 * question a reader has standing on one is which label the value selects. The
 * labels are read out of the source because the tree does not keep them all;
 * the selection is read out of the run where the run has made it, and worked
 * out from the constants only where every label is one.
 */

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

/** Every `switch` explanation the run produced, one entry per step. */
const switchFacts = (code: string): string[][] => {
  const constructs = constructsOf(code);
  return stepsOf(code)
    .map((step) => {
      const source = new HoverTextSource();
      source.setConstructs(constructs);
      source.setStep(step);
      const statement = source.explainStatement(code).statement;
      return statement === null || statement.title !== 'switch statement'
        ? null
        : statement.facts.map((one) => `${one.label}: ${one.value}`);
    })
    .filter((facts): facts is string[] => facts !== null);
};

/**
 * The same facts read off the construct record rather than off the statement
 * under the marker. A `switch` goes on being true while the marker stands on
 * the statements inside it, and those steps are explained as what they are -
 * an assignment, a `break` - so this is where a fact about the switch is
 * visible on them.
 */
const switchStates = (code: string): string[][] =>
  stepsOf(code).flatMap((step) =>
    step.constructStates
      .filter((state) => state.kind === 'switch')
      .map((state) => state.facts.map((one) => `${one.label}=${one.value}`))
  );

/** The labels a `switch` explanation lists, from the first step that has any. */
const labelsOf = (code: string): string[] =>
  (switchFacts(code)[0] ?? [])
    .filter((fact) => fact.startsWith('label: '))
    .map((fact) => fact.slice('label: '.length));

describe('the labels a switch lists', () => {
  test('every label appears, including ones the tree folds together', () => {
    // The mapper turns `case 1: case 2:` into one case holding the constant 1,
    // so a listing built from the tree drops `case 2` without saying so.
    expect(
      labelsOf(`int main(void) {
  int n = 1;
  int out = 0;
  switch (n) {
    case 1:
    case 2:
      out = 20;
      break;
    default:
      out = 30;
  }
  return out;
}`)
    ).toEqual(['case 1', 'case 2', 'default']);
  });

  test('a character constant keeps the quotes it was written with', () => {
    expect(
      labelsOf(`int main(void) {
  char c = 'b';
  int out = 0;
  switch (c) {
    case 'a': out = 1; break;
    case 'b': out = 2; break;
  }
  return out;
}`)
    ).toEqual(["case 'a'", "case 'b'"]);
  });

  test('a nested switch does not lend its labels to the one around it', () => {
    expect(
      labelsOf(`int main(void) {
  int n = 1;
  int m = 1;
  int out = 0;
  switch (n) {
    case 1:
      switch (m) {
        case 7: out = 7; break;
      }
      break;
    default:
      out = 0;
  }
  return out;
}`)
    ).toEqual(['case 1', 'default']);
  });

  test('the word case inside a string is text, not a label', () => {
    expect(
      labelsOf(`int main(void) {
  int n = 1;
  const char *s = "case 9:";
  int out = 0;
  switch (n) {
    case 1: out = 1; break;
  }
  return out;
}`)
    ).toEqual(['case 1']);
  });
});

describe('which label the switch is running', () => {
  test('is known on the step the marker reaches the label', () => {
    // The engine enters a case's first statement one step after choosing it,
    // and the step sitting on `case 2:` is where the question is asked.
    const said = switchFacts(`int main(void) {
  int n = 2;
  int out = 0;
  switch (n) {
    case 1:
      out = 10;
      break;
    case 2:
      out = 20;
      break;
  }
  return out;
}`);
    expect(said.some((facts) => facts.includes('matching label: case 2'))).toBe(
      true
    );
    expect(said.some((facts) => facts.includes('matching label: case 1'))).toBe(
      false
    );
  });

  test('a character constant is matched against the value it is worth', () => {
    const said = switchFacts(`int main(void) {
  char c = 'b';
  int out = 0;
  switch (c) {
    case 'a': out = 1; break;
    case 'b': out = 2; break;
  }
  return out;
}`);
    expect(
      said.some((facts) => facts.includes("matching label: case 'b'"))
    ).toBe(true);
    // The value is the code, and reading it as no match would be wrong.
    expect(
      said.some((facts) =>
        facts.some((fact) => fact.startsWith('no label matches'))
      )
    ).toBe(false);
  });

  test('falling through is reported only once a second body has run', () => {
    const said = switchStates(`int main(void) {
  int n = 1;
  int out = 0;
  switch (n) {
    case 1:
      out = 10;
    case 2:
      out = out + 20;
      break;
  }
  return out;
}`);
    // Selecting `case 1` is not falling through; running `case 2` after it is.
    const selectedOnly = said.filter(
      (facts) =>
        facts.includes('factLabel=case 1') &&
        !facts.some((fact) => fact.startsWith('factFallsThrough'))
    );
    const fell = said.filter((facts) =>
      facts.some((fact) => fact.startsWith('factFallsThrough'))
    );
    expect(0 < selectedOnly.length).toBe(true);
    expect(fell.every((facts) => facts.includes('factLabel=case 2'))).toBe(
      true
    );
    expect(0 < fell.length).toBe(true);
  });

  test('a label the tree cannot reduce to a constant is not guessed at', () => {
    // `case 1 + 1` is a constant expression the mapper leaves as an operator.
    // Answering `default` because the comparison could not be made would be
    // worse than not answering.
    const said = switchFacts(`int main(void) {
  int n = 2;
  int out = 0;
  switch (n) {
    case 1 + 1:
      out = 20;
      break;
    default:
      out = 30;
      break;
  }
  return out;
}`);
    const before = said.filter(
      (facts) => !facts.some((fact) => fact.startsWith('evaluates to'))
    );
    expect(
      before.every(
        (facts) => !facts.some((fact) => fact.startsWith('matching label'))
      )
    ).toBe(true);
  });
});

describe('the labels stay readable while the switch runs', () => {
  test('standing inside a case still lists what the switch offers', () => {
    // The record for a step the outline has no construct for used to carry the
    // runtime facts alone, which say what the switch is doing without saying
    // what it is.
    const said = switchFacts(`int main(void) {
  int n = 2;
  int out = 0;
  switch (n) {
    case 1:
      out = 10;
      break;
    case 2:
      out = 20;
      break;
  }
  return out;
}`);
    const running = said.find((facts) =>
      facts.includes('matching label: case 2')
    )!;
    expect(running).toEqual(
      expect.arrayContaining([
        'controlling expression: n',
        'label: case 1',
        'label: case 2',
        'evaluates to: 2',
        'matching label: case 2',
      ])
    );
  });
});
