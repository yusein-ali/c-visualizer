import { Plivet } from '../src';
import { emptyStepModel } from '../src/core';
import type { Request, Response } from '../src/core';

/* The canvas needs a browser; what this file checks above it does not. */
jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    setFocus(): void {}
    setDiagnostics(): void {}
    setDiagnosticActivity(): void {}
    setRunStatus(): void {}
    setDebugState(): void {}
    destroy(): void {}
  },
}));

/**
 * L16 as a host sees it: the `args` option, the control bar's field behind
 * `features.programArgs`, and the arguments that reach the interpreter when
 * a run starts. The client is stubbed, so what is checked is the request.
 */

const CODE = 'int main(int argc, char *argv[]) { return argc; }';

const stopped: Response = {
  output: '',
  sourcecode: CODE,
  debugState: 'Stop',
  step: 0,
  errors: [],
  model: emptyStepModel(),
};

const mount = (options: ConstructorParameters<typeof Plivet>[1] = {}) => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const plivet = new Plivet(parent, {
    files: [{ path: 'main.c', text: CODE }],
    entry: 'main.c',
    ...options,
  });
  const requests: Request[] = [];
  jest
    .spyOn((plivet as any).client, 'send')
    .mockImplementation((request: unknown) => {
      requests.push(request as Request);
      return Promise.resolve(stopped);
    });
  const send = (command: 'Start' | 'Exec' | 'Step') =>
    (plivet as any).editor.send(command);
  const field = () =>
    parent.querySelector<HTMLInputElement>('.plivet-controls__args input');
  return { plivet, parent, requests, send, field };
};

describe('program arguments in an instance', () => {
  let warned: string[];
  beforeEach(() => {
    warned = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest
      .spyOn(console, 'warn')
      .mockImplementation((message: unknown) => warned.push(String(message)));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('sends none, and draws no field, by default', () => {
    const { send, requests, field } = mount();
    send('Start');
    expect(requests[0].args).toEqual([]);
    expect(field()).toBeNull();
  });

  it('sends the args option with Start and Exec, and only with those', () => {
    const { send, requests } = mount({ args: ['input.txt', 'two words'] });
    send('Start');
    send('Step');
    send('Exec');
    expect(requests.map((request) => request.args)).toEqual([
      ['input.txt', 'two words'],
      undefined,
      ['input.txt', 'two words'],
    ]);
  });

  it('splits a line given as a string as a shell would', () => {
    const { send, requests } = mount({ args: 'one "two words" \'3\'' });
    send('Start');
    expect(requests[0].args).toEqual(['one', 'two words', '3']);
  });

  it('applies an edit to the field at the next Start', () => {
    const { send, requests, field } = mount({
      args: 'first "as written"',
      features: { programArgs: true },
    });
    const input = field()!;
    expect(input.value).toBe('first "as written"');

    send('Start');
    input.value = 'second "two words"';
    input.dispatchEvent(new Event('input'));
    send('Step');
    send('Start');

    expect(requests.map((request) => request.args)).toEqual([
      ['first', 'as written'],
      undefined,
      ['second', 'two words'],
    ]);
  });

  it('fills the field from an array, quoting what needs it', () => {
    const { field } = mount({
      args: ['a', 'b c'],
      features: { programArgs: true },
    });
    expect(field()!.value).toBe("a 'b c'");
  });

  it('drops args that are not arguments, with a warning', () => {
    const { send, requests } = mount({
      args: [1, 2] as unknown as string[],
    });
    send('Start');
    expect(requests[0].args).toEqual([]);
    expect(warned).toEqual([
      'c-visualizer: args must be an array of strings or one string of arguments, and was ignored',
    ]);
  });
});
