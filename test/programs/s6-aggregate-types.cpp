#include<stdio.h>

enum TrafficLight {
  RED = 1,
  YELLOW,
  GREEN
};

typedef enum {
  POWER_OFF,
  POWER_ON
} PowerState;

struct Point {
  int x;
  int y;
};

typedef struct {
  int id;
  struct Point position;
} Marker;

union Reading {
  int whole;
  char letter;
};

class Counter {
public:
  int value;
};

int main(){
  enum TrafficLight light = GREEN;
  PowerState power = POWER_ON;

  struct Point point;
  point.x = 3;
  point.y = 4;

  Marker marker;
  marker.id = 7;
  marker.position.x = point.x;
  marker.position.y = point.y;

  union Reading reading;
  reading.whole = 65;

  Counter counter;
  counter.value = 2;

  /* Set a breakpoint here to inspect every aggregate value. */
  printf("light=%d power=%d point=(%d,%d) marker=%d reading=%d/%c counter=%d\n",
         light, power, point.x, point.y, marker.id,
         reading.whole, reading.letter, counter.value);
  return 0;
}
