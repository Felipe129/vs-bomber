// public/input.js

window.addEventListener('keydown', e => {
    // Se o jogador não estiver conectado ou não existir, ignora as teclas
    if (!joined || !myId || !players[myId]) return;
    
    // --- CONTROLE DO CHAT ---
    if (e.key === 'Enter') {
        e.preventDefault();
        const chatContainer = document.getElementById('chat-input-line');
        const chatInput = document.getElementById('chat-input');
        
        if (!chatting) {
            chatting = true; 
            chatContainer.style.display = 'flex'; 
            chatInput.focus();
        } else {
            const val = chatInput.value;
            if (val) socket.emit('chatMessage', val);
            chatInput.value = ''; 
            chatting = false; 
            chatContainer.style.display = 'none'; 
            canvas.focus();
        }
        return;
    }
    
    // Se estiver com o chat aberto, bloqueia o movimento e as bombas
    if (chatting) return;
    
    const now = Date.now();
    
    // --- COLOCAR BOMBA (Barra de Espaço) ---
    if (e.key === ' ') {
        if (now - lastBomb > 200) { 
            socket.emit('placeBomb', { x: players[myId].x, y: players[myId].y }); 
            lastBomb = now; 
        }
        return;
    }
    
    // --- MOVIMENTAÇÃO (Setinhas) ---
    const currentDelay = players[myId].moveDelay || 150;
    if (now - lastStep < currentDelay) return;
    
    let nX = players[myId].x, nY = players[myId].y;
    
    if (e.key === 'ArrowUp') nY--; 
    else if (e.key === 'ArrowDown') nY++;
    else if (e.key === 'ArrowLeft') nX--; 
    else if (e.key === 'ArrowRight') nX++;
    
    // Se a posição mudou, envia para o servidor
    if (nX !== players[myId].x || nY !== players[myId].y) { 
        lastStep = now; 
        socket.emit('move', { x: nX, y: nY }); 
    }
});