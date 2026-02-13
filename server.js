// server.js
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const { calculateGlitchMove } = require('./ai_glitch');
const storage = require('./storage'); 
const world = require('./world'); 
const worldDuel = require('./world_duel');
const duelManager = require('./duel_manager');
const combat = require('./combat'); 

app.use(express.static(__dirname + '/public'));
storage.loadData();

let players = {};
let enemies = {};
let destroyedBlocks = new Set();
let powerUps = new Map();
let activeBombs = new Map();
let activeFlames = []; 

const ROUND_DURATION = 30 * 60 * 1000;
let roundEndTime = Date.now() + ROUND_DURATION;

function broadcastChat(msgData) {
    const msg = storage.saveChatMessage(msgData);
    io.emit('chatMessage', msg);
}

function updateAndBroadcastRank(player) {
    const updatedRank = storage.updateGlobalRank(player);
    io.emit('leaderboardUpdate', updatedRank);
}

// Helper para chaves compostas por dimensão
const getDimKey = (x, y, dim) => `${dim}:${x},${y}`;

// Wrapper do getTileAt que suporta dimensões
const getTileAt = (x, y, dim = 'main') => {
    // Filtra blocos destruídos apenas da dimensão atual
    // Cria um Set temporário com chaves locais "x,y" para passar ao world.js
    // (Otimização: idealmente world.js aceitaria o prefixo, mas isso mantém compatibilidade)
    const localDestroyed = new Set();
    destroyedBlocks.forEach(k => { if(k.startsWith(dim+':')) localDestroyed.add(k.split(':')[1]); });
    if (dim.startsWith('duel')) {
        return worldDuel.getTileAt(x, y, localDestroyed, world.getSeed());
    }
    return world.getTileAt(x, y, localDestroyed);
};

const findSafeTile = (x, y) => world.findSafeTile(x, y, destroyedBlocks, activeBombs); // Nota: findSafeTile precisaria de update para duelos, mas duelos são arenas fixas

function getGameContext() {
    return { activeBombs, destroyedBlocks, powerUps, activeFlames, enemies, getTileAt, spawnEnemy, io, broadcastChat, players, getDimKey };
}

function resetMapRound() {
    destroyedBlocks.clear();
    powerUps.clear();
    activeBombs.clear();
    activeFlames.length = 0; 
    
    // Gera uma nova semente para o mapa mudar
    const newSeed = Math.random() * 10000;
    world.setSeed(newSeed);

    for (const key in enemies) delete enemies[key];

    Object.values(players).forEach(p => { p.x = 0; p.y = 0; p.lastMoveTime = Date.now(); });
    for (let i = 0; i < 240; i++) spawnEnemy();
    roundEndTime = Date.now() + ROUND_DURATION;
    
    io.emit('roundReset', { players, enemies, roundEndTime, destroyedBlocks: [], mapSeed: newSeed });
    broadcastChat({ id: 'SYSTEM', text: `[SYSTEM] Garbage Collection executed. Map reset.`, system: true });
    io.emit('notification', { text: "GC: Map Memory Cleared. Resetting...", type: "warn" });
}

setInterval(() => {
    let moved = false;
    activeBombs.forEach((bomb, id) => {
        // Física da bomba só interage com coisas na mesma dimensão
        if (bomb.sliding) {
            const nx = bomb.x + bomb.vx, ny = bomb.y + bomb.vy;
            const tile = getTileAt(nx, ny, bomb.dimension);
            const otherBomb = Array.from(activeBombs.values()).find(b => b.dimension === bomb.dimension && b.x === nx && b.y === ny);
            const pAt = Object.values(players).find(p => p.dimension === bomb.dimension && p.x === nx && p.y === ny && !p.isDead);
            const eAt = Object.values(enemies).find(e => e.dimension === bomb.dimension && e.x === nx && e.y === ny);
            const iAt = powerUps.has(getDimKey(nx, ny, bomb.dimension));
            const enteringSafe = Math.abs(nx) <= 5 && Math.abs(ny) <= 5;
            if (tile === 0 && !otherBomb && !pAt && !eAt && !iAt && !enteringSafe) {
                bomb.x = nx; bomb.y = ny; moved = true;
            } else { bomb.sliding = false; }
        }
    });
    if (moved) broadcastBombs();
}, 100);

// Função auxiliar para enviar bombas apenas para as salas corretas
function broadcastBombs() {
    const bombsByDim = {};
    activeBombs.forEach(b => {
        if (!bombsByDim[b.dimension]) bombsByDim[b.dimension] = [];
        bombsByDim[b.dimension].push(b);
    });
    // Envia para cada sala (dimensão) apenas as suas bombas
    // Se uma dimensão não tem bombas, podemos enviar array vazio se necessário, mas o cliente lida bem
    for (const dim in bombsByDim) {
        io.to(dim).emit('bombUpdate', bombsByDim[dim]);
    }
    // Garante que 'main' receba update mesmo vazio se necessário, ou deixe o cliente limpar
    if (!bombsByDim['main']) io.to('main').emit('bombUpdate', []);
}

setInterval(() => {
    if (destroyedBlocks.size === 0) return;
    const dArray = Array.from(destroyedBlocks);
    let reg = false;
    for (let i = 0; i < 5; i++) {
        const k = dArray[Math.floor(Math.random() * dArray.length)];
        if(!k) continue;
        // k agora é "dim:x,y"
        const [dim, coords] = k.split(':');
        const [bx, by] = coords.split(',').map(Number);
        
        // Só regenera se não tiver player perto NA MESMA DIMENSÃO
        if (!Object.values(players).some(p => p.dimension === dim && Math.abs(p.x - bx) < 8 && Math.abs(p.y - by) < 8)) {
            destroyedBlocks.delete(k); reg = true;
        }
    }
    if (reg) broadcastMapUpdate();
}, 10000);

function broadcastMapUpdate() {
    // Agrupa blocos por dimensão para enviar
    const blocksByDim = {};
    destroyedBlocks.forEach(k => {
        const [dim, coords] = k.split(':');
        if (!blocksByDim[dim]) blocksByDim[dim] = [];
        blocksByDim[dim].push(coords); // Envia apenas "x,y" para o cliente
    });
    for (const dim in blocksByDim) {
        io.to(dim).emit('mapUpdate', { destroyedBlocks: blocksByDim[dim] });
    }
}

function spawnEnemy(specificPos = null, isRaging = false, invincibleDuration = 0, forceOffScreen = false) {
    const id = 'en_' + Date.now() + Math.random();
    let ex, ey;
    let attempts = 0;
    if (specificPos) { ex = specificPos.x; ey = specificPos.y; } 
    else {
        do {
            ex = Math.floor(Math.random() * 360) - 180;
            ey = Math.floor(Math.random() * 360) - 180;
            attempts++;
            if (forceOffScreen && attempts < 50 && Object.values(players).some(p => Math.abs(p.x - ex) < 18 && Math.abs(p.y - ey) < 18)) continue;
            if (getTileAt(ex, ey) === 0 && (Math.abs(ex) > 5 || Math.abs(ey) > 5)) break;
        } while (attempts < 100);
    }
    
    // --- CÁLCULO DE PROGRESSÃO DE NÍVEL ---
    const distOrigin = Math.max(Math.abs(ex), Math.abs(ey));
    let level = 0;
    if (distOrigin > 5) level = Math.floor((distOrigin - 6) / 15) + 1;
    
    // 3% de velocidade e inteligência por nível
    const speedMult = Math.pow(1.03, level);
    const smartness = Math.min(1.0, 0.1 + (level * 0.03)); // Base 10% + 3% por nível
    // Visão: Base 4, aumenta até 10 no nível 10
    const baseVision = Math.min(10, 4 + (level * 0.6));

    const rnd = Math.random();
    let type = 'green'; let health = 1; let bombs = 0; let radius = 3;
    if (rnd < 0.08) { type = 'blue'; health = 2; } else if (rnd < 0.16) { type = 'orange'; bombs = 3; } else if (rnd < 0.24) { type = 'red'; bombs = 1; radius = 2; } else if (rnd < 0.32) { type = 'purple'; } else if (rnd < 0.40) { type = 'cyan'; } else if (rnd < 0.55) { type = 'yellow'; } 
    let isBuffed = false;
    if (type === 'green' && level > 3 && Math.random() < 0.8) { isBuffed = true; bombs = 2; }

    // --- PROGRESSÃO DE ATRIBUTOS (RPG SCALING) ---
    // A cada 4 níveis, ganha +1 de Vida (Máximo +3)
    health += Math.floor(level / 4);
    // A cada 3 níveis, ganha +1 de Raio de Explosão
    if (bombs > 0) radius += Math.floor(level / 3);
    // A cada 5 níveis, ganha +1 Bomba extra (Munição)
    if (bombs > 0) bombs += Math.floor(level / 5);

    enemies[id] = { id, x: ex, y: ey, dimension: 'main', lastMove: Date.now(), type, isBuffed, bombs, radius, health, isRaging: isRaging ? Date.now() : null, invincibleUntil: invincibleDuration > 0 ? Date.now() + invincibleDuration : null, state: 'IDLE', level, speedMult, smartness, baseVision, alertedUntil: 0 };
}
for (let i = 0; i < 240; i++) spawnEnemy();

setInterval(() => {
    const now = Date.now();
    if (now >= roundEndTime) { resetMapRound(); return; }

    activeFlames = activeFlames.filter(f => now - f.time < 1000);
    
    Object.values(players).forEach(p => {
        if (p.isDead) return;

        // --- LÓGICA DE AUTO-BOMBA (DEBUFF) ---
        if (p.autoBombUntil && now < p.autoBombUntil) {
            if (now - (p.lastAutoBomb || 0) > 1500) {
                p.lastAutoBomb = now;
                // Tenta colocar bomba automaticamente
                if (Array.from(activeBombs.values()).filter(b => b.owner === p.id && b.dimension === p.dimension).length < p.bombs) {
                    const bid = "ab_" + Date.now() + p.id;
                    const isPierce = p.pierceUntil && Date.now() < p.pierceUntil;
                    activeBombs.set(bid, { x: p.x, y: p.y, dimension: p.dimension, id: bid, radius: p.radius, owner: p.id, sliding: false, isPierce: isPierce });
                    broadcastBombs();
                    io.emit('sfx', 'place');
                    setTimeout(() => combat.detonateBomb(bid, p.id, getGameContext()), 2000);
                }
            }
        } else { p.autoBombUntil = null; }
        // -------------------------------------

        if (p.ghostUntil && now > p.ghostUntil) {
            p.ghostUntil = null;
            if (getTileAt(p.x, p.y, p.dimension) === 2) {
                const safe = findSafeTile(p.x, p.y);
                p.x = safe.x; p.y = safe.y;
                broadcastChat({ id: 'SYSTEM', text: `[SYSTEM] ${p.name} rematerializou.`, system: true });
            }
        }
        if (p.pierceUntil && now > p.pierceUntil) p.pierceUntil = null;
        if (p.kickUntil && now > p.kickUntil) p.kickUntil = null;

        if (p.slowUntil && now > p.slowUntil) p.slowUntil = null;
        if (p.invertUntil && now > p.invertUntil) p.invertUntil = null;

        Object.values(enemies).forEach(en => { if (en.dimension === p.dimension && en.x === p.x && en.y === p.y) resetPlayer(p, `eliminated by Glitch <${en.type}>`, 'error'); });
        
        const killingFlame = activeFlames.find(f => f.dimension === p.dimension && f.x === p.x && f.y === p.y);
        if (killingFlame) {
            // --- MORTE EM DUELO ---
            if (p.inDuel) {
                duelManager.handleDuelDeath(p, killingFlame.owner, players, io, broadcastChat);
                io.emit('sfx', 'powerup'); // Cura visual global (ou mover para dentro do manager se quiser)
                return;
            }
            // ----------------------

            let cause = ""; let type = "error";
            if (killingFlame.owner === p.id) { cause = `committed suicide`; type = "warn"; } 
            else if (players[killingFlame.owner]) {
                const killer = players[killingFlame.owner]; killer.sessionKills++;
                killer.kills++; killer.score += 30;
                io.to(killer.dimension).emit('floatingText', { x: killer.x, y: killer.y, text: "+30" });
                updateAndBroadcastRank(killer);
                cause = `eliminated by ${killer.name}`;
                // LOG: Jogador eliminou jogador
                io.emit('activityLog', { name: killer.name, color: killer.color, action: `eliminou um<br>jogador!`, type: 'kill' });
            } else { cause = `burned to death`; }
            resetPlayer(p, cause, type);
        }
    });

    let enemyUpdate = false;
    Object.values(enemies).forEach(en => {
        const flame = activeFlames.find(f => f.dimension === en.dimension && f.x === en.x && f.y === en.y);
        if (flame) {
            if (en.invincibleUntil && now < en.invincibleUntil) {} 
            else {
                en.health--;
                if (en.health > 0) { en.invincibleUntil = now + 1500; enemyUpdate = true; } 
                else {
                    if (players[flame.owner]) { 
                        players[flame.owner].score += 10; 
                        io.to(players[flame.owner].dimension).emit('floatingText', { x: players[flame.owner].x, y: players[flame.owner].y, text: "+10" });
                        players[flame.owner].enemyKills++; players[flame.owner].sessionEnemyKills++;
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
        const decision = calculateGlitchMove(en, players, getTileAt, activeBombs, powerUps, enemies);
        if (decision) {
            en.state = decision.state || 'IDLE';
            if (decision.action === 'move') { en.x = decision.x; en.y = decision.y; enemyUpdate = true; }
            else if (decision.action === 'bomb') {
                if (Array.from(activeBombs.values()).filter(b => b.owner === en.id && b.dimension === en.dimension).length < en.bombs) {
                    const bid = "eb_" + Date.now() + en.id;
                    activeBombs.set(bid, { x: en.x, y: en.y, dimension: en.dimension, id: bid, radius: en.radius, owner: en.id, sliding: false, isPierce: false });
                    broadcastBombs();
                    io.emit('sfx', 'place');
                    setTimeout(() => combat.detonateBomb(bid, en.id, getGameContext()), 2000);
                }
            }
        } else {
            // Se não houve decisão, mantenha o último estado ou defina como 'IDLE'
            if (!en.state) en.state = 'IDLE';
        }
    });
    if (enemyUpdate) io.to('main').emit('enemiesUpdate', enemies); // Inimigos só existem na main por enquanto
}, 50);

function resetPlayer(p, causeMsg, notifType = 'error') {
    p.deaths = (p.deaths || 0) + 1;

    const timeAlive = p.spawnExitTime ? Math.floor((Date.now() - p.spawnExitTime) / 1000) : 0;
    const deathSummary = {
        cause: causeMsg,
        score: p.score,
        maxLevel: p.sessionMaxLevel,
        timeAlive: timeAlive,
        kills: p.sessionKills,
        enemyKills: p.sessionEnemyKills,
        powerups: p.sessionPowerups
    };

    // Atualiza o ranking global com os dados da sessão (maior score, maior level, etc)
    updateAndBroadcastRank(p); 
    
    p.notified30 = false; p.notified60 = false;
    p.score = 0; p.x = 0; p.y = 0; p.bombs = 1; p.radius = 1; p.kickUntil = null; p.moveDelay = 150; 
    p.pierceUntil = null; p.ghostUntil = null; p.maxDist = 0; p.level = 0; p.sessionMaxLevel = 0;
    p.sessionKills = 0; p.sessionEnemyKills = 0; p.spawnExitTime = null;
    p.slowUntil = null; p.invertUntil = null; p.autoBombUntil = null; p.lastAutoBomb = 0;
    p.sessionPowerups = { bomb: 0, fire: 0, speed: 0, kick: 0, ghost: 0, pierce: 0 };
    p.isDead = true; 
    p.inDuel = null; p.savedState = null; // Garante limpeza se morrer fora de duelo
    p.dimension = 'main';
    
    const sock = io.sockets.sockets.get(p.id);
    if(sock) { sock.join('main'); } // Garante que está na main
    
    io.to(p.id).emit('playerKilled', deathSummary);
    io.emit('notification', { text: `${p.name} ${causeMsg}`, type: notifType });
    broadcastChat({ id: 'SYSTEM', text: `[SYSTEM] ${p.name}: Fatal Error: ${causeMsg}`, system: true });
    
    // LOG: Jogador Morreu
    io.emit('activityLog', { name: p.name, color: p.color, action: `sofreu um erro:<br><span style="color:#cccccc">${causeMsg}</span>`, type: 'death' });

    io.to('main').emit('playerMoved', p);
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
            dimension: 'main', // Dimensão padrão
            score: 0, // A pontuação da sessão começa em 0
            bombs: 1, radius: 1, kickUntil: null, moveDelay: 150, pierceUntil: null, ghostUntil: null, lastMoveTime: 0,
            slowUntil: null, invertUntil: null, autoBombUntil: null, lastAutoBomb: 0,
            color: playerColor, // <--- Aplica a cor persistente aqui
            sessionKills: 0,
            sessionEnemyKills: 0,
            sessionPowerups: { bomb: 0, fire: 0, speed: 0, kick: 0, ghost: 0, pierce: 0 },
            spawnExitTime: null,
            sessionMaxLevel: 0,
            level: 0, maxLevel: saved ? (saved.maxLevel || 0) : 0,
            maxDist: saved ? (saved.maxDist || 0) : 0, 
            kills: saved ? (saved.kills || 0) : 0, 
            enemyKills: saved ? (saved.enemyKills || 0) : 0, 
            deaths: saved ? (saved.deaths || 0) : 0,
            notified30: false, notified60: false, isDead: false 
        };
        
        socket.join('main');

        // Envia apenas dados da dimensão 'main' no init
        const mainBlocks = [];
        destroyedBlocks.forEach(k => { if(k.startsWith('main:')) mainBlocks.push(k.split(':')[1]); });
        
        const mainPowerups = [];
        powerUps.forEach((v, k) => { if(k.startsWith('main:')) mainPowerups.push([k.split(':')[1], v]); });

        const mainBombs = Array.from(activeBombs.values()).filter(b => b.dimension === 'main');

        socket.emit('init', { id: socket.id, players, enemies, destroyedBlocks: mainBlocks, activeBombs: mainBombs, powerUps: mainPowerups, roundEndTime, mapSeed: world.getSeed() });
        socket.emit('chatHistory', storage.getChatHistory());
        
        broadcastChat({ id: 'SYSTEM', text: `[NET] ${players[socket.id].name} connected.`, system: true });
        socket.emit('notification', { text: "INFO: Uma surpresa te aguarda na borda do mapa...", type: "info" });
        
        updateAndBroadcastRank(players[socket.id]);
        io.emit('rankUpdate', Object.values(players).sort((a,b)=>b.score-a.score));
        io.emit('leaderboardUpdate', storage.getRanking());
    });

    socket.on('move', (data) => {
        const p = players[socket.id]; const now = Date.now();
        
        // Aplica lentidão se o debuff estiver ativo (300ms delay = muito lento)
        const effectiveDelay = (p.slowUntil && now < p.slowUntil) ? 300 : p.moveDelay;
        if (p && !p.isDead && now - p.lastMoveTime > effectiveDelay) {
            const bombAt = Array.from(activeBombs.values()).find(b => b.dimension === p.dimension && b.x === data.x && b.y === data.y);
            if (bombAt && p.kickUntil && now < p.kickUntil && !bombAt.sliding) {
                const vx = data.x - p.x, vy = data.y - p.y;
                if (Math.abs(bombAt.x + vx) <= 5 && Math.abs(bombAt.y + vy) <= 5) return;
                bombAt.sliding = true; bombAt.vx = vx; bombAt.vy = vy;
                io.to(p.dimension).emit('sfx', 'kick'); io.to(p.dimension).emit('playerMoved', p); broadcastBombs(); return;
            }
            const tile = getTileAt(data.x, data.y, p.dimension);
            if (!bombAt && (tile === 0 || (p.ghostUntil && now < p.ghostUntil && tile === 2))) {
                p.x = data.x; p.y = data.y; p.lastMoveTime = now;
                const dist = Math.max(Math.abs(p.x), Math.abs(p.y));
                if (dist > p.maxDist) p.maxDist = dist;
                
                if (dist > 5 && !p.spawnExitTime) {
                    p.spawnExitTime = Date.now();
                }

                // --- CÁLCULO DE NÍVEL NO SERVIDOR ---
                let newLevel = 0;
                if (dist > 5) {
                    newLevel = Math.min(99, Math.floor((dist - 6) / 15) + 1);
                }
                p.level = newLevel;
                if (p.level > p.sessionMaxLevel) p.sessionMaxLevel = p.level;
                if (p.level > p.maxLevel) {
                    p.maxLevel = p.level;
                }
                // --- FIM CÁLCULO DE NÍVEL ---
                
                if (dist > 90 && !p.notified30) { p.notified30 = true; socket.emit('notification', { text: "INFO: Você já está quase na metade do caminho.", type: "info" }); }
                if (dist > 160 && !p.notified60) { p.notified60 = true; socket.emit('notification', { text: "WARN: Você está chegando na borda...", type: "warn" }); }
                
                const key = getDimKey(p.x, p.y, p.dimension);
                if (powerUps.has(key)) {
                    const item = powerUps.get(key);
                    let powerMsg = "";
                    
                    // Incrementa o contador de power-ups da sessão
                    if (p.sessionPowerups[item.type] !== undefined) {
                        p.sessionPowerups[item.type]++;
                    }

                    if (item.type === 'bomb') { p.bombs++; powerMsg = "Mais bombas!"; }
                    else if (item.type === 'fire') { p.radius++; powerMsg = "Raio da explosão aumentado!"; } 
                    else if (item.type === 'speed') { p.moveDelay = Math.max(50, p.moveDelay - 20); powerMsg = "Velocidade aumentada!"; }
                    else if (item.type === 'kick') { p.kickUntil = now + 10000; powerMsg = "Chutar Bombas"; } 
                    else if (item.type === 'ghost') { p.ghostUntil = now + 10000; powerMsg = "Modo Ghost"; } 
                    else if (item.type === 'pierce') { p.pierceUntil = now + 10000; powerMsg = "Bomba Perfurante"; }
                    // PowerDowns
                    else if (item.type === 'bomb_down') { p.bombs = Math.max(1, p.bombs - 1); powerMsg = "Menos bombas..."; }
                    else if (item.type === 'fire_down') { p.radius = Math.max(1, p.radius - 1); powerMsg = "Raio reduzido..."; }
                    else if (item.type === 'speed_down') { p.moveDelay = Math.min(300, p.moveDelay + 20); powerMsg = "Velocidade reduzida..."; } // Max 300ms (50% speed)
                    else if (item.type === 'debuff_slow') { p.slowUntil = now + 7000; powerMsg = "Lentidão (7s)"; }
                    else if (item.type === 'debuff_invert') { p.invertUntil = now + 7000; powerMsg = "Controles Invertidos (7s)"; }
                    else if (item.type === 'debuff_autobomb') { p.autoBombUntil = now + 6000; powerMsg = "Auto-Bomba (6s)"; }
                    
                    p.score += 3;
                    io.to(p.dimension).emit('floatingText', { x: p.x, y: p.y, text: "+3" });

                    powerUps.delete(key); 
                    // Update de powerups é complexo, melhor enviar apenas para a sala
                    // Mas como powerUps é global, precisamos filtrar.
                    // Simplificação: Envia update de powerups filtrado para a sala
                    broadcastPowerUps(p.dimension);
                    io.emit('sfx', 'powerup');

                    // LOG: Jogador pegou PowerUp (Enviado a TODOS os clientes)
                    io.emit('activityLog', { name: p.name, color: p.color, action: `carregou modulo:<br><span style="color:#cccccc">${powerMsg}</span>`, type: 'powerup' });

                    if (['kick', 'ghost', 'pierce', 'debuff_slow', 'debuff_invert', 'debuff_autobomb'].includes(item.type)) {
                        socket.emit('timedNotification', { id: `buff_${item.type}`, title: 'Buff Temporário', text: powerMsg, duration: 10000 });
                    } else {
                        socket.emit('notification', { text: `PowerUp: ${powerMsg}`, type: "info" });
                    }
                }
                io.to(p.dimension).emit('playerMoved', p); io.emit('rankUpdate', Object.values(players).sort((a,b)=>b.score-a.score));
            }
        }
    });

    function broadcastPowerUps(dim) {
        const list = [];
        powerUps.forEach((v, k) => {
            if (k.startsWith(dim + ':')) list.push([k.split(':')[1], v]);
        });
        io.to(dim).emit('powerUpsUpdate', list);
    }
    
    socket.on('placeBomb', (data) => {
        const p = players[socket.id];
        // Verifica spawn apenas se estiver na main
        if (p.dimension === 'main' && Math.abs(data.x) <= 5 && Math.abs(data.y) <= 5) return;
        
        if (p && !p.isDead && Array.from(activeBombs.values()).filter(b => b.owner === socket.id && b.dimension === p.dimension).length < p.bombs) {
            const bid = "b_" + Date.now() + socket.id;
            const isPierce = p.pierceUntil && Date.now() < p.pierceUntil;
            activeBombs.set(bid, { x: data.x, y: data.y, dimension: p.dimension, id: bid, radius: p.radius, owner: socket.id, sliding: false, isPierce: isPierce });
            broadcastBombs();
            io.emit('sfx', 'place');
            setTimeout(() => combat.detonateBomb(bid, socket.id, getGameContext()), 2000);
        }
    });

    // --- EVENTOS DE DUELO ---
    socket.on('challengeRequest', (targetId) => {
        const challenger = players[socket.id];
        const target = players[targetId];
        if (challenger && target && !challenger.inDuel && !target.inDuel && !challenger.isDead && !target.isDead) {
            io.to(targetId).emit('challengeReceived', { from: socket.id, name: challenger.name });
            socket.emit('notification', { text: `Desafio enviado para ${target.name}...`, type: "info" });
        }
    });

    socket.on('challengeResponse', (data) => {
        const responder = players[socket.id];
        const challenger = players[data.challengerId];
        if (data.accepted) {
            if (responder && challenger) duelManager.startDuel(challenger, responder, io, broadcastChat);
        } else {
            if (responder && challenger) broadcastChat({ id: 'SYSTEM', text: `[DUEL] 🐔 ${responder.name} arregou o desafio de ${challenger.name}!`, system: true });
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