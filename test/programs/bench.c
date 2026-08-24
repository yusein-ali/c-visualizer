#include<stdio.h>

int sumTo(int n){
  int s = 0;
  int i = 0;
  while (i <= n) {
    s = s + i;
    i = i + 1;
  }
  return s;
}

int main(){
  int arr[10];
  int i = 0;
  int total = 0;
  while (i < 10) {
    arr[i] = sumTo(i);
    i = i + 1;
  }
  i = 0;
  while (i < 10) {
    total = total + arr[i];
    i = i + 1;
  }
  printf("%d\n", total);
  return 0;
}
