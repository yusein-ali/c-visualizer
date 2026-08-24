import { Request, Response, RUN_EVENT } from './server';

/**
 * What the page and the interpreter say to each other.
 *
 * Everything here goes through `structuredClone`, so everything here is plain
 * data: no class instances, no functions, and no `ExecState` - the model in a
 * `Response` is what the interpreter's own objects were turned into before
 * they were left behind in the Worker.
 */

export type ToWorker =
  /** A debug command. The id is what its answer comes back under. */
  | { kind: 'send'; id: number; request: Request }
  /** The uploaded files, sent when they change rather than with every step. */
  | {
      kind: 'files';
      files: Map<string, ArrayBuffer>;
      /** Lets the page reject an answer older than its latest upload/delete. */
      version: number;
    };

export type FromWorker =
  | { kind: 'response'; id: number; response: Response }
  /** A command that threw. The message is all a thrown value survives as. */
  | { kind: 'failed'; id: number; message: string }
  /** A run that stopped on its own, with no command waiting for it. */
  | { kind: 'run'; event: RUN_EVENT; response: Response }
  /** Files created or changed by the running C program. */
  | {
      kind: 'files';
      files: Map<string, ArrayBuffer>;
      version: number;
    };
