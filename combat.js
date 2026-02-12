// combat.js

function detonateBomb(bombId, sourceId, ctx) {
    // Desestruturando o contexto passado pelo servidor
    const {
        activeBombs, destroyedBlocks, powerUps, activeFlames, enemies,
        getTileAt, spawnEnemy, io, broadcastChat, players
    } = ctx;

    const bomb = activeBombs.get(bombId);
    if (!bomb) return;

    const isPierce = bomb.isPierce;
    const area = []; 
    area.push({ x: bomb.x, y: bomb.y });

    // Calcula a propagação do fogo nas 4 direções
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        for (let i = 1; i <= bomb.radius; i++) {
            const tx = bomb.x + (d[0] * i); 
            const ty = bomb.y + (d[1] * i);
            const tile = getTileAt(tx, ty);
            
            if (tile === 1) break; // Parede de metal: para a explosão
            
            area.push({ x: tx, y: ty });
            
            if (tile === 2) { // Bloco de madeira: quebra o bloco
                const key = `${tx},${ty}`;
                destroyedBlocks.add(key);
                
                if (players[sourceId]) {
                    players[sourceId].score += 1;
                    io.emit('floatingText', { x: players[sourceId].x, y: players[sourceId].y, text: "+1" });
                }
                
                // Lógica do Bloco Infectado
                const distCenter = Math.max(Math.abs(tx), Math.abs(ty));
                const isInf = (distCenter > 20) && (Math.abs(Math.cos(tx * 43.11 + ty * 18.23) * 1234.56) % 1 < 0.005);
                
                if (isInf) {
                    broadcastChat({ id: 'SYSTEM', text: `[WARN] INFECTED BLOCK RELEASED.`, system: true });
                    // Spawna 8 inimigos "enfurecidos" ao redor
                    for (let j = 0; j < 8; j++) spawnEnemy({ x: tx, y: ty }, true, 2000);
                    io.emit('enemiesUpdate', enemies);
                } else if (Math.random() < 0.20) { 
                    // Sorteio de PowerUp
                    const rnd = Math.random(); 
                    let type = 'bomb';
                    if (rnd < 0.30) type = 'bomb'; 
                    else if (rnd < 0.60) type = 'fire'; 
                    else if (rnd < 0.85) type = 'speed'; 
                    else if (rnd < 0.96) type = 'kick'; 
                    else if (rnd < 0.98) type = 'ghost'; 
                    else type = 'pierce'; 
                    
                    powerUps.set(key, { type, spawnTime: Date.now() });
                }
                
                if (!isPierce) break; // Bomba normal para no primeiro bloco
            }
        }
    });

    activeBombs.delete(bombId);
    io.emit('bombUpdate', Array.from(activeBombs.values()));
    
    const now = Date.now();
    
    area.forEach(t => {
        if (Math.abs(t.x) <= 5 && Math.abs(t.y) <= 5) return; // Zona de Spawn
        
        const key = `${t.x},${t.y}`;
        const item = powerUps.get(key);
        
        // Destrói power-ups que já estavam no chão
        if (item && (now - item.spawnTime > 2000)) { 
            powerUps.delete(key); 
            io.emit('powerUpsUpdate', Array.from(powerUps)); 
        }
        
        // Registra o fogo para matar jogadores e inimigos
        activeFlames.push({ x: t.x, y: t.y, time: now, owner: sourceId });
    });

    // Reações em Cadeia: se atingir outra bomba, ela explode na hora
    activeBombs.forEach((ob, oid) => { 
        if (area.some(t => t.x === ob.x && t.y === ob.y)) {
            detonateBomb(oid, sourceId, ctx); 
        }
    });

    // Emite o visual da explosão
    io.emit('explosion', { 
        area, 
        bombId, 
        destroyedBlocks: Array.from(destroyedBlocks), 
        powerUps: Array.from(powerUps), 
        isPierce: isPierce 
    });
}

module.exports = {
    detonateBomb
};