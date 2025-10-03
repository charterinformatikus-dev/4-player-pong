#pragma once
#include <Arduino.h>
#include <wifi.h>

namespace WifiHandler {
    void init(const char* ssid, const char* password);
    void update(unsigned long now);
}

