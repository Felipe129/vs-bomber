// public/input.js

document.addEventListener('keydown', e => {
    // IGNORA INPUTS SE ESTIVER DIGITANDO NO CHAT
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        if (e.key === 'Enter') {
            if (document.activeElement.value.trim() !== '') {
                socket.emit('chatMessage', document.activeElement.value);
                document.activeElement.value = '';
            }
            document.activeElement.blur();
        }
        return;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        const chatInput = document.querySelector('input[type="text"]') || document.getElementById('chatInput');
        if (chatInput) chatInput.focus();
        return;
    }

    if (typeof myId === 'undefined' || !players[myId] || players[myId].isDead) return;

    // COLOCAR BOMBA
    if (e.key === ' ' || e.key === 'Control') {
        e.preventDefault();
        socket.emit('placeBomb', { x: players[myId].x, y: players[myId].y });
    }

    // CONTROLE DE MOVIMENTO (PREDIÇÃO LOCAL)
    const now = Date.now();
    if (now - lastStep < 150) return; 

    let nX = players[myId].x;
    let nY = players[myId].y;

    if (e.key === 'ArrowUp') nY--;
    if (e.key === 'ArrowDown') nY++;
    if (e.key === 'ArrowLeft') nX--;
    if (e.key === 'ArrowRight') nX++;

    if (nX === players[myId].x && nY === players[myId].y) return;

    // Verifica se o caminho está livre usando a função do render.js
    const isFree = typeof getTileAt === 'function' && getTileAt(nX, nY) === 0;
    const hasBomb = typeof activeBombs !== 'undefined' && Array.from(activeBombs.values()).some(b => b.x === nX && b.y === nY);

    if (isFree && !hasBomb) {
        lastStep = now;
        
        // Predição: Move instantaneamente na tela do cliente
        players[myId].x = nX;
        players[myId].y = nY;

        if (typeof sfx !== 'undefined' && sfx.move) sfx.move();

        // Envia ao servidor
        socket.emit('move', { x: nX, y: nY });
    }
});