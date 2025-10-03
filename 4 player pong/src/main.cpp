#include <Sound.h>
#include <Joystick.h>
#include <Wifi Handler.h>
#include <Arduino.h>

//wifi credentials
const char* ssid = "PONG_ROUTER";
const char* password = "charter2019";

//pins from ESP
const int soundPin = 5;
const int pinX = 3;
const int pinY = 2;



void setup() {
    WifiHandler::init(ssid, password);
    Sound::init(soundPin); 
    Joystick::init(pinX, pinY, WiFi.macAddress());
}


void loop() {
    unsigned long now = millis();
    Sound::update(now);
    Joystick::update(now);
    WifiHandler::update(now);
}