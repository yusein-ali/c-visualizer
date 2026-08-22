import { Bus } from '../src/app/emitter';
import { EditorController } from '../src/app/EditorController';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  ExecutionSource,
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

/** The same, with the one name the constructs cannot place: a macro. */
const WITH_MACRO = `#define LIMIT 100
#define MAX(a, b) ((a) > (b) ? (a) : (b))
int main(void) {
  int a = 1;
  int b = LIMIT;
  return MAX(a, b);
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
      const active =
        request.files?.find((file) => file.path === request.active)?.text ??
        request.sourcecode;
      const execution = new ExecutionSource(
        request.files ?? [],
        request.entry ?? '',
        request.sourcecode
      );
      return Promise.resolve({
        output: '',
        sourcecode: active,
        debugState: 'Stop',
        step: 0,
        errors: [],
        model: emptyStepModel(),
        expansions: interpreter.getExpansions(active),
        programExpansions: interpreter.getExpansions(execution.code),
        constructs: interpreter.getConstructs(active),
        programConstructs: interpreter.getConstructs(execution.code),
        lints: [],
      } as Response);
    },
  };
  return { client: client as unknown as InterpreterClient, sent };
};

const constructsOf = (source: string) => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(source);
};

const mounted = (doc = PROGRAM) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client, sent } = fakeClient();
  const controller = new EditorController(host, {
    bus,
    client,
    doc,
  });
  const view = (controller as any).editor.view;
  return { host, bus, controller, view, sent };
};

const ENTRY = `int helper(int n);
int main(void) {
  return helper(2);
}`;
const HELPER = `int helper(int n) {
  int result = n * 2;
  return result;
}`;
const MACRO_ENTRY = `#include "values.h"
int main(void) {
  return VALUE;
}`;
const MACRO_HEADER = '#define VALUE 7';
const ENUM_ENTRY = `#include "mode.h"
int main(void) {
  return MODE_RUN;
}`;
const ENUM_HEADER = `enum Mode {
  MODE_IDLE,
  MODE_RUN = 3
};`;
const AGGREGATE_ENTRY = `#include "types.h"
int main(void) {
  struct Pair pair = {1, 2};
  union Number number = {0};
  return pair.left + number.byte;
}`;
const AGGREGATE_HEADER = `struct Pair {
  int left;
  int right;
};
union Number {
  int whole;
  char byte;
};`;

const mountedFiles = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client } = fakeClient();
  const controller = new EditorController(host, {
    bus,
    client,
    files: [
      { path: 'main.c', text: ENTRY },
      { path: 'helper.c', text: HELPER },
    ],
    entry: 'main.c',
  });
  const view = (controller as any).editor.view;
  return { host, bus, controller, view };
};

const mountedMacroFiles = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client } = fakeClient();
  const controller = new EditorController(host, {
    bus,
    client,
    files: [
      { path: 'main.c', text: MACRO_ENTRY },
      { path: 'values.h', text: MACRO_HEADER },
    ],
    entry: 'main.c',
  });
  const view = (controller as any).editor.view;
  return { host, bus, controller, view };
};

const mountedEnumFiles = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client } = fakeClient();
  const controller = new EditorController(host, {
    bus,
    client,
    files: [
      { path: 'main.c', text: ENUM_ENTRY },
      { path: 'mode.h', text: ENUM_HEADER },
    ],
    entry: 'main.c',
  });
  const view = (controller as any).editor.view;
  return { host, controller, view };
};

const mountedAggregateFiles = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client } = fakeClient();
  const controller = new EditorController(host, {
    bus,
    client,
    files: [
      { path: 'main.c', text: AGGREGATE_ENTRY },
      { path: 'types.h', text: AGGREGATE_HEADER },
    ],
    entry: 'main.c',
  });
  const view = (controller as any).editor.view;
  return { host, controller, view };
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
      'Preprocess',
      'SyntaxCheck',
    ]);

    // And only once, however often the pointer comes and goes.
    approach(view);
    await settled();
    expect(sent).toHaveLength(2);
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

  it('opens another source tab for a function body past a prototype', async () => {
    const { host, view, controller } = mountedFiles();
    approach(view);
    await settled();

    clickAt(view, ENTRY.indexOf('helper(2)'));

    expect(controller.active()).toBe('helper.c');
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

  it('goes to the #define from a macro use', async () => {
    // The parser never sees `LIMIT` - it reads `100` - so the constructs have
    // nothing to send the reader to, and the link resolves it against what the
    // preprocessor recorded instead.
    const { host, view, controller } = mounted(WITH_MACRO);
    approach(view);
    await settled();

    const use = WITH_MACRO.indexOf('= LIMIT') + 2;
    view.dispatch({ selection: { anchor: 0 } });
    clickAt(view, use);
    const landed = view.state.selection.main.anchor;
    expect(view.state.doc.lineAt(landed).number).toBe(1);
    // On the name itself, not at the start of the directive.
    expect(view.state.doc.sliceString(landed, landed + 5)).toBe('LIMIT');
    controller.destroy();
    host.remove();
  });

  it('opens a header tab for a macro defined in another file', async () => {
    const { host, view, controller } = mountedMacroFiles();
    approach(view);
    await settled();

    clickAt(view, MACRO_ENTRY.indexOf('VALUE'));

    expect(controller.active()).toBe('values.h');
    const landed = view.state.selection.main.anchor;
    expect(view.state.doc.sliceString(landed, landed + 5)).toBe('VALUE');
    controller.destroy();
    host.remove();
  });

  it('opens a header tab for an enumeration constant declared there', async () => {
    const { host, view, controller } = mountedEnumFiles();
    approach(view);
    await settled();

    clickAt(view, ENUM_ENTRY.indexOf('MODE_RUN'));

    expect(controller.active()).toBe('mode.h');
    const landed = view.state.selection.main.anchor;
    expect(view.state.doc.sliceString(landed, landed + 8)).toBe('MODE_RUN');
    controller.destroy();
    host.remove();
  });

  it.each([
    ['struct', 'left'],
    ['union', 'byte'],
  ])('opens a header tab for a %s field declared there', async (_, field) => {
    const { host, view, controller } = mountedAggregateFiles();
    approach(view);
    await settled();

    clickAt(view, AGGREGATE_ENTRY.lastIndexOf(field));

    expect(controller.active()).toBe('types.h');
    const landed = view.state.selection.main.anchor;
    expect(view.state.doc.sliceString(landed, landed + field.length)).toBe(
      field
    );
    controller.destroy();
    host.remove();
  });

  it('opens an available header directly from its include directive', () => {
    const { host, view, controller } = mountedMacroFiles();

    clickAt(view, MACRO_ENTRY.indexOf('values.h') + 2);

    expect(controller.active()).toBe('values.h');
    expect(view.state.selection.main.anchor).toBe(0);
    controller.destroy();
    host.remove();
  });

  it("leaves a macro call's arguments to the constructs", async () => {
    const { host, view, controller } = mounted(WITH_MACRO);
    approach(view);
    await settled();

    // `a` sits inside the span `MAX(a, b)` replaced, and is still a local.
    // The call, not the `#define` of the same shape above it.
    const argument = WITH_MACRO.lastIndexOf('MAX(a, b)') + 'MAX('.length;
    view.dispatch({ selection: { anchor: 0 } });
    clickAt(view, argument);
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      4
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

describe('memory-view navigation, wired up', () => {
  it('goes from a function cell to the function definition', async () => {
    const { host, bus, view, controller } = mounted();
    approach(view);
    await settled();

    view.dispatch({ selection: { anchor: PROGRAM.length } });
    bus.signal('navigateMemory', { kind: 'function', name: 'twice' });

    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      1
    );
    controller.destroy();
    host.remove();
  });

  it('goes from an object cell to the object declaration', async () => {
    const { host, bus, view, controller } = mounted();
    approach(view);
    await settled();

    const model = {
      ...emptyStepModel(),
      variables: [
        {
          name: 'count',
          key: 'main-count',
          type: 'int',
          value: '2',
          address: 0x1000,
          region: 'stack' as const,
          frame: 'main',
          active: true,
        },
      ],
    };
    controller.recieve({
      output: '',
      sourcecode: PROGRAM,
      debugState: 'Debugging',
      step: 1,
      errors: [],
      model,
      constructs: constructsOf(PROGRAM),
    } as Response);
    view.dispatch({ selection: { anchor: 0 } });
    bus.signal('navigateMemory', { kind: 'object', key: 'main-count' });

    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      5
    );
    controller.destroy();
    host.remove();
  });

  it('keeps an object jump on the right line after a header offset', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bus = new Bus();
    const { client } = fakeClient();
    const entry = `#include "values.h"
int main(void) {
  int count = 2;
  return count;
}`;
    const controller = new EditorController(host, {
      bus,
      client,
      files: [
        { path: 'main.c', text: entry },
        { path: 'values.h', text: MACRO_HEADER },
      ],
      entry: 'main.c',
    });
    const view = (controller as any).editor.view;
    const files = controller.openFiles();
    const source = new ExecutionSource(files, 'main.c', files[0].text);
    const model = {
      ...emptyStepModel(),
      variables: [
        {
          name: 'count',
          key: 'main-count',
          type: 'int',
          value: '2',
          address: 0x1000,
          region: 'stack' as const,
          frame: 'main',
          active: true,
        },
      ],
    };
    controller.recieve({
      output: '',
      sourcecode: source.code,
      debugState: 'Debugging',
      step: 1,
      errors: [],
      model,
      constructs: constructsOf(source.code),
    } as Response);

    bus.signal('navigateMemory', { kind: 'object', key: 'main-count' });

    expect(controller.active()).toBe('main.c');
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      3
    );
    controller.destroy();
    host.remove();
  });

  it('opens the source tab that contains a function definition', () => {
    const { host, bus, view, controller } = mountedFiles();
    const source = `${ENTRY}\n${HELPER}`;
    const model = {
      ...emptyStepModel(),
      functions: [{ name: 'helper', address: 0x1000, size: 16 }],
    };
    controller.recieve({
      output: '',
      sourcecode: source,
      debugState: 'Debugging',
      step: 1,
      errors: [],
      model,
      constructs: constructsOf(source),
    } as Response);

    bus.signal('navigateMemory', { kind: 'function', name: 'helper' });

    expect(controller.active()).toBe('helper.c');
    expect(view.state.doc.lineAt(view.state.selection.main.anchor).number).toBe(
      1
    );
    controller.destroy();
    host.remove();
  });
});
