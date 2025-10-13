#pragma once
#include <Arduino.h>

namespace Sound {
  void init(int pin);     // inicializálás (pin beállítás)
  void update(unsigned long delta);          // loop-ból hívjuk

  void startTone(int freq, int dur);   // egyszeri hang
  void startHitBurst();                // "ütés" effekthez burst
}