#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

const char* ssid = "ESP_ROUTER";
const char* password = "charter2019";

WebSocketsClient webSocket;

// joystick pins (ESP32-S2 Mini)
const int pinX = 3;
const int pinY = 2;
const int joySwitchPin = 4;
const int soundPin = 5;

String lastDir = "stop";
int espId = 0;

// observed min/max (for runtime calibration)
int obsMinX = 65535, obsMaxX = 0;
int obsMinY = 65535, obsMaxY = 0;

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

  uint64_t chipid = ESP.getEfuseMac();
  espId = (chipid & 0xFF) % 4 + 1;
  Serial.printf("Saját ID: %d (MAC alapú)\n", espId);

  String path = String("/4playerpong?type=esp&id=") + espId;
  webSocket.begin("raspberrypi.local", 8080, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  // quick initial center sampling (leave joystick centered for best result)
  Serial.println("Calibrating center (keep joystick neutral)...");
  long sx = 0, sy = 0;
  const int N = 30;
  for (int i = 0; i < N; ++i) {
    sx += readAvg(pinX, 3);
    sy += readAvg(pinY, 3);
  }
  int cx = sx / N;
  int cy = sy / N;
  // seed observed min/max with the center to avoid wild thresholds until we see extremes
  obsMinX = obsMaxX = cx;
  obsMinY = obsMaxY = cy;
  Serial.printf("Initial center X:%d Y:%d\n", cx, cy);
}

void loop() {
  webSocket.loop();

  int xVal = readAvg(pinX);
  int yVal = readAvg(pinY);

  // update observed min/max (adaptive calibration)
  if (xVal < obsMinX) obsMinX = xVal;
  if (xVal > obsMaxX) obsMaxX = xVal;
  if (yVal < obsMinY) obsMinY = yVal;
  if (yVal > obsMaxY) obsMaxY = yVal;

  int rangeX = obsMaxX - obsMinX;
  int rangeY = obsMaxY - obsMinY;

  // fallback if we don't yet have a good range
  if (rangeX < 100) rangeX = 1000;
  if (rangeY < 100) rangeY = 1000;

  int centerX = (obsMinX + obsMaxX) / 2;
  int centerY = (obsMinY + obsMaxY) / 2;

  int deltaX = xVal - centerX;
  int deltaY = yVal - centerY;
  int absDX = abs(deltaX);
  int absDY = abs(deltaY);

  // threshold: percentage of the observed range (20%) but at least a minima
  int threshX = max(rangeX / 5, 300); // ~20% or at least 300
  int threshY = max(rangeY / 5, 300);

  String dir = "stop";

  // prefer the axis with the larger relative movement (so diagonals choose the dominant axis)
  if (absDY > threshY && absDY >= absDX) {
    dir = (deltaY < 0) ? "up" : "down";
  } else if (absDX > threshX) {
    dir = (deltaX < 0) ? "left" : "right";
  } else {
    dir = "stop";
  }

  // only send when direction changes (simple hysteresis)
  if (dir != lastDir) {
    DynamicJsonDocument doc(128);
    doc["dir"] = dir;
    doc["id"] = espId;
    char buffer[128];
    serializeJson(doc, buffer, sizeof(buffer));
    webSocket.sendTXT(buffer);
    Serial.printf("X:%d Y:%d  minX:%d maxX:%d minY:%d maxY:%d  -> %s\n",
      xVal, yVal, obsMinX, obsMaxX, obsMinY, obsMaxY, dir.c_str());
    lastDir = dir;
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
    case WStype_TEXT:
      Serial.printf("WS üzenet: %s\n", payload);
      break;
    default:
      break;
  }
}
