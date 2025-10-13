#pragma once
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Soundhandler/Sound.h>

namespace WebSocketHandler {
     void init(String path, String ip, int port, int playerId);
     void loop();
}