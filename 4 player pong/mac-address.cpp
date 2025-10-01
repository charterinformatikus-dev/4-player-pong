#include <Arduino.h>
#include <WiFi.h>

void setup() {
  Serial.begin(115200);
  delay(2000);  // hogy legyen időd megnyitni a serial monitort

  WiFi.mode(WIFI_STA);  // WiFi stack inicializálás
  Serial.println("=== MAC cím lekérdezés ===");
  Serial.println(WiFi.macAddress());  // STA MAC kiíratás
}

void loop() {
  // nem kell semmi
}
