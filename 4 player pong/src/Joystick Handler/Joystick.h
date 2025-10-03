#pragma once
#include <Arduino.h>

namespace Joystick {
  void init(int pinX, int pinY, String mac);   // kalibráció + inicializálás
  void update(unsigned long now);                                 // loop-ból hívjuk, frissíti a buffert
  String getDirection(); // visszaadja az átlagolt irányt
  int getPlayerIdFromMac(String mac);
}