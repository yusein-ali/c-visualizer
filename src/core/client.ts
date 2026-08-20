import { FromWorker, ToWorker } from './messages';
import { Request, Response, RUN_EVENT } from './server';
import { spawnWorker } from './spawnWorker';

/**
 * The interpreter as the page sees it: `send(request)` returns a promise of a
 * `Response`, exactly as it did when the interpreter ran on this thread.
 *
 * What changed is where the work happens. The Worker is started on the first
 * command rather than on load, so opening the page costs nothing until
 * something is run, and a test that never debugs never needs one.
 *
 * One client per PLIVET, constructed by the instance that uses it - there is
 * no shared one to reach for. Each client owns a Worker, and each Worker owns
 * a `Server` with its own interpreter, history and uploaded files, so two
 * instances on one page run two programs that know nothing of each other.
 */
export class InterpreterClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (response: Response) => void; reject: (error: Error) => void }
  >();
  private nextId = 0;
  /**
   * The uploaded files. Reading a `File` needs the page that owns the input
   * element, so they are read here and sent across when they change.
   */
  private readonly files = new Map<string, ArrayBuffer>();

  /** Where a run that stopped on its own is reported. */
  public onRunEvent: ((event: RUN_EVENT, response: Response) => void) | null =
    null;

  public send(request: Request): Promise<Response> {
    const id = (this.nextId += 1);
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ kind: 'send', id, request });
    });
  }

  public async upload(files: FileList): Promise<Map<string, ArrayBuffer>> {
    await Promise.all(
      Array.from(files).map(async (file) =>
        this.files.set(file.name, await file.arrayBuffer())
      )
    );
    this.post({ kind: 'files', files: this.files });
    return this.files;
  }

  public delete(filename: string): Map<string, ArrayBuffer> {
    this.files.delete(filename);
    this.post({ kind: 'files', files: this.files });
    return this.files;
  }

  /**
   * Ends the session. The Worker is terminated rather than asked to stop: a
   * run is a loop on that thread, and an instance being unmounted has no one
   * left to report to. A later `send` starts a fresh Worker, and with it a
   * fresh interpreter.
   */
  public destroy(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
    this.onRunEvent = null;
    // Commands still in flight are dropped rather than failed. Their answers
    // were going to widgets that are being taken down with them, and the one
    // thing a failed command does is put an alert in front of a reader who
    // has just closed the thing that would have shown it.
    this.pending.clear();
  }

  private post(message: ToWorker): void {
    this.connect().postMessage(message);
  }

  private connect(): Worker {
    if (this.worker !== null) {
      return this.worker;
    }
    const worker = spawnWorker();
    worker.onmessage = (event: MessageEvent<FromWorker>) =>
      this.receive(event.data);
    // A Worker that fails to load or throws at the top level never answers, so
    // every command still waiting is failed rather than left hanging.
    worker.onerror = (event) => this.failAll(event.message || 'interpreter');
    this.worker = worker;
    // A session started before this point uploaded its files to nobody.
    if (0 < this.files.size) {
      worker.postMessage({ kind: 'files', files: this.files });
    }
    return worker;
  }

  private receive(message: FromWorker): void {
    if (message.kind === 'run') {
      if (this.onRunEvent !== null) {
        this.onRunEvent(message.event, message.response);
      }
      return;
    }
    const waiting = this.pending.get(message.id);
    if (waiting === undefined) {
      return;
    }
    this.pending.delete(message.id);
    if (message.kind === 'failed') {
      waiting.reject(new Error(message.message));
      return;
    }
    waiting.resolve(message.response);
  }

  private failAll(message: string): void {
    for (const waiting of this.pending.values()) {
      waiting.reject(new Error(message));
    }
    this.pending.clear();
  }
}
