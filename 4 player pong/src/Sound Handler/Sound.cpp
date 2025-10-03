#include <Sound.h>

namespace {
  int soundPin;
  bool toneActive = false;
  unsigned long toneEndTime = 0;

  const int MAX_BURST = 10;
  int burstFreqs[MAX_BURST];
  int burstCount = 0;
  int burstIndex = 0;
  unsigned long nextBurstTime = 0;
}

void Sound::init(const int pin) {
    soundPin = pin;
    pinMode(soundPin, OUTPUT);
}

void Sound::startTone(int freq, int dur) {
  tone(soundPin, freq);
  toneActive = true;
  toneEndTime = millis() + dur;
}

void Sound::startHitBurst() {
  burstCount = 8; 
  for (int i = 0; i < burstCount; i++) {
    burstFreqs[i] = random(1000, 10001);  
  }
  burstIndex = 0;
  nextBurstTime = millis(); // azonnal indul
}

void Sound::update(unsigned long delta) {

  // tone leállítás
  if (toneActive && delta >= toneEndTime) {
    noTone(soundPin);
    toneActive = false;
  }

  // burst kezelése
  if (burstIndex < burstCount && delta >= nextBurstTime) {
    int f = burstFreqs[burstIndex];
    tone(soundPin, f, 15);
    nextBurstTime = delta + 25;
    burstIndex++;
  }
}