// duel_manager.js
const activeDuels = new Map();

function startDuel(p1, p2, io, broadcastChat) {
    if (!p1 || !p2 || p1.inDuel || p2.inDuel) return;

    const duelId = 'duel_' + Date.now();

    // Salva estado e reseta para base
    [p1, p2].forEach(p => {
        p.savedState = {
            x: p.x, y: p.y,
            bombs: p.bombs, radius: p.radius, moveDelay: p.moveDelay,
            score: p.score,
            sessionPowerups: { ...p.sessionPowerups }
        };
        p.inDuel = duelId;
        p.bombs = 1; p.radius = 1; p.moveDelay = 150; // Stats base
        p.kickUntil = null; p.ghostUntil = null; p.pierceUntil = null;
        
        // Troca de Sala Socket.IO
        const sock = io.sockets.sockets.get(p.id);
        if(sock) { sock.leave('main'); sock.join(duelId); }
        p.dimension = duelId;
    });

    // Teleporta para a arena (cantos opostos locais)
    p1.x = -8; p1.y = -8;
    p2.x = 8; p2.y = 8;

    activeDuels.set(duelId, { p1: p1.id, p2: p2.id });

    // Envia atualização apenas para a sala do duelo
    io.to(duelId).emit('playerMoved', p1);
    io.to(duelId).emit('playerMoved', p2);
    broadcastChat({ id: 'SYSTEM', text: `[DUEL] ⚔️ ${p1.name} vs ${p2.name} começou!`, system: true });
    io.to(p1.id).emit('notification', { text: "DUELO INICIADO! Derrote o oponente.", type: "warn" });
    io.to(p2.id).emit('notification', { text: "DUELO INICIADO! Derrote o oponente.", type: "warn" });
}

function handleDuelDeath(loser, killerId, players, io, broadcastChat) {
    const duelId = loser.inDuel;
    const duel = activeDuels.get(duelId);
    if (!duel) return;

    const winnerId = (loser.id === duel.p1) ? duel.p2 : duel.p1;
    const winner = players[winnerId];

    // Anuncia vencedor
    const winnerName = winner ? winner.name : "Ninguém";
    broadcastChat({ id: 'SYSTEM', text: `[DUEL] 🏆 ${winnerName} venceu o duelo contra ${loser.name}!`, system: true });

    // Restaura estados e teleporta de volta
    [loser, winner].forEach(p => {
        if (p && p.savedState) {
            p.x = 0; p.y = 0; // Volta para o spawn do mundo normal
            p.bombs = p.savedState.bombs;
            p.radius = p.savedState.radius;
            p.moveDelay = p.savedState.moveDelay;
            p.score = p.savedState.score;
            p.sessionPowerups = p.savedState.sessionPowerups;
            p.inDuel = null;
            p.savedState = null;
            p.dimension = 'main';
            
            // Volta para a sala Main
            const sock = io.sockets.sockets.get(p.id);
            if(sock) { sock.leave(duelId); sock.join('main'); }
        }
    });

    activeDuels.delete(duelId);
    
    // Atualiza posição para todos na main
    if (loser) io.to('main').emit('playerMoved', loser);
    if (winner) io.to('main').emit('playerMoved', winner);
}

module.exports = { activeDuels, startDuel, handleDuelDeath };