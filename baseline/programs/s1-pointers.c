#include<stdio.h>

int main(){
  int v = 7;
  int* p = &v;
  int** pp = &p;

  int arr[5] = {1, 2, 3, 4, 5};
  int* inner = &arr[2];
  *inner = 99;

  int* heap = malloc(sizeof(int) * 3);
  heap[0] = 10;
  heap[1] = 20;
  heap[2] = 30;

  int* rows[2];
  rows[0] = malloc(sizeof(int) * 2);
  rows[1] = malloc(sizeof(int) * 2);
  rows[0][0] = 1; rows[0][1] = 2;
  rows[1][0] = 3; rows[1][1] = 4;

  printf("%d %d %d\n", **pp, *inner, heap[2]);
  return 0;
}
