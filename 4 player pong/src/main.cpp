#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ===== WIFI =====
const char* ssid = "ESP_ROUTER";
const char* password = "charter2019";

// ===== FIX KLIENS ID (1..4) =====
#define ESP_ID 4  // <- állítsd 1..4 közé minden eszközön

WebSocketsClient webSocket;

// Joystick pins (ESP32-S2 Mini)
const int pinX = 3;
const int pinY = 2;
const int joySwitchPin = 4;   // gomb
const int soundPin = 5;

String lastDir = "stop";
bool joined = false;
bool wantJoin = false;

// ESP 1
//#define DEADZONE_X 3750
//#define DEADZONE_Y 3750

// ESP 2
//#define DEADZONE_X 3800
//#define DEADZONE_Y 3750

// ESP 3
//#define DEADZONE_X 3875
//#define DEADZONE_Y 3750

// ESP 4
#define DEADZONE_X 3750
#define DEADZONE_Y 3750

// debug időzítés
unsigned long lastDbg = 0;
const unsigned long DBG_PERIOD_MS = 200;

// joystick tartomány
int obsMinX = 65535, obsMaxX = 0;
int obsMinY = 65535, obsMaxY = 0;

// küldés időzítő
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 33; // ~30Hz

// nem-blokkoló hang vezérlés
bool toneActive = false;
unsigned long toneEndTime = 0;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);

int readFast(int pin) {
  return analogRead(pin); // nincs átlagolás, nincs delay
}

void sendJoin() {
  DynamicJsonDocument doc(32);
  doc["type"] = "join";
  char buffer[32];
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

  pinMode(soundPin, OUTPUT);
  pinMode(joySwitchPin, INPUT_PULLUP);
  tone(soundPin, 1500, 1000);
  tone(soundPin, 750, 500);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(200);
    Serial.print(".");
  }
  Serial.println("\nWiFi ok");

  String path = String("/4playerpong?type=esp&id=") + String(ESP_ID);
  webSocket.begin("raspberrypi.local", 8080, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  // Kalibrálás
  Serial.println("Kalibrálás (joystick közép)...");
  long sx = 0, sy = 0;
  const int N = 20;
  for (int i = 0; i < N; i++) {
    sx += readFast(pinX);
    sy += readFast(pinY);
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

  // Join gomb
  if (digitalRead(joySwitchPin) == LOW && !joined) {
    wantJoin = true;
    sendJoin();
    delay(200); // csak debounce miatt
  }

  if (joined) {
    int xVal = readFast(pinX);
    int yVal = readFast(pinY);

    // frissítjük a min/max tartományt
    if (xVal < obsMinX) obsMinX = xVal;
    if (xVal > obsMaxX) obsMaxX = xVal;
    if (yVal < obsMinY) obsMinY = yVal;
    if (yVal > obsMaxY) obsMaxY = yVal;

    int centerX = (obsMinX + obsMaxX) / 2;
    int centerY = (obsMinY + obsMaxY) / 2;

    int deltaX = xVal - centerX;
    int deltaY = yVal - centerY;
    int absDX = abs(deltaX);
    int absDY = abs(deltaY);

    String dir = "stop";
    if (absDY > DEADZONE_Y && absDY >= absDX) {
      dir = (deltaY < 0) ? "up" : "down";
    } else if (absDX > DEADZONE_X) {
      dir = (deltaX < 0) ? "left" : "right";
    }

    unsigned long now = millis();
    if (dir != lastDir || now - lastSend >= SEND_INTERVAL) {
      DynamicJsonDocument doc(32);
      doc["dir"] = dir;
      char buffer[32];
      serializeJson(doc, buffer, sizeof(buffer));
      webSocket.sendTXT(buffer);
      lastDir = dir;
      lastSend = now;
    }

    // --- DEBUG: joystick értékek Serial Monitorra ---
    unsigned long nowDbg = millis();
    if (nowDbg - lastDbg >= DBG_PERIOD_MS) {
      Serial.printf("RAW X:%4d Y:%4d | centerX:%4d centerY:%4d | dX:%4d dY:%4d | joined:%d\n",
                    xVal, yVal, centerX, centerY, deltaX, deltaY, (int)joined);
      lastDbg = nowDbg;
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
      if (wantJoin) sendJoin();
      break;

    case WStype_TEXT: {
      DynamicJsonDocument doc(128);
      if (!deserializeJson(doc, payload, length)) {
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
