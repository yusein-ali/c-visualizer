/*
 * Preprocessor features PLIVET supports, and the ones it does not.
 *
 * unicoen.ts has no preprocessor; PLIVET runs its own pass in
 * src/interpreter/preprocess.ts before the parser sees the code.
 * baseline/scripts/probe-preprocessor.js measures both, feature by feature.
 *
 * Supported: object-like and function-like macros, nested expansion, #undef,
 * #ifdef / #ifndef / #if / #elif / #else / #endif with arithmetic and
 * defined(), backslash continuation, stringification (#x), token pasting
 * (a##b), variadic macros with __VA_ARGS__ including the GNU
 * `, ##__VA_ARGS__` idiom, __LINE__. Expansion skips string literals,
 * character literals and comments, and directives are removed without moving
 * any line - the highlight and breakpoints stay aligned.
 *
 * Out of scope: __VA_OPT__, which is C++20 and C23 - this is a C++14 parser,
 * and `, ##__VA_ARGS__` is the C++14-era answer to the same problem.
 * #include lines are dropped: printf, malloc and sqrt come from the engine
 * whether or not a header is named.
 *
 * Run it, or step through it. Expected output is noted per line.
 */
#include<stdio.h>
#include<stdlib.h>
#include<math.h>

#define SIZE 4
#define STEP (1+1)
#define SCALED (SIZE*STEP)
#define SQ(x) ((x)*(x))
#define MAX(a,b) ((a) > (b) ? (a) : (b))
#define SHOW(e) printf("%s = %d\n", #e, e)
#define JOIN(a,b) a##b
#define LOG(fmt, ...) printf(fmt, ##__VA_ARGS__)
#define VERBOSE
#define LEVEL 2

int main() {
  int i = 0;
  int* heap;
  int a[SIZE];

  /* 1. object-like macro, in an expression and as an array size */
  for (i = 0; i < SIZE; i++) {
    a[i] = i * STEP;
  }
  printf("len %d last %d\n", SIZE, a[SIZE - 1]);        /* len 4 last 6 */

  /* 2. a macro whose value names other macros */
  printf("scaled %d\n", SCALED);                        /* scaled 8 */

  /* 3. function-like macros, with any arguments - not just the parameter
     name used in the definition */
  printf("square %d\n", SQ(3));                         /* square 9 */
  printf("larger %d\n", MAX(SIZE, 9));                  /* larger 9 */

  /* 4. stringification quotes the argument as it was written, before any
     expansion - and printing it needs a printf that can format a string
     literal, which is why PLIVET replaces that library function too. */
  SHOW(SIZE * 2);                                       /* SIZE * 2 = 8 */

  /* 5. token pasting glues its operands into one identifier */
  int part1 = 41;
  printf("joined %d\n", JOIN(part, 1));                 /* joined 41 */

  /* 6. variadic macro. The GNU comma idiom means the same macro takes a
     format with arguments and one without. */
  LOG("logged %d and %d\n", 1, 2);                      /* logged 1 and 2 */
  LOG("logged nothing\n");                              /* logged nothing */

  /* 7. conditional compilation. Only the taken branch is compiled; the other
     one is blanked out before the parser ever sees it. */
#ifdef VERBOSE
  printf("verbose on\n");                               /* verbose on */
#else
  printf("verbose off\n");
#endif

#if LEVEL > 1 && defined(SIZE)
  printf("level high\n");                               /* level high */
#elif LEVEL == 1
  printf("level low\n");
#endif

#if 0
  this text is not C and is dropped before parsing ;;;
#endif

  /* 8. a macro name inside a string or inside a longer identifier is left
     alone - both used to be replaced, which printed "4 = 4" and turned
     `int SIZEx` into `int 4x`. */
  int SIZEx = 1;
  printf("SIZE = %d, SIZEx = %d\n", SIZE, SIZEx);       /* SIZE = 4, SIZEx = 1 */

  /* 9. #undef really stops expansion */
#undef SIZE
  printf("SIZE is text now\n");                         /* SIZE is text now */

  /* 10. library calls resolve without their headers */
  heap = malloc(sizeof(int) * 2);
  heap[0] = 9;
  heap[1] = 16;
  printf("roots %d\n", (int)(sqrt(heap[0]) + sqrt(heap[1])));  /* roots 7 */

  /* 11. __LINE__ is the line this appears on */
  printf("line %d\n", __LINE__);                        /* line 106 */

  return 0;
}
