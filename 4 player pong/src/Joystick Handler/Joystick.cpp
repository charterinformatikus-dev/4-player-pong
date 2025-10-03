#include "Joystick.h"

namespace {
  int pinX, pinY;
  int playerId;
  int centerX = 0, centerY = 0;

  const int SAMPLE_COUNT = 10;
  String dirBuffer[SAMPLE_COUNT];
  int sampleIndex = 0;

  const int deadzones[5] = {
    0, 100, 50, 80, 30
  };

  int readFast(int pin) {
    return analogRead(pin);
  }

  String getAveragedDir() {
    int cntStop=0, cntUp=0, cntDown=0, cntLeft=0, cntRight=0;
    for (int i=0; i<SAMPLE_COUNT; i++) {
      if (dirBuffer[i] == "stop") cntStop++;
      else if (dirBuffer[i] == "up") cntUp++;
      else if (dirBuffer[i] == "down") cntDown++;
      else if (dirBuffer[i] == "left") cntLeft++;
      else if (dirBuffer[i] == "right") cntRight++;
    }
    String best = "stop";
    int maxCnt = cntStop;
    if (cntUp > maxCnt) { best = "up"; maxCnt = cntUp; }
    if (cntDown > maxCnt) { best = "down"; maxCnt = cntDown; }
    if (cntLeft > maxCnt) { best = "left"; maxCnt = cntLeft; }
    if (cntRight > maxCnt) { best = "right"; maxCnt = cntRight; }
    return best;
  }
}

void Joystick::init(int xPin, int yPin, String mac) {
  pinX = xPin;
  pinY = yPin;
  playerId = getPlayerIdFromMac(mac);

  analogReadResolution(12);
  long sx=0, sy=0;
  const int N=30;
  for (int i=0; i<N; i++) {
    sx += readFast(pinX);
    sy += readFast(pinY);
    delay(10);
  }
  centerX = sx / N;
  centerY = sy / N;
}

void Joystick::update(unsigned long now) {
  int xVal = readFast(pinX);
  int yVal = readFast(pinY);

  int dx = xVal - centerX;
  int dy = yVal - centerY;

  String dir = "stop";
  int dz = deadzones[playerId];

  if (playerId == 1 || playerId == 2) {
    if (abs(dy) > dz) dir = (dy < 0) ? "up" : "down";
  } else if (playerId == 3 || playerId == 4) {
    if (abs(dx) > dz) dir = (dx < 0) ? "right" : "left";
  }

  dirBuffer[sampleIndex++] = dir;
  if (sampleIndex >= SAMPLE_COUNT) sampleIndex = 0;
}

String Joystick::getDirection() {
  return getAveragedDir();
}

int Joystick::getPlayerIdFromMac(String mac) {
  mac.toUpperCase();
  if (mac == "90:E5:B1:8E:49:70") return 1; // bal
  if (mac == "90:E5:B1:8E:C2:80") return 3; // felső
  if (mac == "90:E5:B1:8E:CF:B0") return 2; // jobb
  if (mac == "90:E5:B1:8E:6B:50") return 4; // alsó
  return 0; // ismeretlen
}