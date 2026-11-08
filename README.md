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
- **One place that says why a program will not run.** Every finding of both
  checkers - the parser that runs as the reader types, and the course's own
  compiler behind the Build button - is collected into a Diagnostic output
  table at the top of the canvas, with the severity, which checker found it,
  the file, the line and the message. A row is clickable and opens that place
  in the editor, including in a tab the reader is not looking at. While
  nothing is running the state views close and this table is what the canvas
  shows, because a refused Start is the moment a reader most needs to be told
  what is wrong. A status line across the top of the canvas - above the table
  and drawn whether or not anything has been found - says whether a checker is
  still working: local validation running or complete, a build started or
  complete, what the debugger is doing, or that nothing has happened for a
  while. It is what reports a build of a program nothing is wrong with.
- **Richer execution visualization** presents the current statement and
  expression, active function invocations, object writes, and an explicitly
  implementation-oriented memory model covering register-class objects,
  static storage, allocated storage, automatic storage, string literals, and
  function code. Collapsible sections, configurable views, and
  editor-to-canvas cross-highlighting help learners focus on the part of
  program state they are studying.
- **A standard library that refuses what C leaves undefined.** `<ctype.h>`,
  the bounded and searching `<string.h>` functions and the `mem*` family,
  `calloc`, the `strto*`/`ato*` conversions with `errno`, `div`, a seedable
  `rand`, `<time.h>`'s `time`/`clock`/`difftime`, `assert`, the `<limits.h>`
  and `<float.h>` constants, `true`/`false`, `size_t` with a `sizeof` that
  measures arrays and structures, `offsetof`, and the rest of `<math.h>` a
  course meets live in `src/interpreter/library/`. Every byte they store is
  drawn on the canvas and listed among the object writes; writing past the
  end of an array, reading a string with no terminator, `memcpy` between
  overlapping bytes and a null pointer argument stop the program on the line
  with a diagnostic. Widths follow the engine's data model, which is ILP32:
  `int`, `long`, pointers and `size_t` are four bytes, as `sizeof` reports.
  `realloc` grows the last block on the heap in place and otherwise moves the
  block, which the canvas and the object writes show; `qsort` and `bsearch`
  call the program's comparator as ordinary code, so stepping enters it and
  the array is seen being sorted; a function declared with `...` keeps its
  unnamed arguments in its frame as rows `...[0]`, `...[1]`, which a
  `va_list` points at one by one, and `vprintf` and its family format them.
- **C's arithmetic and C's literals.** Binary operators apply the integer
  promotions and the usual arithmetic conversions at the ILP32 widths
  (`-1 < 0u` is 0, `0u - 1` is 4294967295, `unsigned char` wraps when stored),
  with the same rules the expression tree draws its conversion nodes from;
  signed overflow wraps and is reported once per line as undefined behavior.
  Pointer arithmetic counts elements (`p + 1`, `p++`, `*(*(m + 1) + 2)`, and
  `q - p` as a `ptrdiff_t`), and a parameter declared `int a[]` is the pointer
  C makes it. A compound assignment evaluates its target and its right side
  once each, so `total += va_arg(ap, int)` reads one argument.
  `char *names[] = {"ann", "bob"}` is an array of pointers to the literals,
  and `malloc(n * sizeof(struct P))`, `calloc` and `realloc` hold n records,
  each drawn on the heap. The object writes spell an address as the canvas
  does.
  Escape sequences decode as C reads them, and one C does not define is a
  lint warning. A structure's array member is one object per element - drawn
  as an array, subscripted, and read and written by the string functions - and
  a bit-field keeps its width: a store wraps at it, `sizeof` packs it as gcc
  does, and the row reads `a : 3`. A typedef name declares a pointer inside a
  function (`Node *n = malloc(sizeof(Node));`) and can be cast to
  (`(myint)x`, `(ptrdiff_t)-2`). `assert` and a refusal name the file and line
  they happened on.
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
dist/embed/c-expression.js           the expression tree drawing alone, for a host's own trees
dist/embed/c-stdio.js                printf and scanf alone, for a host's format playground
dist/embed/c-stdio.parity.json       the printf parity table c-stdio.js is tested against
dist/embed/library.json              what a program may call and may not write, for a host's lint
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
`autocomplete`, `commands`, `highlight`, `language`, `state`, and `view` module
namespaces; PLIVET then constructs its own editor from those modules and does
not download `codemirror-fallback.js`. It does not expect the host to construct an editor.
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
      new CVisualizer(element, { theme: 'light', footer: false });
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

### The expression tree on its own: `c-expression.js`

`c-expression.js` draws an expression tree the way the canvas's Expression
expansion does - the same layout, boxes, conversion pills and colours - for
a page that builds its trees itself, such as an expression playground that
evaluates C expressions in the page. It is one script with no chunks, and it
contains JointJS and the drawing only: no worker, no interpreter, no
CodeMirror. Its API is on `window` as soon as it has run, and
`CExpressionTreeReady` resolves to the same object:

```html
<div id="tree"></div>
<script src="_static/c-visualizer/c-expression.js"></script>
<script>
  CExpressionTreeReady.then((CExpressionTree) => {
    // CExpressionTree.version === 2, the model version below.
    const tree = CExpressionTree.mount(document.getElementById('tree'), {
      theme: 'light', // or 'dark'
      fontSize: 13, // label size in px; the drawing scales with it
    });
    tree.render(model, { highlight: 'n3' });
    tree.render(model, { highlight: 'n1', dim: 'n5' }); // n5's subtree skipped
    tree.setTheme('dark');
    tree.setFontSize(16);
    tree.destroy();
  });
</script>
```

- `mount(element, options?)` appends a `div.plivet-expression-tree` to
  `element` and returns a handle. `options` may also carry `model`,
  `highlight`, `dim` and `label` (the drawing's accessible name) for the
  first render.
- `render(model, { highlight })` replaces the drawing. `model` is an
  `ExpressionModel` or its root node; `null` draws nothing. `highlight` is a
  node key or an array of keys to outline; omitted, nothing is outlined. The
  layout depends only on the tree's shape and texts, never on its values, so
  a host can reveal one evaluation step at a time by rendering the same tree
  with one more value filled in and the current node highlighted, and
  nothing moves.
- `render(model, { highlight, dim })`: `dim` is a node key or an array of
  keys whose whole subtrees are drawn dimmed (at 35% opacity), together with
  the links into them - the operand C never evaluates, such as the right of
  `&&` when the left was 0, the right of `||` when the left was not, or the
  arm of `?:` that was not chosen. Omitted, nothing is dimmed. Dimming moves
  nothing either, and a dimmed node can still be highlighted. Added without
  a version change: a host that passes no `dim` draws what it drew before.
- `setTheme('light' | 'dark')` switches the palette of this tree only; a host
  calls it when its own theme changes (for example `data-bs-theme`).
- `setFontSize(px)` scales the drawing so its labels are `px` pixels (13 is
  the canvas's own size, scale 1). The geometry stays the canvas's.
- `destroy()` removes the element and the paper.

The paper is sized to the tree; a tree wider than its container scrolls
inside the element. The drawing needs the element to be in the document
when `render` runs, as JointJS measures text to fit it.

#### The expression model, version 2

`EXPRESSION_MODEL_VERSION` in `src/core/model.ts` names this shape; it is
what the interpreter's trace produces for the canvas and what
`c-expression.js` draws. Version 2 added the `conversion` kind and `type`.

```ts
interface ExpressionModel {
  range: CodeRange; // where the expression is written; not drawn
  root: ExpressionNode;
}

interface ExpressionNode {
  key: string; // unique within the tree; what `highlight` names
  kind: 'operand' | 'operator' | 'assignment' | 'conversion';
  text: string; // the box's label: `x`, `2.0`, `+`, `(int)`, `f()`, `int → double`
  type?: string; // the C type of the node's result, e.g. `unsigned int`; optional
  range: CodeRange; // not drawn
  value: string | null; // what the node is worth; null until it has been evaluated
  parameter?: string; // on a call's argument, the parameter it initialises; not drawn
  children: ExpressionNode[];
}

interface CodeRange {
  begin: { x: number; y: number }; // y one-based line, x zero-based column
  end: { x: number; y: number };
}
```

- `operand`: a name or a constant, with no children. A box shows its
  `value` in a "Current value" strip unless the value equals the text, so a
  constant does not repeat itself.
- `operator`: any operator, a cast, a call, `?:`, `return`, `if`; its
  operands are its children, in source order, drawn below it.
- `assignment`: `=` and the compound assignments, and a declaration's
  initialiser; two children, the target and the value, drawn on one row as
  `target = value`.
- `conversion`: an implicit conversion - an integer promotion, one of the
  usual arithmetic conversions, or the conversion of an assigned value to
  the target's type. Exactly one child, the operand converted; `text` is
  `from → to` with the arrow U+2192 and `type` is `to`. It is drawn as a
  dashed pill on the edge between its parent and its operand, with its
  `value` (the converted value) under the types. A written cast is an
  `operator`, not a conversion.

The interpreter's trace emits conversions where both types are arithmetic
and known: the operands of the binary arithmetic, relational, equality and
bitwise operators and of `?:`'s arms after the usual arithmetic
conversions, the operands of unary `+`, `-`, `~` and the shifts after the
integer promotions, and the value of `=` and of an initialiser. One
conversion stands over an operand at most, from its type straight to the
type it is used as (`unsigned char → unsigned int`, not two steps); a host
building its own model may chain them, and they are drawn one under the
other. Call arguments and return values are not converted, since the
trace does not know the callee's parameter and return types, and neither is
anything of unknown type. Widths follow the engine: `long` and pointers are
four bytes.

### Formatting and scanning on their own: `c-stdio.js`

`c-stdio.js` is the interpreter's own `printf` formatter
(`src/interpreter/printf.ts`) and `scanf` matcher (`src/interpreter/scanf.ts`)
for a page that explains format strings without running programs, such as a
format playground. It is one small script with no interpreter, no worker and
no chunks, so what it prints is what a program in the visualizer prints. Its
API is on `window` as soon as it has run, and `CStdioReady` resolves to the
same object:

```html
<script src="_static/c-visualizer/c-stdio.js"></script>
<script>
  CStdioReady.then((CStdio) => {
    // CStdio.version === 1
    const result = CStdio.formatPrintf('%-6s|%5.2f|%#x', [
      { kind: 'string', value: 'pi' },
      { kind: 'double', value: 3.14159 },
      { kind: 'unsigned', value: 255 },
    ]);
    result.text; // 'pi    | 3.14|0xff'
    const [directive] = CStdio.parseFormat('%5.2f').filter(
      (segment) => segment.kind === 'directive'
    );
    CStdio.explainDirective(directive);
    // '%5.2f prints a floating-point number in fixed-point notation ...'
    CStdio.scanAll('%d %s', '42 apples and pears');
    // { values: [{kind: 'int', value: 42, counted: true},
    //            {kind: 'string', text: 'apples', counted: true}],
    //   rest: ' and pears', failure: null, returns: 2 }
  });
</script>
```

- `version` is `STDIO_API_VERSION` (`src/stdio.ts`), which changes only when
  a field below changes meaning. Adding one keeps it: `argumentSlots` and
  `parseScanFormat` were added to version 1, so a host that needs them
  checks that they are there.
- `parseFormat(format)` returns the format as segments in order: literal runs
  `{kind: 'literal', text, start, end}` and directives `{kind: 'directive',
source, start, end, flags: {minus, plus, space, zero, hash}, width,
precision, length, conversion, problem?}`. `start` and `end` are offsets
  into the format. `width` and `precision` are a number, `'*'` (taken from
  the next `int` argument) or `null`; `length` is one of `'' hh h l ll j z t
L`; `conversion` is the conversion character, or `''` when the format ends
  inside the directive. `%%` is a directive that takes no argument. A
  directive that cannot be carried out as written carries `problem`, a
  diagnostic (below): an unknown conversion or a truncated directive is an
  `error`, a length modifier that does not apply (`%hf`) a `warning`.
- `formatPrintf(format, args, {caller?})` formats `args`, each
  `{kind, value, bits?}` with `kind` one of `int unsigned double char string
pointer`. `value` is a number, or a string: the characters for `string`, a
  character or a code for `char`, an integer too large for a JavaScript
  number (`'18446744073709551615'`, `'0xff'`), or `'inf'`, `'-inf'`, `'nan'`
  for `double`. `bits` is the width of the argument's own type when known;
  it is only used to warn that a conversion reads a different width. The
  result is `{text, directives, diagnostics, unusedArguments}`; each entry
  of `directives` is `{directive, argument, widthArgument,
precisionArgument, offset, text, diagnostic}` - the indices of the
  arguments it consumed, where its text starts in `text` (for `%n`, the
  count it would store), what it produced, and what went wrong.
- `explainDirective(directive)` is the directive in plain English: what it
  prints, the type of argument it reads, and what the flags, width,
  precision and length modifier do.
- `scanAll(format, input)` matches `format` against `input` the way `sscanf`
  does: the input is all there is. It returns `{values, rest, failure,
returns}`: the values the conversions would store, in argument order
  (`{kind: 'int' | 'float', value}` or `{kind: 'char' | 'string', text}`,
  each with `counted`, false for `%n`); the input left over; the first
  directive that failed as `{directive, found, suppressed, endOfInput?}`,
  or `null`; and what `sscanf` would return - the number of assignments, or
  -1 (`EOF`) when the input ends before the first conversion.
- `argumentSlots(directive)` takes a directive of `parseFormat` and returns
  the arguments it consumes, in the order it consumes them: `'width'` for a
  `*` width, `'precision'` for a `*` precision, then `'value'` (`%%` has no
  value, and a directive with an `error` problem consumes nothing). Counted
  across a format's directives in order, they are the argument indices
  `formatPrintf` reports as `widthArgument`, `precisionArgument` and
  `argument`: `%*.*f` takes arguments 0, 1 and 2.
- `parseScanFormat(format)` splits a `scanf` format exactly where the scan
  splits it, each directive with `start` and `end` offsets into the format
  and `source`, the text between them: `{kind: 'space'}` for a run of
  whitespace, `{kind: 'literal'}` for ordinary characters (consecutive ones
  together), `{kind: 'conversion', suppress, width, length, spec, scanset}`
  (`width` a number or `null`, `length` as written, `spec` the conversion
  character with `%` and `[` included, `scanset` `{negated, members,
closed}` for `%[` or `null`), and `{kind: 'invalid', written, spec}` for a
  `%` that starts no conversion - the scan matches it as an ordinary `%`;
  `written` is the directive as far as it goes and `spec` the offending
  character, `''` at the end of the format. A `failure.directive` of
  `scanAll` is the `source` of one of these.

A diagnostic is `{rule, severity: 'error' | 'warning', message}`. The rules
are `unknown-conversion`, `missing-argument`, `argument-mismatch`,
`invalid-length-modifier` and `field-too-wide`. A directive with an error
writes nothing and the rest of the format is still formatted; a warning is
formatted anyway.

What the formatter prints follows C on glibc (x86-64, LP64): length
modifiers wrap at their width (`%hhu` of 300 is `44`, `%lu` of -1 is
`18446744073709551615`), `%p` is `0x` and lowercase hexadecimal with a null
pointer as `(nil)`, `%a` prints as many hexadecimal digits as the value
needs, and rounding is to nearest with ties to even on the exact binary
value (`%.2f` of 2.675 is `2.67`, `%.0f` of 2.5 is `2`). One departure: a NaN
prints as `nan` whatever its sign bit.

`c-stdio.parity.json` is `test/fixtures/stdio-parity.json`:
`{version, about, cases}`, each case `{format, args, expected,
diagnostics?, engine?, why?}`. The same table is run through
`formatPrintf`, through the built `c-stdio.js` in a `vm` context, and through
the interpreter's own `printf` (except the cases marked `engine: false`,
which a program in this interpreter cannot spell), so a playground's tests
can read the same expectations.

### What a program may use: `library.json`

`library.json` lists what a C program in the visualizer may use - the
library's functions, macros, objects and types - and the constructs the
interpreter refuses to run. It is for a host that never runs the
interpreter: the course build's lint (course-lint rules 8 and 9 of the
Sphinx extensions, `course_lint_visualizer_manifest`) allows a visualized
block to call only what the manifest lists, besides the functions its own
files define, and to contain none of the refused constructs. A bundle
rebuild is what moves a new library function from "exists in the
visualizer" to "allowed in a visualized block".

It is generated by `npm run deploy` and `npm run deploy:debug` and never
edited: `src/app/libraryManifest.ts` writes it from the library table
(`src/app/libraryHelp.ts`, which completion and hover help read too) and the
refused-construct list (`src/interpreter/refused.ts`). A test runs the engine
and fails, naming the name, when the engine registers something the table
leaves out or the table lists something nothing registers.

```json
{
  "version": 1,
  "functions": [
    {
      "name": "printf",
      "header": "stdio.h",
      "signature": "int printf(const char* format, ...)"
    }
  ],
  "macros": [
    {
      "name": "EOF",
      "header": "stdio.h",
      "signature": "#define EOF (-1)",
      "functionLike": false
    },
    {
      "name": "assert",
      "header": "assert.h",
      "signature": "void assert(scalar expression)",
      "functionLike": true
    }
  ],
  "objects": [
    { "name": "stdin", "header": "stdio.h", "signature": "FILE* stdin" }
  ],
  "types": [
    {
      "name": "size_t",
      "header": "stddef.h",
      "signature": "typedef unsigned long size_t"
    }
  ],
  "refused": [
    {
      "id": "goto",
      "construct": "goto",
      "pattern": "\\bgoto\\b",
      "message": "'goto' cannot be stepped"
    }
  ]
}
```

- `functions`, `macros`, `objects` and `types` each hold `{name, header,
signature}`; a macro also says whether it is `functionLike` - written as a
  call, `assert(x)`, `offsetof(t, m)`, `va_arg(ap, int)`, `isnan(x)` -
  against an object-like one such as `EOF` or `INT_MAX`. A function-like
  macro is called like a function, so a lint that checks calls reads
  `functions` and the function-like `macros` together. `sizeof` is an
  operator and is not listed.
- `refused` holds `{id, construct, pattern, message}` per construct (see
  [Limits](#limits)): `pattern` is a regular expression valid in JavaScript
  and in Python alike - no lookbehind, no named groups, no flags or inline
  modifiers - to be searched for in source whose comments, string literals
  and character constants have been blanked; `message` is what the editor
  says when it refuses the program.
- Every list is sorted by name (`refused` by `id`) in code-point order, so a
  rebuild that adds nothing writes the same file byte for byte.
- `version` (`LIBRARY_MANIFEST_VERSION`) changes only when a field changes
  meaning or goes away. New entries, new lists and new fields keep it, so a
  consumer reads the fields it knows and ignores the rest.

## Embedding API

The renamed API is exported alongside the legacy `Plivet` names, so existing
embedders do not break:

```ts
import { CVisualizer } from './src/index';

new CVisualizer(document.getElementById('root'), { theme: 'dark' });
```

The public `CVisualizer` and `CVisualizerOptions` exports are aliases of the
existing `Plivet` and `PlivetOptions` API.

Source loading and runtime data-file loading are separate features.
`features.loadSource` enables the toolbar Load action and defaults to `false`;
`features.loadFile` controls the data-file panel used by programs calling
`fopen` and defaults to `true`.

The program's arguments: `args` is an array of strings, or one string split
as a POSIX shell (and Python's `shlex.split`) splits a command line -
whitespace separates, `'...'` and `"..."` quote, a backslash escapes, and a
quote left open closes at the end. `int main(int argc, char *argv[])` and
`int main(int argc, char **argv)` receive them: `argv[0]` is the entry file's
name without its directory and `.c` (`main` for `main.c`), `argv[argc]` is a
null pointer, and the strings and the array of pointers are objects of static
storage, drawn in the data segment as `_argv` (a `char*[argc + 1]`) and
`_argv_0`, `_argv_1`, ... (one `char` array per argument), which the program
may read and write as C allows. A `main` declared without parameters ignores
them. `features.programArgs` (off by default) puts a field holding them in the
control bar; what the reader types there applies at the next Start or Run,
never to a run under way. For a host that drives the interpreter itself,
`Request.args` carries `argv[1]` onwards with `Start` and `Exec`.

The program's streams: `stdin` is the console's input field, a line per
Enter. Ctrl+D in the field, or the EOF button beside it while a read waits,
ends the input: the waiting read returns `EOF` (`fgets` and `gets` a null
pointer), and a later read waits for new input. What the program writes to
`stderr` (`fprintf(stderr, …)`, `perror`) is shown in the console in an error
colour, `--plivet-console-error-color`. Files are the uploaded ones plus the
ones the program creates; writes reach a file at `fflush`, `fclose` or the end
of the program, and the panel lists what the program created, renamed or
removed, ready to download. For a host that drives the interpreter itself,
`Request.endOfInput` ends standard input for the waiting read (with
`stdinText`, when given, read first and without a newline), and
`Response.errorSpans` lists the `{start, end}` offsets of `output` that came
from `stderr`.

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
    "features": {
      "preprocessor": false,
      "loadSource": true,
      "loadFile": false
    },
    "views": { "expression": false, "regions": { "registers": false } }
  }'
></div>
<div id="root"></div>
```

An element with no `config` attribute is read for its own text instead, so the
JSON may be written as the element's content where that is easier.

With no source configuration, the standalone visualizer opens the S9 construct
tour as three tabs: `main.c`, `tour.h`, and `tour.c`. It pauses for one integer
through `scanf`, then writes and reads `c-visualizer.txt` in the browser-side
virtual file system.

| Field             | What it says                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`           | `"light"` or `"dark"`. The switch in the control bar still changes it afterwards.                                                                                                                                                                                     |
| `sourceCode`      | The program the editor opens with.                                                                                                                                                                                                                                    |
| `files`           | `{ "path", "text" }` objects, drawn as tabs over the editor.                                                                                                                                                                                                          |
| `entry`           | Which source file opens as the runnable entry. Headers are composed before it, followed by the remaining implementation files. Defaults to the first.                                                                                                                 |
| `args`            | The program's arguments, `argv[1]` onwards: an array of strings, or one string written as a command line (`"input.txt \"two words\""`). See [Embedding API](#embedding-api).                                                                                          |
| `editableRegions` | What the reader may type in; everything outside it is fixed. Either `{ "from", "to" }` offsets into the entry file, or 1-based inclusive line ranges per file, `{ "main.c": [[7, 12], [20, 20]] }`. See [Protected text](#protected-text-sessions-and-appearance).    |
| `session`         | A version 1 or 2 session to open with, applied after `files`. See [Sessions](#sessions).                                                                                                                                                                              |
| `controls`        | Control-bar items a host drives itself: `{ "theme": false, "textSize": false }` leaves the theme switch and the text-size buttons out of the bar.                                                                                                                     |
| `layout`          | `"auto"` (default) stacks the editor, console and canvas into one column while the visualizer is narrower than `stackedBelow`; `"columns"` and `"stacked"` hold one arrangement. See [Layout](#layout).                                                               |
| `stackedBelow`    | The width in pixels, of the visualizer itself rather than the window, below which `"auto"` stacks. Defaults to `720`.                                                                                                                                                 |
| `features`        | `preprocessor` shows preprocessed source; `loadSource` enables loading source/session files (off by default); `loadFile` controls the independent runtime data-file panel used by `fopen` (on by default); `programArgs` shows the program-arguments field (off).     |
| `footer`          | Whether to show the copyright and licence footer. Defaults to `true`; set it to `false` for an embedding that provides this information elsewhere.                                                                                                                    |
| `support-build`   | Whether to construct the host-backed Build button. A programmatic host must also provide at least one `diagnosticProviders` callback; JSON cannot contain callbacks.                                                                                                  |
| `licenses`        | Where the footer's third-party licence report is. The deployed bundle points at its own copy; a host that publishes one elsewhere names it here.                                                                                                                      |
| `codeMirror`      | How the editor itself is built: `indent_unit`, `indent_with_tabs`, `electric_chars`, `match_brackets`, `line_numbers`, `autocomplete`, `font_size`, `light_theme`, `dark_theme`. A host that has editors of its own hands over the configuration it built those with. |
| `views`           | Which canvas sections start visible: `diagnostics`, `statement`, `callStack`, `expression`, `variables`, `memory`, `mutations`, and `regions` for each implementation-memory region (`text`, `readOnly`, `data`, `bss`, `heap`, `stack`, `registers`).                |

`codeMirror` is the one field written for a host that already has editors on
the page. A course chapter holds a block's editors and the window this opens
beside each other, and a reader moves between them mid-exercise; handing over
the settings those editors were built with is what keeps one of them from
indenting with tabs while the other indents with two spaces. Both spellings of
every setting are read - the `codemirror_config` keys of a Sphinx course's
`conf.py` and the camelCase names the editor takes - and so is a setting
written as the text of what it says, because that is how a page generator
usually fills in the ones its author left out. A key that is neither, such as
the `language_configs` of a page with editors in several languages, is ignored
in silence rather than warned about: what arrives is a page's whole
configuration, and most of it was never about this editor. The configuration
may also be written under the `codemirror` or `codemirror_config` key it has on
the page it came from. `light_theme` and `dark_theme` are the serializable
names `default` and `one-dark`. Both the host editor and c-visualizer resolve
those names locally, which keeps their syntax palette consistent without
putting CodeMirror extension objects into course JSON.

Everything is optional, and a feature or a view left out is on. The View panel
over the canvas still holds every switch, so `views` says where a reader
starts rather than what they are held to. A field written wrongly - a
misspelled theme, a string where a boolean belongs - is dropped with a console
warning and the rest of the configuration still applies, so one typo in a
course page cannot leave a reader with a blank pane.

#### Every option in one file

[`visualizer.reference.json`](./visualizer.reference.json) is the table above
written as a configuration: every key the parser reads, in one object. Each
preference carries the value it has when nobody sets it - `theme` light,
`loadSource` and `programArgs` off, `loadFile` and `preprocessor` on, `footer`
on, no `args`, every view and every memory region visible - so a host that would rather delete the lines it
does not want than assemble the ones it does starts from that file. It is also
the list to check a configuration against when a setting appears to be ignored:
a key that is not there is a key nothing reads, whatever it was meant to say.

The rest of the file describes a program and a host rather than a preference,
and is there to be replaced or removed rather than kept. `sourceCode`, `files`,
`entry` and `editableRegions` hold a one-line `main.c` and an editable span the
length of it, so a page that replaces the program but keeps the offsets locks
the reader out of everything past the twenty-eighth character of it. `session`
is a version 2 session for that `main.c`, with the same text, that sets
nothing but the cursor, and `controls` lists the two items a host may take off
the bar, both kept. `layout` and `stackedBelow` are the defaults, `auto` at
720 pixels. `licenses`
and `support-build` are the answers this repository's own deployment gives; a
host that publishes no licence report, or that has no compiler behind Build,
says something else. `codeMirror` is a filled-in example of the shape rather
than a default - the editor left alone indents by two, not by the four written
there - because the point of the field is that a host hands over the settings
its own editors were built with.

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
`updateFiles(files, entry)` replaces the editor's complete source set. A popup
or other independently closing visualizer can pass `onWindowClose(snapshot)`
to synchronously receive its final source during the window's `pagehide`
lifecycle. An embedding page can keep an open instance aligned with its own
appearance by calling `setTheme('light')` or `setTheme('dark')` when the host
theme changes. The callbacks and provider registry belong to each visualizer
instance, so two blocks on one page remain independent.

### Protected text, sessions and appearance

#### Protected text

`editableRegions` turns a program into an exercise: the reader types in the
editable ranges and nothing else. It takes two forms.

- `[{ "from": 4, "to": 8 }]` - offsets into the entry file, as before.
- `{ "main.c": [[7, 12], [20, 20]], "util.c": [[3, 3]] }` - 1-based inclusive
  line ranges per file, the syntax of the Sphinx `:editable-lines:` option. A
  file's entry may also be `{ "lines": [[7, 12]], "text": "..." }`, where
  `text` is the default source the lines count: the file's own text is then
  checked against it, and "Restore default" puts it back. Without `text`, the
  lines count the file's text as it is handed over.

At load, each file's _protected segments_ are cut from its text: the text
between the editable ranges. Cut by lines, a segment runs from the line break
before its first line to the line break after its last, exactly as the Sphinx
build's `protected_segments`, so the course editor and the visualizer accept
and refuse the same text. A range past the last line, or ranges that leave
nothing protected, are dropped with a console warning and leave that file
editable. Protected lines are shaded and carry a lock in the gutter.

The load policy: whenever a file's text is replaced wholesale -
`updateFiles`, `restoreSession`, the `session` option, the Load control, a host
writing back - the segments are found again by their exact text, in order (a
segment that opens or closes the file must still open or close it), and the
editable ranges become the gaps between them. A replacement in which a segment
cannot be found is refused: the editor keeps its text, a notice over the editor
names the first altered line (`Line 7 of main.c is protected, ...`) and offers
**Restore default**, `updateFiles` and `restoreSession` return `false`, and the
`onLoadRefused` callback receives `{ path, line, origin }`, where `line` is the
1-based line of the refused text where the segment stops matching and `origin`
is `"updateFiles"`, `"restoreSession"`, `"session"`, `"load"` or `"files"`.
`"files"` reports a file handed over with its protected text already changed
against a `{ lines, text }` default: that file opens locked, wholly read-only,
until it is restored or an intact text replaces it. `features.loadSource`
stays off by default; when it is on, a loaded file or session follows the same
rule.

`sourceSnapshot().files[i].protected` is present for every protected file and
lists `{ text, from, to }` per segment, offsets into that file's current text
(`to` exclusive; `-1` for a segment a locked file has lost), so a host can
check a submission keeps them without cutting them again.

#### Sessions

`session()` returns a version 2 session: every file with its text, cursor,
breakpoints (disabled ones too) and pinned watches, plus the entry and the file
on screen.

```json
{
  "version": 2,
  "files": [
    {
      "path": "main.c",
      "text": "...",
      "selection": { "anchor": 42, "head": 42 },
      "breakpoints": [6],
      "disabledBreakpoints": [9],
      "watches": [{ "name": "total", "pos": 57 }]
    }
  ],
  "entry": "main.c",
  "active": "main.c"
}
```

Rows are zero-based and positions are offsets. `restoreSession(value)` reads
version 1 (one document, applied to the file on screen) and version 2. In a
version 2 session only `path` is required per file: a host that leaves out
`text` keeps the file's own text and gets the marks applied to it. Files the
session names that are not open are ignored. A text is applied only where it
keeps the file's protected segments; through `restoreSession` a session with
one refused text changes nothing and returns `false`. The `session` option
does the same after `files` while the instance opens, except that a refused
file keeps the text it was given and the rest of the session still applies.
Positions that no longer fit the final text - a cursor past the end, a row past
the last line, a watch whose name is no longer at its offset - are dropped.

#### Appearance

`setTheme(theme)`, `getTheme()` and `onThemeChange(listener)` (returning an
`Unsubscribe`) let a host keep the visualizer in step with its page; the
listener is called for a change from the control bar's switch and from
`setTheme`, and not for a `setTheme` that changes nothing. `setFontSize(px)`
sets the editor's text size (and what the Reset button returns to), returning
`false` for a size that is not a positive number; `getFontSize()` reads it.
`controls: { theme: false, textSize: false }` leaves the switch and the
text-size buttons out of the bar - absent from the DOM, not disabled - for a
host that drives them itself.

#### Layout

The visualizer lays itself out against its own width, which is its
container's, not against the window's: a course chapter's column on a wide
screen is as narrow as a phone. With `layout: "auto"` (the default) it is two
columns - the editor and the console beside the canvas - while it is at least
`stackedBelow` pixels wide (default 720), and one column below that: the
editor, the console under it, the canvas under that. Going back to two columns
takes 48 pixels more than the threshold, so a width that sits on it does not
switch back and forth. `layout: "columns"` and `layout: "stacked"` hold one
arrangement at every width. The root element carries `plivet--stacked` while
it is stacked, for a host's own CSS.

Switching moves nothing: the boxes keep their order and their contents, so the
editor keeps its scroll position and folds, the canvas its drawing and folds,
and a debug session carries on. The floating debug toolbar goes back to its
place over the editor. `getLayout()` returns `"columns"` or `"stacked"`, and
`onLayoutChange(listener)` (returning an `Unsubscribe`) is called after each
change - not for the arrangement the instance opens with.

Stacked, the handle between the columns is gone, and the canvas has a shape
rather than a height: `--plivet-canvas-ratio`, width over height, default
`4 / 3`. The handle under the canvas resizes it to a new shape, so it keeps
its proportions as the width changes; a host may set the property on a
container. `--plivet-graph-height`, the host's or a drag's, applies to the
two-column canvas and comes back with it; `--plivet-editor-height`,
`--plivet-console-max-height` and `--plivet-breakpoints-max-height` apply in
both arrangements. In two columns the editor column opens at half a narrow
visualizer, 400 pixels of a middling one and a third of a wide one.

Because the visualizer measures its own box, a host should give it a width:
a block-level container, or `width: 100%`. In a container sized to its
content (an `inline-block`, a float, a flex item without a width), one column
is narrower content than two, and a visualizer that stacked there can hold
its container narrow and stay stacked.

During browser execution, all named source files are concatenated into one
interpreter input: headers first, then `entry`, then the remaining
implementations. unicoen parses the result as a single translation unit. Step
and step-back locations are mapped to file-local lines, and the matching editor
tab opens automatically. This supports ordinary teaching examples whose
functions are split across files. It does not translate the files as separate
translation units or link object files, so separate-translation-unit features
such as duplicate file-local `static` names are not isolated.

## Limits

Some valid C cannot be stepped by the interpreter underneath, and rather than
stop at it in silence or run on to a wrong answer, the visualizer refuses the
program with a diagnostic on the line. The constructs it refuses are one list,
[`REFUSED_CONSTRUCTS` in `src/interpreter/refused.ts`](src/interpreter/refused.ts),
which the editor's messages come from and which the deploy writes into
[`library.json`](#what-a-program-may-use-libraryjson) for a course's lint:

| `id`                 | Construct | What the editor says                                                        |
| -------------------- | --------- | --------------------------------------------------------------------------- |
| `goto`               | `goto`    | `'goto' cannot be stepped`                                                  |
| `label`              | `label:`  | `a labelled statement cannot be stepped, so this program cannot use 'goto'` |
| `shift-right-assign` | `>>=`     | `'>>=' cannot be stepped; write it as 'x = x >> n'`                         |

They are kept as limits rather than implemented. `<<=` is not on the list: it
runs correctly - on plain variables, through pointers, on members, in a `for`
step and as a value - and the tests hold it to that; only `>>=` loses its
operator in the grammar. A pattern in the list may also find text the
interpreter would accept (a conditional expression broken after its `?` with
a name and the `:` on a line of their own reads as a label), but it never
misses a construct the interpreter refuses.

The other limits are described where they apply: the data model is ILP32
(`int`, `long`, pointers and `size_t` are four bytes, `long long` is held in
a `long`), files are composed into one translation unit (above), and the
library is what `library.json` lists.
