// public/game.js
const socket = io(); 
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d'); 
const TILE_SIZE = 50;

let roundEndTime = 0;

function resizeCanvas() {
    const container = document.getElementById('editor-container');
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    }
}

window.addEventListener('resize', resizeCanvas);

// --- INICIALIZAÇÃO DA INTERFACE COM OS DADOS SALVOS ---
window.addEventListener('load', () => {
    resizeCanvas();
    
    // 1. Carrega o Nickname
    const savedNick = localStorage.getItem('vsbomber_nick');
    const input = document.getElementById('nick');
    const btn = document.querySelector('.btn-primary');
    if (savedNick && input) {
        input.value = savedNick; 
        if(btn) btn.focus(); 
    } else {
        if(input) input.focus();
    }

    // 2. Sincroniza a interface do controle de Volume
    const savedVol = localStorage.getItem('vsbomber_volume');
    if (savedVol !== null) {
        const volSlider = document.getElementById('bgm-volume');
        if (volSlider) volSlider.value = savedVol;
    }

    // 3. Sincroniza a interface do controle de Zoom (View)
    const savedZoom = localStorage.getItem('vsbomber_zoom');
    if (savedZoom !== null) {
        const zoomSlider = document.getElementById('zoom-slider');
        if (zoomSlider) zoomSlider.value = savedZoom;
    }
});

window.restartSession = function() {
    const savedNick = localStorage.getItem('vsbomber_nick') || "User";
    document.getElementById('game-over').style.display = 'none';
    socket.emit('joinGame', savedNick);
};

let myId, players = {}, enemies = {}, explosions = [], currentBombs = [];
let destroyedBlocks = new Set(), powerUps = new Map(), joined = false;
let myPos = { x: 0, y: 0, rx: 0, ry: 0 }; 
let chatting = false, lastStep = 0, lastBomb = 0, floatingTexts = [];

// --- SISTEMA DE ACTIVITY LOG GLOBAL ---
socket.on('activityLog', data => {
    addActivityLog(data.name, data.color, data.action, data.type);
});

socket.on('floatingText', data => {
    floatingTexts.push({ x: data.x + (Math.random() - 0.5) * 0.5, y: data.y + (Math.random() - 0.5) * 0.5, text: data.text, life: 1.5, offset: 0 });
});

function addActivityLog(name, color, action, type) {
    const container = document.getElementById('activity-log');
    if (!container) return;

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    const entry = document.createElement('div');
    entry.className = `log-entry`;
    // A cor da barrinha é a mesma cor do Player recebida pelo Servidor
    entry.style.borderLeftColor = color; 

    entry.innerHTML = `<span class="time">[${timeStr}]</span> <span style="color: ${color}; font-weight: bold;">${name}</span> <span style="color: #cccccc;">${action}</span>`;
    
    container.prepend(entry);

    if (container.children.length > 50) {
        container.removeChild(container.lastChild);
    }
}
// --------------------------------------

function join() {
    sfx.resume(); 
    const nickInput = document.getElementById('nick');
    const nickValue = nickInput.value || "Dev";
    localStorage.setItem('vsbomber_nick', nickValue);
    joined = true; 
    document.getElementById('login').style.display = 'none';
    socket.emit('joinGame', nickValue);
}

function createToast(title, msg, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `vscode-toast ${type}`;
    let icon = 'ⓘ'; let iconColor = 'var(--blue)';
    if(type === 'error') { icon = 'ⓧ'; iconColor = 'var(--red)'; }
    if(type === 'warn') { icon = '⚠'; iconColor = 'var(--orange)'; }
    toast.innerHTML = `<div class="toast-icon" style="color: ${iconColor}">${icon}</div><div class="toast-content"><span class="toast-title">${title}</span><span class="toast-msg">${msg}</span></div><div class="toast-close" onclick="this.parentElement.remove()">✕</div>`;
    container.appendChild(toast);
    setTimeout(() => { if(toast.parentElement) { toast.style.animation = 'fadeOut 0.5s ease-out forwards'; setTimeout(() => toast.remove(), 500); } }, 6000);
}

function createPersistentToast(id, title, msg, duration) {
    const container = document.getElementById('toast-container');
    let existing = document.getElementById(id);
    if (existing) { clearInterval(existing.dataset.intervalId); existing.remove(); }
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `vscode-toast info`; 
    let icon = 'ⓘ'; let iconColor = 'var(--blue)'; let timeLeft = Math.ceil(duration / 1000);
    toast.innerHTML = `<div class="toast-icon" style="color: ${iconColor}">${icon}</div><div class="toast-content"><span class="toast-title">${title}</span><span class="toast-msg" id="${id}-msg">${msg} (0:${timeLeft.toString().padStart(2, '0')})</span></div><div class="toast-close" onclick="this.parentElement.remove()">✕</div>`;
    container.appendChild(toast);
    const interval = setInterval(() => {
        timeLeft--;
        const msgEl = document.getElementById(`${id}-msg`);
        if (timeLeft <= 0) { clearInterval(interval); if(toast.parentElement) { toast.style.animation = 'fadeOut 0.5s ease-out forwards'; setTimeout(() => toast.remove(), 500); }
        } else if (msgEl) { msgEl.innerText = `${msg} (0:${timeLeft.toString().padStart(2, '0')})`; }
    }, 1000);
    toast.dataset.intervalId = interval; 
}

window.showLevelUpPopup = function(level, color) {
    // Adiciona texto flutuante seguindo o player
    floatingTexts.push({
        targetId: myId,
        text: `LVL ${level}`,
        life: 3.0, // Duração maior
        offset: 0,
        color: color || '#dcdcaa',
        font: "bold 32px Consolas"
    });
};

socket.on('init', d => {
    joined = true;
    window.mapSeed = d.mapSeed || 0; // Recebe a semente do mapa
    myId = d.id; players = d.players; enemies = {};
    Object.values(d.enemies).forEach(en => { enemies[en.id] = { ...en, rx: en.x, ry: en.y }; });
    destroyedBlocks = new Set(d.destroyedBlocks); currentBombs = d.activeBombs;
    powerUps = new Map(d.powerUps); roundEndTime = d.roundEndTime; 
    Object.values(players).forEach(p => { p.rx = p.x; p.ry = p.y; });
    if(players[myId]) myPos = players[myId];
});

socket.on('roundReset', d => {
    window.mapSeed = d.mapSeed || 0; // Atualiza a semente no reset
    players = d.players; enemies = {};
    Object.values(d.enemies).forEach(en => { enemies[en.id] = { ...en, rx: en.x, ry: en.y }; });
    destroyedBlocks = new Set(d.destroyedBlocks); roundEndTime = d.roundEndTime;
    Object.values(players).forEach(p => { p.rx = p.x; p.ry = p.y; });
    if(players[myId]) myPos = players[myId];
});

socket.on('notification', data => {
    let title = "Info"; if (data.type === 'warn') title = "Warning"; if (data.type === 'error') title = "Error";
    createToast(title, data.text, data.type);
});

socket.on('timedNotification', data => { 
    createPersistentToast(data.id, data.title, data.text, data.duration); 
});

socket.on('playerMoved', p => {
    if (p.id === myId) {
        if (players[myId]) {
            // Reconciliação: Verifica se o servidor discorda muito da nossa posição local
            const errorX = Math.abs(players[myId].x - p.x);
            const errorY = Math.abs(players[myId].y - p.y);
            
            // Se o erro for maior que 1 bloco de distância, força a correção (ex: teleportes/erros)
            if (errorX > 1 || errorY > 1) {
                players[myId].x = p.x;
                players[myId].y = p.y;
                players[myId].rx = p.x;
                players[myId].ry = p.y;
            }
            
            // Atualiza status sem resetar a posição x/y local se estivermos sincronizados
            Object.assign(players[myId], {
                score: p.score,
                bombs: p.bombs,
                radius: p.radius,
                isDead: p.isDead,
                maxDist: p.maxDist,
                moveDelay: p.moveDelay,
                slowUntil: p.slowUntil,
                invertUntil: p.invertUntil,
                autoBombUntil: p.autoBombUntil
            });
        }
    } else {
        // Para outros jogadores, atualiza as coordenadas alvo para o LERP funcionar
        if (!players[p.id]) {
            p.rx = p.x; p.ry = p.y; // Inicializa a posição visual
            players[p.id] = p;
        } else {
            Object.assign(players[p.id], p);
        }
    }
});

socket.on('enemiesUpdate', serverEnemies => {
    const serverIds = new Set(Object.keys(serverEnemies));
    
    // OTIMIZAÇÃO: Armazena apenas inimigos dentro de um raio seguro (ex: 40 blocos)
    // Isso evita processar e armazenar dados de inimigos muito distantes
    const KEEP_RADIUS = 40;
    
    Object.values(serverEnemies).forEach(sEn => {
        // Verifica distância se tivermos a posição do player
        const inRange = myPos && Math.abs(sEn.x - myPos.x) <= KEEP_RADIUS && Math.abs(sEn.y - myPos.y) <= KEEP_RADIUS;
        
        if (inRange) {
            if (!enemies[sEn.id]) { enemies[sEn.id] = { ...sEn, rx: sEn.x, ry: sEn.y }; } 
            else {
                const current = enemies[sEn.id];
                current.x = sEn.x; current.y = sEn.y;
                current.type = sEn.type; current.isBuffed = sEn.isBuffed; current.isRaging = sEn.isRaging;
                current.invincibleUntil = sEn.invincibleUntil; if(sEn.state) current.state = sEn.state;
            }
        } else {
            // Remove se saiu do raio de visão para liberar memória
            if (enemies[sEn.id]) delete enemies[sEn.id];
        }
    });
    Object.keys(enemies).forEach(id => { if (!serverIds.has(id)) delete enemies[id]; });
});

socket.on('sfx', (type) => sfx[type]()); 

socket.on('chatHistory', (history) => {
    const box = document.getElementById('chat-history'); box.innerHTML = ''; 
    history.forEach(d => appendChatMsg(d)); box.scrollTop = box.scrollHeight;
});

socket.on('chatMessage', d => {
    appendChatMsg(d);
    // Adiciona balão de chat flutuante acima do jogador que enviou
    if (d.id && players[d.id]) {
        floatingTexts.push({
            targetId: d.id,
            text: `- "${d.text}"`,
            life: 4.0,
            offset: 0,
            color: '#ffffff',
            font: "14px Consolas"
        });
    }
});

function appendChatMsg(d) {
    const box = document.getElementById('chat-history'); 
    const msg = document.createElement('div');
    msg.style.borderBottom = "1px solid #2d2d2d"; msg.style.padding = "2px"; 
    const timeStr = d.timestamp ? `[${d.timestamp}] ` : '';
    if (d.system) { msg.innerHTML = `<span style="color:#6a9955">// ${timeStr}${d.text}</span>`; } 
    else { msg.innerHTML = `<span style="color:#808080">${timeStr}</span><span style="color:#569cd6">${d.name}</span>: <span style="color:#ce9178">"${d.text}"</span>`; }
    box.appendChild(msg); if(box.childNodes.length > 50) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
}

socket.on('rankUpdate', list => {
    const now = Date.now();
    const livePlayers = list.filter(p => !p.isDead);

    document.getElementById('live-list').innerHTML = livePlayers.map(p => {
        let isGhost = (p.ghostUntil && p.ghostUntil > now);
        let canKick = (p.kickUntil && p.kickUntil > now);
        const speedLevel = Math.round(Math.max(0, (150 - p.moveDelay) / 20));

        return `<div style="padding: 4px 10px; border-bottom: 1px solid #2b2b2b; font-family: Consolas; font-size: 11px;">
            <div style="display:flex; justify-content:space-between;"><span style="color:${p.color}">#${p.name}</span><span style="color:#6a9955">[${p.x}, ${p.y}]</span></div>
            <div style="color:#808080;">LVL: ${p.level || 0} | Score: ${p.score}</div>
            <div style="color:#808080;">B:${p.bombs} F:${p.radius} S:${speedLevel}</div>
            ${isGhost ? '<span style="color:#c586c0">ghost </span>' : ''}${canKick ? '<span style="color:#dcdcaa">kick </span>' : ''}
        </div>`;
    }).join('');
});

socket.on('leaderboardUpdate', list => {
    document.getElementById('global-list').innerHTML = list.map((p, index) => {
        return `<div style="padding: 4px 10px; border-bottom: 1px solid #2b2b2b; font-size:11px;">
            <div style="display:flex; justify-content:space-between;"><span><span style="color:#6a9955">#${index+1}</span> <span style="color:${p.color}">${p.name}</span></span><span>Score: ${p.score} | Max LVL: ${p.maxLevel || 0}</span></div>
        </div>`;
    }).join('');
});

socket.on('explosion', d => {
    destroyedBlocks = new Set(d.destroyedBlocks); 
    powerUps = new Map(d.powerUps);
    
    if(d.area && d.area.length > 0) {
        sfx.explosion(d.area[0]); 
    } else {
        sfx.explosion({x: 0, y: 0}); 
    }

    d.area.forEach(t => explosions.push({ ...t, time: Date.now(), isPierce: d.isPierce }));
});

socket.on('mapUpdate', d => { destroyedBlocks = new Set(d.destroyedBlocks); });
socket.on('powerUpsUpdate', d => powerUps = new Map(d));
socket.on('bombUpdate', b => currentBombs = b);

socket.on('playerKilled', summary => { 
    sfx.gameOver(); 
    
    // Limpeza Geral do Client Side (Simula F5)
    joined = false;
    enemies = {};
    explosions = [];
    currentBombs = [];
    destroyedBlocks = new Set();
    powerUps = new Map();
    floatingTexts = [];
    players = {};
    
    // Causa da morte
    document.getElementById('death-msg').innerText = `Fatal Error: ${summary.cause}`;
    
    // Preenche as estatísticas
    document.getElementById('stat-score').innerText = summary.score;
    document.getElementById('stat-max-level').innerText = summary.maxLevel;
    
    const time = summary.timeAlive;
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    document.getElementById('stat-time-alive').innerText = `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    
    document.getElementById('stat-player-kills').innerText = summary.kills;
    document.getElementById('stat-glitch-kills').innerText = summary.enemyKills;
    
    // Monta a lista de power-ups
    const powerupsList = document.getElementById('stat-powerups');
    powerupsList.innerHTML = ''; // Limpa a lista anterior
    const powerupMap = {
        bomb: 'Bomb++', fire: 'Fire++', speed: 'Speed++',
        kick: 'Kick()', ghost: 'Ghost', pierce: 'Pierce'
    };
    
    let collectedAny = false;
    for (const type in summary.powerups) {
        if (summary.powerups[type] > 0) {
            collectedAny = true;
            const li = document.createElement('li');
            li.innerText = `${powerupMap[type] || type}: ${summary.powerups[type]}`;
            powerupsList.appendChild(li);
        }
    }
    if (!collectedAny) {
        const li = document.createElement('li');
        li.innerText = 'Nenhum módulo coletado';
        powerupsList.appendChild(li);
    }

    document.getElementById('game-over').style.display = 'block';
});