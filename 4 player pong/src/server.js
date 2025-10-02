// server.js
// 4-játékos Pong – paddlek beljebb + AI deadzone + paddle velocity transfer + falpattanás a saroknál
// javítva: paddlek nem mennek be az L alakú sarkok alá (cornerLimit figyelembevétel)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");
const { exec } = require("child_process");

// ================== ADMIN API ==================
const adminApp = express();
const ADMIN_PORT = 3000; // admin API külön porton fut

adminApp.post("/restart", (req, res) => {
  console.log("Restart requested...");
  exec("bash /home/admin/4playerpong/restart.sh", (err, stdout, stderr) => {
    if (err) {
      console.error("Error restarting:", stderr);
      return res.status(500).send("Restart failed");
    }
    console.log(stdout);
    res.send("Servers restarted");
  });
});

adminApp.listen(ADMIN_PORT, () =>
  console.log(`Admin API listening on port ${ADMIN_PORT}`)
);

// ================== JÁTÉK SERVER ==================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/4playerpong" });

app.use(express.static(__dirname));
app.use(express.static(__dirname));

// alap értékek
let FIELD_W = 600;
let FIELD_H = 400;

// PADDLE meg BALL (I hate AI) beállítások
const PADDLE_SIZE_RATIO = 0.27;
const PADDLE_THICK_RATIO = 0.05;
const PADDLE_OFFSET = 30;
const BALL_R = 20;
const MAX_BALL_SPEED = 30;
const BALL_VELOCITY_SCALE = 1.2;

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

const MAX_GAME_TIMER = 120;
let gameTimer = MAX_GAME_TIMER; // másodpercek
let timerInterval = null;

function startGameTimer() {
  if (timerInterval) clearInterval(timerInterval);

  gameTimer = MAX_GAME_TIMER;
  timerInterval = setInterval(() => {
    if (gamePaused) return;
    gameTimer--;

// ha lejárt az idő
if (gameTimer <= 0) {
  console.log("⏰ Idő lejárt!");

  gamePaused = true;

  // Győztes meghatározása (legtöbb pont)
  const winnerId = Object.keys(scores).reduce((a,b) => scores[a] >= scores[b] ? a : b);
  console.log(`Idő lejárt - Győztes: Játékos ${winnerId}`);

  // Eredménytábla megjelenítése a klienseken
  broadcastTo("display", JSON.stringify({ type: "winner", id: winnerId }));

  // 10 mp scoreboard, aztán reset
  setTimeout(() => {
    scores = {1:0,2:0,3:0,4:0};
    broadcastTo("display", JSON.stringify({ type: "resetScores" }));
    gameTimer = MAX_GAME_TIMER;
    gamePaused = false;
    resetGame();
  }, 10000);
}



    // küldjük a maradék időt a kijelzőknek
    broadcastTo("display", JSON.stringify({ type: "timer", time: gameTimer }));

  }, 1000);
}

function resetBall() {
  ball.x = FIELD_W/2;
  ball.y = FIELD_H/2;
  resetBallVelocity();
  broadcastTo("esp", JSON.stringify({ type: "reset" }));
}

function resetBallVelocity() {
  ball.vx = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random()*2);
  ball.vy = (Math.random() > 0.5 ? 1 : -1) * (5 + Math.random()*2);
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
  startGameTimer();
  broadcastTo("display", JSON.stringify({ type: "reset" }));
}

resetGame();

// --- ÚJ: előrejelzés labda pályára ---
function predictBallY(targetSide) {
  let tempX = ball.x;
  let tempY = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;

  const leftPaddleX = PADDLE_OFFSET;
  const rightPaddleX = FIELD_W - PADDLE_OFFSET;

  for (let steps = 0; steps < 5000; steps++) {
    tempX += vx;
    tempY += vy;

    // felső/alsó fal pattanás
    if (tempY <= 0 || tempY + BALL_R * 2 >= FIELD_H) {
      vy = -vy;
    }

    if (targetSide === "left" && vx < 0 && tempX - BALL_R <= leftPaddleX) {
      return tempY + BALL_R;
    }
    if (targetSide === "right" && vx > 0 && tempX + BALL_R >= rightPaddleX) {
      return tempY + BALL_R;
    }
  }

  // ha nem sikerült kiszámolni → fallback
  return ball.y;
}


function predictBallX(targetSide) {
  let tempX = ball.x;
  let tempY = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;

  const topPaddleY = PADDLE_OFFSET;
  const bottomPaddleY = FIELD_H - PADDLE_OFFSET;

  for (let steps = 0; steps < 5000; steps++) {
    tempX += vx;
    tempY += vy;

    // bal/jobb fal pattanás
    if (tempX <= 0 || tempX + BALL_R * 2 >= FIELD_W) {
      vx = -vx;
    }

    if (targetSide === "top" && vy < 0 && tempY - BALL_R <= topPaddleY) {
      return tempX + BALL_R;
    }
    if (targetSide === "bottom" && vy > 0 && tempY + BALL_R >= bottomPaddleY) {
      return tempX + BALL_R;
    }
  }

  // fallback
  return ball.x;
}

setInterval(() => {
  if (gamePaused) {
    broadcastTo("display", JSON.stringify(buildState()));
    return;
  }

  const { PADDLE_H, PADDLE_W, PADDLE_THICKNESS } = computePaddles();
  const moveSpeed = Math.max(6, Math.floor(Math.min(FIELD_W, FIELD_H) * 0.03));
  const cornerLimit = 120;

  // szimpla AI
  // --- AI vezérlés deadzone-nal ---
  const AI_DEADZONE = 20;  // ennyin belül nem mozdul

  for (let i = 1; i <= 4; i++) {
    if (aiEnabled[i]) {
      if (i === 1) { // bal paddle
        let targetY = predictBallY("left");
        let paddleCenter = players[1].y + PADDLE_H / 2;
        let diff = targetY - paddleCenter;
        if (Math.abs(diff) > AI_DEADZONE) {
          players[1].dir = diff > 0 ? 1 : -1;
        } else {
          players[1].dir = 0;
        }
      }

      if (i === 2) { // jobb paddle
        let targetY = predictBallY("right");
        let paddleCenter = players[2].y + PADDLE_H / 2;
        let diff = targetY - paddleCenter;
        if (Math.abs(diff) > AI_DEADZONE) {
          players[2].dir = diff > 0 ? 1 : -1;
        } else {
          players[2].dir = 0;
        }
      }

      if (i === 3) { // felső paddle
        let targetX = predictBallX("top");
        let paddleCenter = players[3].x + PADDLE_W / 2;
        let diff = targetX - paddleCenter;
        if (Math.abs(diff) > AI_DEADZONE) {
          players[3].dir = diff > 0 ? 1 : -1;
        } else {
          players[3].dir = 0;
        }
      }

      if (i === 4) { // alsó paddle
        let targetX = predictBallX("bottom");
        let paddleCenter = players[4].x + PADDLE_W / 2;
        let diff = targetX - paddleCenter;
        if (Math.abs(diff) > AI_DEADZONE) {
          players[4].dir = diff > 0 ? 1 : -1;
        } else {
          players[4].dir = 0;
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
    ball.x = leftPaddleX + PADDLE_THICKNESS + BALL_R;
    ball.vx = Math.abs(ball.vx);
  } else {
    ball.x = leftPaddleX - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }

  // Gyorsulás minden pattanásnál
  ball.vx *= BALL_VELOCITY_SCALE;
  ball.vy *= BALL_VELOCITY_SCALE;
  clampBallSpeed();

  sendToId(1, JSON.stringify({ type: "hit" }));
  broadcastTo("display", JSON.stringify({ type: "hit" }));
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

  ball.vx *= BALL_VELOCITY_SCALE;
  ball.vy *= BALL_VELOCITY_SCALE;
  clampBallSpeed();

  sendToId(2, JSON.stringify({ type: "hit" }));
  broadcastTo("display", JSON.stringify({ type: "hit" }));
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
  
  ball.vx *= BALL_VELOCITY_SCALE;
  ball.vy *= BALL_VELOCITY_SCALE;
  clampBallSpeed();

  sendToId(3, JSON.stringify({ type: "hit" }));
  broadcastTo("display", JSON.stringify({ type: "hit" }));
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

  ball.vx *= BALL_VELOCITY_SCALE;
  ball.vy *= BALL_VELOCITY_SCALE;
  clampBallSpeed();

  sendToId(4, JSON.stringify({ type: "hit" }));
  broadcastTo("display", JSON.stringify({ type: "hit" }));
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

    // sarokfal pattanás a 30px vastag L alakú falról
  const cornerThickness = 30;  // ugyanaz mint a kliens lineWidth

  // bal felső
  if (ball.x - BALL_R < cornerThickness && ball.y - BALL_R < cornerThickness) {
    if (ball.x < cornerThickness) ball.vx = Math.abs(ball.vx);
    if (ball.y < cornerThickness) ball.vy = Math.abs(ball.vy);

    ball.vx *= BALL_VELOCITY_SCALE;
    ball.vy *= BALL_VELOCITY_SCALE;
    clampBallSpeed();
  }
  // jobb felső
  if (ball.x + BALL_R > FIELD_W - cornerThickness && ball.y - BALL_R < cornerThickness) {
    if (ball.x > FIELD_W - cornerThickness) ball.vx = -Math.abs(ball.vx);
    if (ball.y < cornerThickness) ball.vy = Math.abs(ball.vy);

    ball.vx *= BALL_VELOCITY_SCALE;
    ball.vy *= BALL_VELOCITY_SCALE;
    clampBallSpeed();
  }
  // bal alsó
  if (ball.x - BALL_R < cornerThickness && ball.y + BALL_R > FIELD_H - cornerThickness) {
    if (ball.x < cornerThickness) ball.vx = Math.abs(ball.vx);
    if (ball.y > FIELD_H - cornerThickness) ball.vy = -Math.abs(ball.vy);

    ball.vx *= BALL_VELOCITY_SCALE;
    ball.vy *= BALL_VELOCITY_SCALE;
    clampBallSpeed();
  }
  // jobb alsó
  if (ball.x + BALL_R > FIELD_W - cornerThickness && ball.y + BALL_R > FIELD_H - cornerThickness) {
    if (ball.x > FIELD_W - cornerThickness) ball.vx = -Math.abs(ball.vx);
    if (ball.y > FIELD_H - cornerThickness) ball.vy = -Math.abs(ball.vy);

    ball.vx *= BALL_VELOCITY_SCALE;
    ball.vy *= BALL_VELOCITY_SCALE;
    clampBallSpeed();
  }

  // pontszerzés

  if (ball.x < -BALL_R || ball.x > FIELD_W + BALL_R || ball.y < -BALL_R || ball.y > FIELD_H + BALL_R) {
  // melyik kapun ment ki (az áldozat)
    let victim = null;
    if (ball.x < -BALL_R) victim = 1;
    else if (ball.x > FIELD_W + BALL_R) victim = 2;
    else if (ball.y < -BALL_R) victim = 3;
    else if (ball.y > FIELD_H + BALL_R) victim = 4;

    // Csak akkor módosítunk pontokat, ha van lastHit ÉS az nem a victim (tehát a játékos nem adhat/vehet pontot saját magától)
    if (lastHit && victim != null && lastHit !== victim) {
      // +1 annak, aki utoljára ütött
      scores[lastHit] = (scores[lastHit] || 0) + 1;

      // győzelem ellenőrzés
      if (scores[lastHit] >= 5) {
        console.log(`Játékos ${lastHit} nyert!`);
        broadcastTo("display", JSON.stringify({ type: "winner", id: lastHit }));
        gamePaused = true;
        setTimeout(() => {
          scores = {1:0,2:0,3:0,4:0};
          resetGame();
          lastHit = null;
          gamePaused = false;
        }, 10000);
      }

      // -1 annak, akinek a kapuján áthaladt a labda
      scores[victim] = (scores[victim] || 0) - 1;
    }

    // ha nincs lastHit, vagy lastHit === victim, nem változik a pontszám

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

startGameTimer();
server.listen(8080,"0.0.0.0",()=>console.log("HTTP+WS szerver fut: http://localhost:8080/"));
