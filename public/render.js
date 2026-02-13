// public/render.js

// Paleta VS Code Dark Modern
const C = {
    bg: '#1f1f1f', grid: '#2b2b2b', wall: '#181818', block: '#37373d', blockInf: '#4d2d2d', safe: '#26264f',
    text: '#cccccc', blue: '#569cd6', green: '#6a9955', orange: '#ce9178', purple: '#c586c0', red: '#f14c4c', yellow: '#dcdcaa', white: '#ffffff'
};

// Cores para os níveis de profundidade do mapa, em tons de cinza baseados na paleta
const LVL_COLORS = [
    '#4a586a', // lvl 1+ (blue-gray)
    '#566650', // lvl 2+ (green-gray)
    '#7e6a60', // lvl 3+ (orange-gray)
    '#736273', // lvl 4+ (purple-gray)
    '#825353', // lvl 5+ (red-gray)
    '#81816c', // lvl 6+ (yellow-gray)
    '#777777', // lvl 7+ (white-gray)
];

// Global animation timer for frame delta
let lastFrameTime = performance.now();
let currentPlayerLevel = 0; // Rastreia o nível atual do jogador para exibir o popup

// Velocity-based smoothing for more natural movement
function damp(current, target, velocity, smoothTime, deltaTime) {
    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const temp = (velocity.value + omega * change) * deltaTime;
    velocity.value = (velocity.value - omega * temp) * exp;
    let result = target + (change + temp) * exp;
    return result;
}

const MAP_RADIUS = 187;
const PLAYABLE_RADIUS = 182;

function getTileAt(gx, gy) {
    // --- RENDERIZAÇÃO DA ARENA DE DUELO ---
    // Verifica a dimensão atual do jogador (definida em game.js)
    if (window.myDimension && window.myDimension.startsWith('duel')) {
        // Usa a lógica separada em world_duel.js (assumindo que foi carregado)
        if (window.DuelWorld) return window.DuelWorld.getTileAt(gx, gy, window.mapSeed || 0);
        return 0; // Fallback
    }
    // --------------------------------------

    if (Math.abs(gx) > MAP_RADIUS || Math.abs(gy) > MAP_RADIUS) return 0;
    if (Math.abs(gx) > PLAYABLE_RADIUS || Math.abs(gy) > PLAYABLE_RADIUS) return 1;

    if (destroyedBlocks.has(`${gx},${gy}`)) return 0;
    if (Math.abs(gx) <= 5 && Math.abs(gy) <= 5) return 0; 
    if (gx % 2 === 0 && gy % 2 === 0) return 1;
    const seed = window.mapSeed || 0;
    const val = Math.abs(Math.sin((gx + seed) * 12.9898 + (gy + seed) * 78.233) * 43758.5453) % 1;
    const dist = Math.max(Math.abs(gx), Math.abs(gy));
    const threshold = dist > 10 ? 0.55 : 0.82;
    return val > threshold ? 2 : 0;
}

// --- CARREGA O ZOOM SALVO ---
const savedZoom = localStorage.getItem('vsbomber_zoom');
// Se existir um salvamento, usa ele. Se não, o padrão é 12 blocos.
window.targetVisibleBlocks = savedZoom !== null ? parseFloat(savedZoom) : 12;

window.updateZoom = (val) => { 
    window.targetVisibleBlocks = parseFloat(val); 
    localStorage.setItem('vsbomber_zoom', val); // Salva no navegador
};

function updateTimerUI() {
    if (!joined) return;
    const now = Date.now();
    let diff = Math.max(0, roundEndTime - now);
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    const formatted = `timer_${mins}:${secs.toString().padStart(2, '0')}.js`;
    
    const el = document.getElementById('timer-tab-text');
    if (el) el.innerText = formatted;
}

function draw() {
    updateTimerUI();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!joined || !players[myId]) return requestAnimationFrame(draw);
    
    // --- LÓGICA DE NÍVEL (LEVEL) ---
    const dist = Math.max(Math.abs(players[myId].x), Math.abs(players[myId].y));
    let newLevel = 0;
    if (dist > 5) {
        newLevel = Math.min(99, Math.floor((dist - 6) / 15) + 1);
    }

    if (newLevel > currentPlayerLevel) {
        if (typeof window.showLevelUpPopup === 'function') {
            const colorIndex = (newLevel - 1) % LVL_COLORS.length;
            const levelColor = LVL_COLORS[colorIndex];
            window.showLevelUpPopup(newLevel, levelColor);
        }
        currentPlayerLevel = newLevel;
    } else if (dist <= 5 && currentPlayerLevel > 0) {
        // Reseta o nível se o jogador voltar para a área de spawn
        currentPlayerLevel = 0;
    }
    
    // Use performance.now() for animation timing
    const animNow = performance.now();

    // Suaviza a movimentação visual (Interpolação com velocity e deltaTime)
    const deltaTime = Math.min((animNow - lastFrameTime) / 1000, 0.05); // Clamp para estabilidade
    lastFrameTime = animNow;
    // Parâmetros de suavização
    const smoothTimeSelf = 0.13; // Jogador local (mais responsivo)
    const smoothTimeOther = 0.22; // Outros jogadores e glitches (mais suave)

    Object.values(players).forEach(p => {
        if (p.rx === undefined) { p.rx = p.x; p.ry = p.y; }
        if (!p.vx) p.vx = { value: 0 };
        if (!p.vy) p.vy = { value: 0 };
        const st = (p.id === myId) ? smoothTimeSelf : smoothTimeOther;
        p.rx = damp(p.rx, p.x, p.vx, st, deltaTime);
        p.ry = damp(p.ry, p.y, p.vy, st, deltaTime);
    });
    Object.values(enemies).forEach(en => {
        if (en.rx === undefined || isNaN(en.rx)) en.rx = en.x;
        if (en.ry === undefined || isNaN(en.ry)) en.ry = en.y;
        if (!en.vx) en.vx = { value: 0 };
        if (!en.vy) en.vy = { value: 0 };
        en.rx = damp(en.rx, en.x, en.vx, smoothTimeOther, deltaTime);
        en.ry = damp(en.ry, en.y, en.vy, smoothTimeOther, deltaTime);
    });

    // Suavização de câmera
    if (window.cam === undefined) window.cam = { x: players[myId].rx, y: players[myId].ry, vx: { value: 0 }, vy: { value: 0 } };
    window.cam.x = damp(window.cam.x, players[myId].rx, window.cam.vx, 0.22, deltaTime);
    window.cam.y = damp(window.cam.y, players[myId].ry, window.cam.vy, 0.22, deltaTime);

    const camX = window.cam.x, camY = window.cam.y;
    const centerX = canvas.width/2, centerY = canvas.height/2;

    // --- SISTEMA DE ZOOM DINÂMICO ---
    const targetHeight = window.targetVisibleBlocks * TILE_SIZE; 
    let zoom = canvas.height / targetHeight;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -centerY);

    const visibleWidth = canvas.width / zoom;
    const visibleHeight = canvas.height / zoom;

    // OTIMIZAÇÃO: Limita a renderização a 20 blocos (solicitado) e calcula raio de visão
    const viewRadiusX = Math.min(20, Math.ceil(visibleWidth / TILE_SIZE / 2) + 1);
    const viewRadiusY = Math.min(20, Math.ceil(visibleHeight / TILE_SIZE / 2) + 1);

    // --- DESENHA O GRID DINÂMICO ---
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    
    const leftBound = centerX - visibleWidth / 2;
    const rightBound = centerX + visibleWidth / 2;
    const topBound = centerY - visibleHeight / 2;
    // deltaTime e lastFrameTime já definidos acima
    const bottomBound = centerY + visibleHeight / 2;

    const offsetX = (centerX - camX * TILE_SIZE);
    const offsetY = (centerY - camY * TILE_SIZE);
    const gridStartX = leftBound - ((leftBound - offsetX) % TILE_SIZE) - TILE_SIZE;
    const gridStartY = topBound - ((topBound - offsetY) % TILE_SIZE) - TILE_SIZE;

    for(let i = gridStartX; i < rightBound + TILE_SIZE; i += TILE_SIZE) { 
        ctx.beginPath(); ctx.moveTo(i, topBound); ctx.lineTo(i, bottomBound); ctx.stroke(); 
    }
    for(let i = gridStartY; i < bottomBound + TILE_SIZE; i += TILE_SIZE) { 
        ctx.beginPath(); ctx.moveTo(leftBound, i); ctx.lineTo(rightBound, i); ctx.stroke(); 
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 14px Consolas";
    ctx.fillStyle = "#3c3c3c"; // Cor cinza escuro para parecer "gravado" no chão
    
    // Calcula a posição na tela baseada na câmera
    const spawnX = centerX - camX * TILE_SIZE;
    const spawnY = centerY - camY * TILE_SIZE;

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 14px Consolas";
    ctx.fillStyle = "#3c3c3c"; // Cinza escuro discreto
    
    // 1. CAMADA DO MAPA (Paredes e Blocos)
    for (let r = -viewRadiusY; r <= viewRadiusY; r++) {
        for (let c = -viewRadiusX; c <= viewRadiusX; c++) {
            const wX = Math.round(camX) + c, wY = Math.round(camY) + r;
            const sX = centerX + (wX - camX) * TILE_SIZE - TILE_SIZE/2;
            const sY = centerY + (wY - camY) * TILE_SIZE - TILE_SIZE/2;
            const key = `${wX},${wY}`;
            const tile = getTileAt(wX, wY); 
            
            if (Math.abs(wX) <= 5 && Math.abs(wY) <= 5) { ctx.fillStyle = C.safe; ctx.fillRect(sX, sY, TILE_SIZE, TILE_SIZE); }
            if (tile === 1) { ctx.fillStyle = C.wall; ctx.fillRect(sX, sY, TILE_SIZE, TILE_SIZE); ctx.fillStyle = '#222'; ctx.fillRect(sX+2, sY+2, TILE_SIZE-4, TILE_SIZE-4); }
            if (tile === 2) {
                const isInf = (Math.max(Math.abs(wX), Math.abs(wY)) > 20) && (Math.abs(Math.cos(wX * 43.11 + wY * 18.23) * 1234.56) % 1 < 0.005);
                
                if (isInf) {
                    ctx.fillStyle = C.blockInf;
                } else {
                    const tileDist = Math.max(Math.abs(wX), Math.abs(wY));
                    if (tileDist > 5) {
                        const tileLevel = Math.floor((tileDist - 6) / 15) + 1;
                        const colorIndex = (tileLevel - 1) % LVL_COLORS.length;
                        ctx.fillStyle = LVL_COLORS[colorIndex];
                    } else {
                        ctx.fillStyle = C.block;
                    }
                }
                ctx.fillRect(sX+1, sY+1, TILE_SIZE-2, TILE_SIZE-2);

                if(isInf) { ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.strokeRect(sX+2, sY+2, TILE_SIZE-4, TILE_SIZE-4); }
            }
        }
    }

    // Helper para Culling (Verificar se está na tela)
    const isVisible = (x, y) => Math.abs(x - camX) <= viewRadiusX && Math.abs(y - camY) <= viewRadiusY;

    // 2. CAMADA DE ITENS (PowerUps) - Loop direto no Map (Muito mais rápido que checar tile por tile)
    powerUps.forEach((item, key) => {
        const [kx, ky] = key.split(',').map(Number);
        if (!isVisible(kx, ky)) return;
        const sX = centerX + (kx - camX) * TILE_SIZE - TILE_SIZE/2;
        const sY = centerY + (ky - camY) * TILE_SIZE - TILE_SIZE/2;
        let color = C.white; let text = '?';
        let isPowerDown = false;
        if (item.type === 'bomb') { color = C.blue; text = 'bomb++'; } else if (item.type === 'fire') { color = C.orange; text = 'fire++'; } else if (item.type === 'kick') { color = C.yellow; text = 'kick()'; } else if (item.type === 'ghost') { color = C.purple; text = 'ghost'; } else if (item.type === 'speed') { color = C.green; text = 'speed++'; } else if (item.type === 'pierce') { color = C.red; text = 'pierce'; } 
        else if (item.type === 'bomb_down') { color = '#d16969'; text = 'bomb--'; isPowerDown = true; }
        else if (item.type === 'fire_down') { color = '#d16969'; text = 'fire--'; isPowerDown = true; }
        else if (item.type === 'speed_down') { color = '#d16969'; text = 'speed--'; isPowerDown = true; }
        else if (item.type.startsWith('debuff_')) {
            // Hexagono Vermelho para Debuffs
            drawHexagon(ctx, sX+25, sY+25, 18, '#f14c4c');
            ctx.fillStyle = '#ffffff';
            let dText = '!';
            if (item.type === 'debuff_slow') dText = 'SLOW';
            if (item.type === 'debuff_invert') dText = 'INV';
            if (item.type === 'debuff_autobomb') dText = 'AUTO';
            ctx.font = "bold 9px Consolas"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(dText, sX+25, sY+25);
            return; // Pula o desenho padrão do quadrado
        }
        
        if (isPowerDown) {
            drawRoundedRect(ctx, sX+5, sY+5, 40, 40, 10, color, '#252526');
        } else {
            ctx.fillStyle = '#252526'; ctx.fillRect(sX+5, sY+5, 40, 40); 
            ctx.strokeStyle = color; ctx.strokeRect(sX+5, sY+5, 40, 40); 
        }
        ctx.fillStyle = color; ctx.font = "bold 10px Consolas"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, sX+25, sY+25);
    });

    // 3. CAMADA DE BOMBAS
    currentBombs.forEach(bomb => {
        if (!isVisible(bomb.x, bomb.y)) return;
        const sX = centerX + (bomb.x - camX) * TILE_SIZE - TILE_SIZE/2;
        const sY = centerY + (bomb.y - camY) * TILE_SIZE - TILE_SIZE/2;
        const color = bomb.isPierce ? C.purple : C.blue;
        const tag = bomb.isPierce ? "<pierce>" : "<bomb>";
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sX+25, sY+25, 18, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#1e1e1e'; ctx.font = "bold 10px Consolas"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(tag, sX+25, sY+25);
    });

    // 4. CAMADA DE EXPLOSÕES
    explosions.forEach(exp => {
        if (!isVisible(exp.x, exp.y)) return;
        const sX = centerX + (exp.x - camX) * TILE_SIZE - TILE_SIZE/2;
        const sY = centerY + (exp.y - camY) * TILE_SIZE - TILE_SIZE/2;
        const color = exp.isPierce ? C.purple : C.orange; 
        ctx.fillStyle = color; ctx.globalAlpha = 0.8; ctx.fillRect(sX, sY, TILE_SIZE, TILE_SIZE);
        ctx.globalAlpha = 1.0; 
        ctx.fillStyle = '#1e1e1e'; ctx.font = "bold 12px Consolas"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("<fire>", sX+25, sY+25);
    });

    {
        ctx.save();
        ctx.textAlign = "center";
        // Fonte maior e cor mais clara para destacar no chão escuro
        ctx.font = "bold 16px Consolas";
        ctx.fillStyle = "#999999"; 
        
        // Calcula o PONTO CENTRAL EXATO da coordenada mundo (0,0) na tela
        const spawnCenterX = centerX + (0 - camX) * TILE_SIZE;
        const spawnCenterY = centerY + (0 - camY) * TILE_SIZE;

        // Desenha apenas se a área de spawn estiver visível na tela
        // (Aumentei a margem de segurança para 300px para garantir)
        if (spawnCenterX > -300 && spawnCenterX < canvas.width + 300 &&
            spawnCenterY > -300 && spawnCenterY < canvas.height + 300) {
            
            // --- VS Code style welcome and credits ---
            ctx.font = "bold 18px Consolas";
            ctx.fillStyle = "#6a9955"; // green comment
            ctx.fillText("// Bem-vindo ao VS Bomber", spawnCenterX, spawnCenterY - 100);

            ctx.font = "14px Consolas";
            ctx.fillStyle = "#cccccc";
            ctx.fillText("// desenvolvido por Felipe R. Richter", spawnCenterX, spawnCenterY - 80);

            // Usa espaçamento fixo em pixels para centralizar perfeitamente
            ctx.font = "bold 16px Consolas";
            ctx.fillStyle = "#999999";
            ctx.fillText("// SETAS ou WASDpara Mover", spawnCenterX, spawnCenterY - 50);
            ctx.fillText("// ESPAÇO para Bomba", spawnCenterX, spawnCenterY - 25);
            ctx.fillText("// ENTER para Chat", spawnCenterX, spawnCenterY);

            // Mensagem extra um pouco mais abaixo com estilo diferente
            ctx.font = "italic 14px Consolas";
            ctx.fillStyle = "#569cd6"; // blue for code
            ctx.fillText("console.log('Have Fun!');", spawnCenterX, spawnCenterY + 60);
        }
        ctx.restore();
    }

    // Desenha os Inimigos
    Object.values(enemies).forEach(en => {
        if (!isVisible(en.rx, en.ry)) return; // Culling
        const sX = centerX + (en.rx - camX) * TILE_SIZE - TILE_SIZE/2;
        const sY = centerY + (en.ry - camY) * TILE_SIZE - TILE_SIZE/2;
        let color = C.green; let text = "<enemy>";
        switch(en.type) {
            case 'red': color = C.red; text = "<kamikaze>"; break;
            case 'blue': color = "#4a90e2"; text = "<tank>"; break;
            case 'purple': color = C.purple; text = "<ghost>"; break;
            case 'cyan': color = "#00ffff"; text = "<sniper>"; break;
            case 'orange': color = "#ff8c00"; text = "<trapper>"; break;
            case 'yellow': color = C.yellow; text = "<warn>"; break;
        }
        if (en.isBuffed) { color = C.red; text = "<error>"; }
        if (en.invincibleUntil && Date.now() < en.invincibleUntil) {
            ctx.strokeStyle = C.white; ctx.lineWidth = 3; ctx.strokeRect(sX+2, sY+7, 46, 36);
        }
        ctx.fillStyle = color; ctx.fillRect(sX+5, sY+10, 40, 30);
        ctx.fillStyle = '#1e1e1e'; ctx.font = "bold 9px Consolas"; ctx.textAlign="center"; ctx.textBaseline = "middle"; ctx.fillText(text, sX+25, sY+25);
        // Mostra o estado/ação do glitch como um trecho de código JS (VS Code style)
        let stateLabel = en.state || 'IDLE';
        let codeLine = '';
        switch (stateLabel) {
            case 'FUGINDO':
            case 'PANIC':
                codeLine = 'if (danger) run();';
                break;
            case 'EXPLODIR':
            case 'BOOM!':
                codeLine = 'if (nearPlayer) bomb();';
                break;
            case 'ARMADILHA':
            case 'TRAP':
                codeLine = 'if (trapReady) placeTrap();';
                break;
            case 'VAGANDO':
            case 'WANDER':
                codeLine = 'while(true) walkRandom();';
                break;
            case 'PARADO':
            case 'IDLE':
                codeLine = '// idle';
                break;
            case 'ATACAR':
            case 'ATK':
                codeLine = 'attack(player);';
                break;
            case 'AVANÇAR':
                codeLine = 'moveTo(player);';
                break;
            case 'PERSEGUIR':
                codeLine = 'chase(player);';
                break;
            case 'ESPREITAR':
                codeLine = 'stalk(player);';
                break;
            case 'MIRAR':
                codeLine = 'if (aligned) shoot();';
                break;
            case 'CERCAR':
                codeLine = 'intercept(player);';
                break;
            case 'OBSERVAR':
                codeLine = 'watch(player);';
                break;
            default:
                codeLine = `// ${stateLabel.toLowerCase()}`;
        }
        // Estilo VS Code: cor de comentário para idle, azul para ação, laranja para perigo, etc.
        let codeColor = '#cccccc';
        if (codeLine.startsWith('if')) codeColor = '#569cd6'; // azul VS Code
        else if (codeLine.startsWith('while')) codeColor = '#dcdcaa'; // amarelo
        else if (codeLine.startsWith('attack') || codeLine.startsWith('bomb') || codeLine.startsWith('placeTrap')) codeColor = '#ce9178'; // laranja
        else if (codeLine.startsWith('//')) codeColor = '#858585'; // cinza comentário
        else if (codeLine.startsWith('moveTo') || codeLine.startsWith('chase') || codeLine.startsWith('stalk') || codeLine.startsWith('intercept') || codeLine.startsWith('watch')) codeColor = '#4ec9b0'; // verde água
        ctx.fillStyle = codeColor;
        ctx.font = "10px 'Fira Mono', 'Consolas', monospace";
        ctx.fillText(codeLine, sX+25, sY+2);
    });

    // Desenha os Jogadores
    Object.values(players).forEach(p => {
        if (p.isDead) return;
        if (!isVisible(p.rx, p.ry)) return; // Culling
        
        // O cálculo do sX e sY deve usar o p.rx e p.ry (posições interpoladas)
        const sX = centerX + (p.rx - camX) * TILE_SIZE - TILE_SIZE/2;
        const sY = centerY + (p.ry - camY) * TILE_SIZE - TILE_SIZE/2;
        
        // Código de desenho do jogador
        ctx.globalAlpha = (p.ghostUntil && Date.now() < p.ghostUntil) ? 0.5 : 1.0;
        ctx.fillStyle = p.color;
        ctx.fillRect(sX+10, sY+10, 30, 30);
        // Desenha seta minimalista (>) indicando direção
        ctx.save();
        ctx.translate(sX+25, sY+25); // centro do player
        let rot = 0;
        if (p.facing === 'up') rot = -Math.PI/2;
        else if (p.facing === 'down') rot = Math.PI/2;
        else if (p.facing === 'left') rot = Math.PI;
        // right ou indefinido = 0
        ctx.rotate(rot);
        ctx.font = "bold 18px Consolas";
        ctx.fillStyle = '#222'; // cinza escuro
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('>', 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1.0;
        
        ctx.textAlign = "center"; 
        ctx.font = "bold 14px Consolas";
        ctx.fillStyle = C.blue; 
        ctx.textAlign = "center"; 
        
        ctx.font = "bold 14px Consolas";
        ctx.fillStyle = C.blue; 
        ctx.fillStyle = C.blue; ctx.fillText(`${p.name}`, sX+25, sY-15);
        
        ctx.font = "12px Consolas";
        ctx.fillStyle = C.text; 
        ctx.fillText(`[${p.x}, ${p.y}]`, sX+25, sY-1);
    });

    // --- FLOATING TEXTS (SCORE) ---
    floatingTexts = floatingTexts.filter(t => t.life > 0);
    floatingTexts.forEach(t => {
        t.life -= deltaTime;
        t.offset += deltaTime * 30; // Move up speed
        
        let worldX = t.x;
        let worldY = t.y;

        // Se tiver um alvo (player), segue a posição dele
        if (t.targetId && players[t.targetId]) {
            worldX = players[t.targetId].rx;
            worldY = players[t.targetId].ry;
        }

        if (!isVisible(worldX, worldY)) return; // Culling
        
        const sX = centerX + (worldX - camX) * TILE_SIZE;
        const sY = centerY + (worldY - camY) * TILE_SIZE - TILE_SIZE/2 - 20 - t.offset;
        
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, t.life));
        ctx.fillStyle = t.color || "rgba(220, 220, 220, 1)"; 
        ctx.font = t.font || "bold 20px Consolas";
        ctx.textAlign = "center";
        ctx.fillText(t.text, sX, sY);
        ctx.restore();
    });

    explosions = explosions.filter(ex => Date.now() - ex.time < 1000);
    
    ctx.restore();
    requestAnimationFrame(draw);
}

function drawHexagon(ctx, x, y, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = 2 * Math.PI / 6 * i;
        const hx = x + r * Math.cos(angle);
        const hy = y + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = '#252526'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}

function drawRoundedRect(ctx, x, y, w, h, r, strokeColor, fillColor) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = fillColor; ctx.fill();
    ctx.strokeStyle = strokeColor; ctx.lineWidth = 2; ctx.stroke();
}

// Inicia o loop gráfico
draw();