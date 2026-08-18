#include<stdio.h>

int main(){
  int nums[6] = {3, 1, 4, 1, 5, 9};
  int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  char text[6] = "PLIVET";

  int i = 0;
  int sum = 0;
  while (i < 6) {
    sum = sum + nums[i];
    i = i + 1;
  }

  grid[1][2] = sum;
  printf("%d\n", sum);
  return 0;
}
