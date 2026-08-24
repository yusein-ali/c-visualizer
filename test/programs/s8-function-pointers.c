#include<stdio.h>

int add(int a, int b){ return a + b; }
int sub(int a, int b){ return a - b; }
int mul(int a, int b){ return a * b; }

typedef int (*BinOp)(int, int);

struct Calculator {
  int (*operation)(int, int);
  int accumulator;
};

int (*chosen)(int, int) = add;

/* A callback taken as a parameter: the shape qsort and bsearch use. */
int reduce(int (*step)(int, int), int seed, int values[], int count){
  int total = seed;
  for (int i = 0; i < count; i = i + 1) {
    total = step(total, values[i]);
  }
  return total;
}

int main(){
  int (*op)(int, int) = add;
  int (*table[3])(int, int) = {add, sub, mul};
  BinOp aliased = mul;
  struct Calculator calc;
  int values[4] = {1, 2, 3, 4};

  calc.operation = add;
  calc.accumulator = 0;
  calc.accumulator = calc.operation(calc.accumulator, 10);

  op = sub;

  /* Set a breakpoint here to inspect each pointer, its signature and the
     function it holds. */
  printf("direct=%d table=%d %d %d alias=%d\n",
         op(9, 4), table[0](2, 3), table[1](7, 3), table[2](2, 3),
         aliased(3, 4));
  printf("global=%d member=%d reduced=%d\n",
         chosen(2, 3), calc.accumulator, reduce(add, 0, values, 4));
  return 0;
}
