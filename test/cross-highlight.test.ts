import { dia } from '@joint/core';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { extractVariables } from '../src/core/variables';
import { layoutMemory, FoldState, StepModel } from '../src/core';
import { HoverTextSource } from '../src/app/hoverText';
import { memoryNodeOf } from '../src/ui/graph/MemoryNode';
import { memoryNavigationTarget } from '../src/ui/graph';
import { focusField, setFocusRange } from '../src/ui/editor';
import { plivetHoverSource } from '../src/ui/editor/tooltip';

/**
 * The two panels, pointing at each other.
 *
 * A tooltip in the editor and a row on the canvas are two pictures of one
 * object, and until now neither could recognise the other's. What makes the
 * link is one key, carried by every cell of a row and by the variable the
 * tooltip describes; everything here is a check that the key survives the
 * journey - through the model, through the layout, into the SVG, and back
 * again as the declaration the canvas asks the editor to mark.
 */

const CODE = `int main(void) {
  int count = 7;
  int* p = &count;
  return count;
}`;

/** The model at the step where both objects exist. */
const stepWithBoth = (): { model: StepModel; state: any } => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    let state = interpreter.startStepExecution(CODE);
    let model = extractModel(state);
    let guard = 0;
    while (
      interpreter.isStepExecutionRunning() &&
      guard < 200 &&
      !model.variables.some((variable) => variable.name === 'p')
    ) {
      state = interpreter.stepExecute();
      model = extractModel(state);
      guard += 1;
    }
    return { model, state };
  } finally {
    console.log = log;
  }
};

const constructsOf = (code: string) => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(code);
};

describe('the key a row and a tooltip share', () => {
  it('puts one object key on every cell of that object’s row', () => {
    const { model } = stepWithBoth();
    const stack = model.stacks[0];
    for (const row of stack.rows) {
      const keys = new Set(row.map((cell) => cell.object));
      expect(keys.size).toBe(1);
      expect([...keys][0]).toBeDefined();
    }
  });

  it('gives the tooltip’s variable the key its cells carry', () => {
    const { model, state } = stepWithBoth();
    const variables = extractVariables(state);
    const count = variables.find((variable) => variable.name === 'count')!;
    const cells = model.stacks.flatMap((stack) => stack.rows.flat());
    expect(cells.some((cell) => cell.object === count.key)).toBe(true);
  });

  it('carries the key into the row the memory map lays out', () => {
    const { model } = stepWithBoth();
    const memory = layoutMemory(model, new FoldState());
    const stack = memory.segments.find((segment) => segment.key === 'stack')!;
    const rows = stack.rows.filter((row) => row.kind === 'entry');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.object).toBe('string');
    }
  });

  it('writes the key onto the boxes the canvas draws', () => {
    const { model } = stepWithBoth();
    const memory = layoutMemory(model, new FoldState());
    const stack = memory.segments.find((segment) => segment.key === 'stack')!;
    const node = memoryNodeOf(stack) as dia.Element;
    const marked = JSON.stringify(node.get('markup')).includes(
      'data-object-key'
    );
    expect(marked).toBe(true);
  });

  it('turns an object row into an object navigation target', () => {
    const { model } = stepWithBoth();
    const count = model.variables.find(
      (variable) => variable.name === 'count'
    )!;
    expect(memoryNavigationTarget(model, count.key)).toEqual({
      kind: 'object',
      key: count.key,
    });
  });

  it('turns a text-segment row into a function navigation target', () => {
    const { model } = stepWithBoth();
    expect(memoryNavigationTarget(model, 'text-main')).toEqual({
      kind: 'function',
      name: 'main',
    });
  });
});

describe('pointing from one panel at the other', () => {
  const source = () => {
    const { model } = stepWithBoth();
    const hover = new HoverTextSource();
    hover.setConstructs(constructsOf(CODE));
    hover.setStep(model);
    return { hover, model };
  };

  it('says which object a variable’s tooltip is about', () => {
    const { hover, model } = source();
    const state = EditorState.create({ doc: CODE });
    const record = hover.describe({
      state,
      pos: 0,
      row: 3,
      column: 9,
      word: 'count',
    })!;
    const count = model.variables.find(
      (variable) => variable.name === 'count'
    )!;
    expect(record.object).toBe(count.key);
  });

  it('says nothing about an object for a construct that is not one', () => {
    const { hover } = source();
    const state = EditorState.create({ doc: CODE });
    const record = hover.describe({
      state,
      pos: 0,
      row: 0,
      column: 0,
      word: '',
    })!;
    expect(record.object).toBeUndefined();
  });

  it('finds the declaration of the object the canvas is pointing at', () => {
    const { hover, model } = source();
    const count = model.variables.find(
      (variable) => variable.name === 'count'
    )!;
    const declaration = hover.declarationOf(count.key)!;
    expect(declaration.line).toBe(2);
    expect(declaration.variableDeclarations![0].identifier).toBe('count');
  });

  it('answers nothing for an object no variable claims', () => {
    const { hover } = source();
    expect(hover.declarationOf('nowhere-at-all')).toBeNull();
  });

  it('tells the canvas while the tooltip stands, and again when it goes', () => {
    const said: (string | null)[] = [];
    const view = new EditorView({
      state: EditorState.create({ doc: 'int count = 7;' }),
    });
    const tooltip = plivetHoverSource({
      text: () => ({
        title: 'count',
        facts: [{ label: 'value', value: '7' }],
        object: 'main-count',
      }),
      onFocus: (object) => said.push(object),
    })(view, 5)!;
    const shown = tooltip.create(view);
    shown.mount!(view);
    expect(said).toEqual(['main-count']);
    shown.destroy!();
    expect(said).toEqual(['main-count', null]);
    view.destroy();
  });
});

describe('the mark on the declaration', () => {
  const stateWith = (doc: string) =>
    EditorState.create({ doc, extensions: [focusField] });

  it('marks the range it is given and clears it again', () => {
    const doc = 'int main() {\n  int count = 7;\n}';
    let state = stateWith(doc);
    expect(state.field(focusField).size).toBe(0);

    state = state.update({
      effects: setFocusRange.of({ from: 15, to: 28 }),
    }).state;
    // One line decoration and one mark over the declarator.
    expect(state.field(focusField).size).toBe(2);

    state = state.update({ effects: setFocusRange.of(null) }).state;
    expect(state.field(focusField).size).toBe(0);
  });
});
