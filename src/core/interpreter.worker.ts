import { FromWorker, ToWorker } from './messages';
import { Server } from './server';

/**
 * The interpreter, off the main thread.
 *
 * Everything expensive PLIVET does happens here: parsing a program, stepping
 * it, and reading each step into a `StepModel`. The page is left with the
 * layout and the drawing, which is why a run of a hundred thousand steps no
 * longer stops the editor from scrolling.
 *
 * The Worker owns the session. Nothing about it is shared with the page - the
 * only things that cross are the messages in `messages.ts`.
 */

/**
 * `self` is typed as a `Window` here because the project compiles against the
 * DOM library, and adding the WebWorker one globally would contradict it for
 * every other file. The two members this file actually uses are named instead.
 */
const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const server = new Server();

// A run stops at the end of the program, at a read or at a breakpoint, long
// after the `StepAll` that started it was answered. It is reported on its own.
server.onRunEvent = (event, response) =>
  scope.postMessage({ kind: 'run', event, response });

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.kind === 'files') {
    server.setFiles(message.files);
    return;
  }
  const { id, request } = message;
  try {
    const response = await server.send(request);
    scope.postMessage({ kind: 'response', id, response });
  } catch (thrown) {
    scope.postMessage({
      kind: 'failed',
      id,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
};
