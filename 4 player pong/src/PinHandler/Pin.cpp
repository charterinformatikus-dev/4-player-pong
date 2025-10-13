#include "Pin.h"

namespace {
    int ledPin; int blinkTime;
    Ticker ledTicker; Ticker ledOffTicker;
    bool ledState = false;

    void ledOn() {
        digitalWrite(ledPin, HIGH);
        // blinktime múlva kikapcsoljuk
        ledOffTicker.once_ms(blinkTime, []() {
            digitalWrite(ledPin, LOW);
        });
    }
}

void Pin::init(int Pin, int period, int time) {
    blinkTime = time;
    ledPin = Pin;
    pinMode(ledPin, OUTPUT);
    digitalWrite(ledPin, LOW);

    ledTicker.attach_ms(period, ledOn);
}