const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/4playerpong" });

app.use(express.static(__dirname));

// alap értékek (később a display küldi a pontos méretet)
let FIELD_W = 600;
let FIELD_H = 400;

// paddlek / labda méretek (a clientet is érdemes ezek szerint rajzolni)
const PADDLE_H = 120;      // függőleges paddlek magassága
const PADDLE_W = 120;      // vízszintes paddlek szélessége
const PADDLE_THICKNESS = 20; // paddle "vastagsága" (ahogy a canvason rajzoljuk)
const PADDLE_OFFSET = 30;  // távolság az oldalfaltól (ahová a paddle-ek vannak elhelyezve)
const BALL_R = 12;         // labda sugara (most már használva)

// játék állapota
let players = {};
let ball = {};
let scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
let lastHit = null;
let gamePaused = false;

function resetBall() {
  ball.x = FIELD_W/2;
  ball.y = FIELD_H/2;
  ball.vx = Math.random() > 0.5 ? 6 : -6;
  ball.vy = Math.random() > 0.5 ? 4 : -4;
}

function resetGame() {
  players = {
    1: { y: FIELD_H/2 - PADDLE_H/2, dir: 0 }, // bal
    2: { y: FIELD_H/2 - PADDLE_H/2, dir: 0 }, // jobb
    3: { x: FIELD_W/2 - PADDLE_W/2, dir: 0 }, // felső
    4: { x: FIELD_W/2 - PADDLE_W/2, dir: 0 }  // alsó
  };
  resetBall();
}

resetGame();

setInterval(() => {
  if (gamePaused) {
    const state = { type: "state", players, ball, scores, paused: true };
    broadcastTo("display", JSON.stringify(state));
    return;
  }

  // paddlek mozgatása (limitálva a pályára)
  if (players[1]) players[1].y = Math.max(0, Math.min(FIELD_H - PADDLE_H, players[1].y + players[1].dir * 10));
  if (players[2]) players[2].y = Math.max(0, Math.min(FIELD_H - PADDLE_H, players[2].y + players[2].dir * 10));
  if (players[3]) players[3].x = Math.max(0, Math.min(FIELD_W - PADDLE_W, players[3].x + players[3].dir * 10));
  if (players[4]) players[4].x = Math.max(0, Math.min(FIELD_W - PADDLE_W, players[4].x + players[4].dir * 10));

  // labda mozgatás
  ball.x += ball.vx;
  ball.y += ball.vy;

  // paddle X/Y pozíciók (számított értékek a konstansokból)
  const leftPaddleX = PADDLE_OFFSET;
  const rightPaddleX = FIELD_W - PADDLE_OFFSET - PADDLE_THICKNESS;
  const topPaddleY = PADDLE_OFFSET;
  const bottomPaddleY = FIELD_H - PADDLE_OFFSET - PADDLE_THICKNESS;

  // --- kollíziók BALL_R használatával ---

  // bal paddle (függőleges)
  if ((ball.x - BALL_R) <= (leftPaddleX + PADDLE_THICKNESS)
      && ball.y >= players[1].y
      && ball.y <= players[1].y + PADDLE_H) {
    // ütközés bal paddle-lel: jobbra pattintunk
    ball.vx = Math.abs(ball.vx);
    ball.x = leftPaddleX + PADDLE_THICKNESS + BALL_R; // ne ragadjon át
    sendToId(1, JSON.stringify({ type: "hit" }));
    lastHit = 1;
  }

  // jobb paddle
  if ((ball.x + BALL_R) >= rightPaddleX
      && ball.y >= players[2].y
      && ball.y <= players[2].y + PADDLE_H) {
    ball.vx = -Math.abs(ball.vx);
    ball.x = rightPaddleX - BALL_R;
    sendToId(2, JSON.stringify({ type: "hit" }));
    lastHit = 2;
  }

  // felső paddle (vízszintes)
  if ((ball.y - BALL_R) <= (topPaddleY + PADDLE_THICKNESS)
      && ball.x >= players[3].x
      && ball.x <= players[3].x + PADDLE_W) {
    ball.vy = Math.abs(ball.vy);
    ball.y = topPaddleY + PADDLE_THICKNESS + BALL_R;
    sendToId(3, JSON.stringify({ type: "hit" }));
    lastHit = 3;
  }

  // alsó paddle
  if ((ball.y + BALL_R) >= bottomPaddleY
      && ball.x >= players[4].x
      && ball.x <= players[4].x + PADDLE_W) {
    ball.vy = -Math.abs(ball.vy);
    ball.y = bottomPaddleY - BALL_R;
    sendToId(4, JSON.stringify({ type: "hit" }));
    lastHit = 4;
  }

  // pontszám: ha a labda teljesen elhagyja a pályát (a sugárral bővítve)
  if (ball.x < -BALL_R || ball.x > FIELD_W + BALL_R || ball.y < -BALL_R || ball.y > FIELD_H + BALL_R) {
    if (lastHit) {
      scores[lastHit]++;
      if (scores[lastHit] >= 10) {
        console.log(`Játékos ${lastHit} nyert!`);
        broadcastTo("display", JSON.stringify({ type: "winner", id: lastHit }));

        gamePaused = true;
        setTimeout(() => {
          scores = { 1:0, 2:0, 3:0, 4:0 };
          resetGame();
          lastHit = null;
          gamePaused = false;
        }, 2000);
      }
    }
    resetBall();
    lastHit = null;
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
    ws.send(JSON.stringify({ type: "welcome", id: ws.id }));
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // display küldheti a méretet -> dinamikus pálya
      if (ws.role === "display" && data.type === "displaySize") {
        FIELD_W = data.width;
        FIELD_H = data.height;
        console.log(`Pálya mérete beállítva: ${FIELD_W}x${FIELD_H}`);
        resetGame();
        return;
      }

      // ESP irányüzenetek
      if (ws.role === "esp" && ws.id) {
        if (gamePaused) return;
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
