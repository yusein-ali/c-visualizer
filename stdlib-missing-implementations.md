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
  replaces every `<stdio.h>` registration with `library/stdio.ts` (adding the
  stream functions and the standard streams), and wraps `malloc`.

`src/app/libraryHelp.ts` is the third place: it carries the signature and the
one-line description the editor shows in completions and hover help. Adding a
function means touching both the engine and that file. Since V0 that file is
the callable set's source of truth: `test/library-manifest.test.ts` fails when
the engine registers a name it leaves out or it lists a name nothing
registers, and the deploy writes it out as `library.json`.

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

For reference, the complete set. Since the L packages, a third place
registers names: `src/interpreter/library/` (`ctype.ts`, `string.ts`,
`stdlib.ts`, `realloc.ts`, `search.ts`, `stdarg.ts`, `math.ts`, `time.ts`,
`assert.ts`, `stddef.ts`, `constants.ts`),
installed by `PlivetCPP14Engine.loadLibarary` after the upstream set. It
replaces `strlen` `strcpy` `strcat` `strcmp` `atoi` `abs` `rand` `exit` and
every `<math.h>` function rather than wrapping them, and the engine now puts
back any name a program defines itself, so a student's own `strlen` wins.

| Header | Callable |
|---|---|
| `<stdio.h>` | `printf` `fprintf` `sprintf` `snprintf` `scanf` `fscanf` `sscanf` `puts` `putchar` `getchar` `gets` `fopen` `fclose` `fflush` `fgetc` `fgets` `fputc` `fputs` `ungetc` `fread` `fwrite` `fseek` `ftell` `rewind` `feof` `ferror` `clearerr` `perror` `remove` `rename` `vprintf` `vfprintf` `vsprintf` `vsnprintf` — every one PLIVET's own, in `library/stdio.ts` over `printf.ts`, `scanf.ts` and `stream.ts`; upstream's registrations are all replaced |
| `<stdlib.h>` | `malloc` `calloc` `realloc` `free` `exit` `atoi` `atol` `atoll` `atof` `strtol` `strtoul` `strtoll` `strtoull` `strtod` `rand` `srand` `abs` `labs` `llabs` `div` `ldiv` `qsort` `bsearch` (`realloc` grows the last block in place and otherwise moves the block, which the canvas and the mutation view show; `qsort` and `bsearch` call the comparator as interpreted code, so stepping enters it) |
| `<stdarg.h>` | `va_start` `va_arg` `va_copy` `va_end` - predefined macros (`preprocess.ts`) over `library/stdarg.ts`. A function declared with `...` keeps its unnamed arguments in its frame as rows `...[0]`, `...[1]`, with their promoted types, and a `va_list` is a pointer that walks them (`Variadic.ts`) |
| `<string.h>` | `strlen` `strcpy` `strncpy` `strcat` `strncat` `strcmp` `strncmp` `strchr` `strrchr` `strstr` `strtok` `strspn` `strcspn` `strpbrk` `memcpy` `memmove` `memset` `memcmp` `memchr` `strerror` |
| `<ctype.h>` | `isalpha` `isdigit` `isalnum` `isspace` `isupper` `islower` `ispunct` `isprint` `isgraph` `iscntrl` `isxdigit` `isblank` `toupper` `tolower` |
| `<math.h>` | `sqrt` `cbrt` `pow` `exp` `exp2` `expm1` `log` `log10` `log1p` `log2` `fabs` `floor` `ceil` `round` `rint` `nearbyint` `trunc` `fmod` `remainder` `fmax` `fmin` `fdim` `hypot` `sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sinh` `cosh` `tanh` `asinh` `acosh` `atanh` `modf` `frexp` `ldexp` `copysign` `fma` `isnan` `isinf` `isfinite` `signbit` |
| `<time.h>` | `time` `clock` `difftime` |
| `<assert.h>` | `assert` |
| `<stddef.h>` | `offsetof` (a predefined macro over the engine's record layout) |
| macros | `NULL`; `CHAR_BIT` `SCHAR_MIN` `SCHAR_MAX` `UCHAR_MAX` `CHAR_MIN` `CHAR_MAX` `SHRT_MIN` `SHRT_MAX` `USHRT_MAX` `INT_MIN` `INT_MAX` `UINT_MAX` `LONG_MIN` `LONG_MAX` `ULONG_MAX` `LLONG_MIN` `LLONG_MAX` `ULLONG_MAX`; `FLT_MIN` `FLT_MAX` `FLT_EPSILON` `FLT_DIG` `DBL_MIN` `DBL_MAX` `DBL_EPSILON` `DBL_DIG`; `EDOM` `ERANGE` `EINVAL` `ENOENT`; `EXIT_SUCCESS` `EXIT_FAILURE` `RAND_MAX` `CLOCKS_PER_SEC`; `NAN` `INFINITY` `HUGE_VAL` - all system variables from `library/constants.ts`; `EOF` `SEEK_SET` `SEEK_CUR` `SEEK_END` from `STDIO_CONSTANTS` in `stream.ts`. `true` and `false` are predefined preprocessor macros (`preprocess.ts`) |
| objects | `errno`, an `int` among the program's globals when the program names it; `stdin` `stdout` `stderr`, each a `FILE *` among the globals (data segment) when the program names it, pointing at its stream's `FILE` object (the streams exist, undrawn, for every program) |
| types | `size_t` `ptrdiff_t` `time_t` `clock_t` `div_t` `ldiv_t` `va_list` (`library/types.ts`; widths follow the engine's ILP32 data model) |

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

The L1, L6, L7, L8 and L14 packages implemented the rest of the header a
course meets (see the table above). What is still absent:

| Function | Note |
|---|---|
| `getc` `putc` | the macro spellings of `fgetc` and `fputc` |
| `fgetpos` `fsetpos` | positioning with an opaque type |
| `setbuf` `setvbuf` | buffering control; a file's writes are buffered until `fflush`, `fclose` or the end of the program |
| `freopen` | reopen a stream |
| `tmpfile` `tmpnam` | temporary files |

How the streams behave, briefly: `stdin` is the console, a line at a time,
and the console's end-of-input action (Ctrl+D, or its EOF button) makes the
waiting read return `EOF` (`fgets`/`gets`: a null pointer); a later read
waits for new input rather than returning `EOF` again. `stderr` is the same
transcript as `stdout`, drawn in the error colour. Files are the uploaded
ones plus those the program creates; `fopen` with `w` or `a` creates or
empties the file at once, writes reach the file system at `fflush`,
`fclose` and the end of the program, and `remove`/`rename` change the set
the files panel shows. `fseek`/`ftell` on a console stream fail with
`EINVAL` (a terminal would say `ESPIPE`, which `strerror` has no text for
here).

## Missing — `<stdlib.h>`

**Allocation.**

| Function | Note |
|---|---|
| `calloc` | allocate and zero; the zeroing is directly visible on the memory canvas |
| `realloc` | done (L5): grows the last block in place, otherwise moves it - new block, cells copied, old block freed - and the mutation view says "moved from A to B" |
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

**Searching and sorting — done (L12).** Both call the program's comparator
through the pointer as interpreted code (`library/search.ts`); `qsort` is an
insertion sort by adjacent swaps, each swap two ordinary writes.

| Function | Note |
|---|---|
| `qsort` | done; an array of `char *` initialised with literals cannot be sorted, because the engine cannot represent that array (it stores it as one `char *`) |
| `bsearch` | done |

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
| `<stdarg.h>` | done (L14): `va_list` `va_start` `va_arg` `va_copy` `va_end` and user-written variadic functions; a structure passed through `...` is refused |
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
storing half in `library/stdio.ts` (shared with `fscanf` and `sscanf`). It
accepts `d i u o x X p e E f F g G a A c s n % [`, with `*` suppression, field
widths, and scansets including ranges and `^` negation. `%p` reads what `%p`
prints: `0x` and hexadecimal, or `(nil)` for a null pointer. Length modifiers
`h l L j z t` are parsed and skipped, repeats included, so `hh` and `ll` are
accepted; the destination address decides the size instead.

Two departures from C are deliberate and documented at the top of `scanf.ts` —
whitespace in the format never waits for more input, and a numeric conversion
keeps the longest valid prefix rather than failing on a partial match. A third
is documented there too: end of input is a single event, as Ctrl+D at a
terminal is, so a read after `EOF` waits for new input instead of returning
`EOF` again. Leave all three alone.

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

Fixed with L15: all four have entries now, as has every name the library
packages added.
