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
    description: 'writes formatted text to the output',
  },
  scanf: {
    signature: 'int scanf(const char* format, ...)',
    description:
      'reads formatted input; returns how many values it converted, and stops at the first one it cannot',
  },
  gets: {
    signature: 'char* gets(char* buffer)',
    description: 'reads one line of input into a buffer',
  },
  getchar: {
    signature: 'int getchar(void)',
    description: 'reads a single character from the input',
  },
  fopen: {
    signature: 'FILE* fopen(const char* name, const char* mode)',
    description: 'opens a file and returns a handle, or null on failure',
  },
  fclose: {
    signature: 'int fclose(FILE* file)',
    description: 'closes a file opened with fopen',
  },
  fgetc: {
    signature: 'int fgetc(FILE* file)',
    description: 'reads one character from a file',
  },
  fputc: {
    signature: 'int fputc(int c, FILE* file)',
    description: 'writes one character to a file',
  },
  fgets: {
    signature: 'char* fgets(char* buffer, int size, FILE* file)',
    description: 'reads one line from a file into a buffer',
  },
  fputs: {
    signature: 'int fputs(const char* text, FILE* file)',
    description: 'writes a string to a file',
  },
  fflush: {
    signature: 'int fflush(FILE* file)',
    description: 'flushes buffered output',
  },
  malloc: {
    signature: 'void* malloc(size_t size)',
    description: 'allocates that many bytes on the heap',
  },
  free: {
    signature: 'void free(void* pointer)',
    description: 'releases memory obtained from malloc',
  },
  exit: {
    signature: 'void exit(int status)',
    description: 'ends the program immediately',
  },
  atoi: {
    signature: 'int atoi(const char* text)',
    description: 'converts text to an int',
  },
  rand: {
    signature: 'int rand(void)',
    description: 'returns a pseudo-random integer',
  },
  abs: {
    signature: 'int abs(int x)',
    description: 'absolute value of an integer',
  },
  sizeof: {
    signature: 'size_t sizeof(type)',
    description: 'size of a type in bytes',
  },
  strlen: {
    signature: 'size_t strlen(const char* text)',
    description: 'length of a string, not counting the terminator',
  },
  strcpy: {
    signature: 'char* strcpy(char* to, const char* from)',
    description: 'copies a string, terminator included',
  },
  strcat: {
    signature: 'char* strcat(char* to, const char* from)',
    description: 'appends a string to another',
  },
  strcmp: {
    signature: 'int strcmp(const char* a, const char* b)',
    description: 'compares two strings; 0 when they are equal',
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
    description: 'rounds down to an integer',
  },
  ceil: {
    signature: 'double ceil(double x)',
    description: 'rounds up to an integer',
  },
  round: {
    signature: 'double round(double x)',
    description: 'rounds to the nearest integer',
  },
  rint: {
    signature: 'double rint(double x)',
    description: 'rounds to the nearest integer, halves to even',
  },
  fmod: {
    signature: 'double fmod(double x, double y)',
    description: 'remainder of x divided by y',
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
    description: 'positive difference, or zero',
  },
  hypot: {
    signature: 'double hypot(double x, double y)',
    description: 'length of the hypotenuse',
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
