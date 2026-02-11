// server.js
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const { calculateGlitchMove } = require('./ai_glitch');
const storage = require('./storage'); 
const world = require('./world'); 
const combat = require('./combat'); 

app.use(express.static(__dirname + '/public'));
storage.loadData();

let players = {};
let enemies = {};
let destroyedBlocks = new Set();
let powerUps = new Map();
let activeBombs = new Map();
let activeFlames = []; 

const ROUND_DURATION = 5 * 60 * 1000;
let roundEndTime = Date.now() + ROUND_DURATION;

function broadcastChat(msgData) {
    const msg = storage.saveChatMessage(msgData);
    io.emit('chatMessage', msg);
}

function updateAndBroadcastRank(player) {
    const updatedRank = storage.updateGlobalRank(player);
    io.emit('leaderboardUpdate', updatedRank);
}

const getTileAt = (x, y) => world.getTileAt(x, y, destroyedBlocks);
const findSafeTile = (x, y) => world.findSafeTile(x, y, destroyedBlocks, activeBombs);

function getGameContext() {
    return { activeBombs, destroyedBlocks, powerUps, activeFlames, enemies, getTileAt, spawnEnemy, io, broadcastChat };
}

function resetMapRound() {
    destroyedBlocks.clear();
    powerUps.clear();
    activeBombs.clear();
    activeFlames.length = 0; 
    for (const key in enemies) delete enemies[key];

    Object.values(players).forEach(p => { p.x = 0; p.y = 0; p.lastMoveTime = Date.now(); });
    for (let i = 0; i < 240; i++) spawnEnemy();
    roundEndTime = Date.now() + ROUND_DURATION;
    
    io.emit('roundReset', { players, enemies, roundEndTime, destroyedBlocks: [] });
    broadcastChat({ id: 'SYSTEM', text: `[SYSTEM] Garbage Collection executed. Map reset.`, system: true });
    io.emit('notification', { text: "GC: Map Memory Cleared. Resetting...", type: "warn" });
}

setInterval(() => {
    let moved = false;
    activeBombs.forEach((bomb, id) => {
        if (bomb.sliding) {
            const nx = bomb.x + bomb.vx, ny = bomb.y + bomb.vy;
            const tile = getTileAt(nx, ny);
            const otherBomb = Array.from(activeBombs.values()).find(b => b.x === nx && b.y === ny);
            const pAt = Object.values(players).find(p => p.x === nx && p.y === ny && !p.isDead);
            const eAt = Object.values(enemies).find(e => e.x === nx && e.y === ny);
            const iAt = powerUps.has(`${nx},${ny}`);
            const enteringSafe = Math.abs(nx) <= 5 && Math.abs(ny) <= 5;
            if (tile === 0 && !otherBomb && !pAt && !eAt && !iAt && !enteringSafe) {
                bomb.x = nx; bomb.y = ny; moved = true;
            } else { bomb.sliding = false; }
        }
    });
    if (moved) io.emit('bombUpdate', Array.from(activeBombs.values()));
}, 100);

setInterval(() => {
    if (destroyedBlocks.size === 0) return;
    const dArray = Array.from(destroyedBlocks);
    let reg = false;
    for (let i = 0; i < 5; i++) {
        const k = dArray[Math.floor(Math.random() * dArray.length)];
        if(!k) continue;
        const [bx, by] = k.split(',').map(Number);
        if (!Object.values(players).some(p => Math.abs(p.x - bx) < 8 && Math.abs(p.y - by) < 8)) {
            destroyedBlocks.delete(k); reg = true;
        }
    }
    if (reg) io.emit('mapUpdate', { destroyedBlocks: Array.from(destroyedBlocks) });
}, 10000);

function spawnEnemy(specificPos = null, isRaging = false, invincibleDuration = 0, forceOffScreen = false) {
    const id = 'en_' + Date.now() + Math.random();
    let ex, ey;
    let attempts = 0;
    if (specificPos) { ex = specificPos.x; ey = specificPos.y; } 
    else {
        do {
            ex = Math.floor(Math.random() * 240) - 120;
            ey = Math.floor(Math.random() * 240) - 120;
            attempts++;
            if (forceOffScreen && attempts < 50 && Object.values(players).some(p => Math.abs(p.x - ex) < 18 && Math.abs(p.y - ey) < 18)) continue;
            if (getTileAt(ex, ey) === 0 && (Math.abs(ex) > 5 || Math.abs(ey) > 5)) break;
        } while (attempts < 100);
    }
    const rnd = Math.random();
    let type = 'green'; let health = 1; let bombs = 0; let radius = 3;
    if (rnd < 0.08) { type = 'blue'; health = 2; } else if (rnd < 0.16) { type = 'orange'; bombs = 3; } else if (rnd < 0.24) { type = 'red'; bombs = 1; radius = 2; } else if (rnd < 0.32) { type = 'purple'; } else if (rnd < 0.40) { type = 'cyan'; } else if (rnd < 0.55) { type = 'yellow'; } 
    let isBuffed = false;
    const isFar = Math.abs(ex) > 50 || Math.abs(ey) > 50;
    if (type === 'green' && isFar && Math.random() < 0.8) { isBuffed = true; bombs = 2; }

    enemies[id] = { id, x: ex, y: ey, lastMove: Date.now(), type, isBuffed, bombs, radius, health, isRaging: isRaging ? Date.now() : null, invincibleUntil: invincibleDuration > 0 ? Date.now() + invincibleDuration : null, state: 'IDLE' };
}
for (let i = 0; i < 240; i++) spawnEnemy();

setInterval(() => {
    const now = Date.now();
    if (now >= roundEndTime) { resetMapRound(); return; }

    activeFlames = activeFlames.filter(f => now - f.time < 1000);
    
    Object.values(players).forEach(p => {
        if (p.isDead) return;
        if (p.ghostUntil && now > p.ghostUntil) {
            p.ghostUntil = null;
            if (getTileAt(p.x, p.y) === 2) {
                const safe = findSafeTile(p.x, p.y);
                p.x = safe.x; p.y = safe.y;
                broadcastChat({ id: 'SYSTEM', text: `[SYSTEM] ${p.name} rematerializou.`, system: true });
            }
        }
        if (p.pierceUntil && now > p.pierceUntil) p.pierceUntil = null;
        if (p.kickUntil && now > p.kickUntil) p.kickUntil = null;

        Object.values(enemies).forEach(en => { if (en.x === p.x && en.y === p.y) resetPlayer(p, `eliminated by Glitch <${en.type}>`, 'error'); });
        
        const killingFlame = activeFlames.find(f => f.x === p.x && f.y === p.y);
        if (killingFlame) {
            let cause = ""; let type = "error";
            if (killingFlame.owner === p.id) { cause = `committed suicide`; type = "warn"; } 
            else if (players[killingFlame.owner]) {
                const killer = players[killingFlame.owner];
                killer.kills++; killer.score += 50;
                updateAndBroadcastRank(killer);
                cause = `eliminated by ${killer.name}`;
                // LOG: Jogador eliminou jogador
                io.emit('activityLog', { name: killer.name, color: killer.color, action: `eliminou um<br>jogador!`, type: 'kill' });
            } else { cause = `burned to death`; }
            resetPlayer(p, cause, type);
        }
    });

    let enemyUpdate = false;
    const enemyPositions = new Set();
    Object.values(enemies).forEach(e => enemyPositions.add(`${e.x},${e.y}`));

    Object.values(enemies).forEach(en => {
        const flame = activeFlames.find(f => f.x === en.x && f.y === en.y);
        if (flame) {
            if (en.invincibleUntil && now < en.invincibleUntil) {} 
            else {
                en.health--;
                if (en.health > 0) { en.invincibleUntil = now + 1500; enemyUpdate = true; } 
                else {
                    if (players[flame.owner]) { 
                        let scoreVal = 10; if (en.type === 'blue') scoreVal = 30; if (en.type === 'purple') scoreVal = 20;
                        players[flame.owner].score += scoreVal; players[flame.owner].enemyKills++;
                        updateAndBroadcastRank(players[flame.owner]); 
                        // LOG: Jogador eliminou Glitchie
                        io.emit('activityLog', { name: players[flame.owner].name, color: players[flame.owner].color, action: `eliminou um<br>glitchie!`, type: 'kill' });
                    }
                    delete enemies[en.id]; 
                    io.emit('sfx', 'glitchDeath'); 
                    if (!en.isRaging) { spawnEnemy(null, false, 0, true); if(Math.random() > 0.5) spawnEnemy(null, false, 0, true); }
                    enemyUpdate = true; return;
                }
            }
        }
        if (en.isRaging && now - en.isRaging > 4000) en.isRaging = null;
        const decision = calculateGlitchMove(en, players, getTileAt, activeBombs, powerUps, enemyPositions);
        if (decision) {
            en.state = decision.state || 'IDLE';
            if (decision.action === 'move') { en.x = decision.x; en.y = decision.y; enemyUpdate = true; }
            else if (decision.action === 'bomb') {
                if (Array.from(activeBombs.values()).filter(b => b.owner === en.id).length < en.bombs) {
                    const bid = "eb_" + Date.now() + en.id;
                    activeBombs.set(bid, { x: en.x, y: en.y, id: bid, radius: en.radius, owner: en.id, sliding: false, isPierce: false });
                    io.emit('bombUpdate', Array.from(activeBombs.values()));
                    io.emit('sfx', 'place');
                    setTimeout(() => combat.detonateBomb(bid, en.id, getGameContext()), 2000);
                }
            }
        } else {
            // Se não houve decisão, mantenha o último estado ou defina como 'IDLE'
            if (!en.state) en.state = 'IDLE';
        }
    });
    if (enemyUpdate) io.emit('enemiesUpdate', enemies);
}, 50);

function resetPlayer(p, causeMsg, notifType = 'error') {
    p.deaths = (p.deaths || 0) + 1;
    updateAndBroadcastRank(p);
    
    p.notified30 = false; p.notified60 = false;
    p.score = 0; p.x = 0; p.y = 0; p.bombs = 1; p.radius = 1; p.kickUntil = null; p.moveDelay = 150; 
    p.pierceUntil = null; p.ghostUntil = null; p.maxDist = 0;
    p.isDead = true; 
    
    const fullMsg = `Fatal Error: ${causeMsg}`;
    
    io.to(p.id).emit('playerKilled', fullMsg);
    io.emit('notification', { text: `${p.name} ${causeMsg}`, type: notifType });
    broadcastChat({ id: 'SYSTEM', text: `[SYSTEM] ${p.name}: ${fullMsg}`, system: true });
    
    // LOG: Jogador Morreu
    io.emit('activityLog', { name: p.name, color: p.color, action: `sofreu um erro:<br><span style="color:#cccccc">${causeMsg}</span>`, type: 'death' });

    io.emit('playerMoved', p);
    io.emit('rankUpdate', Object.values(players).sort((a,b)=>b.score-a.score));
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        const globalRank = storage.getRanking();
        const saved = globalRank.find(p => p.name === name);
        
        // --- VERIFICAÇÃO DE COR ---
        // Se o jogador já tem um save, usa a cor salva. Se for um jogador novo, gera uma aleatória.
        const playerColor = (saved && saved.color) ? saved.color : `hsl(${Math.random() * 360}, 80%, 60%)`;

        players[socket.id] = { 
            id: socket.id, name: name || "User", x: 0, y: 0, 
            score: saved ? saved.score : 0, 
            bombs: 1, radius: 1, kickUntil: null, moveDelay: 150, pierceUntil: null, ghostUntil: null, lastMoveTime: 0, 
            color: playerColor, // <--- Aplica a cor persistente aqui
            maxDist: saved ? (saved.maxDist || 0) : 0, 
            kills: saved ? (saved.kills || 0) : 0, 
            enemyKills: saved ? (saved.enemyKills || 0) : 0, 
            deaths: saved ? (saved.deaths || 0) : 0,
            notified30: false, notified60: false, isDead: false 
        };
        
        socket.emit('init', { id: socket.id, players, enemies, destroyedBlocks: Array.from(destroyedBlocks), activeBombs: Array.from(activeBombs.values()), powerUps: Array.from(powerUps), roundEndTime });
        socket.emit('chatHistory', storage.getChatHistory());
        
        broadcastChat({ id: 'SYSTEM', text: `[NET] ${players[socket.id].name} connected.`, system: true });
        socket.emit('notification', { text: "INFO: Uma surpresa te aguarda na borda do mapa...", type: "info" });
        
        updateAndBroadcastRank(players[socket.id]);
        io.emit('rankUpdate', Object.values(players).sort((a,b)=>b.score-a.score));
        io.emit('leaderboardUpdate', storage.getRanking());
    });

    socket.on('move', (data) => {
        const p = players[socket.id]; const now = Date.now();
        if (p && !p.isDead && now - p.lastMoveTime > p.moveDelay) {
            const bombAt = Array.from(activeBombs.values()).find(b => b.x === data.x && b.y === data.y);
            if (bombAt && p.kickUntil && now < p.kickUntil && !bombAt.sliding) {
                const vx = data.x - p.x, vy = data.y - p.y;
                if (Math.abs(bombAt.x + vx) <= 5 && Math.abs(bombAt.y + vy) <= 5) return;
                bombAt.sliding = true; bombAt.vx = vx; bombAt.vy = vy;
                io.emit('sfx', 'kick'); io.emit('playerMoved', p); io.emit('bombUpdate', Array.from(activeBombs.values())); return;
            }
            const tile = getTileAt(data.x, data.y);
            if (!bombAt && (tile === 0 || (p.ghostUntil && now < p.ghostUntil && tile === 2))) {
                p.x = data.x; p.y = data.y; p.lastMoveTime = now;
                const dist = Math.max(Math.abs(p.x), Math.abs(p.y));
                if (dist > p.maxDist) p.maxDist = dist;
                
                if (dist > 30 && !p.notified30) { p.notified30 = true; socket.emit('notification', { text: "INFO: Você já está quase na metade do caminho.", type: "info" }); }
                if (dist > 60 && !p.notified60) { p.notified60 = true; socket.emit('notification', { text: "WARN: Você está chegando na borda...", type: "warn" }); }
                
                const key = `${p.x},${p.y}`;
                if (powerUps.has(key)) {
                    const item = powerUps.get(key);
                    let powerMsg = "";
                    
                    if (item.type === 'bomb') { p.bombs++; powerMsg = "Mais bombas!"; } 
                    else if (item.type === 'fire') { p.radius++; powerMsg = "Raio da explosão aumentado!"; } 
                    else if (item.type === 'speed') { p.moveDelay = Math.max(50, p.moveDelay - 20); powerMsg = "Velocidade aumentada!"; }
                    else if (item.type === 'kick') { p.kickUntil = now + 10000; powerMsg = "Chutar Bombas"; } 
                    else if (item.type === 'ghost') { p.ghostUntil = now + 10000; powerMsg = "Modo Ghost"; } 
                    else if (item.type === 'pierce') { p.pierceUntil = now + 10000; powerMsg = "Bomba Perfurante"; }
                    
                    powerUps.delete(key); 
                    io.emit('powerUpsUpdate', Array.from(powerUps)); 
                    io.emit('sfx', 'powerup');

                    // LOG: Jogador pegou PowerUp (Enviado a TODOS os clientes)
                    io.emit('activityLog', { name: p.name, color: p.color, action: `carregou modulo:<br><span style="color:#cccccc">${powerMsg}</span>`, type: 'powerup' });

                    if (['kick', 'ghost', 'pierce'].includes(item.type)) {
                        socket.emit('timedNotification', { id: `buff_${item.type}`, title: 'Buff Temporário', text: powerMsg, duration: 10000 });
                    } else {
                        socket.emit('notification', { text: `PowerUp: ${powerMsg}`, type: "info" });
                    }
                }
                io.emit('playerMoved', p); io.emit('rankUpdate', Object.values(players).sort((a,b)=>b.score-a.score));
            }
        }
    });
    
    socket.on('placeBomb', (data) => {
        const p = players[socket.id];
        if (Math.abs(data.x) <= 5 && Math.abs(data.y) <= 5) return;
        if (p && !p.isDead && Array.from(activeBombs.values()).filter(b => b.owner === socket.id).length < p.bombs) {
            const bid = "b_" + Date.now() + socket.id;
            const isPierce = p.pierceUntil && Date.now() < p.pierceUntil;
            activeBombs.set(bid, { x: data.x, y: data.y, id: bid, radius: p.radius, owner: socket.id, sliding: false, isPierce: isPierce });
            io.emit('bombUpdate', Array.from(activeBombs.values()));
            io.emit('sfx', 'place');
            setTimeout(() => combat.detonateBomb(bid, socket.id, getGameContext()), 2000);
        }
    });

    socket.on('chatMessage', (msg) => { 
        if(players[socket.id]) {
            broadcastChat({ id: socket.id, name: players[socket.id].name, text: msg.substring(0, 50) }); 
        }
    });

    socket.on('disconnect', () => { 
        if(players[socket.id]) { 
            updateAndBroadcastRank(players[socket.id]); 
            broadcastChat({ id: 'SYSTEM', text: `[NET] ${players[socket.id].name} disconnected.`, system: true }); 
        } 
        delete players[socket.id]; 
        io.emit('rankUpdate', Object.values(players).sort((a,b)=>b.score-a.score)); 
    });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});