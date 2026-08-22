/**
 * The library functions the interpreter provides, with a signature and a short
 * description.
 *
 * The list mirrors what CPP14Engine registers in includeStdio, includeStdlib,
 * includeMath and includeString - nothing here is documented that a program
 * cannot actually call, and nothing callable is left undocumented.
 *
 * The descriptions live here rather than in `strings.ts` because they belong
 * to the entry they describe: a function is added with its text in one place.
 */
export interface LibraryEntry {
  signature: string;
  description: string;
}

const entries: { [name: string]: LibraryEntry } = {
  printf: {
    signature: 'int printf(const char* format, ...)',
    description: 'writes formatted characters to the standard output stream',
  },
  scanf: {
    signature: 'int scanf(const char* format, ...)',
    description:
      'reads formatted input from the standard input stream and returns the number of input items assigned, or EOF if input fails before the first assignment',
  },
  gets: {
    signature: 'char* gets(char* buffer)',
    description:
      'reads a line from the standard input stream without checking the destination size; this unsafe function was removed from C11',
  },
  getchar: {
    signature: 'int getchar(void)',
    description:
      'reads the next character from the standard input stream, or returns EOF',
  },
  fopen: {
    signature: 'FILE* fopen(const char* name, const char* mode)',
    description:
      'opens a stream associated with a file and returns a pointer to its FILE object, or a null pointer on failure',
  },
  fclose: {
    signature: 'int fclose(FILE* file)',
    description: 'closes the specified stream',
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
      'reads at most size - 1 characters from a stream and terminates the stored string with a null character',
  },
  fputs: {
    signature: 'int fputs(const char* text, FILE* file)',
    description: 'writes a string, excluding its null character, to a stream',
  },
  fflush: {
    signature: 'int fflush(FILE* file)',
    description: 'writes unwritten buffered data for an output stream',
  },
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
  sizeof: {
    signature: 'sizeof expression or sizeof(type-name)',
    description:
      'yields the size in bytes of its operand type; it is an operator, not a function',
  },
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
};

export function libraryHelp(name: string): LibraryEntry | null {
  const entry = entries[name];
  return typeof entry === 'undefined' ? null : entry;
}

export function libraryNames(): string[] {
  return Object.keys(entries);
}
