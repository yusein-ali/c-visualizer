import { LIBRARY_CONSTANTS } from '../interpreter/library/constants';
import { STDIO_CONSTANTS } from '../interpreter/stream';
import {
  LIBRARY_TYPEDEFS,
  RECORD_TYPEDEFS,
} from '../interpreter/library/types';

/**
 * The library the interpreter provides - functions, macros, objects and
 * types - with a signature and a short description.
 *
 * This table is the source of truth for what a program may call: the editor
 * reads it for completion and hover help, and the deploy writes it into
 * `library.json` (`libraryManifest.ts`) for hosts that never run the
 * interpreter. It mirrors what CPP14Engine registers in includeStdio,
 * includeStdlib, includeMath and includeString, what `interpreter/library/`
 * adds after them, and the macros the preprocessor predefines - nothing here
 * is documented that a program cannot actually use, and nothing usable is
 * left undocumented, which `test/library-manifest.test.ts` checks against a
 * running engine. The object-like macros and the typedefs are read from the
 * same tables the engine installs them from.
 *
 * The descriptions live here rather than in `strings.ts` because they belong
 * to the entry they describe: a function is added with its text in one place.
 */
export interface LibraryEntry {
  signature: string;
  description: string;
  /**
   * The header that declares it. Every entry but an operator has one, and
   * the manifest test holds the table to that.
   */
  header?: string;
  /**
   * Absent for a function. An `operator` (`sizeof`) is documented for hover
   * help only and is not part of the library.
   */
  kind?: 'macro' | 'object' | 'type' | 'operator';
  /**
   * A macro written with parentheses, `assert(x)` or `offsetof(t, m)`, which
   * a program calls as it calls a function. Absent for an object-like macro.
   * Several are registered with the engine as functions under the hood; the
   * table says what C says they are.
   */
  functionLike?: true;
}

/** Entries for one header, which each of them records. */
const fromHeader = (
  header: string,
  group: { [name: string]: LibraryEntry }
): { [name: string]: LibraryEntry } =>
  Object.fromEntries(
    Object.entries(group).map(([name, entry]) => [name, { ...entry, header }])
  );

const stdioBasics = fromHeader('stdio.h', {
  printf: {
    signature: 'int printf(const char* format, ...)',
    description: 'writes formatted characters to the standard output stream',
  },
  scanf: {
    signature: 'int scanf(const char* format, ...)',
    description:
      'reads formatted input from the standard input stream and returns the number of input items assigned, or EOF if input fails before the first assignment',
  },
  sprintf: {
    signature: 'int sprintf(char* buffer, const char* format, ...)',
    description:
      'writes formatted characters and a terminating null character to an array without checking its size, and returns the number of characters written',
  },
  snprintf: {
    signature:
      'int snprintf(char* buffer, size_t size, const char* format, ...)',
    description:
      'writes at most size - 1 formatted characters and a terminating null character, and returns the length the complete output would have had',
  },
  sscanf: {
    signature: 'int sscanf(const char* text, const char* format, ...)',
    description:
      'reads formatted input from a string and returns the number of input items assigned, or EOF if the string ends before the first conversion',
  },
  gets: {
    signature: 'char* gets(char* buffer)',
    description:
      'reads a line from the standard input stream, without its newline, and returns buffer, or a null pointer at the end of input; it cannot check the destination size, and C11 removed it',
  },
  getchar: {
    signature: 'int getchar(void)',
    description:
      'reads the next character from the standard input stream, or returns EOF',
  },
  fopen: {
    signature: 'FILE* fopen(const char* name, const char* mode)',
    description:
      'opens a file with mode "r", "w" or "a" (optionally + and b) and returns a pointer to its FILE object, or a null pointer with errno set (ENOENT for a missing file)',
  },
  fclose: {
    signature: 'int fclose(FILE* file)',
    description:
      'flushes what the stream has buffered into its file and closes the stream',
  },
  fgetc: {
    signature: 'int fgetc(FILE* file)',
    description: 'reads the next character from a stream, or returns EOF',
  },
  fputc: {
    signature: 'int fputc(int c, FILE* file)',
    description: 'writes one character to a stream',
  },
  fgets: {
    signature: 'char* fgets(char* buffer, int size, FILE* file)',
    description:
      'reads at most size - 1 characters from a stream, up to and including a newline, terminates them with a null character and returns buffer, or a null pointer at the end of input',
  },
  fputs: {
    signature: 'int fputs(const char* text, FILE* file)',
    description: 'writes a string, excluding its null character, to a stream',
  },
  fflush: {
    signature: 'int fflush(FILE* file)',
    description:
      'writes the data an output stream has buffered into its file; fflush(NULL) flushes every output stream',
  },
});

const stdlibBasics = fromHeader('stdlib.h', {
  malloc: {
    signature: 'void* malloc(size_t size)',
    description:
      'allocates size bytes of storage and returns a pointer to it, or a null pointer on failure',
  },
  free: {
    signature: 'void free(void* pointer)',
    description: 'deallocates storage returned by an allocation function',
  },
  exit: {
    signature: 'void exit(int status)',
    description: 'causes normal program termination with the specified status',
  },
  atoi: {
    signature: 'int atoi(const char* text)',
    description:
      'converts the initial integer representation in a string to int without reporting conversion errors',
  },
  rand: {
    signature: 'int rand(void)',
    description: 'returns a pseudo-random integer from 0 through RAND_MAX',
  },
  abs: {
    signature: 'int abs(int x)',
    description: 'returns the absolute value of an int',
  },
});

const operators: { [name: string]: LibraryEntry } = {
  sizeof: {
    kind: 'operator',
    signature: 'sizeof expression or sizeof(type-name)',
    description:
      'yields the size in bytes of its operand type; it is an operator, not a function',
  },
};

const stringBasics = fromHeader('string.h', {
  strlen: {
    signature: 'size_t strlen(const char* text)',
    description:
      'returns the number of characters before a string’s terminating null character',
  },
  strcpy: {
    signature: 'char* strcpy(char* to, const char* from)',
    description:
      'copies a string, including its terminating null character, to the destination array',
  },
  strcat: {
    signature: 'char* strcat(char* to, const char* from)',
    description:
      'appends a string, including its terminating null character, to the destination string',
  },
  strcmp: {
    signature: 'int strcmp(const char* a, const char* b)',
    description:
      'compares two strings and returns a value less than, equal to, or greater than 0',
  },
});

const mathBasics = fromHeader('math.h', {
  sqrt: { signature: 'double sqrt(double x)', description: 'square root' },
  cbrt: { signature: 'double cbrt(double x)', description: 'cube root' },
  pow: {
    signature: 'double pow(double x, double y)',
    description: 'x raised to the power y',
  },
  exp: {
    signature: 'double exp(double x)',
    description: 'e raised to the power x',
  },
  log: {
    signature: 'double log(double x)',
    description: 'natural logarithm',
  },
  fabs: {
    signature: 'double fabs(double x)',
    description: 'absolute value of a floating-point number',
  },
  floor: {
    signature: 'double floor(double x)',
    description: 'returns the greatest integer value not greater than x',
  },
  ceil: {
    signature: 'double ceil(double x)',
    description: 'returns the least integer value not less than x',
  },
  round: {
    signature: 'double round(double x)',
    description:
      'rounds to the nearest integer value, with halfway cases away from zero',
  },
  rint: {
    signature: 'double rint(double x)',
    description:
      'rounds to an integer value according to the current floating-point rounding direction',
  },
  fmod: {
    signature: 'double fmod(double x, double y)',
    description:
      'returns the floating-point remainder of x / y with the quotient truncated toward zero',
  },
  fmax: {
    signature: 'double fmax(double x, double y)',
    description: 'the larger of two numbers',
  },
  fmin: {
    signature: 'double fmin(double x, double y)',
    description: 'the smaller of two numbers',
  },
  fdim: {
    signature: 'double fdim(double x, double y)',
    description: 'returns x - y when x is greater than y, otherwise +0',
  },
  hypot: {
    signature: 'double hypot(double x, double y)',
    description: 'returns the square root of x squared plus y squared',
  },
  sin: { signature: 'double sin(double x)', description: 'sine' },
  cos: { signature: 'double cos(double x)', description: 'cosine' },
  tan: { signature: 'double tan(double x)', description: 'tangent' },
  asin: { signature: 'double asin(double x)', description: 'arc sine' },
  acos: { signature: 'double acos(double x)', description: 'arc cosine' },
  atan: { signature: 'double atan(double x)', description: 'arc tangent' },
  sinh: {
    signature: 'double sinh(double x)',
    description: 'hyperbolic sine',
  },
  cosh: {
    signature: 'double cosh(double x)',
    description: 'hyperbolic cosine',
  },
  tanh: {
    signature: 'double tanh(double x)',
    description: 'hyperbolic tangent',
  },
});

const stdioEntries = fromHeader('stdio.h', {
  vprintf: {
    signature: 'int vprintf(const char* format, va_list arguments)',
    description:
      'writes formatted characters to the standard output stream, taking the arguments from a va_list that va_start has started',
  },
  vfprintf: {
    signature:
      'int vfprintf(FILE* stream, const char* format, va_list arguments)',
    description:
      'writes formatted characters to a stream, taking the arguments from a va_list that va_start has started',
  },
  vsprintf: {
    signature:
      'int vsprintf(char* buffer, const char* format, va_list arguments)',
    description:
      'writes formatted characters and a terminating null character to an array without checking its size, taking the arguments from a va_list',
  },
  vsnprintf: {
    signature:
      'int vsnprintf(char* buffer, size_t size, const char* format, va_list arguments)',
    description:
      'writes at most size - 1 formatted characters and a terminating null character, taking the arguments from a va_list, and returns the length the complete output would have had',
  },
  fprintf: {
    signature: 'int fprintf(FILE* stream, const char* format, ...)',
    description:
      'writes formatted characters to a stream and returns the number of bytes written',
  },
  fscanf: {
    signature: 'int fscanf(FILE* stream, const char* format, ...)',
    description:
      'reads formatted input from a stream and returns the number of input items assigned, or EOF if input ends before the first conversion',
  },
  puts: {
    signature: 'int puts(const char* text)',
    description: 'writes a string and a newline to the standard output stream',
  },
  putchar: {
    signature: 'int putchar(int c)',
    description:
      'writes one character to the standard output stream and returns it',
  },
  ungetc: {
    signature: 'int ungetc(int c, FILE* stream)',
    description:
      'pushes a character back onto a stream, so the next read returns it, and clears the end-of-file indicator',
  },
  fread: {
    signature:
      'size_t fread(void* buffer, size_t size, size_t count, FILE* stream)',
    description:
      'reads up to count objects of size bytes from a stream into an array and returns how many it read completely',
  },
  fwrite: {
    signature:
      'size_t fwrite(const void* buffer, size_t size, size_t count, FILE* stream)',
    description:
      'writes count objects of size bytes from an array to a stream and returns how many it wrote',
  },
  fseek: {
    signature: 'int fseek(FILE* stream, long offset, int origin)',
    description:
      'moves a file stream to offset bytes from SEEK_SET, SEEK_CUR or SEEK_END and returns 0, or -1 on failure',
  },
  ftell: {
    signature: 'long ftell(FILE* stream)',
    description:
      'returns the current position of a file stream in bytes from its start, or -1 on failure',
  },
  rewind: {
    signature: 'void rewind(FILE* stream)',
    description:
      'moves a file stream back to its start and clears its end-of-file and error indicators',
  },
  feof: {
    signature: 'int feof(FILE* stream)',
    description:
      'returns nonzero once a read on the stream has found the end of its input',
  },
  ferror: {
    signature: 'int ferror(FILE* stream)',
    description:
      'returns nonzero once a read or write on the stream has failed',
  },
  clearerr: {
    signature: 'void clearerr(FILE* stream)',
    description: 'clears the end-of-file and error indicators of a stream',
  },
  perror: {
    signature: 'void perror(const char* text)',
    description:
      'writes text, a colon and the message for the current errno to the standard error stream',
  },
  remove: {
    signature: 'int remove(const char* name)',
    description:
      'deletes a file and returns 0, or -1 with errno set to ENOENT when there is no such file',
  },
  rename: {
    signature: 'int rename(const char* old_name, const char* new_name)',
    description:
      'renames a file, replacing any file that already has the new name, and returns 0, or -1 when the old one does not exist',
  },
  FILE: {
    kind: 'type',
    signature: 'typedef struct FILE FILE',
    description:
      'the type of a stream: fopen returns a pointer to one, and stdin, stdout and stderr each point at one; its members are the library’s own',
  },
  stdin: {
    kind: 'object',
    signature: 'FILE* stdin',
    description:
      'the standard input stream: what is typed into the console; Ctrl+D ends it',
  },
  stdout: {
    kind: 'object',
    signature: 'FILE* stdout',
    description: 'the standard output stream: the console',
  },
  stderr: {
    kind: 'object',
    signature: 'FILE* stderr',
    description: 'the standard error stream: the console, in the error colour',
  },
});

const ctypeEntries = fromHeader('ctype.h', {
  isalpha: {
    signature: 'int isalpha(int c)',
    description: 'returns nonzero when c is a letter, A to Z or a to z',
  },
  isdigit: {
    signature: 'int isdigit(int c)',
    description: 'returns nonzero when c is a decimal digit, 0 to 9',
  },
  isalnum: {
    signature: 'int isalnum(int c)',
    description: 'returns nonzero when c is a letter or a decimal digit',
  },
  isspace: {
    signature: 'int isspace(int c)',
    description:
      "returns nonzero when c is white space: ' ', '\\t', '\\n', '\\v', '\\f' or '\\r'",
  },
  isupper: {
    signature: 'int isupper(int c)',
    description: 'returns nonzero when c is an uppercase letter',
  },
  islower: {
    signature: 'int islower(int c)',
    description: 'returns nonzero when c is a lowercase letter',
  },
  ispunct: {
    signature: 'int ispunct(int c)',
    description:
      'returns nonzero when c is a printing character that is neither a letter, a digit nor a space',
  },
  isprint: {
    signature: 'int isprint(int c)',
    description:
      'returns nonzero when c is a printing character, space included',
  },
  isgraph: {
    signature: 'int isgraph(int c)',
    description:
      'returns nonzero when c is a printing character other than space',
  },
  iscntrl: {
    signature: 'int iscntrl(int c)',
    description:
      'returns nonzero when c is a control character (0 to 31, and 127)',
  },
  isxdigit: {
    signature: 'int isxdigit(int c)',
    description:
      'returns nonzero when c is a hexadecimal digit: 0 to 9, a to f or A to F',
  },
  isblank: {
    signature: 'int isblank(int c)',
    description: 'returns nonzero when c is a space or a horizontal tab',
  },
  toupper: {
    signature: 'int toupper(int c)',
    description:
      'returns the uppercase letter for a lowercase c, and any other c unchanged',
  },
  tolower: {
    signature: 'int tolower(int c)',
    description:
      'returns the lowercase letter for an uppercase c, and any other c unchanged',
  },
});

const stringEntries = fromHeader('string.h', {
  strncpy: {
    signature: 'char* strncpy(char* to, const char* from, size_t n)',
    description:
      'copies at most n characters and pads with null characters up to n; the copy has no terminator when from has n or more characters',
  },
  strncat: {
    signature: 'char* strncat(char* to, const char* from, size_t n)',
    description:
      'appends at most n characters of from to the string in to, then a null character',
  },
  strncmp: {
    signature: 'int strncmp(const char* a, const char* b, size_t n)',
    description:
      'compares at most n characters of two strings and returns a value less than, equal to, or greater than 0',
  },
  strchr: {
    signature: 'char* strchr(const char* s, int c)',
    description:
      'returns a pointer to the first occurrence of c in s, or a null pointer',
  },
  strrchr: {
    signature: 'char* strrchr(const char* s, int c)',
    description:
      'returns a pointer to the last occurrence of c in s, or a null pointer',
  },
  strstr: {
    signature: 'char* strstr(const char* haystack, const char* needle)',
    description:
      'returns a pointer to the first occurrence of needle in haystack, or a null pointer',
  },
  strtok: {
    signature: 'char* strtok(char* s, const char* delimiters)',
    description:
      'returns the next token of s, writing a null character over the delimiter that ends it; pass NULL to continue with the same string',
  },
  strspn: {
    signature: 'size_t strspn(const char* s, const char* accept)',
    description:
      'returns the length of the initial part of s made only of characters in accept',
  },
  strcspn: {
    signature: 'size_t strcspn(const char* s, const char* reject)',
    description:
      'returns the length of the initial part of s made only of characters not in reject',
  },
  strpbrk: {
    signature: 'char* strpbrk(const char* s, const char* accept)',
    description:
      'returns a pointer to the first character of s that is in accept, or a null pointer',
  },
  memcpy: {
    signature: 'void* memcpy(void* to, const void* from, size_t n)',
    description:
      'copies n bytes from one object to another; the two must not overlap',
  },
  memmove: {
    signature: 'void* memmove(void* to, const void* from, size_t n)',
    description: 'copies n bytes, correctly even when the two objects overlap',
  },
  memset: {
    signature: 'void* memset(void* s, int c, size_t n)',
    description: 'stores the byte value c in each of the first n bytes of s',
  },
  memcmp: {
    signature: 'int memcmp(const void* a, const void* b, size_t n)',
    description:
      'compares the first n bytes of two objects as unsigned char values',
  },
  memchr: {
    signature: 'void* memchr(const void* s, int c, size_t n)',
    description:
      'returns a pointer to the first byte equal to c among the first n bytes of s, or a null pointer',
  },
  strerror: {
    signature: 'char* strerror(int errnum)',
    description:
      'returns a pointer to the message for an error number, such as the value of errno',
  },
});

const stdlibEntries = fromHeader('stdlib.h', {
  realloc: {
    signature: 'void* realloc(void* pointer, size_t size)',
    description:
      'resizes an allocated block, moving it and its contents to a new block when it cannot grow where it is, and returns the block’s address, which may differ from pointer; realloc(NULL, size) is malloc(size)',
  },
  qsort: {
    signature:
      'void qsort(void* base, size_t count, size_t size, int (*compare)(const void*, const void*))',
    description:
      'sorts an array of count elements of size bytes in place, calling compare with pointers to two elements, which returns a negative int, zero or a positive int',
  },
  bsearch: {
    signature:
      'void* bsearch(const void* key, const void* base, size_t count, size_t size, int (*compare)(const void*, const void*))',
    description:
      'searches a sorted array for an element compare finds equal to *key, and returns a pointer to it or a null pointer',
  },
  calloc: {
    signature: 'void* calloc(size_t count, size_t size)',
    description:
      'allocates storage for count objects of size bytes each, with every byte set to zero, or returns a null pointer',
  },
  strtol: {
    signature: 'long strtol(const char* text, char** end, int base)',
    description:
      'converts the initial integer in a string to long, stores where the number ended through end, and sets errno to ERANGE on overflow',
  },
  strtoul: {
    signature: 'unsigned long strtoul(const char* text, char** end, int base)',
    description:
      'converts the initial integer in a string to unsigned long, stores where it ended through end, and sets errno to ERANGE on overflow',
  },
  strtoll: {
    signature: 'long long strtoll(const char* text, char** end, int base)',
    description:
      'converts the initial integer in a string to long long, stores where it ended through end, and sets errno to ERANGE on overflow',
  },
  strtoull: {
    signature:
      'unsigned long long strtoull(const char* text, char** end, int base)',
    description:
      'converts the initial integer in a string to unsigned long long, stores where it ended through end, and sets errno to ERANGE on overflow',
  },
  strtod: {
    signature: 'double strtod(const char* text, char** end)',
    description:
      'converts the initial floating-point number in a string to double, stores where it ended through end, and sets errno to ERANGE when it is out of range',
  },
  atof: {
    signature: 'double atof(const char* text)',
    description:
      'converts the initial floating-point number in a string to double without reporting conversion errors',
  },
  atol: {
    signature: 'long atol(const char* text)',
    description:
      'converts the initial integer in a string to long without reporting conversion errors',
  },
  atoll: {
    signature: 'long long atoll(const char* text)',
    description:
      'converts the initial integer in a string to long long without reporting conversion errors',
  },
  labs: {
    signature: 'long labs(long x)',
    description: 'returns the absolute value of a long',
  },
  llabs: {
    signature: 'long long llabs(long long x)',
    description: 'returns the absolute value of a long long',
  },
  div: {
    signature: 'div_t div(int numerator, int denominator)',
    description:
      'returns the quotient and the remainder of an int division together, in the members quot and rem',
  },
  ldiv: {
    signature: 'ldiv_t ldiv(long numerator, long denominator)',
    description:
      'returns the quotient and the remainder of a long division together, in the members quot and rem',
  },
  srand: {
    signature: 'void srand(unsigned int seed)',
    description:
      'seeds the pseudo-random sequence rand returns; the same seed gives the same sequence',
  },
});

const mathEntries = fromHeader('math.h', {
  atan2: {
    signature: 'double atan2(double y, double x)',
    description:
      'arc tangent of y / x, using the signs of both to choose the quadrant',
  },
  exp2: {
    signature: 'double exp2(double x)',
    description: '2 raised to the power x',
  },
  expm1: {
    signature: 'double expm1(double x)',
    description: 'e raised to the power x, minus 1, accurate for small x',
  },
  log10: {
    signature: 'double log10(double x)',
    description: 'base-10 logarithm',
  },
  log1p: {
    signature: 'double log1p(double x)',
    description: 'natural logarithm of 1 + x, accurate for small x',
  },
  log2: {
    signature: 'double log2(double x)',
    description: 'base-2 logarithm',
  },
  trunc: {
    signature: 'double trunc(double x)',
    description: 'rounds toward zero to an integer value',
  },
  nearbyint: {
    signature: 'double nearbyint(double x)',
    description:
      'rounds to an integer value in the current rounding direction (halfway cases to even)',
  },
  modf: {
    signature: 'double modf(double x, double* whole)',
    description:
      'splits x into its fractional part, which it returns, and its integer part, which it stores through whole',
  },
  frexp: {
    signature: 'double frexp(double x, int* exponent)',
    description:
      'splits x into a fraction in [0.5, 1), which it returns, and a power of 2, which it stores through exponent',
  },
  ldexp: {
    signature: 'double ldexp(double x, int exponent)',
    description: 'returns x multiplied by 2 raised to the power exponent',
  },
  copysign: {
    signature: 'double copysign(double x, double y)',
    description: 'returns the magnitude of x with the sign of y',
  },
  fma: {
    signature: 'double fma(double x, double y, double z)',
    description: 'returns x * y + z (rounded twice here, where C rounds once)',
  },
  remainder: {
    signature: 'double remainder(double x, double y)',
    description:
      'returns x - n * y, where n is x / y rounded to the nearest integer',
  },
  asinh: {
    signature: 'double asinh(double x)',
    description: 'inverse hyperbolic sine',
  },
  acosh: {
    signature: 'double acosh(double x)',
    description: 'inverse hyperbolic cosine',
  },
  atanh: {
    signature: 'double atanh(double x)',
    description: 'inverse hyperbolic tangent',
  },
  isnan: {
    kind: 'macro',
    functionLike: true,
    signature: 'int isnan(real-floating x)',
    description: 'macro: nonzero when x is a NaN',
  },
  isinf: {
    kind: 'macro',
    functionLike: true,
    signature: 'int isinf(real-floating x)',
    description:
      'macro: nonzero when x is an infinity (1 for positive, -1 for negative here, as in glibc)',
  },
  isfinite: {
    kind: 'macro',
    functionLike: true,
    signature: 'int isfinite(real-floating x)',
    description: 'macro: nonzero when x is neither an infinity nor a NaN',
  },
  signbit: {
    kind: 'macro',
    functionLike: true,
    signature: 'int signbit(real-floating x)',
    description: 'macro: nonzero when the sign of x is negative, -0.0 included',
  },
});

const otherEntries: { [name: string]: LibraryEntry } = {
  time: {
    header: 'time.h',
    signature: 'time_t time(time_t* timer)',
    description:
      'returns the current calendar time in seconds since 1970, and stores it through timer too unless timer is a null pointer',
  },
  clock: {
    header: 'time.h',
    signature: 'clock_t clock(void)',
    description:
      'returns the time used since the program started, in CLOCKS_PER_SEC units per second; here real time, because a step debugger mostly waits for its reader',
  },
  difftime: {
    header: 'time.h',
    signature: 'double difftime(time_t end, time_t start)',
    description: 'returns end - start, in seconds, as a double',
  },
  assert: {
    header: 'assert.h',
    kind: 'macro',
    functionLike: true,
    signature: 'void assert(scalar expression)',
    description:
      'macro: does nothing when the expression is true; otherwise prints "Assertion failed: expression, file main.c, line N" and aborts the program',
  },
  va_start: {
    header: 'stdarg.h',
    kind: 'macro',
    functionLike: true,
    signature: 'void va_start(va_list arguments, last)',
    description:
      'macro: starts a va_list on the unnamed arguments of the function declared with ..., after its last named parameter last',
  },
  va_arg: {
    header: 'stdarg.h',
    kind: 'macro',
    functionLike: true,
    signature: 'type va_arg(va_list arguments, type)',
    description:
      'macro: the next unnamed argument, read as type, which must be its type after the default argument promotions (int for char and short, double for float)',
  },
  va_copy: {
    header: 'stdarg.h',
    kind: 'macro',
    functionLike: true,
    signature: 'void va_copy(va_list destination, va_list source)',
    description:
      'macro: makes destination a copy of source, positioned at the same unnamed argument',
  },
  va_end: {
    header: 'stdarg.h',
    kind: 'macro',
    functionLike: true,
    signature: 'void va_end(va_list arguments)',
    description:
      'macro: ends the use of a va_list; call it before the function that started the list returns',
  },
  offsetof: {
    header: 'stddef.h',
    kind: 'macro',
    functionLike: true,
    signature: 'size_t offsetof(type, member)',
    description:
      'macro: the offset in bytes of a member from the start of its structure, padding included',
  },
  NULL: {
    header: 'stddef.h',
    kind: 'macro',
    signature: '#define NULL ((void*)0)',
    description:
      'the null pointer constant, which points to no object; <stdio.h>, <stdlib.h>, <string.h> and <time.h> define it too',
  },
  errno: {
    header: 'errno.h',
    kind: 'object',
    signature: 'int errno',
    description:
      'the error number the library sets when a call fails; set it to 0 before a call and test it after',
  },
  true: {
    header: 'stdbool.h',
    kind: 'macro',
    signature: '#define true 1',
    description: 'the int constant 1, as <stdbool.h> defines it',
  },
  false: {
    header: 'stdbool.h',
    kind: 'macro',
    signature: '#define false 0',
    description: 'the int constant 0, as <stdbool.h> defines it',
  },
};

/** The object-like macros, from the table the engine installs them from. */
const constantEntries: { [name: string]: LibraryEntry } = Object.fromEntries(
  Object.entries({ ...LIBRARY_CONSTANTS, ...STDIO_CONSTANTS }).map(
    ([name, constant]) => [
      name,
      {
        header: constant.header,
        kind: 'macro' as const,
        signature: `#define ${name} ${constant.spelling}`,
        description: constant.description,
      },
    ]
  )
);

/** The library's typedef names, from the table the canvas reads too. */
const typeEntries: { [name: string]: LibraryEntry } = Object.fromEntries([
  ...Object.entries(LIBRARY_TYPEDEFS).map(([name, typedef]) => [
    name,
    {
      header: typedef.header,
      kind: 'type' as const,
      signature: `typedef ${typedef.underlying} ${name}`,
      description: typedef.description,
    },
  ]),
  ...Object.entries(RECORD_TYPEDEFS).map(([name, record]) => [
    name,
    {
      header: record.header,
      kind: 'type' as const,
      signature: `typedef struct { ${record.members
        .map((member) => `${record.memberType} ${member};`)
        .join(' ')} } ${name}`,
      description: `the structure ${name.replace(
        /_t$/,
        ''
      )} returns: the quotient in quot and the remainder in rem`,
    },
  ]),
]);

const library: { [name: string]: LibraryEntry } = {
  ...stdioBasics,
  ...stdlibBasics,
  ...operators,
  ...stringBasics,
  ...mathBasics,
  ...stdioEntries,
  ...ctypeEntries,
  ...stringEntries,
  ...stdlibEntries,
  ...mathEntries,
  ...otherEntries,
  ...constantEntries,
  ...typeEntries,
};

export function libraryHelp(name: string): LibraryEntry | null {
  const entry = Object.prototype.hasOwnProperty.call(library, name)
    ? library[name]
    : undefined;
  return typeof entry === 'undefined' ? null : entry;
}

export function libraryNames(): string[] {
  return Object.keys(library);
}
