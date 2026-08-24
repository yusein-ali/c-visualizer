#include<stdio.h>

int fact(int n){
  int r = 1;
  if (n > 1) {
    r = n * fact(n - 1);
  }
  printf("fact(%d)\n", n);
  return r;
}

int main(){
  int n = 4;
  int result = fact(n);
  printf("%d\n", result);
  return 0;
}
