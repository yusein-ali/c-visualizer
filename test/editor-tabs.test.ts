import { Bus } from '../src/app/emitter';
import { EditorController } from '../src/app/EditorController';
import {
  InterpreterClient,
  Request,
  Response,
  emptyStepModel,
} from '../src/core';

/**
 * The controller with more than one file open.
 *
 * A tab is not only a text: it is where the reader was, which lines they
 * marked and what they pinned. Switching away and back has to give all of it
 * back, or a tab is a worse way to keep a second file than a second window.
 */

/** A client that answers everything with a stopped session. */
const fakeClient = () => {
  const sent: Request[] = [];
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
        constructs: [],
        lints: [],
      } as Response);
    },
  };
  return { client: client as unknown as InterpreterClient, sent };
};

const mounted = (files: { path: string; text: string }[], entry?: string) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const bus = new Bus();
  const { client, sent } = fakeClient();
  const controller = new EditorController(host, { bus, client, files, entry });
  return { host, bus, controller, sent };
};

const tabButtons = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.plivet-tabs__select'));

const FILES = [
  { path: 'main.c', text: 'int main(void) {\n  return 0;\n}' },
  { path: 'notes.c', text: 'int unused = 1;' },
];

describe('the editor with several files', () => {
  it('opens the entry file and lists them all', () => {
    const { host, controller } = mounted(FILES);
    expect(controller.active()).toBe('main.c');
    expect(controller.entry()).toBe('main.c');
    expect(tabButtons(host).map((tab) => tab.textContent)).toEqual([
      'main.c',
      'notes.c',
    ]);
    expect(controller.code()).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('gives a tab back its text and its marks', () => {
    const { host, controller } = mounted(FILES);
    const editor = (controller as any).editor;
    editor.debug.setBreakpoints(editor.view, [1]);

    tabButtons(host)[1].click();
    expect(controller.code()).toBe('int unused = 1;');
    expect(editor.debug.rows(editor.view.state)).toEqual([]);

    tabButtons(host)[0].click();
    expect(controller.code()).toContain('return 0;');
    expect(editor.debug.rows(editor.view.state)).toEqual([1]);
    controller.destroy();
    host.remove();
  });

  it('keeps an edit made in a tab that is not on the screen', () => {
    const { host, controller } = mounted(FILES);
    tabButtons(host)[1].click();
    (controller as any).edited('int unused = 2;');
    tabButtons(host)[0].click();

    const files = controller.openFiles();
    expect(files.find((file) => file.path === 'notes.c')!.text).toBe(
      'int unused = 2;'
    );
    controller.destroy();
    host.remove();
  });

  it('sends every file and says which one runs', () => {
    const { host, controller, sent } = mounted(FILES);
    controller.send('Start');
    const request = sent[sent.length - 1];
    expect(request.entry).toBe('main.c');
    expect(request.files!.map((file) => file.path)).toEqual([
      'main.c',
      'notes.c',
    ]);
    expect(request.sourcecode).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('runs the entry file even while another tab is on the screen', () => {
    const { host, controller, sent } = mounted(FILES);
    tabButtons(host)[1].click();
    controller.send('Start');
    const request = sent[sent.length - 1];
    expect(request.sourcecode).toContain('return 0;');
    controller.destroy();
    host.remove();
  });

  it('changes which file runs when the reader asks', () => {
    const { host, controller, sent } = mounted(FILES);
    host.querySelectorAll<HTMLButtonElement>('.plivet-tabs__entry')[1].click();
    expect(controller.entry()).toBe('notes.c');
    controller.send('Start');
    expect(sent[sent.length - 1].sourcecode).toBe('int unused = 1;');
    controller.destroy();
    host.remove();
  });

  it('opens a file from outside beside the ones already there', () => {
    const { host, controller } = mounted(FILES);
    controller.openInTab('extra.c', 'int extra = 3;');
    expect(controller.active()).toBe('extra.c');
    expect(controller.openFiles().map((file) => file.path)).toEqual([
      'main.c',
      'notes.c',
      'extra.c',
    ]);
    controller.destroy();
    host.remove();
  });

  it('closes a file, but never the one that runs', () => {
    const { host, controller } = mounted(FILES);
    const closers = host.querySelectorAll<HTMLButtonElement>(
      '.plivet-tabs__close'
    );
    // One closer, on the file that is not the entry.
    expect(closers).toHaveLength(1);
    closers[0].click();
    expect(controller.openFiles().map((file) => file.path)).toEqual(['main.c']);
    controller.destroy();
    host.remove();
  });

  it('opens with one unnamed file when it is given no set', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bus = new Bus();
    const { client } = fakeClient();
    const controller = new EditorController(host, {
      bus,
      client,
      doc: 'int main(void) {}',
    });
    expect(controller.openFiles()).toHaveLength(1);
    expect(host.querySelector('.plivet-tabs')!.hasAttribute('hidden')).toBe(
      true
    );
    controller.destroy();
    host.remove();
  });
});
