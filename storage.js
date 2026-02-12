// storage.js
const fs = require('fs');

const RANK_FILE = 'ranking.json';
const CHAT_FILE = 'chat.json';

let globalRank = [];
let chatHistory = [];

// Carrega os dados do disco ao iniciar o servidor
function loadData() {
    try { 
        if (fs.existsSync(RANK_FILE)) globalRank = JSON.parse(fs.readFileSync(RANK_FILE, 'utf8')); 
    } catch (e) { globalRank = []; }
    
    try { 
        if (fs.existsSync(CHAT_FILE)) chatHistory = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')); 
    } catch (e) { chatHistory = []; }
}

function getRanking() {
    return globalRank;
}

function getChatHistory() {
    return chatHistory;
}

function saveChatMessage(msgData) {
    // Cria a data e hora no formato DD/MM/YYYY HH:MM:SS
    if (!msgData.timestamp) {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        msgData.timestamp = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    chatHistory.push(msgData);
    if (chatHistory.length > 50) chatHistory.shift(); 
    try { fs.writeFileSync(CHAT_FILE, JSON.stringify(chatHistory, null, 2)); } catch (e) {}
    
    return msgData; // Retorna a mensagem com o timestamp embutido
}

function updateGlobalRank(player) {
    if (!player || !player.name) return globalRank;
    
    const existingIndex = globalRank.findIndex(p => p.name === player.name);
    const stats = {
        name: player.name,
        score: player.score,
        color: player.color,
        maxDist: player.maxDist || 0,
        maxLevel: player.maxLevel || 0,
        kills: player.kills || 0,
        enemyKills: player.enemyKills || 0,
        deaths: player.deaths || 0
    };

    if (existingIndex !== -1) {
        const current = globalRank[existingIndex];
        if (player.score > current.score) current.score = player.score;
        if (player.maxDist > (current.maxDist || 0)) current.maxDist = player.maxDist;
        if (player.maxLevel > (current.maxLevel || 0)) current.maxLevel = player.maxLevel;
        current.kills = player.kills;
        current.enemyKills = player.enemyKills;
        current.deaths = player.deaths;
        globalRank[existingIndex] = current; 
    } else {
        globalRank.push(stats);
    }
    
    globalRank.sort((a, b) => b.score - a.score);
    if (globalRank.length > 20) globalRank = globalRank.slice(0, 20);
    try { fs.writeFileSync(RANK_FILE, JSON.stringify(globalRank, null, 2)); } catch (e) {}
    
    return globalRank; // Retorna o ranking atualizado
}

module.exports = {
    loadData,
    getRanking,
    getChatHistory,
    saveChatMessage,
    updateGlobalRank
};