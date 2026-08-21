# c-visualizer

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js CI](https://github.com/yusein-ali/c-visualizer/actions/workflows/test.yml/badge.svg)](https://github.com/yusein-ali/c-visualizer/actions/workflows/test.yml)

`c-visualizer` is a browser-only C program visualizer and step debugger. Write
or open a C program, run it one statement at a time, and inspect the current
statement, call stack, variables, memory regions, arrays, and pointer
relationships. Parsing, execution, history, and visualization all remain in
the browser; the application has no backend.

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
  expression, call stack, registers, read-only and initialized data, BSS, heap,
  stack frames, and variable mutations. Collapsible sections, configurable
  views, and editor-to-canvas cross-highlighting help learners focus on the
  part of program state they are studying.
- **A more complete debugging workflow** includes breakpoints, forward and
  backward history navigation, run-to-breakpoint, standard input and output,
  and a resizable workspace with independent text and canvas zoom. These make
  the tool useful for both guided demonstrations and self-directed debugging.
- **Source and session workflows** add multiple source tabs with an explicit
  entry file, opening and saving C files, restoring visualizer sessions,
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

## Embedding API

The renamed API is exported alongside the legacy `Plivet` names, so existing
embedders do not break:

```ts
import { CVisualizer } from './src/index';

new CVisualizer(document.getElementById('root'), { theme: 'dark' });
```

The public `CVisualizer` and `CVisualizerOptions` exports are aliases of the
existing `Plivet` and `PlivetOptions` API.
