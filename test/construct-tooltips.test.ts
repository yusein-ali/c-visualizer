import { EditorState } from '@codemirror/state';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { Construct } from '../src/interpreter/Construct';
import { StepModel } from '../src/core';
import { HoverTextSource } from '../src/app/hoverText';
import { preprocessSource } from '../src/interpreter/preprocess';
import { linesOf } from './records';

/**
 * What a tooltip says about a construct, in both halves.
 *
 * The static half is `outline.ts`: the clauses a construct is made of, the
 * loop a `break` leaves, whether a function has a body. It is true whether or
 * not anything is running. The runtime half is `ConstructTrace.ts`: the value
 * the controlling expression came to, which branch ran, how many iterations
 * have begun, what a call was passed and gave back.
 *
 * Both are checked through the surface that shows them, because a fact
 * recorded and never said is worth nothing - and because the rule that keeps
 * the two apart, that a value is shown only for the step it belongs to, is
 * only visible from here.
 */

const constructsOf = (code: string): Construct[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(code);
};

/** Every step of a run, as the models the main thread would be handed. */
const stepsOf = (code: string): StepModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const steps: StepModel[] = [];
  try {
    let state = interpreter.startStepExecution(code);
    let count = 0;
    while (interpreter.isStepExecutionRunning() && count < 500) {
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

/** The step whose marker sits on a line, counting from the first. */
const stepOn = (steps: StepModel[], line: number, nth = 0): StepModel => {
  const found = steps.filter(
    (step) => step.codeRange !== null && step.codeRange.begin.y === line
  );
  return found[nth];
};

const factsFor = (step: StepModel, kind: string, line: number): string[] => {
  const state = step.constructStates.find(
    (one) => one.kind === kind && one.range.begin.y === line
  );
  return typeof state === 'undefined'
    ? []
    : state.facts.map((fact) =>
        fact.value === '' ? fact.label : `${fact.label}=${fact.value}`
      );
};

/** A hover source holding one program and one step of it. */
const hovering = (code: string, step?: StepModel) => {
  const source = new HoverTextSource();
  source.setConstructs(constructsOf(code));
  source.setExpansions(preprocessSource(code).expansions);
  if (typeof step !== 'undefined') {
    source.setStep(step);
  }
  const state = EditorState.create({ doc: code });
  return (line: number, column: number, word = '') =>
    linesOf(
      source.describe({
        state,
        pos: state.doc.line(line).from + column,
        row: line - 1,
        column,
        word,
      })
    );
};

const PROGRAM = `#include <stdio.h>
int twice(int n);
int main(void) {
  int total = 0;
  for (int i = 0; i < 3; i++) {
    if (i == 0) {
      continue;
    }
    total = total + twice(i);
  }
  switch (total) {
    case 6:
      total = total + 1;
    case 7:
      total = total + 10;
      break;
    default:
      total = 0;
  }
  printf("%d\\n", total);
  return total;
}
int twice(int n) {
  return n * 2;
}`;

describe('what a construct is', () => {
  const found = constructsOf(PROGRAM);
  const at = (kind: string, line: number) =>
    found.find(
      (construct) => construct.kind === kind && construct.line === line
    )!;

  it('names the three clauses of a for loop as the standard names them', () => {
    expect(at('for', 5).clauses).toEqual([
      { label: 'clauseInitialization', text: 'int i = 0' },
      { label: 'clauseCondition', text: 'i < 3' },
      { label: 'clauseIteration', text: 'i++' },
    ]);
  });

  it('pairs each argument with the parameter it initialises', () => {
    // C passes by value, and nothing on screen says so: writing the parameter
    // beside the argument is the shortest way to say what a call does.
    expect(at('call', 9).clauses).toEqual([
      { label: 'clauseArgument', text: 'int n = i' },
    ]);
  });

  it('says which loop a continue restarts', () => {
    expect(at('continue', 7).enclosing).toEqual({ kind: 'for', line: 5 });
  });

  it('says which construct a break leaves, not which one contains it', () => {
    // The break is inside a switch inside a loop, and it leaves the switch.
    expect(at('break', 16).enclosing).toEqual({ kind: 'switch', line: 11 });
  });

  it('names the function a return leaves', () => {
    expect(at('return', 21).enclosing).toEqual({
      kind: 'functionDec',
      line: 3,
      name: 'main',
    });
  });

  it('tells a declaration from the definition it belongs to', () => {
    expect(at('functionDec', 2).declaredFunction!.isDefinition).toBe(false);
    expect(at('functionDec', 23).declaredFunction!.isDefinition).toBe(true);
  });

  it('says of a do-while what its source does not', () => {
    const [loop] = constructsOf(
      'int main(void){ int i = 0; do { i++; } while (i < 0); return i; }'
    ).filter((construct) => construct.kind === 'doWhile');
    expect(loop.notes).toEqual(['noteBodyBeforeTest']);
  });
});

describe('what a construct is doing', () => {
  const steps = stepsOf(PROGRAM);

  it('reports a controlling expression as the integer C reads', () => {
    // The engine compares with JavaScript's operators and hands back a
    // boolean; C's relational operators yield an int, and showing `true`
    // would teach a type C does not have.
    expect(factsFor(stepOn(steps, 6), 'for', 5)).toContain(
      'factConditionValue=1'
    );
    expect(factsFor(stepOn(steps, 6), 'for', 5)).toContain('factNonzero');
  });

  it('counts the iterations that have begun, from inside the body', () => {
    expect(factsFor(stepOn(steps, 9, 0), 'for', 5)).toContain(
      'factIterations=2'
    );
    expect(factsFor(stepOn(steps, 9, 1), 'for', 5)).toContain(
      'factIterations=3'
    );
  });

  it('says which branch of an if is the one running', () => {
    expect(factsFor(stepOn(steps, 7), 'if', 6)).toContain('factBranchThen');
  });

  it('says what a call was passed and what it gave back', () => {
    // Inside the callee the caller's statement is suspended, so the arguments
    // are known and the result is not.
    const inside = stepOn(steps, 24, 0);
    expect(factsFor(inside, 'call', 9)).toEqual(['factArgument=n = 1']);
    // The value it returned can only be reported once it has returned, which
    // is a step later - the marker has moved on, and the call has not.
    const after = stepOn(steps, 5, 2);
    expect(factsFor(after, 'call', 9)).toEqual([
      'factArgument=n = 1',
      'factReturns=2',
    ]);
  });

  it('counts how many times a function has been entered', () => {
    expect(factsFor(stepOn(steps, 24, 1), 'functionDec', 23)).toEqual([
      'factArgument=n = 2',
      'factTimesEntered=2',
    ]);
  });

  it('says what an assignment replaced and what it put there', () => {
    expect(factsFor(stepOn(steps, 5, 2), 'assignment', 9)).toEqual([
      'factWas=0',
      'factNow=2',
    ]);
  });

  it('names the label a switch selected, and when control fell into it', () => {
    expect(factsFor(stepOn(steps, 14), 'switch', 11)).toEqual([
      'factConditionValue=6',
      'factLabel=case 6',
    ]);
    // Nothing in the source says that `case 7` runs after `case 6`.
    expect(factsFor(stepOn(steps, 16), 'switch', 11)).toEqual([
      'factConditionValue=6',
      'factLabel=case 7',
      'factFallsThrough',
    ]);
  });

  it('does not read a switch as true or false', () => {
    // A switch selects on a value rather than on whether it is zero.
    expect(factsFor(stepOn(steps, 14), 'switch', 11)).not.toContain(
      'factNonzero'
    );
  });

  it('reads a string literal argument back as the string it holds', () => {
    expect(factsFor(stepOn(steps, 21), 'call', 20)).toContain(
      'factArgument="%d\\n"'
    );
  });

  it('says nothing at all once the run is over', () => {
    expect(steps[steps.length - 1].constructStates).toEqual([]);
  });
});

describe('the tooltip that says both halves', () => {
  it('puts what the construct is doing under what it is', () => {
    const steps = stepsOf(PROGRAM);
    const text = hovering(PROGRAM, stepOn(steps, 9, 1))(5, 2);
    expect(text).toBe(
      [
        'for loop',
        'initialization: int i = 0',
        'controlling expression: i < 3',
        'iteration expression: i++',
        'evaluates to: 1',
        'which C reads as true, because it is not zero',
        'iterations begun so far: 3',
      ].join('\n')
    );
  });

  it('says only what is always true when nothing is running', () => {
    expect(hovering(PROGRAM)(5, 2)).toBe(
      [
        'for loop',
        'initialization: int i = 0',
        'controlling expression: i < 3',
        'iteration expression: i++',
      ].join('\n')
    );
  });

  it('says which loop a continue restarts, and on which line', () => {
    expect(hovering(PROGRAM)(7, 6)).toBe(
      'continue\nrestarts: for loop on line 5'
    );
  });

  it('reports the innermost part of the statement under the pointer', () => {
    // Hovering the `*` is a question about the multiplication, not about the
    // return statement that contains it.
    const steps = stepsOf(PROGRAM);
    const after = stepOn(steps, 5, 2);
    expect(hovering(PROGRAM, after)(24, 11)).toBe('n * 2\nvalue: 2');
  });
});

describe('a macro defined in terms of another', () => {
  const code = `#define STEP 3
#define NEXT STEP
int main(void){ return NEXT; }`;

  it('shows the step in the middle rather than only the end', () => {
    // `NEXT → 3` is true and hides that NEXT is defined as STEP.
    expect(hovering(code)(3, 23, 'NEXT')).toBe(
      'NEXT → STEP → 3\ndefined on line: 2'
    );
  });

  it('says a one-step expansion once', () => {
    expect(hovering(code)(2, 13, 'STEP')).toBe('STEP → 3\ndefined on line: 1');
  });
});
