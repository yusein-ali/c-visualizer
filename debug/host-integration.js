'use strict';

const MAIN_SOURCE = `#include <stdio.h>

int helper(int value);

int main(void) {
  int unused = 42;
  printf("result: %d\\n", helper(3));
  return 0;
}
`;

const HELPER_SOURCE = `int helper(int value) {
  // TODO: the simulated grader reports this line.
  return value * 2;
}
`;

const scope = window;
const query = new URLSearchParams(location.search);
const mode = query.get('codemirror') === 'fallback' ? 'fallback' : 'host';
const logElement = document.querySelector('#host-log');
const statusElement = document.querySelector('#status');
const modeElement = document.querySelector('#mode');
const mount = document.querySelector('#visualizer');

const log = (message, value) => {
  const suffix =
    typeof value === 'undefined' ? '' : `\n${JSON.stringify(value, null, 2)}`;
  logElement.textContent += `${new Date().toLocaleTimeString()} ${message}${suffix}\n`;
  logElement.scrollTop = logElement.scrollHeight;
};

const loadScript = (src, attributes = {}) =>
  new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    for (const [name, value] of Object.entries(attributes)) {
      script.dataset[name] = value;
    }
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`Failed to load ${script.src}`)),
      { once: true }
    );
    document.head.appendChild(script);
  });

const diagnosticAt = (path, text, needle, severity, message) => {
  const offset = text.indexOf(needle);
  if (offset === -1) {
    return null;
  }
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  const lastNewline = before.lastIndexOf('\n');
  const column = offset - lastNewline - 1;
  return {
    path,
    severity,
    message,
    code: `debug-${severity}`,
    from: { line, column },
    to: { line, column: column + needle.length },
  };
};

const simulatedGrader = async (snapshot) => {
  log('A+ provider received source snapshot', snapshot);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const files = new Map(snapshot.files.map((file) => [file.path, file.text]));
  const found = [
    diagnosticAt(
      'main.c',
      files.get('main.c') ?? '',
      'unused',
      'warning',
      'Simulated compiler warning: unused local variable'
    ),
    diagnosticAt(
      'helper.c',
      files.get('helper.c') ?? '',
      'TODO',
      'info',
      'Simulated grader note from helper.c'
    ),
  ].filter((diagnostic) => diagnostic !== null);
  log('A+ provider returned diagnostics', found);
  return found;
};

const start = async () => {
  modeElement.textContent =
    mode === 'host' ? 'host-provided CodeMirror' : 'c-visualizer fallback';

  if (mode === 'host') {
    await loadScript('/embed/codemirror-fallback.js');
    scope.hostCodeMirror = scope.CodeMirror;
    log('Host exposed window.CodeMirror before c-visualizer loaded');
  } else {
    log('Host left window.CodeMirror undefined; loader must fetch fallback');
  }

  await loadScript('/embed/c-visualizer.js', {
    cVisualizerAutoMount: 'false',
  });
  const CVisualizer = await scope.CVisualizerReady;
  const reusedHostModules =
    mode === 'host' && scope.CodeMirror === scope.hostCodeMirror;
  statusElement.textContent =
    mode === 'host'
      ? reusedHostModules
        ? 'host CodeMirror reused'
        : 'host CodeMirror was replaced'
      : 'fallback loaded successfully';

  const visualizer = new CVisualizer(mount, {
    files: [
      { path: 'main.c', text: MAIN_SOURCE },
      { path: 'helper.c', text: HELPER_SOURCE },
    ],
    entry: 'main.c',
    supportBuild: true,
    diagnosticProviders: { aplus: simulatedGrader },
    onSourceChange: (snapshot) =>
      log(`Source changed to revision ${snapshot.revision}`),
    onActiveFileChange: (path) => log(`Active source tab: ${path}`),
  });
  scope.debugVisualizer = visualizer;
  log('c-visualizer constructed with the host callback registry');

  document.querySelector('#save').addEventListener('click', () => {
    const snapshot = visualizer.sourceSnapshot();
    scope.lastSavedSnapshot = snapshot;
    log('Host saved every modified source file', snapshot);
  });

  let updated = false;
  document.querySelector('#update').addEventListener('click', () => {
    updated = !updated;
    const suffix = updated ? '\n// Updated by the host page.\n' : '';
    const accepted = visualizer.updateFiles(
      [
        { path: 'main.c', text: MAIN_SOURCE + suffix },
        { path: 'helper.c', text: HELPER_SOURCE },
      ],
      'main.c'
    );
    log(`Host source update ${accepted ? 'accepted' : 'refused'}`);
  });

  document.querySelector('#direct-diagnostic').addEventListener('click', () => {
    const snapshot = visualizer.sourceSnapshot();
    const text =
      snapshot.files.find((file) => file.path === 'main.c')?.text ?? '';
    const diagnostic = diagnosticAt(
      'main.c',
      text,
      'printf',
      'error',
      'Diagnostic supplied directly by the host page'
    );
    const accepted = visualizer.setDiagnostics(
      'host-direct',
      diagnostic === null ? [] : [diagnostic],
      { revision: snapshot.revision }
    );
    log(`Direct diagnostic ${accepted ? 'accepted' : 'stale'}`);
  });

  document.querySelector('#clear-diagnostic').addEventListener('click', () => {
    visualizer.clearDiagnostics('host-direct');
    log('Direct host diagnostics cleared');
  });

  document.querySelector('#clear-log').addEventListener('click', () => {
    logElement.textContent = '';
  });
};

start().catch((error) => {
  statusElement.textContent = 'failed';
  log(error instanceof Error ? (error.stack ?? error.message) : String(error));
  console.error(error);
});
