// public/world_duel.js
(function(window) {
    window.DuelWorld = {
        getTileAt: function(gx, gy, seed) {
            const localX = gx;
            const localY = gy;
            if (Math.abs(localX) > 10 || Math.abs(localY) > 10) return 1; 
            if (Math.abs(localX) === 10 || Math.abs(localY) === 10) return 1;
            if (Math.abs(localX) < 2 && Math.abs(localY) < 2) return 0;
            if (Math.abs(localX) >= 8 && Math.abs(localY) >= 8) return 0;
            const duelVal = Math.abs(Math.sin((gx + seed) * 12.9898 + (gy + seed) * 78.233) * 43758.5453) % 1;
            return duelVal > 0.6 ? 2 : 0;
        }
    };
})(window);