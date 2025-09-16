const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/4playerpong" });

app.use(express.static(__dirname));

let players = {
  1: { y: 170, dir: 0 },
  2: { y: 170, dir: 0 },
  3: { x: 270, dir: 0 },
  4: { x: 270, dir: 0 }
};
let ball = { x: 300, y: 200, vx: 3, vy: 2 };
let scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
let lastHit = null; // utolsó ütő

let gamePaused = false;
let pauseUntil = 0;

function resetBall() {
  ball.x = 300;
  ball.y = 200;
  ball.vx = Math.random() > 0.5 ? 3 : -3;
  ball.vy = Math.random() > 0.5 ? 2 : -2;
}

setInterval(() => {
  if (gamePaused) {
    const state = { type: "state", players, ball, scores, paused: true };
    broadcastTo("display", JSON.stringify(state));
    return; // játék áll
  }

  // paddlek mozgatása
  if (players[1]) players[1].y = Math.max(0, Math.min(340, players[1].y + players[1].dir * 5));
  if (players[2]) players[2].y = Math.max(0, Math.min(340, players[2].y + players[2].dir * 5));
  if (players[3]) players[3].x = Math.max(0, Math.min(540, players[3].x + players[3].dir * 5));
  if (players[4]) players[4].x = Math.max(0, Math.min(540, players[4].x + players[4].dir * 5));

  // labda mozgatás
  ball.x += ball.vx;
  ball.y += ball.vy;

  // ütközés paddlékkel
  if (ball.x <= 30 && ball.y >= players[1].y && ball.y <= players[1].y + 60) {
    ball.vx = -ball.vx;
    ball.x = 30;
    sendToId(1, JSON.stringify({ type: "hit" }));
    lastHit = 1;
  }
  if (ball.x >= 570 && ball.y >= players[2].y && ball.y <= players[2].y + 60) {
    ball.vx = -ball.vx;
    ball.x = 570;
    sendToId(2, JSON.stringify({ type: "hit" }));
    lastHit = 2;
  }
  if (ball.y <= 30 && ball.x >= players[3].x && ball.x <= players[3].x + 60) {
    ball.vy = -ball.vy;
    ball.y = 30;
    sendToId(3, JSON.stringify({ type: "hit" }));
    lastHit = 3;
  }
  if (ball.y >= 370 && ball.x >= players[4].x && ball.x <= players[4].x + 60) {
    ball.vy = -ball.vy;
    ball.y = 370;
    sendToId(4, JSON.stringify({ type: "hit" }));
    lastHit = 4;
  }

  // pontszám ha elhagyja a pályát
  if (ball.y < 0 || ball.y > 400 || ball.x < 0 || ball.x > 600) {
  if (lastHit) {
    scores[lastHit]++; // az utolsó ütő kap pontot
    // győzelem ellenőrzés
    if (scores[lastHit] >= 10) {
      console.log(`Játékos ${lastHit} nyert!`);
      broadcastTo("display", JSON.stringify({ type: "winner", id: lastHit }));

      // játék leállítása 3 másodpercre
      gamePaused = true;
      pauseUntil = Date.now() + 3000;

      // nullázás csak szünet végén
      setTimeout(() => {
        scores = { 1:0, 2:0, 3:0, 4:0 };
        resetBall();
        lastHit = null;
        gamePaused = false;
      }, 3000);
    }
  }

  resetBall();
  lastHit = null; // újrakezdésnél töröljük
}

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

function sendToId(id, msg) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.role === "esp" && client.id === id) {
      client.send(msg);
    }
  });
}

wss.on("connection", (ws, req) => {
  const params = url.parse(req.url, true).query;
  ws.role = params.type || "unknown";

  if (ws.role === "esp") {
    // kiosztjuk a legkisebb szabad ID-t 1–4 között
    let freeId = null;
    for (let i = 1; i <= 4; i++) {
      let inUse = false;
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.role === "esp" && client.id === i) {
          inUse = true;
        }
      });
      if (!inUse) { freeId = i; break; }
    }
    ws.id = freeId;

    if (!ws.id) {
      ws.close(1000, "Nincs szabad játékos slot");
      return;
    }

    console.log(`Új ESP csatlakozott, kiosztott ID: ${ws.id}`);

    // visszajelezzük a kliensnek, hogy ő melyik ID
    ws.send(JSON.stringify({ type: "welcome", id: ws.id }));
  }

  console.log(`Kapcsolat: ${ws.role} ${ws.id || ""}`);

  ws.on("message", (msg) => {
    try {
      if (ws.role === "esp" && ws.id) {
      if (gamePaused) return; // szünet alatt ignoráljuk
  // normál paddle iránykezelés
}
      const data = JSON.parse(msg.toString());
      if (ws.role === "esp" && ws.id) {
        if (ws.id === 1 || ws.id === 2) {
          if (data.dir === "up") players[ws.id].dir = -1;
          else if (data.dir === "down") players[ws.id].dir = 1;
          else players[ws.id].dir = 0;
        }
        if (ws.id === 3 || ws.id === 4) {
          if (data.dir === "left") players[ws.id].dir = 1;
          else if (data.dir === "right") players[ws.id].dir = -1;
          else players[ws.id].dir = 0;
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
  console.log("HTTP+WS szerver fut: http://localhost:8080/");
});
