#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ===== WIFI =====
const char* ssid = "ESP_ROUTER";
const char* password = "charter2019";

// ===== FIX KLIENS ID (1..4) =====
#define ESP_ID 2  // <- állítsd 1..4 közé minden eszközön

WebSocketsClient webSocket;

// Joystick pins (ESP32-S2 Mini)
const int pinX = 3;
const int pinY = 2;
const int joySwitchPin = 4;   // gomb
const int soundPin = 5;

String lastDir = "stop";
bool joined = false;     // ténylegesen Player módban vagyunk-e
bool wantJoin = false;   // szeretnénk-e Player módban lenni (kitart restartokon is)

int obsMinX = 65535, obsMaxX = 0;
int obsMinY = 65535, obsMaxY = 0;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 33; // ~30 Hz

// nem-blokkoló hang vezérlés
bool toneActive = false;
unsigned long toneEndTime = 0;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);

int readAvg(int pin, int samples = 1) {  // gyorsabb, kevesebb minta
  long sum = 0;
  for (int i = 0; i < samples; ++i) {
    sum += analogRead(pin);
  }
  return (int)(sum / samples);
}

void sendJoin() {
  DynamicJsonDocument doc(64);
  doc["type"] = "join";
  char buffer[64];
  serializeJson(doc, buffer, sizeof(buffer));
  webSocket.sendTXT(buffer);
  Serial.println("JOIN elküldve");
}

void startTone(int freq, int dur) {
  tone(soundPin, freq);
  toneActive = true;
  toneEndTime = millis() + dur;
}

void handleTone() {
  if (toneActive && millis() >= toneEndTime) {
    noTone(soundPin);
    toneActive = false;
  }
}

void setup() {
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(200);
    Serial.print(".");
  }
  Serial.println("\nWiFi ok");

  pinMode(soundPin, OUTPUT);
  pinMode(joySwitchPin, INPUT_PULLUP);

  // Fix ID-s csatlakozás
  String path = String("/4playerpong?type=esp&id=") + String(ESP_ID);
  webSocket.begin("raspberrypi.local", 8080, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  // Kalibrálás (joystick középen tart)
  Serial.println("Kalibrálás (joystick középen tart)...");
  long sx = 0, sy = 0;
  const int N = 20;
  for (int i = 0; i < N; ++i) {
    sx += readAvg(pinX);
    sy += readAvg(pinY);
  }
  int cx = sx / N;
  int cy = sy / N;

  obsMinX = cx - 512;
  obsMaxX = cx + 512;
  obsMinY = cy - 512;
  obsMaxY = cy + 512;

  Serial.printf("Közép: X:%d Y:%d | ESP_ID=%d\n", cx, cy, ESP_ID);
}

void loop() {
  webSocket.loop();
  handleTone();

  // Gomb: bekapcsoljuk a "wantJoin"-t és azonnal kérünk Player módot.
  if (digitalRead(joySwitchPin) == LOW) {
    if (!joined) {
      wantJoin = true;
      sendJoin();
      delay(200); // csak gomb-debounce
    }
  }

  if (joined) {
    int xVal = readAvg(pinX);
    int yVal = readAvg(pinY);

    // observed min/max frissítés
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

    int threshX = max(rangeX / 3, 900);
    int threshY = max(rangeY / 3, 900);

    String dir = "stop";
    if (absDY > threshY && absDY >= absDX) {
      dir = (deltaY < 0) ? "up" : "down";
    } else if (absDX > threshX) {
      dir = (deltaX < 0) ? "left" : "right";
    }

    unsigned long now = millis();
    if (dir != lastDir || now - lastSend >= SEND_INTERVAL) {
      DynamicJsonDocument doc(64);
      doc["dir"] = dir;
      char buffer[64];
      serializeJson(doc, buffer, sizeof(buffer));
      webSocket.sendTXT(buffer);

      Serial.printf("X:%d Y:%d -> %s\n", xVal, yVal, dir.c_str());
      lastDir = dir;
      lastSend = now;
    }
  }
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("WS bontva");
      joined = false;
      break;

    case WStype_CONNECTED:
      Serial.println("WS kapcsolódva");
      if (wantJoin) {
        sendJoin();
      }
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.printf("WS üzenet: %s\n", msg.c_str());

      DynamicJsonDocument doc(128);
      DeserializationError err = deserializeJson(doc, msg);
      if (!err) {
        const char* t = doc["type"] | "";
        if (!strcmp(t, "hit")) {
          startTone(1000, 100);
        } else if (!strcmp(t, "reset")) {
          startTone(400, 300);
        } else if (!strcmp(t, "joined")) {
          joined = true;
          Serial.printf("JOINED ACK, id=%d\n", ESP_ID);
        }
      }
      break;
    }

    default:
      break;
  }
}
