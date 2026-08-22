# c-visualizer

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js CI](https://github.com/yusein-ali/c-visualizer/actions/workflows/test.yml/badge.svg)](https://github.com/yusein-ali/c-visualizer/actions/workflows/test.yml)

`c-visualizer` is a browser-only C program visualizer and step debugger. Write
or load C source, execute it one statement at a time, and inspect the current
statement, active function invocations, declared objects, array elements,
structure and union members, and pointer relationships. Its memory map is an
explicit teaching model of common implementation regions, not a layout
required by the C language. Parsing, interpretation, history, and
visualization all remain in the browser; the application has no backend.

## Attribution and disclaimer

`c-visualizer` is a fork of
[PLIVET (Programming Language Interpreter for Visualization of Execution Trace)](https://github.com/RYOSKATE/PLIVET),
originally developed by RYOSKATE and distributed under the MIT License. It is
an independently developed fork, not an official PLIVET release. The original
PLIVET copyright and license notice are retained in [LICENSE](LICENSE). Some
internal TypeScript names and `plivet-*` CSS hooks are intentionally preserved
for compatibility with existing integrations.

The educational and research context includes Veli-Matti Rantanen's 2023 Aalto
University master's thesis,
[_An Interactive C Code Execution and Visualization Tool for Online Learning_](https://urn.fi/URN:NBN:fi:aalto-202309035541).
The 38-page thesis was completed in the Master's Programme in Computer,
Communication and Information Sciences, majoring in Security and Cloud
Computing, under the supervision of Prof. Riku Jäntti and with Dr. Yusein Ali
as thesis advisor. It investigates a web-based tool intended to reduce stress
in introductory C programming by generating and visualizing intelligent
feedback.

The current version of `c-visualizer` is developed by **Yusein R. Ali at Aalto
University**. References to Aalto University and to the upstream project state
the project's provenance and research context; they do not imply endorsement
by Aalto University or by the original PLIVET maintainers.

## What changed from PLIVET

The fork modernizes PLIVET and reshapes it into an embeddable teaching widget:

- **Focused scope:** unfinished Java and Python support and the language
  selector were removed so the application can concentrate on C. The interface
  is English-only.
- **Modern, framework-free interface:** React, Bootstrap, Ace, and Konva were
  replaced with plain TypeScript and DOM widgets, CodeMirror 6, and JointJS.
  This reduces framework coupling and makes the visualizer easier to embed in
  course pages.
- **Responsive browser execution:** the interpreter runs in a Web Worker, so
  parsing and long runs do not block the interface. Step history is bounded,
  and backward stepping replays recorded states rather than attempting reverse
  execution.
- **Embeddable, isolated instances:** a page can mount multiple visualizers,
  each with its own event bus, Worker, files, state, and theme. Scoped styles
  avoid changing the surrounding page.
- **Modern development baseline:** the project now uses Node.js 24, npm 11,
  TypeScript 5, Webpack 5, ESLint, Prettier, Jest, and reproducible CI builds.

## Features added and why

- **Teaching-oriented editor tools** provide C-aware completion and snippets,
  structured hover explanations, inline watched values, occurrence
  highlighting, code folding, execution coverage, syntax and runtime
  diagnostics, and teaching lint rules with quick fixes. These features help
  learners connect source code with C semantics and identify problems where
  they occur.
- **Richer execution visualization** presents the current statement and
  expression, active function invocations, object writes, and an explicitly
  implementation-oriented memory model covering register-class objects,
  static storage, allocated storage, automatic storage, string literals, and
  function code. Collapsible sections, configurable views, and
  editor-to-canvas cross-highlighting help learners focus on the part of
  program state they are studying.
- **A more complete debugging workflow** includes breakpoints, forward and
  backward history navigation, run-to-breakpoint, standard input and output streams,
  and a resizable workspace with independent text and canvas zoom. These make
  the tool useful for both guided demonstrations and self-directed debugging.
- **Source and session workflows** add multiple source tabs with an explicit
  entry source file, loading and saving C source files, restoring visualizer sessions,
  protected exercise regions, uploaded runtime data files, and a preprocessed
  source comparison. These support realistic exercises and future integration
  with A+ and Sphinx course material.
- **Accessibility and usability improvements** include light and dark themes,
  keyboard-operable resizing, live execution announcements, contextual help,
  and clearer execution-state controls. These make the visualizer easier to use
  in a wider range of learning settings.

The detailed implementation history and architectural rationale are recorded
in [UPGRADE_PLAN.md](UPGRADE_PLAN.md).

## Run locally

The application supports current Chrome, Firefox, Edge, and Safari releases,
including Firefox ESR. It must be served over HTTP because the interpreter uses
a Web Worker; opening the built page directly with a `file://` URL is not
supported.

Requirements:

- Node.js 24.15.0 (see `.tool-versions`)
- npm 11 (`package-lock.json` is committed)

Install and start the development server:

```sh
npm ci
npm start
```

Open `http://localhost:8080/`. The development page at
`http://localhost:8080/dev.html` mounts two isolated instances side by side.

## Build and verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The production build is written to `dist/`, including a generated third-party
license report.

### Debug the deployed host integration

In VS Code, run **c-visualizer: deployed host integration**. It builds the
three deployed scripts with source maps, starts a local server on port 8090,
and opens the host integration harness. The same workflow is available from a
terminal:

```sh
npm run debug:host-integration -- --port 8090
```

The harness exercises Build through a simulated A+ provider, diagnostics on
both source tabs, host Save and Update controls, direct diagnostics, and source
revision callbacks. Starting and stepping the sample follows its function call
from `main.c` into `helper.c` and switches the visible tab automatically.
Start and Run first syntax-check every supplied source file; either action is
refused when one fails, and the first failing tab opens with its diagnostic.
Use its two mode links to test both an existing
`window.CodeMirror` supplied by the host and c-visualizer's fallback loader.
The active instance is available as `window.debugVisualizer` and the last
saved value as `window.lastSavedSnapshot` in browser developer tools.

## Deploying into another page

`npm run build` produces a site. `npm run deploy` produces assets for somebody
else's site - a Sphinx `_static` directory, a Moodle block, any page whose
markup is generated by something other than this repository:

```sh
npm run deploy
```

```
dist/embed/c-visualizer.js           the small loader and the one <script src>
dist/embed/c-visualizer.app.js       the visualizer, loaded after CodeMirror is available
dist/embed/codemirror-fallback.js    CodeMirror modules for hosts that do not provide them
dist/embed/CPP14.<hash>.js           the interpreter, fetched when a program is first run
dist/embed/<worker>.<hash>.js        the interpreter's Worker
dist/embed/preprocessed.<hash>.js    the preprocessor dialog, fetched when it is first opened
dist/embed/licenses.html             what the footer links to
```

Copy the directory into the host's assets and include the one script. The
page writes the same configuration element the standalone page reads, and an
element for c-visualizer to mount into:

```html
<div id="c-visualizer-config" config='{"theme": "dark"}'></div>
<div id="c-visualizer"></div>
<script src="_static/c-visualizer/c-visualizer.js"></script>
```

`#root` is still mounted into where `#c-visualizer` is absent, so pages written
against the standalone page keep working.

The loader checks `window.CodeMirror` first. A host may provide compatible
`autocomplete`, `commands`, `language`, `state`, and `view` module namespaces;
PLIVET then constructs its own editor from those modules and does not download
`codemirror-fallback.js`. It does not expect the host to construct an editor.
Where those namespaces are absent, the loader fetches the bundled fallback.

The loader, application, and fallback have fixed names because the loader
addresses them directly. Lazy chunks carry a content hash and are addressed by
the application. Every asset is found relative to `c-visualizer.js`, so the
directory may live under `_static`, a CDN path, or a subdirectory without a
build-time public path. The script may go in the head, as Sphinx's
`add_js_file` writes it: mounting waits for the document.

A page with more than one visualization on it cannot say so with an id. The
loader publishes `window.CVisualizerReady`; it resolves to the class after all
required scripts are loaded, so the host builds the instances from there:

```html
<div class="c-visualizer-block"></div>
<div class="c-visualizer-block"></div>
<script
  data-c-visualizer-auto-mount="false"
  src="_static/c-visualizer/c-visualizer.js"
></script>
<script>
  CVisualizerReady.then((CVisualizer) => {
    document.querySelectorAll('.c-visualizer-block').forEach((element) => {
      new CVisualizer(element, { theme: 'light' });
    });
  });
</script>
```

`CVisualizer.instance` is the one mounted automatically, or `null` where the
page wrote no element for it; `CVisualizer.mount(document, options)`,
`CVisualizer.parseConfig(text)` and `CVisualizer.readConfig(document)` are the
same functions the entry itself uses.

`data-c-visualizer-auto-mount="false"` tells the loader that a managing script
will construct every instance itself. This avoids an empty automatic instance
while the host waits for `CVisualizerReady` and supplies callback options.

## Embedding API

The renamed API is exported alongside the legacy `Plivet` names, so existing
embedders do not break:

```ts
import { CVisualizer } from './src/index';

new CVisualizer(document.getElementById('root'), { theme: 'dark' });
```

The public `CVisualizer` and `CVisualizerOptions` exports are aliases of the
existing `Plivet` and `PlivetOptions` API.

### Configuring the standalone page

A page that only includes the bundle - a course page, a Moodle block, anything
that cannot run a line of JavaScript of its own - configures the same options
in markup. The standalone entry looks for an element with the id
`c-visualizer-config` and reads the JSON on its `config` attribute before it
builds anything:

```html
<div
  id="c-visualizer-config"
  config='{
    "theme": "dark",
    "features": { "preprocessor": false, "loadFile": false },
    "views": { "expression": false, "regions": { "registers": false } }
  }'
></div>
<div id="root"></div>
```

An element with no `config` attribute is read for its own text instead, so the
JSON may be written as the element's content where that is easier.

| Field             | What it says                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`           | `"light"` or `"dark"`. The switch in the control bar still changes it afterwards.                                                                                                                                          |
| `sourceCode`      | The program the editor opens with.                                                                                                                                                                                         |
| `files`           | `{ "path", "text" }` objects, drawn as tabs over the editor.                                                                                                                                                               |
| `entry`           | Which source file is placed first in the interpreter's combined input. Defaults to the first.                                                                                                                              |
| `editableRegions` | `{ "from", "to" }` offsets the reader may type in. Everything outside them is fixed.                                                                                                                                       |
| `features`        | `preprocessor` - the button showing the preprocessed source; `loadFile` - the upload panel of data files a program can `fopen`.                                                                                            |
| `support-build`   | Whether to construct the host-backed Build button. A programmatic host must also provide at least one `diagnosticProviders` callback; JSON cannot contain callbacks.                                                       |
| `licenses`        | Where the footer's third-party licence report is. The deployed bundle points at its own copy; a host that publishes one elsewhere names it here.                                                                           |
| `views`           | Which canvas sections start visible: `statement`, `callStack`, `expression`, `memory`, `mutations`, and `regions` for each implementation-memory region (`text`, `readOnly`, `data`, `bss`, `heap`, `stack`, `registers`). |

Everything is optional, and a feature or a view left out is on. The View panel
over the canvas still holds every switch, so `views` says where a reader
starts rather than what they are held to. A field written wrongly - a
misspelled theme, a string where a boolean belongs - is dropped with a console
warning and the rest of the configuration still applies, so one typo in a
course page cannot leave a reader with a blank pane.

### Host-managed build, diagnostics, and saving

Build is opt-in because c-visualizer has no compiler service. The managing
script supplies a registry of named callbacks. Each callback receives all
current files plus the entry file and revision, performs its A+ grader request,
and returns normalized diagnostics. PLIVET owns the CodeMirror view and paints
the findings on the matching source tabs:

```html
<div class="c-visualizer-managed"></div>
<button id="save-code">Save in host</button>
<script
  data-c-visualizer-auto-mount="false"
  src="_static/c-visualizer/c-visualizer.js"
></script>
<script>
  CVisualizerReady.then((CVisualizer) => {
    const visualizer = new CVisualizer(
      document.querySelector('.c-visualizer-managed'),
      {
        files: [{ path: 'main.c', text: 'int main(void) { return 0; }' }],
        entry: 'main.c',
        supportBuild: true,
        diagnosticProviders: {
          aplus: async (snapshot) => {
            const response = await fetch('/grader/compile', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(snapshot),
            });
            return response.json();
          },
        },
      }
    );

    document.querySelector('#save-code').addEventListener('click', () => {
      const snapshot = visualizer.sourceSnapshot();
      // Save snapshot.files, snapshot.entry, and snapshot.revision in the host.
    });
  });
</script>
```

Diagnostic positions are zero-based and their `to` position is exclusive. A
diagnostic has `{ path, severity, message, code?, from, to }`, where `path`
matches one submitted file. Results from an older revision are discarded
automatically. Providers may also be added later with
`registerDiagnosticProvider(name, callback)` and invoked through
`requestDiagnostics(name)`.

For host-side Save/Update controls, `sourceSnapshot()` returns every modified
file, `onSourcesChanged(callback)` subscribes to changes, and
`updateFiles(files, entry)` replaces the editor's complete source set. The
callbacks and provider registry belong to each visualizer instance, so two
blocks on one page remain independent.

During browser execution, all named source files are concatenated into one
interpreter input, with `entry` first; unicoen parses the resulting source as a
single translation unit. Step and step-back
locations are mapped to file-local lines, and the matching editor tab opens
automatically. This supports ordinary teaching examples whose functions are
split across files. It does not translate the files as separate translation
units or link object files, so separate-translation-unit
features such as duplicate file-local `static` names are not isolated.
