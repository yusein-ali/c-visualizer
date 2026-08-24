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

  /**
   * What the check found in the file that is not open.
   *
   * The parse behind every background check reads the whole composed program;
   * everything it found outside the tab being edited used to be dropped, so a
   * reader was never told that the file they were not looking at was the one
   * holding the mistake.
   */
  it('reports a finding from a file the check was not asked about', async () => {
    const broken = files.map((file) =>
      file.path === 'helper.c'
        ? {
            ...file,
            text: file.text.replace('return doubled;', 'return total;'),
          }
        : file
    );
    const response = await quiet(() =>
      new Server().send({
        controlEvent: 'SyntaxCheck',
        sourcecode: broken[0].text,
        files: broken,
        entry: 'main.c',
        active: 'main.c',
      })
    );

    expect(response.errors).toEqual([]);
    expect(response.lints).toEqual([]);
    expect(response.programLints).toEqual([
      {
        path: 'helper.c',
        lints: [
          expect.objectContaining({
            rule: 'undeclared-identifier',
            // The third line of helper.c, not of the composed unit.
            line: 3,
            column: 9,
          }),
        ],
      },
    ]);
  });

  it('reports a sibling syntax error without refusing anything', async () => {
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
        active: 'main.c',
      })
    );

    // `fileErrors` is what tells the editor a run did not happen, and nothing
    // has been refused here: a check reports, it does not stop anything.
    expect(response.fileErrors).toBeUndefined();
    expect(response.errors).toEqual([]);
    expect(response.programErrors).toEqual([
      {
        path: 'helper.c',
        errors: [
          // The sentence names the file's own line, not the composed unit's.
          { line: 4, charPositionInLine: 0, msg: "line 4:0 unexpected '}'" },
        ],
      },
    ]);
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
    expect(helper?.model.context).toEqual({
      file: 'helper.c',
      function: 'helper',
    });
    const helperIndex =
      typeof helper === 'undefined' ? -1 : responses.indexOf(helper);
    expect(
      responses
        .slice(helperIndex + 1)
        .some((response) => response.location?.path === 'main.c')
    ).toBe(true);
  });
});
