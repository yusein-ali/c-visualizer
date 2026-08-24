import { forEachDiagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { Plivet } from '../src';
import type { ExternalDiagnostic } from '../src';

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

const FILES = [
  { path: 'main.c', text: 'int main(void) { return 0; }' },
  { path: 'helper.c', text: 'int helper(void) { return 1; }' },
];

const warning = (path = 'main.c'): ExternalDiagnostic => ({
  path,
  severity: 'warning',
  message: 'unused value',
  code: '-Wunused-value',
  from: { line: 0, column: 4 },
  to: { line: 0, column: 8 },
});

const editorView = (plivet: Plivet): EditorView =>
  (plivet as any).editor.editor.view as EditorView;

const diagnostics = (view: EditorView) => {
  const found: { message: string; source?: string }[] = [];
  forEachDiagnostic(view.state, (diagnostic) => {
    found.push({ message: diagnostic.message, source: diagnostic.source });
  });
  return found;
};

describe('the host integration API', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('returns every current file and reports revisioned source changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const changed: number[] = [];
    const plivet = new Plivet(parent, {
      files: FILES,
      entry: 'main.c',
      onSourceChange: (snapshot) => changed.push(snapshot.revision),
    });

    expect(plivet.sourceSnapshot()).toEqual({
      files: FILES,
      entry: 'main.c',
      active: 'main.c',
      revision: 0,
    });

    const view = editorView(plivet);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'int changed;' },
    });

    expect(plivet.sourceSnapshot().files[0]).toEqual({
      path: 'main.c',
      text: 'int changed;',
    });
    expect(changed).toEqual([1]);
    plivet.destroy();
  });

  it('reports the final source snapshot when its window is closing', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const onWindowClose = jest.fn();
    const plivet = new Plivet(parent, {
      files: FILES,
      entry: 'main.c',
      onWindowClose,
    });
    const view = editorView(plivet);
    view.dispatch({ changes: { from: 0, insert: '// final\n' } });

    window.dispatchEvent(new Event('pagehide'));

    expect(onWindowClose).toHaveBeenCalledTimes(1);
    expect(onWindowClose).toHaveBeenCalledWith(plivet.sourceSnapshot());

    plivet.destroy();
    window.dispatchEvent(new Event('pagehide'));
    expect(onWindowClose).toHaveBeenCalledTimes(1);
  });

  it('updates the complete file set and refuses invalid replacements', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, { files: FILES });

    expect(
      plivet.updateFiles(
        [
          { path: 'one.c', text: 'int one;' },
          { path: 'two.c', text: 'int main(void) { return 0; }' },
        ],
        'two.c'
      )
    ).toBe(true);
    expect(plivet.sourceSnapshot()).toMatchObject({
      entry: 'two.c',
      active: 'two.c',
      revision: 1,
    });
    expect(plivet.updateFiles([], undefined)).toBe(false);
    expect(plivet.sourceSnapshot().files).toHaveLength(2);
    await Promise.resolve();
    plivet.destroy();
  });

  it('runs a registered provider and rejects a result for edited source', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, { files: FILES });
    let answer: ((found: ExternalDiagnostic[]) => void) | undefined;
    const provider = jest.fn(
      () =>
        new Promise<ExternalDiagnostic[]>((resolve) => {
          answer = resolve;
        })
    );
    plivet.registerDiagnosticProvider('gcc', provider);

    const requested = plivet.requestDiagnostics('gcc');
    expect(provider).toHaveBeenCalledWith(plivet.sourceSnapshot());
    const view = editorView(plivet);
    view.dispatch({ changes: { from: 0, insert: ' ' } });
    answer?.([warning()]);

    await expect(requested).resolves.toBe(false);
    expect(diagnostics(view)).toEqual([]);
    plivet.destroy();
  });

  it('merges a provider result into CodeMirror and clears only its source', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, { files: FILES });
    plivet.registerDiagnosticProvider('gcc', async () => [warning()]);

    await expect(plivet.requestDiagnostics('gcc')).resolves.toBe(true);
    expect(diagnostics(editorView(plivet))).toEqual([
      {
        message: 'unused value',
        source: 'c-visualizer:build/-Wunused-value',
      },
    ]);

    plivet.clearDiagnostics('gcc');
    expect(diagnostics(editorView(plivet))).toEqual([]);
    plivet.destroy();
  });

  it('keeps compiler diagnostics with their source tab', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const plivet = new Plivet(parent, { files: FILES });
    plivet.setDiagnostics('gcc', [
      warning('main.c'),
      { ...warning('helper.c'), message: 'helper warning' },
    ]);

    expect(diagnostics(editorView(plivet))[0].message).toBe('unused value');
    parent
      .querySelectorAll<HTMLButtonElement>('.plivet-tabs__select')[1]
      .click();
    expect(diagnostics(editorView(plivet))[0].message).toBe('helper warning');
    expect(plivet.sourceSnapshot().revision).toBe(0);
    await Promise.resolve();
    plivet.destroy();
  });

  it('requires a provider for support-build and runs it from the button', async () => {
    const missing = document.createElement('div');
    expect(() => new Plivet(missing, { supportBuild: true })).toThrow(
      'support-build requires at least one diagnostic provider'
    );

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const provider = jest.fn(async () => [warning()]);
    const plivet = new Plivet(parent, {
      files: FILES,
      supportBuild: true,
      diagnosticProviders: { gcc: provider },
    });
    parent.querySelector<HTMLButtonElement>('[aria-label="Build"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(provider).toHaveBeenCalledWith(plivet.sourceSnapshot());
    expect(diagnostics(editorView(plivet))).toHaveLength(1);
    plivet.destroy();
  });
});
