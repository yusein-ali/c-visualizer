#include <stdio.h>

enum Mode { MODE_OFF, MODE_IDLE, MODE_ACTIVE };

typedef const enum Mode ReadOnlyMode;

struct Sensor {
  const int id;
  volatile int reading;
  int *const fixedTarget;
  const int *readOnlyTarget;
};

typedef volatile struct Sensor LiveSensor;

union Payload {
  int whole;
  char letter;
};

typedef const union Payload ReadOnlyPayload;

static const int calibration = 5;
volatile int interruptFlag = 0;
_Atomic(int) sampleCount = 1;

int main() {
  int raw = 42;
  register int fast = 7;

  ReadOnlyMode mode = MODE_ACTIVE;
  LiveSensor sensor = {101, raw, &raw, &raw};
  LiveSensor sensors[3] = {
    [0] = {2, raw, &raw, &raw},
    [1] = {0},
    [2] = {0}
  };
  ReadOnlyPayload payload = {65};

  int *restrict rawView = &raw;
  volatile int changing = 3;
  changing = 4;
  interruptFlag = 1;
  sampleCount = 2;

  /* Set a breakpoint here to inspect types, values and aligned addresses. */
  printf("mode=%d sensor=%d/%d payload=%d/%c fast=%d calibration=%d flag=%d samples=%d raw=%d sensors=%d/%d/%d\n",
         mode, sensor.id, sensor.reading, payload.whole, payload.letter, fast,
         calibration, interruptFlag, sampleCount, *rawView,
         sensors[0].id, sensors[1].id, sensors[2].id);
  return 0;
}
