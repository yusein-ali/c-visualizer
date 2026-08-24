import { InterpreterClient, emptyStepModel } from '../src/core';
import { spawnWorker } from '../src/core/spawnWorker';
import type { FromWorker, ToWorker } from '../src/core/messages';
import type { Request, Response } from '../src/core';

/**
 * The interpreter client, on both sides of the Worker boundary. There is no
 * Worker under Jest - `spawnWorker` is a stub that throws - so this replaces
 * it with one that records what it was posted and answers when told to.
 *
 * What is being checked is one client per instance, so two PLIVETs on one
 * page do not share an interpreter, a history or a set of uploaded files.
 */

class FakeWorker {
  static readonly spawned: FakeWorker[] = [];
  readonly posted: ToWorker[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  constructor() {
    FakeWorker.spawned.push(this);
  }

  postMessage(message: ToWorker): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** What the Worker would have sent back. */
  answer(message: FromWorker): void {
    if (this.onmessage !== null) {
      this.onmessage({ data: message } as MessageEvent<FromWorker>);
    }
  }
}

jest.mock('../src/core/spawnWorker', () => ({
  spawnWorker: jest.fn(() => new FakeWorker()),
}));

const request: Request = { controlEvent: 'Step', sourcecode: 'int main(){}' };

const responseWith = (output: string): Response => ({
  output,
  sourcecode: '',
  debugState: 'Debugging',
  step: 1,
  errors: [],
  model: emptyStepModel(),
});

const sent = (worker: FakeWorker) =>
  worker.posted.filter((message) => message.kind === 'send');

beforeEach(() => {
  FakeWorker.spawned.length = 0;
  (spawnWorker as jest.Mock).mockClear();
});

describe('the interpreter client', () => {
  it('starts no Worker until something is asked of it', () => {
    new InterpreterClient();
    expect(FakeWorker.spawned).toHaveLength(0);
  });

  it('gives every instance a Worker of its own', () => {
    const one = new InterpreterClient();
    const other = new InterpreterClient();
    void one.send(request);
    void other.send(request);

    expect(FakeWorker.spawned).toHaveLength(2);
    expect(sent(FakeWorker.spawned[0])).toHaveLength(1);
    expect(sent(FakeWorker.spawned[1])).toHaveLength(1);
  });

  it('answers only the command that was waiting for it', async () => {
    const one = new InterpreterClient();
    const other = new InterpreterClient();
    const first = one.send(request);
    let otherAnswered = false;
    void other.send(request).then(() => (otherAnswered = true));

    FakeWorker.spawned[0].answer({
      kind: 'response',
      id: 1,
      response: responseWith('one'),
    });

    expect((await first).output).toBe('one');
    expect(otherAnswered).toBe(false);
  });

  it('reports a run that stopped to its own instance', () => {
    const one = new InterpreterClient();
    const other = new InterpreterClient();
    const heard: string[] = [];
    one.onRunEvent = (event) => heard.push(`one:${event}`);
    other.onRunEvent = (event) => heard.push(`other:${event}`);
    void one.send(request);
    void other.send(request);

    FakeWorker.spawned[1].answer({
      kind: 'run',
      event: 'EOF',
      response: responseWith('other'),
    });

    expect(heard).toEqual(['other:EOF']);
  });

  it('keeps uploaded files to the instance they were given to', async () => {
    const one = new InterpreterClient();
    const other = new InterpreterClient();
    // jsdom's `File` has no `arrayBuffer`, and the name and the bytes are all
    // the client reads.
    const file = {
      name: 'data.txt',
      arrayBuffer: async () => new ArrayBuffer(8),
    };

    const files = await one.upload([file] as unknown as FileList);
    void other.send(request);

    expect(Array.from(files.keys())).toEqual(['data.txt']);
    expect(
      FakeWorker.spawned[1].posted.some((message) => message.kind === 'files')
    ).toBe(false);
  });

  it('receives files created by its own Worker', () => {
    const one = new InterpreterClient();
    const other = new InterpreterClient();
    const oneFiles: Map<string, ArrayBuffer>[] = [];
    const otherFiles: Map<string, ArrayBuffer>[] = [];
    one.onFilesChanged = (files) => oneFiles.push(new Map(files));
    other.onFilesChanged = (files) => otherFiles.push(new Map(files));
    void one.send(request);
    void other.send(request);

    FakeWorker.spawned[0].answer({
      kind: 'files',
      version: 0,
      files: new Map([['result.txt', new Uint8Array([79, 75]).buffer]]),
    });

    expect(Array.from(oneFiles[0].keys())).toEqual(['result.txt']);
    expect(Array.from(new Uint8Array(oneFiles[0].get('result.txt')!))).toEqual([
      79, 75,
    ]);
    expect(otherFiles).toHaveLength(0);
  });

  it('rejects a runtime file update older than its latest upload', async () => {
    const client = new InterpreterClient();
    const changes: Map<string, ArrayBuffer>[] = [];
    client.onFilesChanged = (files) => changes.push(new Map(files));
    void client.send(request);
    const upload = {
      name: 'new-input.txt',
      arrayBuffer: async () => new ArrayBuffer(1),
    };
    await client.upload([upload] as unknown as FileList);

    FakeWorker.spawned[0].answer({
      kind: 'files',
      version: 0,
      files: new Map([['stale-output.txt', new ArrayBuffer(1)]]),
    });

    expect(changes).toHaveLength(0);
  });

  it('terminates its own Worker and leaves the other running', async () => {
    const one = new InterpreterClient();
    const other = new InterpreterClient();
    let settled = '';
    one.send(request).then(
      () => (settled = 'resolved'),
      () => (settled = 'rejected')
    );
    void other.send(request);

    one.destroy();
    await Promise.resolve();

    // Dropped, not failed: the widget the answer was for has gone too, and a
    // rejection would reach the alert in `EditorController`.
    expect(settled).toBe('');
    expect(FakeWorker.spawned[0].terminated).toBe(true);
    expect(FakeWorker.spawned[1].terminated).toBe(false);

    // The other instance still has an interpreter to answer it.
    FakeWorker.spawned[1].answer({
      kind: 'response',
      id: 1,
      response: responseWith('other'),
    });
  });

  it('fails what was in flight when its Worker does', async () => {
    const client = new InterpreterClient();
    const pending = client.send(request);
    const worker = FakeWorker.spawned[0];
    if (worker.onerror !== null) {
      worker.onerror({ message: 'Worker failed to load' });
    }

    await expect(pending).rejects.toThrow('Worker failed to load');
  });

  it('starts a fresh Worker for a session after the last one ended', () => {
    const client = new InterpreterClient();
    void client.send(request);
    client.destroy();
    void client.send(request);

    expect(FakeWorker.spawned).toHaveLength(2);
    expect(FakeWorker.spawned[0].terminated).toBe(true);
    expect(FakeWorker.spawned[1].terminated).toBe(false);
  });
});
