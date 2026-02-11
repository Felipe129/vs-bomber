// ai_glitch.js
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const getKey = (x, y) => `${x},${y}`;

// Mapeia áreas de perigo (onde a explosão vai acontecer)
function getDangerMap(activeBombs, getTileAt) {
    const danger = new Set();
    activeBombs.forEach(b => {
        danger.add(getKey(b.x, b.y));
        const dirs = [[0,1], [0,-1], [1,0], [-1,0]];
        dirs.forEach(d => {
            for(let i=1; i<=b.radius; i++) {
                const tx = b.x + (d[0] * i);
                const ty = b.y + (d[1] * i);
                const tile = getTileAt(tx, ty);
                if (tile === 1) break;
                danger.add(getKey(tx, ty));
                if (tile === 2) break;
            }
        });
    });
    return danger;
}

// BFS para fugir do perigo
function findNearestSafeTile(start, dangerMap, getTileAt, activeBombs) {
    const queue = [{x: start.x, y: start.y, path: []}];
    const visited = new Set();
    visited.add(getKey(start.x, start.y));
    let attempts = 0;

    // Aumentei o limite de tentativas para melhorar a fuga em mapas complexos
    while(queue.length > 0 && attempts < 80) {
        const current = queue.shift();
        attempts++;
        if (!dangerMap.has(getKey(current.x, current.y))) return current.path[0];

        const moves = [[0,1], [0,-1], [1,0], [-1,0]];
        for (let m of moves) {
            const nx = current.x + m[0];
            const ny = current.y + m[1];
            const key = getKey(nx, ny);
            if (!visited.has(key)) {
                const tile = getTileAt(nx, ny);
                const hasBomb = Array.from(activeBombs.values()).some(b => b.x === nx && b.y === ny);
                
                // GHOST (Purple) pode considerar blocos quebráveis (2) como rota de fuga
                let isWalkable = (tile === 0);
                if (start.type === 'purple') isWalkable = (tile === 0 || tile === 2);

                if (isWalkable && !hasBomb && Math.abs(nx) > 5) {
                    visited.add(key);
                    queue.push({x: nx, y: ny, path: [...current.path, {x: nx, y: ny}]});
                }
            }
        }
    }
    return null;
}

function calculateGlitchMove(glitch, players, getTileAt, activeBombs, powerUps, enemyPositions) {
    const now = Date.now();
    
    // --- 1. VELOCIDADE POR TIPO ---
    let cooldown = 700; 
    if (glitch.isRaging) cooldown = 250;
    else if (glitch.type === 'red') cooldown = 400;       // Kamikaze: Rápido
    else if (glitch.type === 'blue') cooldown = 1200;     // Tank: Lento
    else if (glitch.type === 'orange') cooldown = 600;    // Trapper: Ágil
    else if (glitch.type === 'yellow') cooldown = 900;    // Warn: Cauteloso
    else cooldown = Math.max(300, 700 - (Math.max(Math.abs(glitch.x), Math.abs(glitch.y)) * 4));

    if (now - glitch.lastMove < cooldown) return null;
    glitch.lastMove = now;

    // --- 2. SOBREVIVÊNCIA (PANIC) ---
    const dangerMap = getDangerMap(activeBombs, getTileAt);
    if (dangerMap.has(getKey(glitch.x, glitch.y))) {
        const escapeStep = findNearestSafeTile(glitch, dangerMap, getTileAt, activeBombs);
        if (escapeStep) {
            return { action: 'move', x: escapeStep.x, y: escapeStep.y, state: 'PANIC' };
        }
    }

    // --- 3. ALVO ---
    let target = null;
    let minD = Infinity;
    Object.values(players).forEach(p => {
        const d = dist(glitch, p);
        if (d < minD) { minD = d; target = p; }
    });

    if (!target) return randomMove(glitch, getTileAt, activeBombs, dangerMap, 'IDLE');
    if (minD > 40 && glitch.type !== 'cyan') return randomMove(glitch, getTileAt, activeBombs, dangerMap, 'WANDER');

    // --- 4. TÁTICAS DE MOVIMENTO (ROLES) ---
    const moves = [{x:0, y:-1}, {x:0, y:1}, {x:-1, y:0}, {x:1, y:0}];
    let bestMove = null;
    let maxScore = -Infinity;
    
    // Define posição ideal baseada no tipo
    let targetPos = { x: target.x, y: target.y };

    moves.forEach(m => {
        const nx = glitch.x + m.x;
        const ny = glitch.y + m.y;
        const nKey = getKey(nx, ny);

        if (Math.abs(nx) <= 5 && Math.abs(ny) <= 5) return; // Não entra no spawn seguro
        const tile = getTileAt(nx, ny);
        const hasBomb = Array.from(activeBombs.values()).some(b => b.x === nx && b.y === ny);
        
        // COLISÃO: Ghost (Purple) e Warn (Yellow) atravessam blocos soft (2)
        if (glitch.type === 'purple' || glitch.type === 'yellow') {
            if (tile === 1 || hasBomb) return; 
        } else {
            if (tile !== 0 || hasBomb) return;
        }

        // Evita entrar no fogo voluntariamente
        if (dangerMap.has(nKey)) return;

        let score = 0;
        const d = Math.abs(nx - targetPos.x) + Math.abs(ny - targetPos.y);

        // --- PONTUAÇÃO DE MOVIMENTO POR TIPO ---
        if (glitch.type === 'red') {
            // Kamikaze: Quer distância zero
            score -= d * 15; 
        } else if (glitch.type === 'purple') {
            // Ghost: Quer manter distância média (stalker)
            score -= Math.abs(d - 4) * 10;
        } else if (glitch.type === 'cyan') {
            // Sniper: Quer alinhar eixo X ou Y
            const alignedX = (nx === target.x);
            const alignedY = (ny === target.y);
            if (alignedX || alignedY) score += 40;
            // Mas quer manter distância segura
            score -= Math.abs(d - 7) * 5;
        } else if (glitch.type === 'orange') {
            // Trapper: Tenta interceptar (ficar um pouco à frente ou perto)
            score -= Math.abs(d - 3) * 8;
        } else if (glitch.type === 'blue') {
            // Tank: Perseguição lenta e constante
            score -= d * 3;
        } else {
            // Green/Standard
            score -= d * 5;
        }

        // Evita empilhar com outros inimigos
        if (enemyPositions.has(nKey)) score -= 30; 
        score += Math.random() * 5; // Fator caótico

        if (score > maxScore) { maxScore = score; bestMove = { x: nx, y: ny }; }
    });

    // --- 5. ATAQUE ---
    // Red: Ataca se estiver colado
    if (glitch.type === 'red' && minD <= 1) {
        return { action: 'bomb', state: 'BOOM!' };
    }
    // Orange: Coloca armadilhas se estiver perto (mas não colado)
    if (glitch.type === 'orange' && minD <= 5 && minD > 2 && !dangerMap.has(getKey(glitch.x, glitch.y))) {
        if (Math.random() < 0.2) return { action: 'bomb', state: 'TRAP' };
    }
    // Buffados genéricos
    if (glitch.isBuffed && minD <= 2 && !dangerMap.has(getKey(glitch.x, glitch.y))) {
        if (Math.random() < 0.3) return { action: 'bomb', state: 'ATK' };
    }

    if (bestMove) {
        // Para tipos conhecidos, retorna um estado de ação amigável
        let moveState = 'AVANÇAR';
        if (glitch.type === 'red') moveState = 'AVANÇAR';
        else if (glitch.type === 'blue') moveState = 'PERSEGUIR';
        else if (glitch.type === 'purple') moveState = 'ESPREITAR';
        else if (glitch.type === 'cyan') moveState = 'MIRAR';
        else if (glitch.type === 'orange') moveState = 'CERCAR';
        else if (glitch.type === 'yellow') moveState = 'OBSERVAR';
        // Para qualquer outro, usa 'AVANÇAR'
        return { action: 'move', x: bestMove.x, y: bestMove.y, state: moveState };
    }
    return randomMove(glitch, getTileAt, activeBombs, dangerMap, 'PARADO');
}

function randomMove(glitch, getTileAt, activeBombs, dangerMap, state) {
    const moves = [[0,1], [0,-1], [1,0], [-1,0]].sort(()=>Math.random()-0.5);
    for(let m of moves) {
        const nx = glitch.x + m[0];
        const ny = glitch.y + m[1];
        const tile = getTileAt(nx, ny);
        const hasBomb = Array.from(activeBombs.values()).some(b => b.x === nx && b.y === ny);
        const isSafe = !dangerMap.has(getKey(nx, ny));
        
        let isWalkable = (tile === 0);
        if (glitch.type === 'purple') isWalkable = (tile === 0 || tile === 2);

        if (isWalkable && !hasBomb && isSafe && (Math.abs(nx)>5 || Math.abs(ny)>5)) {
            return { action: 'move', x: nx, y: ny, state: state };
        }
    }
    return null;
}

module.exports = { calculateGlitchMove };