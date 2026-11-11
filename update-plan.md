# Update plan: c-visualizer

Part of the ELEC-A7100 redesign. This plan lists the c-visualizer work that
the c-visualizer table of `05-required-features.md` calls for, plus the host
features the Sphinx extensions plan (`_sphinx_extensions/update-plan.md`)
needs from this repository. It is written against `master` at 7fc11cb
(2026-11-07). `stdlib-missing-implementations.md` is the inventory it starts
from; where the two disagree, this plan is newer.

Packages:

- `V` versioned contract with the host repository.
- `L` library and language: what a C program can call or write.
- `H` host integration: what a page embedding the visualizer can ask of it.

The Sphinx plan refers to packages by these ids: V0, L1, L9, L16 and H1 to
H7. The other numbers are this plan's own.

Every package ends with `npm run lint`, `npm run typecheck` and `npm test`
passing, and its functions listed in `src/app/libraryHelp.ts` (completion and
hover help), which V0 turns into the manifest.

## Todo

Phase 1:

- [x] L1 Own `printf` formatter; the argument-conversion defects and `%n`.
- [x] L2 `size_t`, `ptrdiff_t` and `<stddef.h>`.
- [x] L3 `<ctype.h>` in full.
- [x] L4 `<string.h>` and `<stdlib.h>` functions of the 5.7, 6.5 and 6.7 pages.
- [x] L5 `realloc` with a visible move of the block.
- [x] L6 `sprintf`, `snprintf`, `sscanf`.
- [x] L17 Bit-fields in the memory view: check, and fix or refuse.
- [x] V0 `library.json` written by the deploy.
- [x] L9 The documented limits as a refused-construct list.
- [x] H6 `c-stdio.js`: the formatter and the scanner without the interpreter.
- [x] H7 `c-expression.js`: the expression tree renderer with conversion nodes.

Phase 2:

- [x] L7 `EOF`; `stdin`, `stdout`, `stderr` as real objects; end of input.
- [x] L8 Stream output, block I/O, positioning and file operations.
- [x] L10 `srand`, `RAND_MAX`, `time`, `clock`, `assert`; `rand` fixed.
- [x] L11 `errno`, `strerror`, `EXIT_SUCCESS`, `EXIT_FAILURE`.
- [x] L12 `qsort`, `bsearch`.
- [x] L13 `<limits.h>` and `<float.h>` constants; `true` and `false`.
- [x] L14 `<stdarg.h>` and the `v*printf` family.
- [x] L16 Program arguments.
- [x] H1 Whole-program session: export, restore, `session` option.
- [x] H2 Per-file editable regions anchored by text; `protected` in snapshots.
- [x] H3 `setFontSize`, `getTheme`, `onThemeChange`, hideable controls.
- [x] H4 Layout against the container; stacked mode.
- [x] H5 Load policy.

Phase 3:

- [x] L15 `atan2`, `log2`, `NAN`, `INFINITY` and the rest of `<math.h>` a
      course meets; `scanf` `%p`; hover help for every math function.

Suggested order: L1 first, because every formatted-output package builds on
it; L11 and L7 before L8; L2, L3, L4, L13 and L10 in any order; L5 after its
decision; L12 and L14 after the engine work above; V0 and L9 last among the
library packages, so the first manifest is complete. H7 and H1 to H5 are
independent of the library work; H6 needs L1.

## V: the contract

### V0 `library.json` written by the deploy

Today: nothing outside this repository can ask which functions a program may
call. `libraryHelp.ts` documents them for the editor; the engine registers
them with `setTop`; the two are kept in step by hand.

Change:

- One table is the source of truth for the callable set: name, header,
  signature, one-line description and kind (`function`, `macro`, `object`,
  `type`). `libraryHelp.ts` reads it for completion and hover help.
- A test starts the real engine, lists every name registered into its global
  scope, and fails when a registered name is missing from the table or a
  table entry has no registration. The failure names the function.
- `npm run deploy` (and `deploy:debug`) writes `library.json` beside the
  loader in the embed directory, generated from the table and from the L9
  refused-construct list, never edited by hand:

  ```json
  {
    "version": 1,
    "functions": [{"name": "printf", "header": "stdio.h", "signature": "..."}],
    "macros": [{"name": "EOF", "header": "stdio.h"}],
    "objects": [{"name": "stdin", "header": "stdio.h"}],
    "types": [{"name": "size_t", "header": "stddef.h"}],
    "refused": [{"construct": "goto", "pattern": "\\bgoto\\b", "message": "..."}]
  }
  ```

  `version` changes only when a field changes meaning. Lists are sorted by
  name so a rebuild that adds nothing produces the same file.
- README: the manifest's shape and its consumer (course-lint rules 8 and 9).

Tests: the registration parity test; a test of the generator's output shape
and ordering.

Decided during implementation: the table stays in `src/app/libraryHelp.ts`
(every entry now has a header; `kind` gains `operator` for `sizeof`, which
the engine registers but the manifest leaves out, and `functionLike` marks
`assert`, `offsetof`, the `va_*` macros and `isnan`, `isinf`, `isfinite`,
`signbit`); `NULL` and `FILE` were added because the engine has them. The
generator is `src/app/libraryManifest.ts`, run at deploy time by
`scripts/library-manifest.js` and emitted as a webpack asset by the loader's
compiler. Entries are `{name, header, signature}`, macros add
`functionLike`, refused entries are `{id, construct, pattern, message}`.

## L: library and language

Shared rules for every L package:

- A library function is registered in `src/interpreter/CPP14Engine.ts` (or a
  module under `src/interpreter/library/` that it calls), never by editing
  `node_modules/unicoen.ts`, which is frozen.
- Memory writes go through the engine's scope so the canvas, the mutation
  view and the uninitialised-read checks see them. A function that writes
  bytes the canvas draws (the `mem*` and `str*` families, `calloc`,
  `realloc`) is checked on the canvas in a browser before it is ticked.
- A misuse C leaves undefined (overlapping `strcpy`, `memcpy` past a block,
  `free` of a pointer not from the allocator) raises a runtime diagnostic in
  the existing `RuntimeDiagnostic` style rather than producing a quiet wrong
  answer.
- `TeachingLint` rows for the new functions' format strings and argument
  types are added where the lint has a rule for that kind of call.

### L1 Own `printf` formatter

Today: `printf` is upstream's wrapper around the `agh.sprintf` package. Four
defects (`stdlib-missing-implementations.md`): `%n` stores nothing; `%p` on a
`char *` prints the string; an integer equal to the address of a live `char`
object prints as a string; an unknown conversion prints
`(sprintf:error:%q)` into the program's output.

Change:

- `src/interpreter/printf.ts`, pure TypeScript with no engine import:
  `parseFormat(format)` returns the literal runs and the directives (flags,
  width, precision, `*` for either, length modifier, conversion, source
  offsets); `formatPrintf(format, args)` takes arguments already typed
  (`{kind: 'int' | 'unsigned' | 'double' | 'char' | 'string' | 'pointer',
  value, bits}`) and returns the text plus, per directive, the argument it
  consumed, the text it produced and any diagnostic. Covers `d i u o x X e E
  f F g G a A c s p n %`, flags `- + space 0 #`, width, precision, `*`, and
  the length modifiers `hh h l ll j z t L` with C's wrap at each width.
  `explainDirective(directive)` returns the plain-English reading the format
  playground shows.
- The engine's `printf` converts each argument by the conversion that
  consumes it, not by its value: only `%s` reads a `char` array, `%p` prints
  the address, `%n` stores the count so far through the pointer with the
  width its modifier names. An unknown conversion or a missing argument is a
  runtime diagnostic, and nothing is written for it.
- `agh.sprintf` is no longer reached; the dependency is removed if nothing
  else uses it.

Tests: a parity table (`test/fixtures/stdio-parity.json`) of format,
arguments and expected text, run through `formatPrintf` and through the
interpreter's `printf`; one test per defect.

### L2 `size_t`, `ptrdiff_t` and `<stddef.h>`

`size_t n;`, `size_t i = 0;` in a `for`, parameters and return types of
`size_t`, `ptrdiff_t`, and `offsetof(type, member)`. `size_t` is an unsigned
type of pointer width, drawn with its name on the canvas. `sizeof` yields it.
`%zu` and `%td` format it (L1).

Decided during implementation: the engine's data model is ILP32 (`int`,
`long` and pointers are 4 bytes; `long long` is reduced to `long`), not LP64
as this plan first assumed. `size_t` is therefore 4 bytes, and every package
follows the engine. Moving to LP64 is one constant in
`src/interpreter/library/types.ts` plus the engine's own widths, and is not
planned.

Changed after the plan (2026-11-08): `long long` is no longer reduced to
`long`. `DeclarationSpecifiers` writes it as one engine word
(`ENGINE_LONG_LONG` in `ExpressionTypes.ts`), `basicSizeof` - installed as
the engine's `sizeof` - gives it eight bytes, and values wrap at 64 bits, as
on a 32-bit x86 or ARM target. Values are JavaScript numbers, exact up to
2^53; `exactInteger` reads 2^63 and 2^64 back as `LLONG_MAX` and
`ULLONG_MAX`. A `long` now wraps at its own four bytes.

### L3 `<ctype.h>` in full

`isalpha isdigit isalnum isspace isupper islower ispunct isprint isgraph
iscntrl isxdigit isblank toupper tolower`, on the "C" locale, accepting
`EOF` and every `unsigned char` value; a negative argument other than `EOF`
is a runtime diagnostic, as C leaves it undefined.

### L4 `<string.h>` and `<stdlib.h>` functions

`strncpy strncat strncmp strchr strrchr strstr strtok strspn strcspn strpbrk
memcpy memmove memset memcmp memchr` and `calloc strtol strtoul strtoll
strtoull strtod atof atol atoll labs llabs div ldiv`. `strtok` keeps its
state per program run. `calloc` zeroes the block visibly, built on the
`malloc` wrapper. `strtol` sets `errno` to `ERANGE` once L11 exists and
writes the end pointer. `memcpy` with overlapping ranges is a diagnostic
that points at `memmove`.

### L5 `realloc` with a visible move

Decision (taken here, change it before implementing if needed): the block
grows in place when it is the last block on the heap; otherwise a new block
is carved, the old bytes are copied, the old block is freed, and the new
address is returned. The canvas shows the old block freed and the pointer's
arrow on the new block; the mutation view records "moved from A to B".
`realloc(NULL, n)` is `malloc(n)`. `realloc(p, 0)` frees `p` and returns a
null pointer, with a note that C23 makes the call undefined. A shrink keeps
the block in place and frees its tail.

### L6 `sprintf`, `snprintf`, `sscanf`

Built on L1 and on `plivetScanf`. `sprintf` past the end of the destination
block is a runtime diagnostic naming the block's size; `snprintf` truncates,
terminates and returns the length it would have written. `sscanf` reports a
failed directive the way `scanf` does, and returns the number of
assignments, or `EOF` (L7) on an input that ends before the first
conversion.

### L7 `EOF`; the standard streams; end of input

`EOF` is `-1`. `stdin`, `stdout` and `stderr` are objects of type `FILE *`
in the static area, drawn as such, usable with every stream function. The
console gains an end-of-input action (Ctrl+D in the input, and a button
beside it) that makes the waiting read return `EOF` (`getchar`, `fgetc`,
`scanf` before its first conversion) or `NULL` (`fgets`, `gets`); input
given after that starts a new line of input. `stderr` output is written to
the console in the error colour. The deliberate departures documented in
`scanf.ts` stay.

### L8 Stream output, block I/O, positioning, files

`puts putchar fprintf fscanf fread fwrite fseek ftell rewind feof ferror
clearerr perror remove rename ungetc`. Files are the uploaded ones plus the
ones a program creates; `remove` and `rename` act on that set, and the files
panel shows the result. `perror` prints `errno`'s message (L11).

### L9 The documented limits as a refused-construct list

Today: `JscppSyntax` refuses `goto` and `>>=` with its own diagnostics; the
interpreter's own addresses are documented in the README only.

Change: one exported list of refused constructs (`goto`, labels used as
`goto` targets, `<<=`, `>>=`), each with an id, a source pattern a host can
check without parsing C, and the message the editor shows. The existing
refusals read their message from it. V0 writes it into the manifest. The
README section on limits links to it.

Decided during implementation: `<<=` is not refused and not listed. It runs
correctly (plain variables, pointers, members, a `for` step, as a value,
with the wrap of `unsigned char` and `unsigned int`), which
`test/refused-constructs.test.ts` holds it to; only `>>=` loses its
operator. The list is `goto`, `label` (any labelled statement, which the
interpreter refuses whether or not a `goto` names it) and
`shift-right-assign` (`>>=`), in `src/interpreter/refused.ts`. Patterns are
flagless regular expressions valid in JavaScript and Python, for source with
comments and literals blanked; the `>>=` refusal itself now matches with
its pattern. Course-lint rule 8 should take the list from the manifest
rather than hard-coding `<<=`.

Later: `>>=` runs and is off the list. The grammar's `rightShiftAssign` rule
wants the tokens `>`, `>` and `=`, while unicoen's lexer read `>>=` as `>`
and `>=`, so the statement never parsed and the recovery dropped it - the
operator was not lost in the mapper. `src/interpreter/ShiftAssignLexer.ts`
splits a `>=` that touches the `>` before it, and the engine's compound
assignment computes the rest. The id `shift-right-assign` is retired, and
the list is `goto` and `label`.

### L10 `srand`, `RAND_MAX`, `time`, `clock`, `assert`

Today `rand` returns `Math.random() * Math.pow(0, ...)`, which is always 0.
Change: a seedable generator (the C standard's sample LCG), `RAND_MAX`
32767, `srand`; `time(NULL)` and `time(&t)`, `clock` and `CLOCKS_PER_SEC`,
`difftime`; `assert(expr)` stops the program with
`Assertion failed: expr, file main.c, line N` on the console and a runtime
diagnostic on the line.

### L11 `errno`, `strerror`, `EXIT_SUCCESS`, `EXIT_FAILURE`

`errno` as a modifiable `int` object in the static area, `EDOM`, `ERANGE`,
`EINVAL`, `ENOENT`, `strerror` with the glibc wording for those, and the
two exit macros. `exit(EXIT_FAILURE)` shows the status on the console.

### L12 `qsort`, `bsearch`

The comparison callback is a program function reached through a function
pointer (`FunctionPointerTable`), called as interpreted code so a step into
`qsort` steps through the comparator's calls. The sort is a straightforward
insertion or merge sort whose element moves are ordinary writes, so the
canvas shows the array being sorted.

### L13 `<limits.h>` and `<float.h>` constants; `true` and `false`

`CHAR_BIT SCHAR_MIN SCHAR_MAX UCHAR_MAX CHAR_MIN CHAR_MAX SHRT_MIN SHRT_MAX
USHRT_MAX INT_MIN INT_MAX UINT_MAX LONG_MIN LONG_MAX ULONG_MAX LLONG_MIN
LLONG_MAX ULLONG_MAX` (ILP32, see L2) and `FLT_MIN FLT_MAX FLT_EPSILON FLT_DIG
DBL_MIN DBL_MAX DBL_EPSILON DBL_DIG`. `true` is 1 and `false` 0, of type
`int` as `<stdbool.h>` defines them.

### L14 `<stdarg.h>` and the `v*printf` family

User-written variadic functions (`int sum(int count, ...)`), `va_list`,
`va_start`, `va_arg`, `va_copy`, `va_end`, and `vprintf vfprintf vsprintf
vsnprintf` on L1. The canvas shows the variadic arguments in the callee's
frame as a row of unnamed parameters. `va_arg` with a type that does not
match the promoted argument is a diagnostic.

### L15 `<math.h>` remainder; `scanf` `%p`; math hover help

`atan2 log2 trunc nearbyint modf frexp ldexp copysign fma remainder asinh
acosh atanh` and `NAN INFINITY HUGE_VAL isnan isinf isfinite signbit`;
`M_PI` is not ISO C and stays out. `scanf("%p", &q)` reads what `%p` prints.
`exp2 expm1 log10 log1p` and the new functions gain hover help.

### L16 Program arguments

Option `args` (an array of strings, or one string split like a shell line)
and an optional field in the header of the Console and Breakpoints dock
(feature `programArgs`, default off). `int main(int argc, char *argv[])` and `char **argv` receive them:
`argv[0]` is the entry file's name without `.c`, the strings live in the
static area and are drawn there, `argv[argc]` is a null pointer. A `main`
without parameters ignores them. The configuration element accepts `args`.

Decided during implementation: a string is split as POSIX `sh` and Python's
`shlex.split` split it (an unclosed quote closes at the end rather than
failing). `argv[0]` is the entry file's name without its directory and
`.c`. The strings and the pointer array are written cell by cell into the
global scope before `main` starts (`src/interpreter/ProgramArguments.ts`),
not declared, and are drawn in the data segment as `_argv` (`char*[argc +
1]`) and `_argv_0`, `_argv_1`, ...; `main`'s parameters are bound as `int`
and `char **` when its block starts. `Request.args` carries `argv[1]`
onwards with `Start` and `Exec`. The configuration element also accepts
`features.programArgs`.

### L17 Bit-fields in the memory view

Today `RecordTable` keeps a bit-field's declared type and drops its width.
Check what the memory view draws for `struct { unsigned a : 3; unsigned b :
5; }`. Either store and draw the widths (the field's value wraps at its
width, the row shows `a : 3`), or refuse the declaration with a diagnostic
naming the limit. The first is preferred; the check decides.

## H: host integration

### H1 Whole-program session

Today: `session()` and `restoreSession()` cover the active document only
(`SessionJSON` version 1).

Change: version 2 of the session holds every file (path and text), the
entry, the active file, and per file the selection, the breakpoints (with
the disabled ones) and the pinned watches. `session()` writes version 2;
`restoreSession()` reads 1 and 2. A new `session` option is applied after
`files`: a file named in the session but not in `files` is ignored; a
file's text in the session replaces the given text only when it keeps the
file's protected segments (H2, H5); positions and rows that no longer fit
the text are dropped. The configuration element accepts `session`.

### H2 Per-file editable regions anchored by text

Today: `editableRegions` is an array of offsets into the first document,
and a full replacement of the document loses it.

Change:

- `editableRegions` also accepts a mapping from file path to 1-based
  inclusive line ranges, the syntax of the Sphinx `:editable-lines:` option:
  `{"main.c": [[7, 12], [20, 20]]}`. The offset array keeps its meaning for
  the entry file.
- At load, each file's protected segments are computed from its text: the
  text between the editable ranges, with its line span. On any later
  replacement of the file (`updateFiles`, Load, session restore, the host
  writing back), the segments are located by exact text, in order, and the
  editable ranges are the gaps. A replacement that lacks a segment is refused
  (H5).
- `SourceSnapshot.files[i].protected` lists the file's segments (`text`,
  `from`, `to` as offsets in the current text), so a host can verify a
  submission without re-deriving them.
- Protected lines are shaded and carry a lock marker in the gutter, as the
  Sphinx editor draws them.

### H3 Font size, theme and controls API

`setFontSize(px)` (and `getFontSize()`), `getTheme()`, `onThemeChange(cb)`
returning an `Unsubscribe`, called for changes from the control bar and from
`setTheme`. Option `controls` hides control-bar items a host drives itself:
`{"theme": false, "textSize": false}`. Hidden is absent from the DOM, not
disabled. The configuration element accepts `controls`.

### H4 Layout against the container

Today: the shell is a two-column grid sized for a window; the Sphinx
extension falls back to its ordinary editor below about 900 px.

Change: the shell measures its own container (`ResizeObserver`) and below a
threshold (option `stackedBelow`, default 720 px) switches to a stacked
layout: editor, then console, then canvas, one column, the splitters turned
horizontal, the canvas at a fixed aspect ratio that the reader can resize.
Option `layout`: `auto` (default), `columns` or `stacked`. Switching layout
keeps the debug session, the scroll positions and the folds. The class
`plivet--stacked` on the root marks the mode for host CSS.

### H5 Load policy

The rules for anything that replaces a file's text, in one place:

- A file with protected segments keeps them: a replacement is accepted only
  when every segment is found in order (H2); otherwise it is refused with a
  notice naming the first missing segment's line, and the editor keeps its
  text. The notice offers "Restore default".
- `features.loadSource` stays off by default; when on, loading a session or a
  source file follows the rule above.
- `updateFiles` and `restoreSession` return false on a refusal, and the
  `onLoadRefused` callback reports the path and the line.

### H6 `c-stdio.js`

`npm run deploy` writes `c-stdio.js` into the embed directory: one small
script with no interpreter, built from `printf.ts` (L1) and `scan.ts`/
`scanf.ts`, that sets `window.CStdio = {version, parseFormat, formatPrintf,
scanAll, explainDirective}` and resolves `window.CStdioReady`. `scanAll`
returns the stored values, the leftover input and the first failing
directive as `ScanFailure` reports it. The deploy also writes
`c-stdio.parity.json`, the parity table of L1, so the format playground's
tests read the same expectations. README: the API.

Tests: the parity table through the built script in a `vm` context.

### H7 `c-expression.js`

Change:

- `ExpressionNodeKind` gains `conversion`: one child, the text `int →
  double`, the node's `type` field set to the result type. Every node gains
  an optional `type` field. `EXPRESSION_MODEL_VERSION` (2) is exported and
  documented in the README with the model's shape.
- The interpreter's expression trace emits conversion nodes where the usual
  arithmetic conversions apply, when the operand types are known.
- `npm run deploy` writes `c-expression.js`: the expression layout and node
  drawing of the canvas, without the worker or the engine, setting
  `window.CExpressionTree = {version, mount(element, options)}` and
  resolving `window.CExpressionTreeReady`. `mount` returns `{render(model,
  {highlight}), setTheme(theme), setFontSize(px), destroy()}`. The geometry
  is the canvas's own, so the two trees look alike.

Tests: layout of a model with a conversion node; the model version; a
render with the drawing stubbed as `instances.test.ts` does.

## Verification

- The library packages are done when every function of the c-visualizer
  table runs a sample program in a browser with the expected output and
  canvas, the parity table passes through both paths, and the manifest
  lists exactly the registered set.
- The host packages are done when `/dev.html` shows two instances with
  per-file regions, a restored version-2 session, a font size set from the
  console, and the stacked layout at 600 px.
- A bundle rebuild (`npm run deploy` from the Sphinx repository's clone)
  produces `library.json`, `c-stdio.js`, `c-stdio.parity.json` and
  `c-expression.js` beside the loader.
