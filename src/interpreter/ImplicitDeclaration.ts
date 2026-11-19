import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';

/**
 * A call of a function that nothing declares.
 *
 * C99 removed implicit function declarations, and gcc 14 refuses such a call
 * as an error. The course's warm-ups are in this state until the student
 * writes the function or the macro (`reading_minutes(pages, 2)` before
 * `book.c` defines it, `MINUTES(pages)` before `shelf.h` does), and the
 * visualizer ran them and stopped at the call with "This statement could not
 * be executed". The check before a run refuses the program with gcc's words
 * (`TeachingLint`'s program rule), and the engine says the same where a call
 * is reached without that check.
 *
 * What counts as declared is deliberately wide, so that no program that runs
 * is refused: a name any file of the program declares as anything - a
 * function, with or without a body, anywhere; an object, a parameter, a
 * member - and every function of the C standard library, whether the
 * interpreter provides it or not. A function one file defines and another
 * calls without a prototype is refused by gcc and is not here: the files are
 * run as one program. A standard function the interpreter does not provide
 * (`abort`, `getenv`) is left to the run, where it is reached: with its
 * header included, gcc compiles it, and the message would be false.
 */

/** What gcc 14 says, and what to do about it. */
export function implicitDeclarationMessage(name: string): string {
  return (
    `implicit declaration of function '${name}': nothing in the program ` +
    `declares or defines ${name}, and since C99 a function has to be ` +
    `declared before it is called`
  );
}

/** The declarator's stars belong to the name the parser reports: `*p`. */
const withoutStars = (name: unknown): string =>
  String(name ?? '').replace(/^\**/, '');

/**
 * Every name the tree declares, as anything: functions, prototypes,
 * objects, parameters, members and typedefs, at any depth.
 */
export function declaredNamesIn(root: UniNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: any): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.fields === 'undefined') {
      return;
    }
    if (node instanceof UniFunctionDec && typeof node.name === 'string') {
      names.add(node.name);
    }
    if (node instanceof UniVariableDec && Array.isArray(node.variables)) {
      for (const variable of node.variables as { name: unknown }[]) {
        names.add(withoutStars(variable.name));
      }
    }
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field]);
      }
    }
  };
  visit(root);
  return names;
}

/** `sin`, `sinf` and `sinl`. */
const withFloatVariants = (names: string[]): string[] =>
  names.flatMap((name) => [name, `${name}f`, `${name}l`]);

/**
 * The functions and function-like macros of the C11 standard library, by the
 * header that declares them, and the keywords written like a call. A name
 * here is never an implicit declaration: see above.
 */
const STANDARD_FUNCTIONS: ReadonlySet<string> = new Set([
  // Keywords, and the <assert.h> and <stdalign.h> macros that spell them.
  ...[
    '_Static_assert',
    'static_assert',
    '_Generic',
    '_Alignof',
    'alignof',
    '_Alignas',
    'alignas',
  ],
  // <assert.h>
  'assert',
  // <complex.h>
  ...withFloatVariants([
    'cacos',
    'casin',
    'catan',
    'ccos',
    'csin',
    'ctan',
    'cacosh',
    'casinh',
    'catanh',
    'ccosh',
    'csinh',
    'ctanh',
    'cexp',
    'clog',
    'cabs',
    'cpow',
    'csqrt',
    'carg',
    'cimag',
    'conj',
    'cproj',
    'creal',
  ]),
  ...['CMPLX', 'CMPLXF', 'CMPLXL'],
  // <ctype.h>
  ...[
    'isalnum',
    'isalpha',
    'isblank',
    'iscntrl',
    'isdigit',
    'isgraph',
    'islower',
    'isprint',
    'ispunct',
    'isspace',
    'isupper',
    'isxdigit',
    'tolower',
    'toupper',
  ],
  // <fenv.h>
  ...[
    'feclearexcept',
    'fegetexceptflag',
    'feraiseexcept',
    'fesetexceptflag',
    'fetestexcept',
    'fegetround',
    'fesetround',
    'fegetenv',
    'feholdexcept',
    'fesetenv',
    'feupdateenv',
  ],
  // <inttypes.h>
  ...['imaxabs', 'imaxdiv', 'strtoimax', 'strtoumax', 'wcstoimax', 'wcstoumax'],
  // <locale.h>
  ...['setlocale', 'localeconv'],
  // <math.h>
  ...withFloatVariants([
    'acos',
    'asin',
    'atan',
    'atan2',
    'cos',
    'sin',
    'tan',
    'acosh',
    'asinh',
    'atanh',
    'cosh',
    'sinh',
    'tanh',
    'exp',
    'exp2',
    'expm1',
    'frexp',
    'ilogb',
    'ldexp',
    'log',
    'log10',
    'log1p',
    'log2',
    'logb',
    'modf',
    'scalbn',
    'scalbln',
    'cbrt',
    'fabs',
    'hypot',
    'pow',
    'sqrt',
    'erf',
    'erfc',
    'lgamma',
    'tgamma',
    'ceil',
    'floor',
    'nearbyint',
    'rint',
    'lrint',
    'llrint',
    'round',
    'lround',
    'llround',
    'trunc',
    'fmod',
    'remainder',
    'remquo',
    'copysign',
    'nan',
    'nextafter',
    'nexttoward',
    'fdim',
    'fmax',
    'fmin',
    'fma',
  ]),
  ...[
    'fpclassify',
    'isfinite',
    'isinf',
    'isnan',
    'isnormal',
    'signbit',
    'isgreater',
    'isgreaterequal',
    'isless',
    'islessequal',
    'islessgreater',
    'isunordered',
  ],
  // <setjmp.h>, <signal.h>
  ...['setjmp', 'longjmp', 'signal', 'raise'],
  // <stdarg.h>
  ...['va_start', 'va_arg', 'va_copy', 'va_end'],
  // <stddef.h>
  'offsetof',
  // <stdint.h>
  ...[
    'INT8_C',
    'INT16_C',
    'INT32_C',
    'INT64_C',
    'UINT8_C',
    'UINT16_C',
    'UINT32_C',
    'UINT64_C',
    'INTMAX_C',
    'UINTMAX_C',
  ],
  // <stdio.h>
  ...[
    'remove',
    'rename',
    'tmpfile',
    'tmpnam',
    'fclose',
    'fflush',
    'fopen',
    'freopen',
    'setbuf',
    'setvbuf',
    'fprintf',
    'fscanf',
    'printf',
    'scanf',
    'snprintf',
    'sprintf',
    'sscanf',
    'vfprintf',
    'vfscanf',
    'vprintf',
    'vscanf',
    'vsnprintf',
    'vsprintf',
    'vsscanf',
    'fgetc',
    'fgets',
    'fputc',
    'fputs',
    'getc',
    'getchar',
    'gets',
    'putc',
    'putchar',
    'puts',
    'ungetc',
    'fread',
    'fwrite',
    'fgetpos',
    'fseek',
    'fsetpos',
    'ftell',
    'rewind',
    'clearerr',
    'feof',
    'ferror',
    'perror',
  ],
  // <stdlib.h>
  ...[
    'atof',
    'atoi',
    'atol',
    'atoll',
    'strtod',
    'strtof',
    'strtold',
    'strtol',
    'strtoll',
    'strtoul',
    'strtoull',
    'rand',
    'srand',
    'aligned_alloc',
    'calloc',
    'free',
    'malloc',
    'realloc',
    'abort',
    'atexit',
    'at_quick_exit',
    'exit',
    '_Exit',
    'getenv',
    'quick_exit',
    'system',
    'bsearch',
    'qsort',
    'abs',
    'labs',
    'llabs',
    'div',
    'ldiv',
    'lldiv',
    'mblen',
    'mbtowc',
    'wctomb',
    'mbstowcs',
    'wcstombs',
  ],
  // <string.h>
  ...[
    'memcpy',
    'memmove',
    'strcpy',
    'strncpy',
    'strcat',
    'strncat',
    'memcmp',
    'strcmp',
    'strcoll',
    'strncmp',
    'strxfrm',
    'memchr',
    'strchr',
    'strcspn',
    'strpbrk',
    'strrchr',
    'strspn',
    'strstr',
    'strtok',
    'memset',
    'strerror',
    'strlen',
  ],
  // <time.h>
  ...[
    'clock',
    'difftime',
    'mktime',
    'time',
    'timespec_get',
    'asctime',
    'ctime',
    'gmtime',
    'localtime',
    'strftime',
  ],
  // <uchar.h>
  ...['mbrtoc16', 'c16rtomb', 'mbrtoc32', 'c32rtomb'],
  // <wchar.h>
  ...[
    'fwprintf',
    'fwscanf',
    'swprintf',
    'swscanf',
    'vfwprintf',
    'vfwscanf',
    'vswprintf',
    'vswscanf',
    'vwprintf',
    'vwscanf',
    'wprintf',
    'wscanf',
    'fgetwc',
    'fgetws',
    'fputwc',
    'fputws',
    'fwide',
    'getwc',
    'getwchar',
    'putwc',
    'putwchar',
    'ungetwc',
    'wcstod',
    'wcstof',
    'wcstold',
    'wcstol',
    'wcstoll',
    'wcstoul',
    'wcstoull',
    'wcscpy',
    'wcsncpy',
    'wmemcpy',
    'wmemmove',
    'wcscat',
    'wcsncat',
    'wcscmp',
    'wcscoll',
    'wcsncmp',
    'wcsxfrm',
    'wmemcmp',
    'wcschr',
    'wcscspn',
    'wcspbrk',
    'wcsrchr',
    'wcsspn',
    'wcsstr',
    'wcstok',
    'wmemchr',
    'wcslen',
    'wmemset',
    'wcsftime',
    'btowc',
    'wctob',
    'mbsinit',
    'mbrlen',
    'mbrtowc',
    'wcrtomb',
    'mbsrtowcs',
    'wcsrtombs',
  ],
  // <wctype.h>
  ...[
    'iswalnum',
    'iswalpha',
    'iswblank',
    'iswcntrl',
    'iswdigit',
    'iswgraph',
    'iswlower',
    'iswprint',
    'iswpunct',
    'iswspace',
    'iswupper',
    'iswxdigit',
    'iswctype',
    'wctype',
    'towlower',
    'towupper',
    'towctrans',
    'wctrans',
  ],
]);

/**
 * Whether a call of `name` is one gcc refuses as an implicit declaration:
 * nothing in the program declares it (`declared`), the interpreter does not
 * provide it (`provided`), and it is not a standard library function.
 */
export function isImplicitlyDeclared(
  name: string,
  declared: (name: string) => boolean,
  provided: (name: string) => boolean
): boolean {
  return (
    name !== '' &&
    !STANDARD_FUNCTIONS.has(name) &&
    !provided(name) &&
    !declared(name)
  );
}
