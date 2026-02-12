// public/audio.js

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundMemeMode = false; // Começa no modo Moderno
let bgmSource = null;
let bgmGainNode = audioCtx.createGain();

bgmGainNode.connect(audioCtx.destination);

// --- CARREGA O VOLUME SALVO ---
const savedVolume = localStorage.getItem('vsbomber_volume');
const initialVolume = savedVolume !== null ? parseFloat(savedVolume) : 0.3;
// Aplica a trava de 25% (0.25) no valor recuperado
bgmGainNode.gain.value = initialVolume * 0.25; 

const DEATH_SOUNDS = [
    'som-do-zap-zap-estourado.mp3',
    'tu-e-um-beta.mp3',
    'chicken-on-tree-screaming.mp3',
    'brutal-acabou-pro-beta-globo.mp3',
    'nao-sobrou-nada_fZprXSC.mp3'
];

// Otimização: Pré-carrega os sons de "meme" para evitar a criação de `new Audio()`
// a cada efeito, o que pode causar atrasos e consumir mais recursos.
const memeAudio = {
    place: new Audio('sounds/fiau.mp3'),
    explosion: new Audio('sounds/som-de-explosao.mp3'),
    death: DEATH_SOUNDS.map(sound => new Audio('sounds/' + sound))
};

window.toggleSoundMode = () => {
    soundMemeMode = !soundMemeMode;
    const icon = document.getElementById('sound-icon');
    const filename = document.getElementById('sound-filename');
    
    if (soundMemeMode) {
        icon.innerText = "ON";
        icon.style.color = "#e8ba36";
        filename.innerText = "sound_meme.js";
        if (typeof createToast === 'function') createToast("System", "Meme sounds enabled (MP3)", "warn");
    } else {
        icon.innerText = "OFF";
        icon.style.color = "#6a9955";
        filename.innerText = "sound_modern.js";
        if (typeof createToast === 'function') createToast("System", "Modern Synth enabled", "info");
    }
};

window.startBGM = async () => {
    try {
        const response = await fetch('sounds/lofybeat.mp3');
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        if (bgmSource) bgmSource.stop();
        bgmSource = audioCtx.createBufferSource();
        bgmSource.buffer = audioBuffer;
        bgmSource.loop = true;
        bgmSource.connect(bgmGainNode);
        bgmSource.start(0);
    } catch (e) {
        console.warn("BGM não carregada.");
    }
};

/**
 * Atualiza o volume e salva a preferência do jogador
 */
window.updateVolume = (val) => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    bgmGainNode.gain.setTargetAtTime(val * 0.25, audioCtx.currentTime, 0.05);
    localStorage.setItem('vsbomber_volume', val); // Salva no navegador
};

const playSynth = (freqs, type, duration, volume = 0.1) => {
    if (audioCtx.state === 'suspended') return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqs[0], t);
    if (freqs[1]) osc.frequency.exponentialRampToValueAtTime(freqs[1], t + duration);
    gain.gain.setValueAtTime(0.001, t); 
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration);
};

window.sfx = {
    resume: () => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
                if (!bgmSource) window.startBGM();
            });
        } else if (!bgmSource) {
            window.startBGM();
        }
    },
    move: () => { playSynth([120, 80], 'sine', 0.08, 0.03); },
    place: () => { 
        if (soundMemeMode) {
            const audio = memeAudio.place;
            audio.currentTime = 0; // Reinicia o som se já estiver tocando
            audio.play().catch(() => {}); 
        } else {
            playSynth([800, 100], 'sine', 0.15, 0.1);
        }
    },
    powerup: () => { 
        const t = audioCtx.currentTime;
        [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
            setTimeout(() => playSynth([f, f * 1.1], 'sine', 0.25, 0.06), i * 60);
        });
    },
    explosion: (bombPos) => { 
        const d = Math.sqrt(Math.pow(myPos.x - bombPos.x, 2) + Math.pow(myPos.y - bombPos.y, 2));
        const maxRadius = 15;
        if (d > maxRadius) return; 

        const distMult = Math.max(0, 1 - (d / maxRadius));

        if (soundMemeMode) {
            const explosionAudio = memeAudio.explosion;
            explosionAudio.currentTime = 0;
            explosionAudio.volume = 0.8 * distMult; 
            explosionAudio.play().catch(() => {}); 
        } else {
            const t = audioCtx.currentTime;
            playSynth([100, 30], 'sine', 0.6, 0.5 * distMult); 

            const bufferSize = audioCtx.sampleRate * 0.6;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            const g = audioCtx.createGain();
            const filter = audioCtx.createBiquadFilter();
            
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(450, t); 
            filter.frequency.exponentialRampToValueAtTime(40, t + 0.5);
            filter.Q.value = 8;

            g.gain.setValueAtTime(0.3 * distMult, t); 
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            
            noise.connect(filter);
            filter.connect(g);
            g.connect(audioCtx.destination);
            noise.start(t);
        }
    },
    kick: () => { playSynth([200, 50], 'square', 0.1, 0.05); },
    glitchDeath: () => { playSynth([400, 10], 'sawtooth', 0.2, 0.05); },
    gameOver: () => {
        if (soundMemeMode) {
            const randomAudio = memeAudio.death[Math.floor(Math.random() * memeAudio.death.length)];
            randomAudio.currentTime = 0;
            randomAudio.play().catch(() => {});
        } else {
            const t = audioCtx.currentTime;
            [261.63, 196.00, 155.56].forEach((f, i) => {
                setTimeout(() => playSynth([f, f * 0.8], 'triangle', 0.7, 0.07), i * 120);
            });
        }
    }
};