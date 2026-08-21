import { Bus } from '../src/app/emitter';
import { EditorController } from '../src/app/EditorController';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  InterpreterClient,
  Request,
  Response,
  emptyStepModel,
} from '../src/core';

/**
 * The jump, through the whole application rather than through the extension.
 *
 * The gesture and the rule that chooses a declaration are tested on their own
 * elsewhere. What is checked here is the wiring between them, which is where
 * it was broken: the editor resolves a name against the constructs of the
 * last syntax check, and nothing ran one until the reader had typed. On a
 * program somebody had just opened - the one they are most likely to be
 * asking questions about - every construct tooltip, every completion of the
 * program's own names and every ctrl-click had nothing to answer with.
 */

const PROGRAM = `int twice(int n) {
  return n * 2;
}
int main(void) {
  int count = 2;
  return twice(count);
}`;

/** A client that answers a syntax check the way the Worker would. */
const fakeClient = () => {
  const sent: Request[] = [];
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const client = {
    onRunEvent: null,
    send: (request: Request): Promise<Response> => {
      sent.push(request);
      return Promise.resolve({
        output: '',
        sourcecode: request.sourcecode,
        debugState: 'Stop',
        step: 0,
        errors: [],
        model: emptyStepModel(),
        expansions: [],
        constructs: interpreter.getConstructs(request.sourcecode),
        lints: [],
      } as Response);
    },
  };
  return { client: client as unknown as InterpreterClient, sent };
};

const mounted = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client, sent } = fakeClient();
  const controller = new EditorController(host, {
    bus,
    client,
    doc: PROGRAM,
  });
  const view = (controller as any).editor.view;
  return { host, controller, view, sent };
};

/** The pointer arriving over the editor, which is what wakes the check. */
const approach = (view: any) =>
  view.dom.dispatchEvent(new MouseEvent('mouseenter'));

/** A ctrl-click at an offset, with the platform's own modifier. */
const clickAt = (view: any, at: number) => {
  view.posAtCoords = () => at;
  view.contentDOM.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true })
  );
};

/** Whatever the promises the check started have to say. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ctrl-click, wired up', () => {
  it('checks the program as soon as the reader comes near it', async () => {
    const { host, sent, view, controller } = mounted();
    expect(sent).toHaveLength(0);

    approach(view);
    await settled();
    expect(sent.map((request) => request.controlEvent)).toEqual([
      'SyntaxCheck',
    ]);

    // And only once, however often the pointer comes and goes.
    approach(view);
    await settled();
    expect(sent).toHaveLength(1);
    controller.destroy();
    host.remove();
  });

  it('goes to the function body from the call', async () => {
    const { host, view, controller } = mounted();
    approach(view);
    await settled();

    // From the call on line 6, with the cursor there to begin with, so a
    // cursor that never moved cannot pass for a jump.
    const call = PROGRAM.indexOf('twice(count)') + 2;
    view.dispatch({ selection: { anchor: call } });
    clickAt(view, call);
    // Line 1 is the definition; the cursor lands on it.
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      1
    );
    controller.destroy();
    host.remove();
  });

  it('goes to the declaration of a local from its use', async () => {
    const { host, view, controller } = mounted();
    approach(view);
    await settled();

    const use = PROGRAM.indexOf('twice(count)') + 'twice('.length + 1;
    view.dispatch({ selection: { anchor: use } });
    clickAt(view, use);
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      5
    );
    controller.destroy();
    host.remove();
  });

  it('leaves the cursor alone for a name the program does not declare', async () => {
    const { host, view, controller } = mounted();
    approach(view);
    await settled();

    // A keyword is a word the program declares nowhere.
    const at = PROGRAM.indexOf('int count') + 1;
    view.dispatch({ selection: { anchor: 0 } });
    clickAt(view, at);
    expect(view.state.selection.main.anchor).toBe(0);
    controller.destroy();
    host.remove();
  });
});
