#include <SoundHandler/Sound.h>
#include <JoystickHandler/Joystick.h>
#include <WifiHandler/Wifi Handler.h>
#include <PinHandler/Pin.h>
#include <WebSocketHandler/WebSocket Handler.h>
#include <Arduino.h>

//wifi ssid és jelszó
const char* ssid = "PONG_ROUTER";
const char* password = "charter2019";

//ESPre pinek
const int soundPin = 5;
const int pinX = 3;
const int pinY = 2;
const int ledPin = 15;

//időzítők a ledre
const int BLINK_PERIOD = 1000;   // teljes periódus
const int BLINK_TIME = 10; 

//websocket
WebSocketsClient client;
String path = String("/4playerpong?type=esp&id=");
String ip = String("Raspberrypi.local");
int port = 8080;

void setup() {
    Serial.begin(115200);
    WifiHandler::init(ssid, password);
    Sound::init(soundPin); 
    Joystick::init(pinX, pinY, WiFi.macAddress());

    int playerId = Joystick::getPlayerIdFromMac(WiFi.macAddress());
    path = path + String(playerId);
    WebSocketHandler::init(path, ip, port, playerId);
    Pin::init(ledPin, BLINK_PERIOD, BLINK_TIME);
}


void loop() {
    unsigned long now = millis();
    Sound::update(now);
    Joystick::update(now);
    if (WifiHandler::update(now)) WebSocketHandler::loop();

    
}