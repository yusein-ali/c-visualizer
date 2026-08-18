#include<stdio.h>
int recursiveToThree(int n){
  printf("%d th\n", n + 1);
  if(n < 3){
      int r = recursiveToThree(n + 1);
      n = r;
  }
  return n;
}
int main(){
  int n = 0;//variable declaration

  n = recursiveToThree(0);//recursive function

  int arr[5] = {1, 2, 3};//array variable

  int* ptr = &arr[2];//pointer variable
  *ptr = 5;

  //dynamic memory allocation
  int* d_arry = malloc(sizeof(int) * 3);

  //two-dimensional dynamic array
  int* pd_arr[2];
  pd_arr[0] = malloc(sizeof(int) * 2);
  pd_arr[1] = malloc(sizeof(int) * 2);

  printf("Hello,world!\n");//standard output

  free(pd_arr[0]);//memory leak

  //File Output
  {
    FILE* fp=NULL;
    fp = fopen("PLIVET.txt", "w");
    fputs("PLIVET", fp);
    fclose(fp);
  }

  //File Input
  {
    FILE* fp=NULL;
    char buf[7];
    fp = fopen("PLIVET.txt", "r");
    while(fgets(buf,10,fp) != NULL) {
      printf("%s",buf);
    }
    fclose(fp);
  }
  return 0;
}
