#include <WebSocket Handler.h>

namespace {
    WebSocketsClient client;
    int playerId;


    unsigned long stopStart = 0;
    bool returnedToAI = false;
    const unsigned long STOP_TIMEOUT = 17000;

    unsigned long lastReturnPress = 0;
    const unsigned long RETURN_COOLDOWN = 5000; // 5 másodperc

    const unsigned long DEBOUNCE_MS = 50;
    int lastRawButtonState = HIGH;      // INPUT_PULLUP -> idle HIGH
    int stableButtonState = HIGH;
    unsigned long lastDebounceTime = 0;

    String lastDir = "stop";
    bool joined = false;
    bool wantJoin = false;

    void sendJoin() {
        DynamicJsonDocument doc(64);
        doc["type"] = "join";
        doc["id"] = playerId;
        char buffer[64];
        serializeJson(doc, buffer, sizeof(buffer));
        client.sendTXT(buffer);
        Serial.printf("JOIN elküldve (id=%d)\n", playerId);
    }

    void sendReturnToAI() {
        DynamicJsonDocument doc(64);
        doc["type"] = "return_to_ai";
        doc["id"] = playerId;
        char buffer[64];
        serializeJson(doc, buffer, sizeof(buffer));
        client.sendTXT(buffer);

        joined = false;
        wantJoin = false;
        Serial.printf("⚠ return_to_ai küldve (id=%d)\n", playerId);
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
                    Sound::startHitBurst();
                } else if (strcmp(t, "reset") == 0) {
                    Sound::startTone(400, 300);
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
}

void WebSocketHandler::init(String path, String ip, int port, int playerID) {
    client.begin(ip, port, path.c_str());
    client.onEvent(webSocketEvent);
    client.setReconnectInterval(3000);
}

void WebSocketHandler::loop() {
    client.loop();
}