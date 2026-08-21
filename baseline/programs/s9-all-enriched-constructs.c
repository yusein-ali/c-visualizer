/*
 * PLIVET C construct tour
 *
 * Paste this file into the editor, choose Start, and use Step/Step All.
 * Useful places for breakpoints are marked with "BREAKPOINT" below.
 *
 * The program deliberately exercises every source construct currently named
 * by the editor/canvas, plus every major runtime shape:
 *
 *   declarations: variables, functions, typedefs, enum constants, and fields
 *   control flow: if/else, for, while, do-while, switch, break, continue,
 *                 calls, recursion, and return
 *   expressions: assignment, compound assignment, cast, and ternary
 *   memory: globals, static/const/register objects, stack frames, arrays,
 *           structs, unions, enums, strings, pointers, and heap allocations
 *   callable data: direct calls, callbacks, typedef'd function pointers,
 *                  arrays of function pointers, and a function-pointer field
 *   preprocessing: object/function macros, nested expansion, stringification,
 *                  token pasting, variadics, conditionals, and __LINE__
 */

#include <stdio.h>
#include <stdlib.h>

#define ITEM_COUNT 3
#define DOUBLE(x) ((x) * 2)
#define SCALED_COUNT DOUBLE(ITEM_COUNT)
#define STRINGIFY_RAW(x) #x
#define STRINGIFY(x) STRINGIFY_RAW(x)
#define JOIN_RAW(a, b) a##b
#define JOIN(a, b) JOIN_RAW(a, b)
#define LOG(fmt, ...) printf(fmt, ##__VA_ARGS__)
#define TOUR_LEVEL 2
#define ENABLE_CALLBACKS
#define MULTILINE_VALUE \
  (1 + 3)

#ifdef ENABLE_CALLBACKS
#define CALLBACKS_AVAILABLE 1
#endif

#ifndef DISABLED_FEATURE
#define FALLBACK_VALUE 0
#endif

#if TOUR_LEVEL > 1 && defined(ENABLE_CALLBACKS)
#define SELECTED_BONUS 5
#elif TOUR_LEVEL == 1
#define SELECTED_BONUS 2
#else
#define SELECTED_BONUS 0
#endif

#if 0
This intentionally invalid C is removed before parsing.
#endif

enum Mode {
  MODE_IDLE,
  MODE_RUN = 3,
  MODE_DONE
};

typedef enum Mode Mode;

union Number {
  int whole;
  char byte;
};

struct Pair {
  int left;
  int right;
};

typedef int (*BinaryOperation)(int, int);

struct Calculator {
  BinaryOperation operation;
  int accumulator;
};

typedef struct Snapshot {
  struct Pair pair;
  union Number number;
  Mode mode;
  int samples[ITEM_COUNT];
} Snapshot;

int zero_global;
int initialized_global = 7;
static int file_static = 8;
const int read_only_global = 9;
volatile int signal_flag = 0;
_Atomic(int) atomic_count = 0;

static int add(int a, int b) {
  return a + b;
}

int subtract(int a, int b) {
  return a - b;
}

int multiply(int a, int b) {
  return a * b;
}

int apply(BinaryOperation operation, int a, int b) {
  return operation(a, b);
}

struct Pair make_pair(int left, int right) {
  struct Pair result = {0, 0};
  result.left = left;
  result.right = right;
  return result;
}

int factorial(int n) {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}

BinaryOperation global_operation = add;

int main() {
  auto int automatic = 1;
  register int fast = 2;
  static int visits = 0;
  const int fixed = 4;
  volatile int changing = 0;
  int JOIN(named_, value) = SELECTED_BONUS;
  int macro_flags = CALLBACKS_AVAILABLE + FALLBACK_VALUE + MULTILINE_VALUE;

  int values[ITEM_COUNT] = {1, 2, 3};
  int grid[2][2] = {{1, 2}, {3, 4}};
  char word[7] = "PLIVET";
  int *pointer = &values[1];
  int **pointer_to_pointer = &pointer;
  int *restrict restricted_view = values;

  struct Pair first = make_pair(10, 20);
  struct Pair copied = first;
  union Number number = {0};
  number.whole = 65;
  Mode mode = MODE_RUN;

  BinaryOperation operation = add;
  BinaryOperation operations[3] = {add, subtract, multiply};
  Snapshot snapshot = {
    {first.left, first.right},
    {65},
    MODE_RUN,
    {1, 2, 3}
  };
  struct Calculator calculator = {subtract, 0};

  struct Pair heap_source = {11, 22};
  struct Pair *heap_pair = (struct Pair *)malloc(sizeof(struct Pair));
  *heap_pair = heap_source;

  visits += 1;
  initialized_global += 1;
  zero_global = fixed;
  signal_flag = 1;
  atomic_count = 2;
  changing = 3;
  *pointer = 9;
  restricted_view[0] = 6;

  int sum = 0;
  for (int i = 0; i < ITEM_COUNT; i += 1) {
    if (i == 1) {
      continue;
    }
    sum += values[i];
  }

  int countdown = 2;
  while (countdown > 0) {
    sum += countdown;
    countdown -= 1;
  }

  int once = 0;
  do {
    once += 1;
  } while (once < 1);

  switch (mode) {
    case MODE_IDLE:
      sum = -1;
      break;
    case MODE_RUN:
      sum += SELECTED_BONUS;
      break;
    default:
      sum = 0;
      break;
  }

  int larger = first.left > first.right ? first.left : first.right;
  double widened = (double)sum;
  operation = operations[2];
  int product = operation(3, 4);
  snapshot.pair = copied;

  int direct_result = global_operation(2, 3);
  int callback_result = apply(operation, 4, 5);
  int member_result = calculator.operation(9, 4);
  int member_display = calculator.operation(8, 3);
  int recursive_result = factorial(4);
  int snapshot_left = snapshot.pair.left;
  int heap_left = heap_pair->left;
  int heap_right = heap_pair->right;

  /* BREAKPOINT: inspect all memory regions, aggregates, and pointer arrows. */
  LOG("tour ready\n");
  LOG("%s: count=%d scaled=%d line=%d\n", STRINGIFY(PLIVET), ITEM_COUNT, SCALED_COUNT, __LINE__);
  printf("flow=%d once=%d larger=%d widened=%d\n",
         sum, once, larger, (int)widened);
  printf("calls=%d/%d/%d recursive=%d\n",
         direct_result, callback_result, member_result, recursive_result);
  printf("memory=%d/%d/%d/%d/%d/%d/%d text=%s grid=%d union=%d/%c\n",
         automatic, fast, visits, zero_global, initialized_global, file_static,
         read_only_global, word, grid[1][1], number.whole, number.byte);
  printf("aggregate=%d/%d/%d product=%d enum=%d heap=%d->%d macro=%d/%d\n",
         snapshot_left, copied.right, member_display, product, mode,
         heap_left, heap_right, named_value, macro_flags);

  /* BREAKPOINT: watch the heap aggregate disappear after this call. */
  free(heap_pair);

#undef ENABLE_CALLBACKS
  return 0;
}
