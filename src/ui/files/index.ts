/**
 * PLIVET's upload panel: the files a running program can open.
 *
 * Reading a `File` needs the page that owns the input element, so the reading
 * happens on this side and the bytes are handed to the interpreter client;
 * see `src/core/client.ts`.
 */
export { FilePanel } from './FilePanel';
export type { FilePanelOptions } from './FilePanel';
