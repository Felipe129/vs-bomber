// world_duel.js

function getTileAt(gx, gy, destroyedBlocks, seed) {
    // Arena Fechada (20x20)
    if (Math.abs(gx) > 10 || Math.abs(gy) > 10) return 1; // Parede Indestrutível
    if (Math.abs(gx) === 10 || Math.abs(gy) === 10) return 1;

    // A chave recebida já deve ser local (x,y)
    const key = `${gx},${gy}`; 
    if (destroyedBlocks && destroyedBlocks.has(key)) return 0;

    // Spawn limpo no duelo (centro e cantos)
    if (Math.abs(gx) < 2 && Math.abs(gy) < 2) return 0;
    if (Math.abs(gx) >= 8 && Math.abs(gy) >= 8) return 0;

    // Padrão aleatório simples para a arena
    const duelVal = Math.abs(Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) % 1;
    return duelVal > 0.6 ? 2 : 0;
}

module.exports = {
    getTileAt
};