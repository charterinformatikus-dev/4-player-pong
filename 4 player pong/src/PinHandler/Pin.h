#pragma once
#include <Arduino.h>
#include <Ticker.h>

namespace Pin {
  void init(int pin, int period, int time);
}