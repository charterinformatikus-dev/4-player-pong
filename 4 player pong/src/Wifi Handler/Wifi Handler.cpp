#include "Wifi Handler.h"

namespace WifiHandler {
    const char* ssid;
    const char* password;
    unsigned long lastWiFiAttempt = 0;
    const unsigned long WIFI_RETRY_INTERVAL = 5000; // 5 sec
}

void WifiHandler::init(const char* ssid, const char* password) {
    WifiHandler::ssid = ssid;
    WifiHandler::password = password;
    WiFi.begin(ssid, password);
    WiFi.setSleep(false);
    Serial.printf("WiFi: csatlakozás SSID='%s'\n", ssid);
    lastWiFiAttempt = millis();
}

void WifiHandler::update(unsigned long now) {
    if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiAttempt >= WIFI_RETRY_INTERVAL) {
      Serial.println("⚠ Nincs WiFi, újracsatlakozás...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
      lastWiFiAttempt = now;
    }
  }
}