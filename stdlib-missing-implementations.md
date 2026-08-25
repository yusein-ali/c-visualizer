# Standard library: what Plivet does not implement

Plivet has no headers to read. Every library function a program can call is a
JavaScript function registered by name into the global scope, so the callable
set is exactly the list of `setTop(...)` registrations — 49 functions and one
object-like macro, against roughly 200 in a hosted C implementation.

Two places register them:

- `includeStdio` / `includeStdlib` / `includeMath` / `includeString` in
  `node_modules/unicoen.ts/dist/interpreter/CPP14/CPP14Engine.js` — the base
  set, from the upstream engine.
- `includeStdio` / `includeStdlib` in `src/interpreter/CPP14Engine.ts` — Plivet
  wraps `printf`, replaces `scanf`, and wraps `malloc`. It adds no new names.

`src/app/libraryHelp.ts` is the third place: it carries the signature and the
one-line description the editor shows in completions and hover help. Adding a
function means touching both the engine and that file.

## How a missing function fails

`#include <string.h>` is accepted and does nothing — headers are not read. A
call to a name nothing registers has no implementation behind it, so the
program reaches run time and fails there rather than being refused up front.
`LinkerCheck` deliberately does not flag calls to names the source never
declares (that is what every library call looks like from the tree), so the
editor gives no warning either.

The practical consequence for course material: an exercise that calls
`memcpy` looks correct in the editor and dies mid-run.

## Currently callable

For reference, the complete set.

| Header | Callable |
|---|---|
| `<stdio.h>` | `printf` `scanf` `gets` `getchar` `fopen` `fclose` `fgetc` `fputc` `fgets` `fputs` `fflush` |
| `<stdlib.h>` | `malloc` `free` `exit` `atoi` `rand` `abs` |
| `<string.h>` | `strlen` `strcpy` `strcat` `strcmp` |
| `<math.h>` | `sqrt` `cbrt` `pow` `exp` `exp2` `expm1` `log` `log10` `log1p` `fabs` `floor` `ceil` `round` `rint` `fmod` `fmax` `fmin` `fdim` `hypot` `sin` `cos` `tan` `asin` `acos` `atan` `sinh` `cosh` `tanh` |
| macros | `NULL` only (`setSystemVariable('SYSTEM', 'NULL', 0)`) |

`sizeof` is an operator the engine handles in `execUnaryOp`, not a registered
function.

## Missing — `<string.h>`

Four of the header's 22 functions exist. The rest:

**Memory block functions — none are implemented.**

| Function | Note |
|---|---|
| `memcpy` | copy n bytes, non-overlapping |
| `memmove` | copy n bytes, overlap-safe |
| `memset` | fill n bytes with a value |
| `memcmp` | compare n bytes |
| `memchr` | find a byte in a block |

**Bounded string functions — none are implemented.** These are the ones a
course teaches *instead of* the unbounded four that do exist, which is the
sharpest gap in the current set.

| Function | Note |
|---|---|
| `strncpy` | bounded copy |
| `strncat` | bounded concatenate |
| `strncmp` | bounded compare |

**Searching and tokenizing — none are implemented.**

| Function | Note |
|---|---|
| `strchr` | first occurrence of a character |
| `strrchr` | last occurrence of a character |
| `strstr` | find a substring |
| `strtok` | tokenize on a delimiter set; keeps static state between calls |
| `strspn` | length of a prefix of accepted characters |
| `strcspn` | length of a prefix of rejected characters |
| `strpbrk` | first occurrence of any of a set |

**Remainder.**

| Function | Note |
|---|---|
| `strerror` | message for an error number; needs `errno` |
| `strcoll` | locale-aware compare |
| `strxfrm` | locale transform |

`strdup` is POSIX rather than ISO C, and is also absent.

## Missing — `<stdio.h>`

**Formatted output to a buffer or stream — none are implemented.** `printf` to
standard output is the only formatting path that works.

| Function | Note |
|---|---|
| `sprintf` | format into a buffer; unbounded |
| `snprintf` | format into a buffer; bounded |
| `fprintf` | format to a stream; also needs `stdout`/`stderr` to exist |
| `vprintf` `vfprintf` `vsprintf` `vsnprintf` | `va_list` variants; `<stdarg.h>` is not supported at all |

`src/interpreter/TeachingLint.ts` already carries format-string argument
positions for `sprintf` and `snprintf`, so the lint side is prepared for them;
the rule simply can never fire today.

**Formatted input from a buffer or stream.**

| Function | Note |
|---|---|
| `sscanf` | parse from a string |
| `fscanf` | parse from a stream |

Both are named in `TeachingLint`'s `SCANNING` list alongside `scanf`, and
neither is callable. `scanf` itself is Plivet's own `plivetScanf`, so a new
implementation should be built on that rather than on the upstream one.

**Character output — none are implemented.** Note that the input side
(`getchar`, `fgetc`, `fgets`, `gets`) exists but the matching output side
mostly does not.

| Function | Note |
|---|---|
| `puts` | write a string and a newline to standard output |
| `putchar` | write one character to standard output |
| `ungetc` | push a character back onto a stream |

**Binary and positioning — none are implemented.**

| Function | Note |
|---|---|
| `fread` `fwrite` | block I/O |
| `fseek` `ftell` `rewind` | positioning |
| `fgetpos` `fsetpos` | positioning with an opaque type |
| `setbuf` `setvbuf` | buffering control |

**Stream state and files — none are implemented.**

| Function | Note |
|---|---|
| `feof` `ferror` `clearerr` | stream state |
| `perror` | print an error message; needs `errno` |
| `freopen` | reopen a stream |
| `remove` `rename` | file operations |
| `tmpfile` `tmpnam` | temporary files |

**Objects and macros.** `stdin`, `stdout`, `stderr` and `errno` do not exist as
objects. `src/interpreter/TeachingLint.ts` knows all four by name only so that
the `undeclared-identifier` rule does not flag them — using one still evaluates
to nothing at run time.

`EOF` is not defined. It reaches the tree as a bare identifier and is not
flagged, because `undeclared-identifier` exempts anything spelled in macro
case. So `while ((c = getchar()) != EOF)` compares against nothing rather than
against -1. This is worth fixing ahead of most of the function list: it is
silent, and it breaks the standard input loop every C course teaches.

## Missing — `<stdlib.h>`

**Allocation.**

| Function | Note |
|---|---|
| `calloc` | allocate and zero; the zeroing is directly visible on the memory canvas |
| `realloc` | resize a block; the engine's heap cursor only moves forward, so this needs thought |
| `aligned_alloc` | C11 |

Plivet already wraps `malloc` to blank fresh blocks, and that wrapper is where
`calloc` would naturally be built.

**String-to-number conversion.** Only `atoi` exists.

| Function | Note |
|---|---|
| `atof` `atol` `atoll` | unchecked conversions |
| `strtol` `strtoul` `strtoll` `strtoull` | checked conversion with an end pointer |
| `strtod` `strtof` `strtold` | checked floating conversion |

**Integer arithmetic.** Only `abs` exists.

| Function | Note |
|---|---|
| `labs` `llabs` | wider absolute values |
| `div` `ldiv` `lldiv` | quotient and remainder together; return a struct |

**Random numbers.** `rand` exists; `srand` does not, so a sequence cannot be
seeded or made reproducible — a real problem for a graded exercise.

| Function | Note |
|---|---|
| `srand` | seed the generator |
| `RAND_MAX` | not defined either |

**Searching and sorting — none are implemented.** Both take a function pointer,
and `src/interpreter/FunctionPointerTable.ts` means the machinery exists.

| Function | Note |
|---|---|
| `qsort` | sort with a comparison callback |
| `bsearch` | binary search with a comparison callback |

**Program control and environment.** Only `exit` exists.

| Function | Note |
|---|---|
| `abort` | abnormal termination |
| `atexit` | register a termination handler |
| `getenv` `system` | environment; arguably out of scope for a browser visualizer |
| `EXIT_SUCCESS` `EXIT_FAILURE` | macros, not defined |

## Missing — `<ctype.h>`

**The entire header.** Nothing from it is registered.

| Function | Note |
|---|---|
| `isalpha` `isdigit` `isalnum` `isspace` | the four a course actually uses |
| `isupper` `islower` `ispunct` `isprint` `isgraph` `iscntrl` `isxdigit` `isblank` | remainder of the classification set |
| `toupper` `tolower` | case conversion |

These are the cheapest functions on this list to add — each is a few lines over
a character code — and they pair with the string exercises that the missing
`<string.h>` half blocks.

## Missing — `<math.h>`

The math set is the best covered. What is absent:

| Function | Note |
|---|---|
| `atan2` | two-argument arc tangent; the common one |
| `log2` | binary logarithm |
| `modf` `frexp` `ldexp` | split a float into parts |
| `trunc` `nearbyint` | remaining rounding modes |
| `copysign` `fma` `remainder` `remquo` | |
| `asinh` `acosh` `atanh` | inverse hyperbolics |
| `erf` `erfc` `tgamma` `lgamma` | special functions; low priority |
| `isnan` `isinf` `isfinite` `signbit` | classification macros |
| `NAN` `INFINITY` `HUGE_VAL` `M_PI` | not defined |

## Missing — headers with no support at all

| Header | Note |
|---|---|
| `<assert.h>` | `assert` — useful for teaching, and easy: it needs a diagnostic path, not a computation |
| `<stdarg.h>` | `va_list` `va_start` `va_arg` `va_end`; blocks every `v*printf` and any user-written variadic function |
| `<limits.h>` | `INT_MAX` `INT_MIN` `CHAR_BIT` `LONG_MAX` …; silently undefined, same failure mode as `EOF` |
| `<float.h>` | `DBL_MAX` `FLT_EPSILON` …; same |
| `<time.h>` | `time` `clock` `difftime` `mktime` `localtime` `strftime`; `time(NULL)` is the usual `srand` seed |
| `<stdbool.h>` | `bool` and `_Bool` are recognised as type keywords by `AstValidator` and `TeachingLint`, so the type works without the header; `true` and `false` are not defined anywhere and reach the tree as bare identifiers |
| `<stddef.h>` | `size_t` is not in `AstValidator`'s accepted-type pattern, so `size_t n;` is not a usable declaration — even though `libraryHelp` writes `malloc` and `strlen` with `size_t` in their signatures. `ptrdiff_t` and `offsetof` are likewise absent |
| `<errno.h>` | `errno` and the `E*` constants |
| `<signal.h>` `<setjmp.h>` `<locale.h>` | out of scope for a teaching visualizer |
| `<complex.h>` `<fenv.h>` `<tgmath.h>` `<threads.h>` `<stdatomic.h>` | out of scope |

## Format specifiers: defects rather than gaps

Specifier *coverage* is not the problem. `printf` and `scanf` between them
accept very nearly the whole C set, and the items below are cases where a
specifier is accepted and then behaves wrongly — which is worse than a missing
function, because nothing reports it.

### `printf`

Formatting is delegated to the `agh.sprintf` package
(`node_modules/agh.sprintf/agh.sprintf.js`, reached from `includeStdio` in the
upstream engine). Its conversion table covers `d i u o x X e E f F g G a A c s
p n %` plus the non-standard `C` and `S`. Flags `-`, `+`, space, `0`, `#`, `'`,
field width, precision, `*` for either, and positional `%2$d` all work. Length
modifiers are honoured rather than skipped: `getUnsignedValue` masks to the
width the modifier names, so `%hhu` wraps at 8 bits and a bare `%u` of `-1`
prints 4294967295.

Four defects:

| Defect | Detail |
|---|---|
| **`%n` is a silent no-op** | `convertOutputLength` performs `value[0] = ...`, but Plivet passes an address as a plain number, so the assignment goes nowhere. Nothing is stored, nothing is printed, and no diagnostic is raised. |
| **`%p` on a `char*` prints the string** | The argument-conversion loop in `includeStdio` rewrites any argument whose value is the address of a char-typed object into a string *before* formatting, without consulting the specifier. |
| **An integer argument can be turned into a string** | Same loop, same cause: it keys on the argument value alone. `printf("%d", n)` prints a string whenever `n` happens to equal the address of a live `char` object. Segment bases are 10000 (static), 20000 (heap) and 50000 (stack), so a large value is needed to trigger it — printing a pointer with `%d` is the realistic route. String literals are not at risk: `execStringLiteral` returns a JavaScript array rather than storing bytes in memory. |
| **An unknown conversion prints itself** | `agh.sprintf` substitutes the text `(sprintf:error:%q)` into the program's output instead of raising a diagnostic the editor could show. |

The first three are in the wrapper Plivet already owns
(`src/interpreter/CPP14Engine.ts`, `includeStdio`), so fixing them does not
mean forking the formatting package. Restricting the char-to-string rewrite to
the arguments whose specifier is `%s` fixes defects two and three together.

### `scanf`

`scanf` is Plivet's own implementation — `src/interpreter/scanf.ts`, with the
storing half in `plivetScanf`. It accepts `d i u o x X e E f F g G a A c s n %
[`, with `*` suppression, field widths, and scansets including ranges and `^`
negation. Length modifiers `h l L j z t` are parsed and skipped, repeats
included, so `hh` and `ll` are accepted; the destination address decides the
size instead.

| Defect | Detail |
|---|---|
| **`%p` is not supported** | It is the one conversion character missing from the accepted set. It falls through to the literal branch, so `scanf("%p", &q)` waits for the characters `%` and `p` to appear in the input. |

Two departures from C are deliberate and documented at the top of `scanf.ts` —
whitespace in the format never waits for more input, and a numeric conversion
keeps the longest valid prefix rather than failing on a partial match. There is
also no `EOF` return, because standard input in this page has no end. Leave all
three alone.

Worth recording on the other side of the ledger: a failed conversion writes
`[scanf] %d did not match 'a' - it stays in the input, so the next read starts
there.` into the program's output. C is completely silent there, and the silence
is what makes `scanf` hard to teach.

### The lint is already ahead of the implementation

`src/interpreter/TeachingLint.ts` checks argument types against specifiers for
six functions. Only `printf` and `scanf` are callable, so the rows for
`fprintf`, `sprintf`, `snprintf`, `fscanf` and `sscanf` are waiting on the
implementations rather than on new lint work.

## Suggested order of work

Ranked by how often a first-year C course hits the gap, not by implementation
cost.

1. **The `printf` argument-conversion defects, and `%n`.** Ahead of everything
   else because they are wrong answers rather than absent ones: the output
   looks plausible and nothing warns. All three live in the wrapper Plivet
   already owns, and the `%s`-only restriction fixes two of them at once.
2. **`EOF`, and `stdin`/`stdout`/`stderr` as real objects.** Silent wrong
   behaviour today. Everything in category 3 that writes to a stream depends on
   the stream objects existing.
3. **`puts`, `putchar`, `sprintf`, `snprintf`, `fprintf`, `sscanf`.** The
   output side of `<stdio.h>`, and the format-string lint is already written
   for the `*printf` family.
4. **`<ctype.h>` in full.** Cheapest per function on the list.
5. **`memcpy`, `memmove`, `memset`, `memcmp`; `strncpy`, `strncat`, `strncmp`,
   `strchr`, `strstr`, `strtok`.** The `<string.h>` gap. `memset` and `memcpy`
   in particular are worth showing on the memory canvas.
6. **`calloc`, `srand`, `strtol`, `atof`.** Small `<stdlib.h>` additions with
   clear teaching value; `calloc`'s zeroing is visible on the canvas.
7. **`assert`, `<limits.h>` constants, `atan2`, `log2`.**
8. **`qsort` and `bsearch`.** The function-pointer machinery exists; these are
   a good demonstration of it.
9. **`realloc`, and `scanf`'s `%p`.** Deliberately last. The heap cursor only
   moves forward, so `realloc` needs a design decision about what growing a
   block should look like on the canvas before it needs code; `%p` is cheap but
   worth little until `printf` can be trusted to print a pointer.

## One inconsistency worth fixing while here

`src/app/libraryHelp.ts` states in its header comment that "nothing here is
documented that a program cannot actually call, and nothing callable is left
undocumented." Four callable functions are currently undocumented:

- `exp2`
- `expm1`
- `log10`
- `log1p`

All four are registered by `includeMath` in the upstream engine and have no
entry in `libraryHelp.ts`, so they are missing from completions and hover help.
