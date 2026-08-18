/**
 * The library functions the interpreter provides, with a signature and a short
 * description in each interface language.
 *
 * The list mirrors what CPP14Engine registers in includeStdio, includeStdlib,
 * includeMath and includeString - nothing here is documented that a program
 * cannot actually call, and nothing callable is left undocumented.
 *
 * The strings live here rather than in `locales/` because they are one table
 * with two columns; splitting them across two files would mean editing both
 * every time a function is added.
 */
export interface LibraryEntry {
  signature: string;
  en: string;
  ja: string;
}

const entries: { [name: string]: LibraryEntry } = {
  printf: {
    signature: 'int printf(const char* format, ...)',
    en: 'writes formatted text to the output',
    ja: '書式付きで出力する',
  },
  scanf: {
    signature: 'int scanf(const char* format, ...)',
    en: 'reads formatted input; the program waits for a line',
    ja: '書式付きで入力を読み込む。入力待ちになる',
  },
  gets: {
    signature: 'char* gets(char* buffer)',
    en: 'reads one line of input into a buffer',
    ja: '1行読み込んでバッファに入れる',
  },
  getchar: {
    signature: 'int getchar(void)',
    en: 'reads a single character from the input',
    ja: '1文字読み込む',
  },
  fopen: {
    signature: 'FILE* fopen(const char* name, const char* mode)',
    en: 'opens a file and returns a handle, or null on failure',
    ja: 'ファイルを開く。失敗すると null',
  },
  fclose: {
    signature: 'int fclose(FILE* file)',
    en: 'closes a file opened with fopen',
    ja: 'ファイルを閉じる',
  },
  fgetc: {
    signature: 'int fgetc(FILE* file)',
    en: 'reads one character from a file',
    ja: 'ファイルから1文字読み込む',
  },
  fputc: {
    signature: 'int fputc(int c, FILE* file)',
    en: 'writes one character to a file',
    ja: 'ファイルに1文字書き込む',
  },
  fgets: {
    signature: 'char* fgets(char* buffer, int size, FILE* file)',
    en: 'reads one line from a file into a buffer',
    ja: 'ファイルから1行読み込む',
  },
  fputs: {
    signature: 'int fputs(const char* text, FILE* file)',
    en: 'writes a string to a file',
    ja: 'ファイルに文字列を書き込む',
  },
  fflush: {
    signature: 'int fflush(FILE* file)',
    en: 'flushes buffered output',
    ja: 'バッファをフラッシュする',
  },
  malloc: {
    signature: 'void* malloc(size_t size)',
    en: 'allocates that many bytes on the heap',
    ja: 'ヒープにメモリを確保する',
  },
  free: {
    signature: 'void free(void* pointer)',
    en: 'releases memory obtained from malloc',
    ja: 'malloc で確保したメモリを解放する',
  },
  exit: {
    signature: 'void exit(int status)',
    en: 'ends the program immediately',
    ja: 'プログラムを終了する',
  },
  atoi: {
    signature: 'int atoi(const char* text)',
    en: 'converts text to an int',
    ja: '文字列を整数に変換する',
  },
  rand: {
    signature: 'int rand(void)',
    en: 'returns a pseudo-random integer',
    ja: '疑似乱数を返す',
  },
  abs: {
    signature: 'int abs(int x)',
    en: 'absolute value of an integer',
    ja: '整数の絶対値',
  },
  sizeof: {
    signature: 'size_t sizeof(type)',
    en: 'size of a type in bytes',
    ja: '型のバイト数',
  },
  strlen: {
    signature: 'size_t strlen(const char* text)',
    en: 'length of a string, not counting the terminator',
    ja: '終端文字を除いた文字列の長さ',
  },
  strcpy: {
    signature: 'char* strcpy(char* to, const char* from)',
    en: 'copies a string, terminator included',
    ja: '文字列をコピーする',
  },
  strcat: {
    signature: 'char* strcat(char* to, const char* from)',
    en: 'appends a string to another',
    ja: '文字列を連結する',
  },
  strcmp: {
    signature: 'int strcmp(const char* a, const char* b)',
    en: 'compares two strings; 0 when they are equal',
    ja: '2つの文字列を比較する。等しければ 0',
  },
  sqrt: { signature: 'double sqrt(double x)', en: 'square root', ja: '平方根' },
  cbrt: { signature: 'double cbrt(double x)', en: 'cube root', ja: '立方根' },
  pow: {
    signature: 'double pow(double x, double y)',
    en: 'x raised to the power y',
    ja: 'x の y 乗',
  },
  exp: {
    signature: 'double exp(double x)',
    en: 'e raised to the power x',
    ja: 'e の x 乗',
  },
  log: {
    signature: 'double log(double x)',
    en: 'natural logarithm',
    ja: '自然対数',
  },
  fabs: {
    signature: 'double fabs(double x)',
    en: 'absolute value of a floating-point number',
    ja: '浮動小数点数の絶対値',
  },
  floor: {
    signature: 'double floor(double x)',
    en: 'rounds down to an integer',
    ja: '切り捨て',
  },
  ceil: {
    signature: 'double ceil(double x)',
    en: 'rounds up to an integer',
    ja: '切り上げ',
  },
  round: {
    signature: 'double round(double x)',
    en: 'rounds to the nearest integer',
    ja: '四捨五入',
  },
  rint: {
    signature: 'double rint(double x)',
    en: 'rounds to the nearest integer, halves to even',
    ja: '最近接偶数への丸め',
  },
  fmod: {
    signature: 'double fmod(double x, double y)',
    en: 'remainder of x divided by y',
    ja: 'x を y で割った余り',
  },
  fmax: {
    signature: 'double fmax(double x, double y)',
    en: 'the larger of two numbers',
    ja: '大きい方の値',
  },
  fmin: {
    signature: 'double fmin(double x, double y)',
    en: 'the smaller of two numbers',
    ja: '小さい方の値',
  },
  fdim: {
    signature: 'double fdim(double x, double y)',
    en: 'positive difference, or zero',
    ja: '正の差。負なら 0',
  },
  hypot: {
    signature: 'double hypot(double x, double y)',
    en: 'length of the hypotenuse',
    ja: '斜辺の長さ',
  },
  sin: { signature: 'double sin(double x)', en: 'sine', ja: '正弦' },
  cos: { signature: 'double cos(double x)', en: 'cosine', ja: '余弦' },
  tan: { signature: 'double tan(double x)', en: 'tangent', ja: '正接' },
  asin: { signature: 'double asin(double x)', en: 'arc sine', ja: '逆正弦' },
  acos: { signature: 'double acos(double x)', en: 'arc cosine', ja: '逆余弦' },
  atan: { signature: 'double atan(double x)', en: 'arc tangent', ja: '逆正接' },
  sinh: {
    signature: 'double sinh(double x)',
    en: 'hyperbolic sine',
    ja: '双曲線正弦',
  },
  cosh: {
    signature: 'double cosh(double x)',
    en: 'hyperbolic cosine',
    ja: '双曲線余弦',
  },
  tanh: {
    signature: 'double tanh(double x)',
    en: 'hyperbolic tangent',
    ja: '双曲線正接',
  },
};

export function libraryHelp(name: string): LibraryEntry | null {
  const entry = entries[name];
  return typeof entry === 'undefined' ? null : entry;
}

export function libraryNames(): string[] {
  return Object.keys(entries);
}
