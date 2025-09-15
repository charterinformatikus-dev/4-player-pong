const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/4playerpong" });

// ---- Statikus fájlok kiszolgálása ----
// Ahol az index.html van, azt a mappát add meg:
app.use(express.static(__dirname));

// ---- Játék logika ----
let players = {
  1: { y: 200, dir: 0 },
  2: { y: 200, dir: 0 },
  3: { x: 200, dir: 0 },
  4: { x: 200, dir: 0 }
};
let ball = { x: 300, y: 200, vx: 3, vy: 2 };
// Pontszámok
let scores = { 1: 0, 2: 0, 3: 0, 4: 0 };

function resetBall() {
  ball.x = 300;
  ball.y = 200;
  ball.vx = Math.random() > 0.5 ? 3 : -3;
  ball.vy = Math.random() > 0.5 ? 2 : -2;
}

setInterval(() => {
  // Játékosok mozgatása (marad)
  if (players[1]) players[1].y = Math.max(0, Math.min(340, players[1].y + players[1].dir * 5));
  if (players[2]) players[2].y = Math.max(0, Math.min(340, players[2].y + players[2].dir * 5));
  if (players[3]) players[3].x = Math.max(0, Math.min(540, players[3].x + players[3].dir * 5));
  if (players[4]) players[4].x = Math.max(0, Math.min(540, players[4].x + players[4].dir * 5));

  // Labda mozgatás
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Ütközések
  if (ball.y < 0) { scores[4]++; resetBall(); }
  if (ball.y > 400) { scores[3]++; resetBall(); }
  if (ball.x < 0) { scores[2]++; resetBall(); }
  if (ball.x > 600) { scores[1]++; resetBall(); }

  // Állapot broadcast
  const state = { type: "state", players, ball, scores };
  broadcastTo("display", JSON.stringify(state));
}, 1000 / 60);

function broadcastTo(role, msg) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.role === role) {
      client.send(msg);
    }
  });
}

wss.on("connection", (ws, req) => {
  const params = url.parse(req.url, true).query;
  ws.role = params.type || "unknown";
  ws.id = parseInt(params.id) || null;

  console.log(`Kapcsolat: ${ws.role} ${ws.id || ""}`);

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (ws.role === "esp") {
        if (ws.id === 1 || ws.id === 2) {
          if (data.dir === "up") players[ws.id].dir = -1;
          else if (data.dir === "down") players[ws.id].dir = 1;
          else if (data.dir === "stop") players[ws.id].dir = 0;
        }
        if (ws.id === 3 || ws.id === 4) {
          if (data.dir === "left") players[ws.id].dir = -1;
          else if (data.dir === "right") players[ws.id].dir = 1;
          else if (data.dir === "stop") players[ws.id].dir = 0;
        }
      }
    } catch (e) {
      console.error("Hibás üzenet:", msg.toString());
    }
  });

  ws.on("close", () => {
    console.log(`Kapcsolat bontva: ${ws.role} ${ws.id || ""}`);
    if (ws.role === "esp" && ws.id) {
      players[ws.id].dir = 0;
    }
  });
});

server.listen(8080, "0.0.0.0", () => {
  console.log("HTTP+WS szerver fut: http://192.168.88.157:8080/");
});
