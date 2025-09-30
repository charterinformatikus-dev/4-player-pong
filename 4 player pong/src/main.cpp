#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ===== WIFI =====
const char* ssid = "PONG_ROUTER";
const char* password = "charter2019";

WebSocketsClient webSocket;

// Joystick pins (ESP32-S2 Mini)
const int pinX = 3;
const int pinY = 2;
const int joySwitchPin = 4;   // gomb
const int soundPin = 5;

// LED villogás időzítők
const int ledPin = 15;
unsigned long lastBlink = 0;
const unsigned long BLINK_PERIOD = 1000;   // 1 sec
const unsigned long BLINK_ON_TIME = 10;   //
bool ledActive = false;

// --- hang burst vezérlés ---
const int MAX_BURST = 10;
int burstFreqs[MAX_BURST];
int burstCount = 0;
int burstIndex = 0;
unsigned long nextBurstTime = 0;

String lastDir = "stop";
bool joined = false;
bool wantJoin = false;

// Deadzone (delta értékre, ADC 0..4095 skálán)
const int deadzones[5] = {
  0,    // index 0 nincs használva
  100,  // 1: Bal
  100,  // 2: Jobb 
  80,  // 3: Felső
  50   // 4: Alsó
};

// Középértékek (setup alatt számoljuk ki)
int centerX = 0;
int centerY = 0;

// debug időzítés
unsigned long lastDbg = 0;
const unsigned long DBG_PERIOD_MS = 200;

// küldés időzítő
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 33; // ~30Hz

// stop figyelés
unsigned long stopStart = 0;
bool returnedToAI = false;
const unsigned long STOP_TIMEOUT = 17000;

// hang vezérlés
bool toneActive = false;
unsigned long toneEndTime = 0;

//return to ai gomb nyomással
unsigned long lastReturnPress = 0;
const unsigned long RETURN_COOLDOWN = 5000; // 5 másodperc

// gomb debounce / edge detection (nem blokkoló)
const unsigned long DEBOUNCE_MS = 50;
int lastRawButtonState = HIGH;      // INPUT_PULLUP -> idle HIGH
int stableButtonState = HIGH;
unsigned long lastDebounceTime = 0;

// --- MAC → ID hozzárendelés ---
int getPlayerIdFromMac(String mac) {
  mac.toUpperCase();
  if (mac == "90:E5:B1:8E:49:70") return 1; // bal
  if (mac == "90:E5:B1:8E:C2:80") return 3; // felső
  if (mac == "90:E5:B1:8E:CF:B0") return 2; // jobb
  if (mac == "90:E5:B1:8D:C0:D2") return 4; // alsó
  return 0; // ismeretlen
}

int playerId = 0;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);

int readFast(int pin) {
  return analogRead(pin);
}

void sendJoin() {
  DynamicJsonDocument doc(64);
  doc["type"] = "join";
  doc["id"] = playerId;
  char buffer[64];
  serializeJson(doc, buffer, sizeof(buffer));
  webSocket.sendTXT(buffer);
  Serial.printf("JOIN elküldve (id=%d)\n", playerId);
}

void startHitBurst() {
  burstCount = 8; 
  for (int i = 0; i < burstCount; i++) {
    burstFreqs[i] = random(1000, 10001);  
  }
  burstIndex = 0;
  nextBurstTime = millis(); // azonnal indul
}

void handleBurst() {
  unsigned long now = millis();
  if (burstIndex < burstCount && now >= nextBurstTime) {
    int f = burstFreqs[burstIndex];
    tone(soundPin, f, 15);          // nagyon rövid: 0.1 sec
    nextBurstTime = now + 25;       // kis szünet a csipogások közt
    burstIndex++;
  }
}

void sendReturnToAI() {
  DynamicJsonDocument doc(64);
  doc["type"] = "return_to_ai";
  doc["id"] = playerId;
  char buffer[64];
  serializeJson(doc, buffer, sizeof(buffer));
  webSocket.sendTXT(buffer);

  joined = false;
  wantJoin = false;
  Serial.printf("⚠ return_to_ai küldve (id=%d)\n", playerId);
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
  analogReadResolution(12);   // ADC 12 bit (0..4095)

  pinMode(soundPin, OUTPUT);
  pinMode(joySwitchPin, INPUT_PULLUP);

  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

  tone(soundPin, 1500, 100);
  delay(120);
  tone(soundPin, 800, 120);

  // WiFi csatlakozás
  WiFi.begin(ssid, password);
  Serial.print("WiFi: csatlakozás");
  while (WiFi.status() != WL_CONNECTED) {
    delay(200);
    Serial.print(".");
  }
  WiFi.setSleep(false);
  Serial.println("\nWiFi ok");
  
  // MAC cím
  String mac = WiFi.macAddress();
  Serial.print("Eszköz MAC: ");
  Serial.println(mac);

  // ID hozzárendelés MAC alapján
  playerId = getPlayerIdFromMac(mac);
  if (playerId == 0) {
    Serial.println("⚠ Ismeretlen MAC! Nincs ID hozzárendelve!");
  } else {
    Serial.printf("Ez az eszköz a(z) %d-es játékos\n", playerId);
  }

  // WebSocket
  String path = String("/4playerpong?type=esp&id=") + String(playerId);
  webSocket.begin("raspberrypi.local", 8080, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  // Joystick kalibráció (közép)
  long sx=0, sy=0;
  const int N=30;
  Serial.println("Kalibrálás, ne mozgasd a joystickot...");
  for (int i=0; i<N; i++) {
    sx += readFast(pinX);
    sy += readFast(pinY);
    delay(10);
  }
  centerX = sx / N;
  centerY = sy / N;
  Serial.printf("Fix közép: X:%d Y:%d (átlag %d minta)\n", centerX, centerY, N);
}

// --- Irány átlagolás buffer ---
const int SAMPLE_COUNT = 10;
String dirBuffer[SAMPLE_COUNT];
int sampleIndex = 0;

String getAveragedDir() {
  // megszámolja a bufferben az irányokat
  int cntStop = 0, cntUp = 0, cntDown = 0, cntLeft = 0, cntRight = 0;
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    if (dirBuffer[i] == "stop") cntStop++;
    else if (dirBuffer[i] == "up") cntUp++;
    else if (dirBuffer[i] == "down") cntDown++;
    else if (dirBuffer[i] == "left") cntLeft++;
    else if (dirBuffer[i] == "right") cntRight++;
  }

  // kiválasztja a legtöbbször előforduló irányt
  String bestDir = "stop";
  int maxCnt = cntStop;
  if (cntUp > maxCnt) { bestDir = "up"; maxCnt = cntUp; }
  if (cntDown > maxCnt) { bestDir = "down"; maxCnt = cntDown; }
  if (cntLeft > maxCnt) { bestDir = "left"; maxCnt = cntLeft; }
  if (cntRight > maxCnt) { bestDir = "right"; maxCnt = cntRight; }

  return bestDir;
}

void loop() {
  webSocket.loop();
  handleTone();
  handleBurst();

  // olvassuk a jelenlegi időt egyszer
  unsigned long now = millis();

  // --- Gomb kezelése: debounced edge-detection (nem blokkol) ---
  int rawBtn = digitalRead(joySwitchPin);
  if (rawBtn != lastRawButtonState) {
    // állapotváltozás történt --> indítsuk a debounce időzítőt
    lastDebounceTime = now;
    lastRawButtonState = rawBtn;
  }

  // ha az állapot stabil több mint DEBOUNCE_MS, tekintsük érvényesnek
  if (now - lastDebounceTime > DEBOUNCE_MS) {
    if (rawBtn != stableButtonState) {
      // stabil állapotváltás történt
      stableButtonState = rawBtn;

      // csak a lenyomás eseményre reagálunk (HIGH -> LOW)
      if (stableButtonState == LOW) {
        if (!joined) {
          // még nincs join → belépés
          wantJoin = true;
          sendJoin();
        } else {
          // már joined → return_to_ai, cooldown védelemmel
          if (now - lastReturnPress >= RETURN_COOLDOWN) {
            lastReturnPress = now;   // AZONNAL rögzítjük a nyomást -> spam megelőzve
            sendReturnToAI();
            startTone(900, 80); // opcionális visszajelzés
          }
        }
      }
    }
  }

  // új villogás indítása
  if (!ledActive && (now - lastBlink >= BLINK_PERIOD)) {
    digitalWrite(ledPin, HIGH);
    ledActive = true;
    lastBlink = now;
  }

  // ha épp villog, akkor 0.1 sec után lekapcsol
  if (ledActive && (now - lastBlink >= BLINK_ON_TIME)) {
    digitalWrite(ledPin, LOW);
    ledActive = false;
  }

  if (joined && playerId != 0) {
    int xVal = readFast(pinX);
    int yVal = readFast(pinY);

    int deltaX = xVal - centerX;
    int deltaY = yVal - centerY;
    int absDX = abs(deltaX);
    int absDY = abs(deltaY);

    String dir = "stop";
    int dz = deadzones[playerId];

    // --- Paddle-specifikus irány logika ---
    if (playerId == 1 || playerId == 2) {
      if (absDY > dz) {
        dir = (deltaY < 0) ? "up" : "down";
      }
    }
    else if (playerId == 3 || playerId == 4) {
      if (absDX > dz) {
        dir = (deltaX < 0) ? "right" : "left";
      }
    }

    // --- irány hozzáadása a bufferhez ---
    dirBuffer[sampleIndex] = dir;
    sampleIndex++;

    if (sampleIndex >= SAMPLE_COUNT) {
      sampleIndex = 0; // reset

      // átlagolt irány
      String avgDir = getAveragedDir();
      unsigned long nowInner = millis();

      if (avgDir == "stop") {
        if (stopStart == 0) stopStart = nowInner;
        if (!returnedToAI && (nowInner - stopStart >= STOP_TIMEOUT)) {
          sendReturnToAI();
          returnedToAI = true;
        } 
      } else {
          stopStart = 0;
          returnedToAI = false;
      }

      if (avgDir != lastDir || nowInner - lastSend >= SEND_INTERVAL) {
        DynamicJsonDocument doc(64);
        doc["dir"] = avgDir;
        char buffer[64];
        serializeJson(doc, buffer, sizeof(buffer));
        webSocket.sendTXT(buffer);
        lastDir = avgDir;
        lastSend = nowInner;
      }

      // Debug kiírás
      unsigned long nowDbg = millis();
      if (nowDbg - lastDbg >= DBG_PERIOD_MS) {
        Serial.printf("ID:%d | RAW X:%4d Y:%4d | dX:%4d dY:%4d | out(avg):%s\n",
          playerId, xVal, yVal, deltaX, deltaY, avgDir.c_str());
        lastDbg = nowDbg;
      }
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
      DeserializationError err = deserializeJson(doc, payload, length);
      if (!err) {
        const char* t = doc["type"] | "";
        if (strcmp(t, "hit") == 0) {
          startHitBurst();
        } else if (strcmp(t, "reset") == 0) {
          startTone(400, 300);
        } else if (strcmp(t, "joined") == 0) {
          joined = true;
          Serial.printf("JOINED ACK, id=%d\n", playerId);
        }
      }
      break;
    }

    default:
      break;
  }
}