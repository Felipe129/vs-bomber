// combat.js

function detonateBomb(bombId, sourceId, ctx) {
    // Desestruturando o contexto passado pelo servidor
    const {
        activeBombs, destroyedBlocks, powerUps, activeFlames, enemies,
        getTileAt, spawnEnemy, io, broadcastChat, players, getDimKey
    } = ctx;

    const bomb = activeBombs.get(bombId);
    if (!bomb) return;
    const dim = bomb.dimension || 'main';

    const isPierce = bomb.isPierce;
    const area = []; 
    area.push({ x: bomb.x, y: bomb.y });

    // Calcula a propagação do fogo nas 4 direções
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        for (let i = 1; i <= bomb.radius; i++) {
            const tx = bomb.x + (d[0] * i); 
            const ty = bomb.y + (d[1] * i);
            const tile = getTileAt(tx, ty, dim);
            
            if (tile === 1) break; // Parede de metal: para a explosão
            
            area.push({ x: tx, y: ty });
            
            if (tile === 2) { // Bloco de madeira: quebra o bloco
                const key = getDimKey(tx, ty, dim);
                destroyedBlocks.add(key);
                
                if (players[sourceId]) {
                    players[sourceId].score += 1;
                    io.to(dim).emit('floatingText', { x: players[sourceId].x, y: players[sourceId].y, text: "+1" });
                }
                
                // Lógica do Bloco Infectado
                const distCenter = Math.max(Math.abs(tx), Math.abs(ty));
                const isInf = (dim === 'main') && (distCenter > 20) && (Math.abs(Math.cos(tx * 43.11 + ty * 18.23) * 1234.56) % 1 < 0.005);
                
                if (isInf) {
                    broadcastChat({ id: 'SYSTEM', text: `[WARN] INFECTED BLOCK RELEASED.`, system: true });
                    // Spawna 8 inimigos "enfurecidos" ao redor
                    for (let j = 0; j < 8; j++) spawnEnemy({ x: tx, y: ty }, true, 2000);
                    io.to('main').emit('enemiesUpdate', enemies);
                } else if (Math.random() < 0.20) { 
                    // Sorteio de PowerUp
                    const rnd = Math.random(); 
                    let type = 'bomb';
                    if (rnd < 0.25) type = 'bomb'; 
                    else if (rnd < 0.50) type = 'fire'; 
                    else if (rnd < 0.70) type = 'speed'; 
                    else if (rnd < 0.78) type = 'kick'; 
                    else if (rnd < 0.80) type = 'ghost'; 
                    else if (rnd < 0.82) type = 'pierce';
                    // PowerDowns (Permanentes)
                    else if (rnd < 0.88) type = 'bomb_down';
                    else if (rnd < 0.94) type = 'fire_down';
                    else if (rnd < 1.00) {
                        // Debuffs Temporários ou Speed Down
                        const sub = Math.random();
                        if (sub < 0.4) type = 'speed_down';
                        else if (sub < 0.6) type = 'debuff_slow';
                        else if (sub < 0.8) type = 'debuff_invert';
                        else type = 'debuff_autobomb';
                    }
                    
                    powerUps.set(key, { type, spawnTime: Date.now() });
                }
                
                if (!isPierce) break; // Bomba normal para no primeiro bloco
            }
        }
    });

    activeBombs.delete(bombId);
    
    // Update bombs for this dimension
    const dimBombs = Array.from(activeBombs.values()).filter(b => b.dimension === dim);
    io.to(dim).emit('bombUpdate', dimBombs);
    
    const now = Date.now();
    
    area.forEach(t => {
        if (dim === 'main' && Math.abs(t.x) <= 5 && Math.abs(t.y) <= 5) return; // Zona de Spawn (Apenas Main)
        
        const key = getDimKey(t.x, t.y, dim);
        const item = powerUps.get(key);
        
        // Destrói power-ups que já estavam no chão
        if (item && (now - item.spawnTime > 2000)) { 
            powerUps.delete(key); 
            // Filter powerups for update
            const localPowerUpsUpdate = [];
            powerUps.forEach((v, k) => {
                if (k.startsWith(dim + ':')) localPowerUpsUpdate.push([k.split(':')[1], v]);
            });
            io.to(dim).emit('powerUpsUpdate', localPowerUpsUpdate); 
        }
        
        // Registra o fogo para matar jogadores e inimigos
        activeFlames.push({ x: t.x, y: t.y, dimension: dim, time: now, owner: sourceId });
    });

    // Reações em Cadeia: se atingir outra bomba, ela explode na hora
    activeBombs.forEach((ob, oid) => { 
        if (ob.dimension === dim && area.some(t => t.x === ob.x && t.y === ob.y)) {
            detonateBomb(oid, sourceId, ctx); 
        }
    });

    // Filter destroyed blocks for this dimension
    const localDestroyed = [];
    destroyedBlocks.forEach(k => {
        if (k.startsWith(dim + ':')) localDestroyed.push(k.split(':')[1]);
    });

    // Filter powerups for this dimension
    const localPowerUps = [];
    powerUps.forEach((v, k) => {
        if (k.startsWith(dim + ':')) localPowerUps.push([k.split(':')[1], v]);
    });

    // Emite o visual da explosão
    io.to(dim).emit('explosion', { 
        area, 
        bombId, 
        destroyedBlocks: localDestroyed, 
        powerUps: localPowerUps, 
        isPierce: isPierce 
    });
}

module.exports = {
    detonateBomb
};