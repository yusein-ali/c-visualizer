/**
 * The deployed one-script entry.
 *
 * Course pages already expose CodeMirror 6 as `window.CodeMirror`; a plain
 * popup or another host may not. Static external imports cannot make that
 * decision themselves because they are evaluated before the application, so
 * this dependency-free loader makes it first and only then loads PLIVET.
 * `data-c-visualizer-auto-mount="false"` is forwarded to that application for
 * hosts that wait for `CVisualizerReady` and construct every instance by hand.
 *
 * What the application entry publishes is `CVisualizerApp`, a promise for the
 * API: the entry is a stub that imports the application, so the API is there
 * one chunk after the script it came with. `CVisualizerReady` stays the single
 * thing a host awaits either way.
 */

type LoaderWindow = Window &
  typeof globalThis & {
    CodeMirror?: Record<string, unknown>;
    CVisualizer?: unknown;
    CVisualizerApp?: Promise<unknown>;
    CVisualizerReady?: Promise<unknown>;
  };

const scope = window as LoaderWindow;
const script = document.currentScript;

const hasCodeMirror = (): boolean => {
  const found = scope.CodeMirror;
  return (
    typeof found === 'object' &&
    found !== null &&
    ['autocomplete', 'commands', 'language', 'state', 'view'].every(
      (name) => typeof found[name] === 'object' && found[name] !== null
    )
  );
};

const load = (
  name: string,
  base: URL,
  nonce?: string,
  autoMount?: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = new URL(name, base).href;
    element.async = true;
    if (typeof nonce !== 'undefined' && nonce !== '') {
      element.nonce = nonce;
    }
    if (typeof autoMount !== 'undefined') {
      element.dataset.cVisualizerAutoMount = autoMount;
    }
    element.addEventListener('load', () => resolve(), { once: true });
    element.addEventListener(
      'error',
      () => reject(new Error(`Failed to load ${element.src}`)),
      { once: true }
    );
    document.head.appendChild(element);
  });

if (typeof scope.CVisualizerReady === 'undefined') {
  scope.CVisualizerReady = (async () => {
    if (!(script instanceof HTMLScriptElement) || script.src === '') {
      throw new Error('c-visualizer loader needs a script URL');
    }
    const base = new URL('.', script.src);
    const nonce = script.nonce;
    const autoMount = script.dataset.cVisualizerAutoMount;
    if (!hasCodeMirror()) {
      await load('codemirror-fallback.js', base, nonce);
    }
    await load('c-visualizer.app.js', base, nonce, autoMount);
    // That script is the entry, not the application: the application is in the
    // chunks under it, so its `load` event is the point at which a promise for
    // the API exists rather than the API itself.
    await scope.CVisualizerApp;
    if (typeof scope.CVisualizer === 'undefined') {
      throw new Error('c-visualizer application did not publish its API');
    }
    return scope.CVisualizer;
  })();
  scope.CVisualizerReady.catch((error: unknown) => console.error(error));
}
