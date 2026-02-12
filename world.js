// world.js

const MAP_RADIUS = 187; // 375 / 2
const PLAYABLE_RADIUS = 182; // 5 camadas de borda

let mapSeed = Math.random() * 10000;
function setSeed(s) { mapSeed = s; }
function getSeed() { return mapSeed; }

// Função que gera o mapa proceduralmente
function getTileAt(gx, gy, destroyedBlocks) {
    gx = Math.round(gx); 
    gy = Math.round(gy);
    
    // Limites do Mapa (375x375 com borda de 5 blocos)
    if (Math.abs(gx) > MAP_RADIUS || Math.abs(gy) > MAP_RADIUS) return 0; // Void
    if (Math.abs(gx) > PLAYABLE_RADIUS || Math.abs(gy) > PLAYABLE_RADIUS) return 1; // Borda Indestrutível

    const key = `${gx},${gy}`;
    
    // Se o bloco foi quebrado, é caminho livre (0)
    if (destroyedBlocks && destroyedBlocks.has(key)) return 0;
    
    // Spawn point seguro
    if (Math.abs(gx) <= 5 && Math.abs(gy) <= 5) return 0; 
    
    // Paredes de metal indestrutíveis (Grid par)
    if (gx % 2 === 0 && gy % 2 === 0) return 1;
    
    // Ruído determinístico para espalhar os blocos de madeira
    const val = Math.abs(Math.sin((gx + mapSeed) * 12.9898 + (gy + mapSeed) * 78.233) * 43758.5453) % 1;
    const dist = Math.max(Math.abs(gx), Math.abs(gy));
    
    // Mais blocos longe do centro, menos blocos perto do spawn
    const threshold = dist > 10 ? 0.55 : 0.82; 
    return val > threshold ? 2 : 0;
}

// Encontra o local seguro mais próximo para o player não ficar preso
function findSafeTile(sx, sy, destroyedBlocks, activeBombs) {
    for (let radius = 1; radius < 20; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                let tx = sx + dx, ty = sy + dy;
                
                // Garante que não spawne dentro da parede da borda
                if (Math.abs(tx) > PLAYABLE_RADIUS || Math.abs(ty) > PLAYABLE_RADIUS) continue;

                // Verifica se é espaço livre e se não tem bomba em cima
                if (getTileAt(tx, ty, destroyedBlocks) === 0 && !Array.from(activeBombs.values()).some(b => b.x === tx && b.y === ty)) {
                    let freeNeighbors = 0;
                    [[0,1],[0,-1],[1,0],[-1,0]].forEach(d => { 
                        if (getTileAt(tx + d[0], ty + d[1], destroyedBlocks) === 0) freeNeighbors++; 
                    });
                    
                    // Precisa de no mínimo 2 saídas para o player não renascer encurralado
                    if (freeNeighbors >= 2) return { x: tx, y: ty };
                }
            }
        }
    }
    return { x: 0, y: 0 }; // Fallback para a origem
}

module.exports = {
    getTileAt,
    findSafeTile,
    setSeed,
    getSeed,
    MAP_RADIUS,
    PLAYABLE_RADIUS
};