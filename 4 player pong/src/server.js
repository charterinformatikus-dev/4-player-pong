// server.js
// 4-játékos Pong – paddlek beljebb + AI deadzone + paddle velocity transfer + falpattanás a saroknál
// javítva: paddlek nem mennek be az L alakú sarkok alá (cornerLimit figyelembevétel)

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/4playerpong" });

app.use(express.static(__dirname));

// alap értékek
let FIELD_W = 600;
let FIELD_H = 400;

// PADDLE beállítások
const PADDLE_SIZE_RATIO = 0.20;
const PADDLE_THICK_RATIO = 0.035;
const PADDLE_OFFSET = 30;
const BALL_R = 16;
const AI_DEADZONE = 20;
const MAX_BALL_SPEED = 18;

function computePaddles() {
  const base = Math.min(FIELD_W, FIELD_H);
  const PADDLE_SIZE = Math.max(80, Math.floor(base * PADDLE_SIZE_RATIO));
  const PADDLE_THICKNESS = Math.max(12, Math.floor(base * PADDLE_THICK_RATIO));
  return {
    PADDLE_H: PADDLE_SIZE,
    PADDLE_W: PADDLE_SIZE,
    PADDLE_THICKNESS
  };
}

let players = {};
let ball = {};
let scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
let lastHit = null;
let gamePaused = false;

let aiEnabled = {1:true,2:true,3:true,4:true};
let lastInputTime = {1:0,2:0,3:0,4:0};

function resetBall() {
  ball.x = FIELD_W/2;
  ball.y = FIELD_H/2;
  resetBallVelocity();
  broadcastTo("esp", JSON.stringify({ type: "reset" }));
}

function resetBallVelocity() {
  ball.vx = (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random()*2);
  ball.vy = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random()*2);
}

function resetGame() {
  const { PADDLE_H, PADDLE_W } = computePaddles();

  players = {
    1: { y: FIELD_H/2 - PADDLE_H/2, dir: 0, vy: 0 },
    2: { y: FIELD_H/2 - PADDLE_H/2, dir: 0, vy: 0 },
    3: { x: FIELD_W/2 - PADDLE_W/2, dir: 0, vx: 0 },
    4: { x: FIELD_W/2 - PADDLE_W/2, dir: 0, vx: 0 }
  };
  resetBall();
}

resetGame();

// --- ÚJ: előrejelzés labda pályára ---
function predictBallY(paddleX) {
  let simX = ball.x, simY = ball.y;
  let vx = ball.vx, vy = ball.vy;

  while (true) {
    simX += vx;
    simY += vy;

    // felső/alsó fal pattanás
    if (simY - BALL_R <= 0) { simY = BALL_R; vy = Math.abs(vy); }
    if (simY + BALL_R >= FIELD_H) { simY = FIELD_H - BALL_R; vy = -Math.abs(vy); }

    // bal/jobb paddle vonal elérése
    if (vx < 0 && simX - BALL_R <= paddleX) return simY;
    if (vx > 0 && simX + BALL_R >= paddleX) return simY;

    // biztonsági limit
    if (simX < -100 || simX > FIELD_W+100) break;
  }
  return FIELD_H/2; // fallback
}

function predictBallX(paddleY) {
  let simX = ball.x, simY = ball.y;
  let vx = ball.vx, vy = ball.vy;

  while (true) {
    simX += vx;
    simY += vy;

    // bal/jobb fal pattanás
    if (simX - BALL_R <= 0) { simX = BALL_R; vx = Math.abs(vx); }
    if (simX + BALL_R >= FIELD_W) { simX = FIELD_W - BALL_R; vx = -Math.abs(vx); }

    // felső/alsó paddle vonal elérése
    if (vy < 0 && simY - BALL_R <= paddleY) return simX;
    if (vy > 0 && simY + BALL_R >= paddleY) return simX;

    if (simY < -100 || simY > FIELD_H+100) break;
  }
  return FIELD_W/2; // fallback
}

// --- ÚJ: AI döntés késleltetéssel ---
let aiDecisionDelay = {1:0,2:0,3:0,4:0};
setInterval(() => {
  if (gamePaused) {
    broadcastTo("display", JSON.stringify(buildState()));
    return;
  }

  const { PADDLE_H, PADDLE_W, PADDLE_THICKNESS } = computePaddles();
  const moveSpeed = Math.max(6, Math.floor(Math.min(FIELD_W, FIELD_H) * 0.02));
  const cornerLimit = 120;

  for (let i=1;i<=4;i++) {
    if (aiEnabled[i]) {
      if (!aiDecisionDelay[i]) aiDecisionDelay[i] = 0;
      if (Date.now() >= aiDecisionDelay[i]) {
        // lassabb reakció
        aiDecisionDelay[i] = Date.now() + (200 + Math.random()*200); // 200–400ms

        // kis esély hogy rosszat dönt (hibázás)
        if (Math.random() < 0.15) {  // 15% hiba
          players[i].dir = (Math.random() < 0.5) ? -1 : 1;
          continue;
        }

        if (i === 1) { // bal
          let target = predictBallY(PADDLE_OFFSET + PADDLE_THICKNESS) + (Math.random()*100 - 50); // ±50
          let paddleCenter = players[i].y + PADDLE_H/2;
          players[i].dir = (target > paddleCenter+AI_DEADZONE*2) ? 1 :
                          (target < paddleCenter-AI_DEADZONE*2) ? -1 : 0;
        }
        if (i === 2) { // jobb
          let target = predictBallY(FIELD_W - PADDLE_OFFSET - PADDLE_THICKNESS) + (Math.random()*100 - 50);
          let paddleCenter = players[i].y + PADDLE_H/2;
          players[i].dir = (target > paddleCenter+AI_DEADZONE*2) ? 1 :
                          (target < paddleCenter-AI_DEADZONE*2) ? -1 : 0;
        }
        if (i === 3) { // felső
          let target = predictBallX(PADDLE_OFFSET + PADDLE_THICKNESS) + (Math.random()*100 - 50);
          let paddleCenter = players[i].x + PADDLE_W/2;
          players[i].dir = (target > paddleCenter+AI_DEADZONE*2) ? 1 :
                          (target < paddleCenter-AI_DEADZONE*2) ? -1 : 0;
        }
        if (i === 4) { // alsó
          let target = predictBallX(FIELD_H - PADDLE_OFFSET - PADDLE_THICKNESS) + (Math.random()*100 - 50);
          let paddleCenter = players[i].x + PADDLE_W/2;
          players[i].dir = (target > paddleCenter+AI_DEADZONE*2) ? 1 :
                          (target < paddleCenter-AI_DEADZONE*2) ? -1 : 0;
        }
      }
    }
  }


  // paddlek mozgatása (keret közti tartományban, de most cornerLimit-tel)
  if (players[1]) {
    players[1].vy = players[1].dir * moveSpeed;
    // vert paddlek y korlátai: top = cornerLimit, bottom = FIELD_H - cornerLimit - PADDLE_H
    players[1].y = Math.max(cornerLimit, Math.min(FIELD_H - cornerLimit - PADDLE_H, players[1].y + players[1].vy));
  }
  if (players[2]) {
    players[2].vy = players[2].dir * moveSpeed;
    players[2].y = Math.max(cornerLimit, Math.min(FIELD_H - cornerLimit - PADDLE_H, players[2].y + players[2].vy));
  }
  if (players[3]) {
    players[3].vx = players[3].dir * moveSpeed;
    // horiz paddlek x korlátai: left = cornerLimit, right = FIELD_W - cornerLimit - PADDLE_W
    players[3].x = Math.max(cornerLimit, Math.min(FIELD_W - cornerLimit - PADDLE_W, players[3].x + players[3].vx));
  }
  if (players[4]) {
    players[4].vx = players[4].dir * moveSpeed;
    players[4].x = Math.max(cornerLimit, Math.min(FIELD_W - cornerLimit - PADDLE_W, players[4].x + players[4].vx));
  }

  // labda mozgatás
  ball.prevX = ball.x;
  ball.prevY = ball.y;

  ball.x += ball.vx;
  ball.y += ball.vy;

  const leftPaddleX = PADDLE_OFFSET;
  const rightPaddleX = FIELD_W - PADDLE_OFFSET - PADDLE_THICKNESS;
  const topPaddleY = PADDLE_OFFSET;
  const bottomPaddleY = FIELD_H - PADDLE_OFFSET - PADDLE_THICKNESS;
  // a cornerSize mostantól legyen a cornerLimit, hogy a fal és a paddlek konzisztensen kezeljék a sarkokat
  const cornerSize = cornerLimit;

  // --- ütközések paddlékkel pontosítva (prevX/prevY-vel) ---
 // Left paddle
if (ball.x - BALL_R <= leftPaddleX + PADDLE_THICKNESS &&
    ball.x + BALL_R >= leftPaddleX &&
    ball.y + BALL_R >= players[1].y &&
    ball.y - BALL_R <= players[1].y + PADDLE_H) {
  if (ball.vx < 0) {
    // balról jött
    ball.x = leftPaddleX + PADDLE_THICKNESS + BALL_R;
    ball.vx = Math.abs(ball.vx);
  } else {
    // hátulról jött (jobbról)
    ball.x = leftPaddleX - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }
  if (players[1].vy) { ball.vy += players[1].vy * 0.5; clampBallSpeed(); }
  sendToId(1, JSON.stringify({ type: "hit" }));
  lastHit = 1;
}


// Right paddle
if (ball.x + BALL_R >= rightPaddleX &&
    ball.x - BALL_R <= rightPaddleX + PADDLE_THICKNESS &&
    ball.y + BALL_R >= players[2].y &&
    ball.y - BALL_R <= players[2].y + PADDLE_H) {
  if (ball.vx > 0) {
    // jobbról jött
    ball.x = rightPaddleX - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  } else {
    // hátulról jött (balról)
    ball.x = rightPaddleX + PADDLE_THICKNESS + BALL_R;
    ball.vx = Math.abs(ball.vx);
  }
  if (players[2].vy) { ball.vy += players[2].vy * 0.5; clampBallSpeed(); }
  sendToId(2, JSON.stringify({ type: "hit" }));
  lastHit = 2;
}
// Top paddle
if (ball.y - BALL_R <= topPaddleY + PADDLE_THICKNESS &&
    ball.y + BALL_R >= topPaddleY &&
    ball.x + BALL_R >= players[3].x &&
    ball.x - BALL_R <= players[3].x + PADDLE_W) {
  if (ball.vy < 0) {
    // fentről jött
    ball.y = topPaddleY + PADDLE_THICKNESS + BALL_R;
    ball.vy = Math.abs(ball.vy);
  } else {
    // hátulról jött (lentről)
    ball.y = topPaddleY - BALL_R;
    ball.vy = -Math.abs(ball.vy);
  }
  if (players[3].vx) { ball.vx += players[3].vx * 0.5; clampBallSpeed(); }
  sendToId(3, JSON.stringify({ type: "hit" }));
  lastHit = 3;
}

// Bottom paddle
if (ball.y + BALL_R >= bottomPaddleY &&
    ball.y - BALL_R <= bottomPaddleY + PADDLE_THICKNESS &&
    ball.x + BALL_R >= players[4].x &&
    ball.x - BALL_R <= players[4].x + PADDLE_W) {
  if (ball.vy > 0) {
    // lentről jött
    ball.y = bottomPaddleY - BALL_R;
    ball.vy = -Math.abs(ball.vy);
  } else {
    // hátulról jött (fentről)
    ball.y = bottomPaddleY + PADDLE_THICKNESS + BALL_R;
    ball.vy = Math.abs(ball.vy);
  }
  if (players[4].vx) { ball.vx += players[4].vx * 0.5; clampBallSpeed(); }
  sendToId(4, JSON.stringify({ type: "hit" }));
  lastHit = 4;
}
  // sarokfal pattanás (most cornerSize-ot használva)
  if (ball.x - BALL_R <= 0 && (ball.y < FIELD_H - cornerSize && ball.y > cornerSize)) {
    // gól — bal oldali kapu
  } else if (ball.x - BALL_R <= 0) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  }
  if (ball.x + BALL_R >= FIELD_W && (ball.y < FIELD_H - cornerSize && ball.y > cornerSize)) {
    // gól — jobb oldali kapu
  } else if (ball.x + BALL_R >= FIELD_W) {
    ball.x = FIELD_W - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y - BALL_R <= 0 && (ball.x > cornerSize && ball.x < FIELD_W - cornerSize)) {
    // gól — felső kapu
  } else if (ball.y - BALL_R <= 0) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy);
  }
  if (ball.y + BALL_R >= FIELD_H && (ball.x > cornerSize && ball.x < FIELD_W - cornerSize)) {
    // gól — alsó kapu
  } else if (ball.y + BALL_R >= FIELD_H) {
    ball.y = FIELD_H - BALL_R;
    ball.vy = -Math.abs(ball.vy);
  }

  // pontszerzés

  if (ball.x < -BALL_R || ball.x > FIELD_W + BALL_R || ball.y < -BALL_R || ball.y > FIELD_H + BALL_R) {
    // +1 annak aki utoljára ütötte
    if (lastHit) {
      scores[lastHit]++;

      if (scores[lastHit] >= 5) {
        console.log(`Játékos ${lastHit} nyert!`);
        broadcastTo("display", JSON.stringify({ type: "winner", id: lastHit }));
        gamePaused = true;
        setTimeout(() => {
          scores = {1:0,2:0,3:0,4:0};
          resetGame();
          lastHit = null;
          gamePaused = false;
        }, 2000);
      }
    }

  if (ball.x < -BALL_R) {         // bal kapu
    scores[1] = Math.max(0, (scores[1] || 0) - 1);
  } else if (ball.x > FIELD_W + BALL_R) { // jobb kapu
    scores[2] = Math.max(0, (scores[2] || 0) - 1);
  } else if (ball.y < -BALL_R) {  // felső kapu
    scores[3] = Math.max(0, (scores[3] || 0) - 1);
  } else if (ball.y > FIELD_H + BALL_R) { // alsó kapu
    scores[4] = Math.max(0, (scores[4] || 0) - 1);
  }

    resetBall();
    lastHit = null;
  }

  broadcastTo("display", JSON.stringify(buildState()));
}, 1000/60);

function clampBallSpeed() {
  ball.vx = Math.max(-MAX_BALL_SPEED, Math.min(MAX_BALL_SPEED, ball.vx));
  ball.vy = Math.max(-MAX_BALL_SPEED, Math.min(MAX_BALL_SPEED, ball.vy));
}

function buildState() {
  const paddleInfo = computePaddles();
  return {
    type: "state",
    players,
    ball,
    scores,
    paddles: paddleInfo,
    roles: {
      1: aiEnabled[1] ? "AI" : "Player",
      2: aiEnabled[2] ? "AI" : "Player",
      3: aiEnabled[3] ? "AI" : "Player",
      4: aiEnabled[4] ? "AI" : "Player"
    }
  };
}

function broadcastTo(role, msg) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && c.role === role) {
      c.send(msg);
    }
  });
}

function sendToId(id, msg) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && c.role === "esp" && c.id === id) {
      c.send(msg);
    }
  });
}

wss.on("connection", (ws, req) => {
  const params = url.parse(req.url, true).query;
  ws.role = params.type || "unknown";

  if (ws.role === "esp") {
    const wantId = parseInt(params.id, 10);
    if (!wantId || wantId < 1 || wantId > 4) {
      ws.close(1008, "Érvénytelen vagy hiányzó id (1..4)"); return;
    }
    let inUse = false;
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN && c.role === "esp" && c.id === wantId) inUse = true;
    });
    if (inUse) { ws.close(1008, "Az id már foglalt"); return; }

    ws.id = wantId;
    console.log(`Új ESP, ID: ${ws.id}`);
    ws.send(JSON.stringify({ type: "welcome", id: ws.id }));
  }

  if (ws.role === "display") {
    console.log("Display csatlakozott");
  }

  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg.toString());

      if (ws.role === "display" && data.type === "displaySize") {
        FIELD_W = Number(data.width) || FIELD_W;
        FIELD_H = Number(data.height) || FIELD_H;
        console.log(`Pálya frissítve: ${FIELD_W}x${FIELD_H}`);
        resetGame();
        return;
      }

      if (ws.role === "esp" && ws.id) {
        if (data.type === "join") {
          aiEnabled[ws.id] = false;
          players[ws.id].dir = 0;
          ws.send(JSON.stringify({ type: "joined", id: ws.id }));
          console.log(`Játékos ${ws.id} Player mód`);
          return;
        }

        if (data.type === "return_to_ai") {
          aiEnabled[ws.id] = true;
          players[ws.id].dir = 0;
          console.log(`Játékos ${ws.id} vissza AI-ra`);
          return;
        }

        if (!aiEnabled[ws.id]) {
          lastInputTime[ws.id] = Date.now();
          if (gamePaused) return;

          if (ws.id===1||ws.id===2) {
            if (data.dir==="up") players[ws.id].dir=-1;
            else if (data.dir==="down") players[ws.id].dir=1;
            else players[ws.id].dir=0;
          }
          if (ws.id===3||ws.id===4) {
            if (data.dir==="left") players[ws.id].dir=-1;
            else if (data.dir==="right") players[ws.id].dir=1;
            else players[ws.id].dir=0;
          }
        }
      }
    } catch(e) {
      console.error("Hibás üzenet:", msg.toString());
    }
  });

  ws.on("close", () => {
    console.log(`Kapcsolat bontva: ${ws.role} ${ws.id||""}`);
    if (ws.role==="esp"&&ws.id) {
      players[ws.id].dir=0;
      aiEnabled[ws.id]=true;
    }
  });
});

server.listen(8080,"0.0.0.0",()=>console.log("HTTP+WS szerver fut: http://localhost:8080/"));
