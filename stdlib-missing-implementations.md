# Standard library: what Plivet does not implement

Checked against `ca4c72a` (2026-11-08), after the update plan
(`update-plan.md`, packages L1 to L17) was implemented, and updated for the
fixes that followed: the `<stdint.h>` types, `printf`'s `'` flag and a
64-bit `long long`. Each "missing" entry
below was checked against the library manifest (`library.json`). Where this
file says a program behaves a certain way, that behaviour was seen by running
the program through the interpreter.

Plivet has no headers to read. Every library name a program can use is
registered by name into the global scope, so the callable set is exactly the
list of registrations: 135 functions, 75 macros, 4 objects (`errno`, `stdin`,
`stdout`, `stderr`) and 20 types. That covers most of what a first-year C
course meets. A hosted C implementation has roughly 200 functions.

Three places register names:

- `includeStdio` / `includeStdlib` / `includeMath` / `includeString` in
  `node_modules/unicoen.ts/dist/interpreter/CPP14/CPP14Engine.js` hold the
  base set, from the upstream engine. Plivet has replaced most of it.
- `includeStdio` / `includeStdlib` in `src/interpreter/CPP14Engine.ts`.
  Plivet replaces every `<stdio.h>` registration with `library/stdio.ts`
  (adding the stream functions and the standard streams), and wraps `malloc`.
- `src/interpreter/library/` (`ctype.ts`, `string.ts`, `stdlib.ts`,
  `realloc.ts`, `search.ts`, `stdarg.ts`, `math.ts`, `time.ts`, `assert.ts`,
  `stddef.ts`, `constants.ts`), installed by `PlivetCPP14Engine.loadLibarary`
  after the upstream set. It replaces `strlen` `strcpy` `strcat` `strcmp`
  `atoi` `abs` `rand` `exit` and every `<math.h>` function rather than
  wrapping them. A name the program defines itself wins, so a student's own
  `strlen` is the one called.

`src/app/libraryHelp.ts` is the source of truth for the callable set (V0). It
holds each name's header, its signature and the one-line description the
editor shows in completions and hover help. `test/library-manifest.test.ts`
fails when the engine registers a name the table leaves out, or the table
lists a name nothing registers. `npm run deploy` writes the table out as
`library.json`. Adding a function means changing both the engine and that
table.

## How a missing function fails

`#include <string.h>` is accepted and dropped (`preprocess.ts`), because
headers are not read. A call to a name nothing registers passes the syntax
check. It fails at run time, on the line of the call, with the runtime
diagnostic `invalid-statement`: "This statement could not be executed." The
message names neither the function nor the reason. `LinkerCheck` deliberately
does not flag calls to names the source never declares, because every library
call looks like that from the tree. So the editor gives no warning before the
run. The only hint is that completion does not offer the name.

Course material is now checked at build time. Course-lint rule 9
(`_sphinx_extensions/course-lint`) reports any call in a visualized block to a
name that `library.json` does not list and the block does not define. A
student typing into the editor still gets only the run-time message.

## Currently callable

The complete set, as `library.json` lists it.

| Header | Callable |
|---|---|
| `<stdio.h>` | `printf` `fprintf` `sprintf` `snprintf` `scanf` `fscanf` `sscanf` `puts` `putchar` `getchar` `gets` `fopen` `fclose` `fflush` `fgetc` `fgets` `fputc` `fputs` `ungetc` `fread` `fwrite` `fseek` `ftell` `rewind` `feof` `ferror` `clearerr` `perror` `remove` `rename` `vprintf` `vfprintf` `vsprintf` `vsnprintf`. Every one is PLIVET's own, in `library/stdio.ts` over `printf.ts`, `scanf.ts` and `stream.ts`; all of upstream's registrations are replaced |
| `<stdlib.h>` | `malloc` `calloc` `realloc` `free` `exit` `atoi` `atol` `atoll` `atof` `strtol` `strtoul` `strtoll` `strtoull` `strtod` `rand` `srand` `abs` `labs` `llabs` `div` `ldiv` `qsort` `bsearch`. `realloc` grows the last block in place and otherwise moves the block, which the canvas and the mutation view show. `qsort` and `bsearch` call the comparator as interpreted code, so stepping enters it |
| `<stdarg.h>` | `va_start` `va_arg` `va_copy` `va_end`: predefined macros (`preprocess.ts`) over `library/stdarg.ts`. A function declared with `...` keeps its unnamed arguments in its frame as rows `...[0]`, `...[1]`, with their promoted types, and a `va_list` is a pointer that walks them (`Variadic.ts`). A structure passed through `...` is refused |
| `<string.h>` | `strlen` `strcpy` `strncpy` `strcat` `strncat` `strcmp` `strncmp` `strchr` `strrchr` `strstr` `strtok` `strspn` `strcspn` `strpbrk` `memcpy` `memmove` `memset` `memcmp` `memchr` `strerror` |
| `<ctype.h>` | `isalpha` `isdigit` `isalnum` `isspace` `isupper` `islower` `ispunct` `isprint` `isgraph` `iscntrl` `isxdigit` `isblank` `toupper` `tolower` |
| `<math.h>` | `sqrt` `cbrt` `pow` `exp` `exp2` `expm1` `log` `log10` `log1p` `log2` `fabs` `floor` `ceil` `round` `rint` `nearbyint` `trunc` `fmod` `remainder` `fmax` `fmin` `fdim` `hypot` `sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sinh` `cosh` `tanh` `asinh` `acosh` `atanh` `modf` `frexp` `ldexp` `copysign` `fma` `isnan` `isinf` `isfinite` `signbit` |
| `<time.h>` | `time` `clock` `difftime` |
| `<assert.h>` | `assert` |
| `<stddef.h>` | `offsetof` (a predefined macro over the engine's record layout) |
| `<stdint.h>` | `int8_t` `uint8_t` `int16_t` `uint16_t` `int32_t` `uint32_t` `int64_t` `uint64_t` `intptr_t` `uintptr_t` `intmax_t` `uintmax_t`. Each is given to the engine as a typedef before the program's first declaration (`installLibraryTypedefs` in `library/types.ts`), so a value wraps at the type's width and `sizeof`, array strides and pointer steps use it. A typedef of the same name in the program replaces the library's. The 64-bit ones are `long long` (see "Data model" below) |
| macros | `NULL`; `CHAR_BIT` `SCHAR_MIN` `SCHAR_MAX` `UCHAR_MAX` `CHAR_MIN` `CHAR_MAX` `SHRT_MIN` `SHRT_MAX` `USHRT_MAX` `INT_MIN` `INT_MAX` `UINT_MAX` `LONG_MIN` `LONG_MAX` `ULONG_MAX` `LLONG_MIN` `LLONG_MAX` `ULLONG_MAX`; `FLT_MIN` `FLT_MAX` `FLT_EPSILON` `FLT_DIG` `DBL_MIN` `DBL_MAX` `DBL_EPSILON` `DBL_DIG`; `EDOM` `ERANGE` `EINVAL` `ENOENT`; `EXIT_SUCCESS` `EXIT_FAILURE` `RAND_MAX` `CLOCKS_PER_SEC`; `NAN` `INFINITY` `HUGE_VAL`; `INT8_MIN` `INT8_MAX` `UINT8_MAX` `INT16_MIN` `INT16_MAX` `UINT16_MAX` `INT32_MIN` `INT32_MAX` `UINT32_MAX` `INT64_MIN` `INT64_MAX` `UINT64_MAX` `INTPTR_MIN` `INTPTR_MAX` `UINTPTR_MAX` `INTMAX_MIN` `INTMAX_MAX` `UINTMAX_MAX` `SIZE_MAX` `PTRDIFF_MIN` `PTRDIFF_MAX`. All of these are system variables from `library/constants.ts`. `EOF` `SEEK_SET` `SEEK_CUR` `SEEK_END` come from `STDIO_CONSTANTS` in `stream.ts`. `true` and `false` are predefined preprocessor macros (`preprocess.ts`) |
| objects | `errno` is an `int` among the program's globals when the program names it. `stdin` `stdout` `stderr` are each a `FILE *` among the globals (data segment) when the program names it, pointing at its stream's `FILE` object. The streams exist, undrawn, for every program |
| types | `FILE` `size_t` `ptrdiff_t` `time_t` `clock_t` `div_t` `ldiv_t` `va_list`, and the twelve `<stdint.h>` types above (`library/types.ts`; widths follow the engine's ILP32 data model) |

`sizeof` is an operator the engine handles in `execUnaryOp`, not a registered
function. The manifest leaves it out.

## Missing: `<string.h>`

Twenty of the header's 22 functions exist. The two missing ones:

| Function | Note |
|---|---|
| `strcoll` `strxfrm` | locale-aware compare and transform; with only the "C" locale, `strcoll` would behave as `strcmp` |

`strdup` and `strndup` are missing too. They are POSIX, and ISO C since C23.
Course code uses them often.

## Missing: `<stdio.h>`

| Function | Note |
|---|---|
| `getc` `putc` | the macro spellings of `fgetc` and `fputc` |
| `fgetpos` `fsetpos` | positioning with an opaque type |
| `setbuf` `setvbuf` | buffering control; a file's writes are buffered until `fflush`, `fclose` or the end of the program |
| `freopen` | reopen a stream |
| `tmpfile` `tmpnam` | temporary files |

How the streams behave:

- `stdin` is the console, read a line at a time.
- The console's end-of-input action (Ctrl+D, or its EOF button) makes the
  waiting read return `EOF`. For `fgets` and `gets` it returns a null pointer.
  A later read waits for new input rather than returning `EOF` again.
- `stderr` writes to the same transcript as `stdout`, in the error colour.
- Files are the uploaded ones plus any the program creates. `fopen` with `w`
  or `a` creates or empties the file at once. Writes reach the file system at
  `fflush`, `fclose` or the end of the program.
- `remove` and `rename` change the set of files the files panel shows.
- `fseek` and `ftell` on a console stream fail with `EINVAL`. A terminal would
  give `ESPIPE`, which `strerror` has no text for here.

## Missing: `<stdlib.h>`

| Function | Note |
|---|---|
| `aligned_alloc` | C11 |
| `strtof` `strtold` | `strtod` exists |
| `lldiv` | `div` and `ldiv` exist |
| `abort` `atexit` | abnormal termination, termination handlers; `exit` exists |
| `quick_exit` `at_quick_exit` | C11; low priority |
| `getenv` `system` | environment; arguably out of scope for a browser visualizer |
| `mblen` `mbtowc` `wctomb` `mbstowcs` `wcstombs` | multibyte characters; out of scope |

## Missing: `<math.h>`

| Function | Note |
|---|---|
| `remquo` | |
| `lround` `llround` `lrint` `llrint` | rounding to an integer type |
| `scalbn` `ilogb` `logb` `nextafter` `nan` | |
| `fpclassify` `isnormal` and the `FP_*` macros | classification beyond the four that exist |
| `isgreater` `isless` `islessgreater` `isunordered` | quiet comparisons |
| `erf` `erfc` `tgamma` `lgamma` | special functions; low priority |
| the `f` and `l` variants | `sqrtf`, `powf`, `fabsf`, and so on; a program has to call the `double` versions |

`M_PI` is not ISO C, and L15 decided to leave it out. A course that wants it
defines it.

## Headers with partial or no support

| Header | Note |
|---|---|
| `<stdint.h>` | The exact-width, pointer-width and greatest-width types and their limits exist. Missing: the `int_leastN_t`/`int_fastN_t` families and their limits, and the `INTN_C` constant macros. A missing name such as `int_fast8_t` is still accepted as a type name with no width, as `uint8_t` was before it was added |
| `<inttypes.h>` | `PRId32` and the other format macros |
| `<time.h>` | `time` `clock` `difftime` exist. `struct tm` `mktime` `localtime` `gmtime` `strftime` `ctime` `asctime` do not |
| `<wchar.h>` `<wctype.h>` `<uchar.h>` | wide characters; out of scope |
| `<signal.h>` `<setjmp.h>` `<locale.h>` | out of scope for a teaching visualizer |
| `<complex.h>` `<fenv.h>` `<tgmath.h>` `<threads.h>` `<stdatomic.h>` | out of scope |

These headers were missing in earlier versions of this list and are now
supported: `<ctype.h>` (L3), `<stddef.h>` (L2), `<assert.h>` (L10),
`<errno.h>` (L11), `<limits.h>`, `<float.h>` and `<stdbool.h>`'s `true` and
`false` (L13), and `<stdarg.h>` (L14).

## Data model: `long long`

The engine is ILP32 (see L2), as a 32-bit x86 or ARM target is: `int`,
`long` and pointers are 4 bytes, and `long long` is 8.

- `DeclarationSpecifiers` writes `long long` as one engine word,
  `_LongLong` (`_ULongLong` when unsigned), in the space the two words took,
  because unicoen's mapper reads only one type word. `basicSizeof`, which
  `PlivetCPP14Engine` installs as the engine's `sizeof`, gives it 8 bytes.
  Nothing the reader sees carries the engine word: `cSpelling` in
  `ExpressionTypes.ts` puts `long long` back, and `test/long-long.test.ts`
  checks every canvas state, the outline and the lints for it.
- Values wrap at 64 bits. A `long` wraps at its own 4 bytes, which it did
  not while `long long` reached the engine as a `long`.
- In a structure, a `long long` member is aligned to 8 bytes, as on ARM
  (gcc for 32-bit x86 aligns it to 4).
- Values are JavaScript numbers, exact up to 2^53 (9007199254740992). An
  operation, constant or conversion whose value goes past that, and is
  therefore approximate, raises an `inexact-integer` warning. 20! is past
  2^53 and still exact, so it raises nothing.
- `LLONG_MAX` and `ULLONG_MAX` round up to 2^63 and 2^64 as numbers, which no
  64-bit object can hold. `exactInteger` reads those two numbers back as the
  maximums, so the limits print, draw and overflow correctly:
  `printf("%lld", LLONG_MAX)` prints `9223372036854775807`, and
  `LLONG_MAX + 1` wraps to `LLONG_MIN` with a `signed-overflow` warning. The
  `printf` formatter applies the same rule to a number argument of a 64-bit
  conversion. The cost of the rule is that `%lld` of an unsigned 2^63 prints
  `LLONG_MAX` rather than `LLONG_MIN`.

If approximate values past 2^53 are ever not good enough, the alternative is
to hold 64-bit values as `bigint` throughout the engine, which every consumer
of a value would have to handle.

## Format specifiers

### `printf`

Since L1, Plivet formats with its own code:

- `src/interpreter/printf.ts` does the formatting. It imports nothing from the
  engine, so the same code ships as `c-stdio.js`.
- `library/stdio.ts` reads each argument from memory by the conversion that
  consumes it.

It covers:

- the conversions `d i u o x X e E f F g G a A c s p n %`;
- the flags `-` `+` space `0` `#`;
- width and precision, with `*` for either;
- the length modifiers `hh h l ll j z t L`, with C's wrap at each width.

Where C leaves a choice to the implementation, it follows glibc on x86-64:
`%p` prints `0x` and lowercase hexadecimal, and a null pointer prints as
`(nil)`. One departure: a NaN prints as `nan` whatever its sign bit.

The four defects of the old `agh.sprintf` wrapper are fixed, and each has a
test:

- `%n` stores the count.
- `%p` of a `char *` prints the address.
- An integer that equals a `char` object's address prints as an integer.
- An unknown conversion is a runtime diagnostic, and nothing is written for
  it.

`test/fixtures/stdio-parity.json` (158 cases) runs through both
`formatPrintf` and the interpreter. Other misuses are also diagnostics now:
a missing argument, an argument of the wrong width, and a length modifier that
does not apply to its conversion.

`agh.sprintf` accepted two things that the new formatter refuses. Each one
raises an `unknown-conversion` diagnostic, and nothing is written for the
directive:

- positional arguments, `%2$d` (POSIX, not ISO C);
- the non-standard `%C` and `%S`.

The `'` thousands-grouping flag (POSIX) is accepted and does nothing, as in
glibc's "C" locale, which is the one a program that never calls `setlocale`
runs in: `printf("[%'d]", 1234567)` prints `[1234567]`. A `posix-flag`
warning says the flag had no effect. TeachingLint counts the directive, so
the arguments after it are checked against the right conversions.

### `scanf`

`scanf` is Plivet's own implementation: `src/interpreter/scanf.ts`, with the
storing half in `library/stdio.ts` (shared with `fscanf` and `sscanf`).

- It accepts `d i u o x X p e E f F g G a A c s n % [`, with `*` suppression,
  field widths, and scansets including ranges and `^` negation.
- `%p` reads what `%p` prints: `0x` and hexadecimal, or `(nil)` for a null
  pointer.
- The length modifiers `h l L j z t` are parsed and skipped, repeats included,
  so `hh` and `ll` are accepted. The destination address decides the size
  instead.

Three departures from C are deliberate and documented at the top of
`scanf.ts`. Leave all three alone:

- Whitespace in the format never waits for more input.
- A numeric conversion keeps the longest valid prefix rather than failing on a
  partial match.
- End of input is a single event, as Ctrl+D at a terminal is. A read after
  `EOF` waits for new input instead of returning `EOF` again.

A failed conversion is not silent as it is in C. `scanf` and `fscanf` write
`[scanf] %d did not match 'a' - it stays in the input, so the next read
starts there.` into the program's output. `sscanf` writes that it stops at the
first directive that fails, and what it returns. C's silence here is what
makes `scanf` hard to teach.

### The lint

`src/interpreter/TeachingLint.ts` checks argument types against the format
string for `printf` `fprintf` `sprintf` `snprintf` `scanf` `fscanf` `sscanf`.
All seven are now callable. The `v*printf` family has no row, because its
arguments arrive in a `va_list`.

## Suggested order of work

Ranked by how often a first-year C course hits the gap, not by implementation
cost.

1. **Name the function when a call to an unknown name fails.** For example:
   "`strdup` is not in Plivet's library". Of everything on this list, this is
   the failure a student is most likely to see, and today's message does not
   explain it.
2. **`getc`, `putc`, `strdup`, `abort`.** Small, and common in course code.
3. **`<time.h>` broken-down time, the `f` variants of the math functions,
   `lround`.**
