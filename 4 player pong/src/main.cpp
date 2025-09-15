#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

const char* ssid = "ESP_ROUTER";
const char* password = "charter2019";

WebSocketsClient webSocket;

// joystick lábak
const int pinX = 1;
const int pinY = 2;

String lastDir = "stop";
int espId = 0; // szervernek küldendő ID

void setup() {
  Serial.begin(115200);

  // WiFi csatlakozás
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi ok");

  // MAC cím → ID
  uint64_t chipid = ESP.getEfuseMac();  
  espId = (chipid & 0xFF) % 4 + 1; // 1..4 közötti ID

  Serial.printf("Saját ID: %d (MAC alapú)\n", espId);

  // WebSocket URL összeállítás
  String path = String("/4playerpong?type=esp&id=") + espId;
  webSocket.begin("192.168.88.157", 8080, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();

  int xVal = analogRead(pinX);
  int yVal = analogRead(pinY);

  String dir = "stop";

  if (yVal < 1500) dir = "up";
  else if (yVal > 2500) dir = "down";
  else if (xVal < 1500) dir = "left";
  else if (xVal > 2500) dir = "right";

  if (dir != lastDir) {
    StaticJsonDocument<64> doc;
    doc["dir"] = dir;
    doc["id"] = espId;
    char buffer[64];
    serializeJson(doc, buffer);
    webSocket.sendTXT(buffer);
    lastDir = dir;
    Serial.println("Küldve: " + dir);
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
