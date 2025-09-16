#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ====== WIFI ======
const char* ssid = "ESP_ROUTER";
const char* password = "charter2019";

// ====== FIX KLIENS ID (1..4) ======
#define ESP_ID 2   // ← állítsd minden eszközön 1..4 közé

WebSocketsClient webSocket;

// joystick pins (ESP32-S2 Mini)
const int pinX = 3;
const int pinY = 2;
const int joySwitchPin = 4;   // gomb
const int soundPin = 5;

String lastDir = "stop";
bool joined = false;  // alapból AI, gombbal vált Player-re

// observed min/max (for runtime calibration)
int obsMinX = 65535, obsMaxX = 0;
int obsMinY = 65535, obsMaxY = 0;

unsigned long lastSend = 0;  // biztonsági stop timer

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);

int readAvg(int pin, int samples = 6) {
  long sum = 0;
  for (int i = 0; i < samples; ++i) {
    sum += analogRead(pin);
    delay(2);
  }
  return (int)(sum / samples);
}

void setup() {
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi ok");

  pinMode(soundPin, OUTPUT);
  pinMode(joySwitchPin, INPUT_PULLUP);

  // Csatlakozás fix, compile-time ID-val
  String path = String("/4playerpong?type=esp&id=") + String(ESP_ID);
  webSocket.begin("raspberrypi.local", 8080, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  // quick initial center sampling
  Serial.println("Kalibrálás (joystick középen tart)... ");
  long sx = 0, sy = 0;
  const int N = 30;
  for (int i = 0; i < N; ++i) {
    sx += readAvg(pinX, 3);
    sy += readAvg(pinY, 3);
  }
  int cx = sx / N;
  int cy = sy / N;

  // induló tartomány ±512
  obsMinX = cx - 512;
  obsMaxX = cx + 512;
  obsMinY = cy - 512;
  obsMaxY = cy + 512;

  Serial.printf("Közép: X:%d Y:%d | ESP_ID=%d\n", cx, cy, ESP_ID);
}

void loop() {
  webSocket.loop();

  // gomb lenyomás → Player mód
  if (digitalRead(joySwitchPin) == LOW && !joined) {
    DynamicJsonDocument doc(64);
    doc["type"] = "join";
    char buffer[64];
    serializeJson(doc, buffer, sizeof(buffer));
    webSocket.sendTXT(buffer);
    joined = true;
    Serial.println("JOIN küldve → Player mód!");
    delay(500);  // debounce
  }

  if (joined) {
    int xVal = readAvg(pinX);
    int yVal = readAvg(pinY);

    // update observed min/max
    if (xVal < obsMinX) obsMinX = xVal;
    if (xVal > obsMaxX) obsMaxX = xVal;
    if (yVal < obsMinY) obsMinY = yVal;
    if (yVal > obsMaxY) obsMaxY = yVal;

    int rangeX = obsMaxX - obsMinX;
    int rangeY = obsMaxY - obsMinY;

    if (rangeX < 100) rangeX = 1000;
    if (rangeY < 100) rangeY = 1000;

    int centerX = (obsMinX + obsMaxX) / 2;
    int centerY = (obsMinY + obsMaxY) / 2;

    int deltaX = xVal - centerX;
    int deltaY = yVal - centerY;
    int absDX = abs(deltaX);
    int absDY = abs(deltaY);

    // nagyobb deadzone
    int threshX = max(rangeX / 3, 900);
    int threshY = max(rangeY / 3, 900);

    String dir = "stop";

    // iránylogika VÁLTOZATLAN (a szerveredhez igazodva)
    if (absDY > threshY && absDY >= absDX) {
      dir = (deltaY < 0) ? "up" : "down";
    } else if (absDX > threshX) {
      dir = (deltaX < 0) ? "left" : "right";
    } else {
      dir = "stop";
    }

    unsigned long now = millis();
    if (dir != lastDir || (dir == "stop" && now - lastSend > 500)) {
      DynamicJsonDocument doc(128);
      doc["dir"] = dir;
      char buffer[128];
      serializeJson(doc, buffer, sizeof(buffer));
      webSocket.sendTXT(buffer);
      Serial.printf("X:%d Y:%d -> %s\n", xVal, yVal, dir.c_str());
      lastDir = dir;
      lastSend = now;
    }
  }

  delay(50);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("WS bontva");
      break;
    case WStype_CONNECTED:
      Serial.println("WS kapcsolódva");
      break;
    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.printf("WS üzenet: %s\n", msg.c_str());

      DynamicJsonDocument doc(128);
      DeserializationError err = deserializeJson(doc, msg);
      if (!err) {
        if (doc["type"] == "hit") {
          tone(soundPin, 1000, 100);
          delay(120);
          noTone(soundPin);
        }
        if (doc["type"] == "reset") {
          tone(soundPin, 400, 300);   // új hang resetnél
          delay(320);
          noTone(soundPin);
        }
        // "welcome" üzenetet figyelmen kívül hagyjuk — az ID compile-time fix (ESP_ID)
      }
      break;
    }
    default:
      break;
  }
}
