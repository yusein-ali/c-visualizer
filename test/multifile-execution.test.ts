import { CONTROL_EVENT, Request, Response, Server } from '../src/core';

const files = [
  {
    path: 'main.c',
    text: `int helper(int value);

int main(void) {
  int result = helper(3);
  return result;
}
`,
  },
  {
    path: 'helper.c',
    text: `int helper(int value) {
  int doubled = value * 2;
  return doubled;
}
`,
  },
];

const request = (controlEvent: CONTROL_EVENT): Request => ({
  controlEvent,
  sourcecode: files[0].text,
  files,
  entry: 'main.c',
});

const quiet = async (run: () => Promise<Response>): Promise<Response> => {
  const logged = console.log;
  const errored = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.log = logged;
    console.error = errored;
  }
};

describe('multi-file execution', () => {
  it.each<CONTROL_EVENT>(['Start', 'Exec'])(
    'refuses %s when a sibling source has a syntax error',
    async (controlEvent) => {
      const broken = files.map((file) =>
        file.path === 'helper.c'
          ? {
              ...file,
              text: file.text.replace('return doubled;', 'return doubled'),
            }
          : file
      );
      const response = await quiet(() =>
        new Server().send({
          controlEvent,
          sourcecode: broken[0].text,
          files: broken,
          entry: 'main.c',
          active: 'main.c',
        })
      );

      expect(response.debugState).toBe('Stop');
      expect(response.diagnosticPath).toBe('helper.c');
      expect(response.fileErrors).toEqual([
        { path: 'helper.c', errors: response.errors },
      ]);
      expect(response.location).toBeUndefined();
    }
  );

  it('reports a syntax error from the active helper tab', async () => {
    const broken = files.map((file) =>
      file.path === 'helper.c'
        ? {
            ...file,
            text: file.text.replace('return doubled;', 'return doubled'),
          }
        : file
    );
    const response = await quiet(() =>
      new Server().send({
        controlEvent: 'SyntaxCheck',
        sourcecode: broken[0].text,
        files: broken,
        entry: 'main.c',
        active: 'helper.c',
      })
    );

    expect(response.sourcecode).toBe(broken[1].text);
    expect(response.errors.length).toBeGreaterThan(0);
    expect(response.errors.some((error) => error.line === 4)).toBe(true);
  });

  it('resolves an entry-file prototype against a sibling definition', async () => {
    const response = await quiet(() =>
      new Server().send(request('SyntaxCheck'))
    );

    expect(
      response.lints?.filter(
        (diagnostic) => diagnostic.rule === 'undefinedReference'
      )
    ).toEqual([]);
  });

  it('maps steps into a helper file and back to the entry file', async () => {
    const server = new Server();
    const responses = [await quiet(() => server.send(request('Start')))];
    for (let step = 0; step < 80; step += 1) {
      const response = await quiet(() => server.send(request('Step')));
      responses.push(response);
      if (response.debugState === 'EOF') {
        break;
      }
    }
    const helper = responses.find(
      (response) => response.location?.path === 'helper.c'
    );
    expect(helper?.location?.range.begin.y).toBeGreaterThanOrEqual(1);
    const helperIndex =
      typeof helper === 'undefined' ? -1 : responses.indexOf(helper);
    expect(
      responses
        .slice(helperIndex + 1)
        .some((response) => response.location?.path === 'main.c')
    ).toBe(true);
  });
});
