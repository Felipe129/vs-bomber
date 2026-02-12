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
    
    // Respeita a velocidade atual do player (incluindo debuff de lentidão)
    let currentDelay = players[myId].moveDelay || 150;
    if (players[myId].slowUntil && now < players[myId].slowUntil) currentDelay = 300;
    
    if (now - lastStep < currentDelay) return; 

    let nX = players[myId].x;
    let nY = players[myId].y;

    let up = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
    let down = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
    let left = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
    let right = e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';

    // Lógica de Inversão de Controles
    if (players[myId].invertUntil && now < players[myId].invertUntil) {
        const tUp = up; up = down; down = tUp;
        const tLeft = left; left = right; right = tLeft;
    }

    if (up) { nY--; players[myId].facing = 'up'; }
    if (down) { nY++; players[myId].facing = 'down'; }
    if (left) { nX--; players[myId].facing = 'left'; }
    if (right) { nX++; players[myId].facing = 'right'; }

    if (nX === players[myId].x && nY === players[myId].y) return;

    // Permite atravessar paredes (tile 2) se estiver em modo ghost
    let canGhost = players[myId].ghostUntil && Date.now() < players[myId].ghostUntil;
    let tileType = typeof getTileAt === 'function' ? getTileAt(nX, nY) : 1;
    const isFree = (tileType === 0) || (canGhost && tileType === 2);
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