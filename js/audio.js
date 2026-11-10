// ============================================================================
// MOTOR DE AUDIO AVANZADO: RADIO, MOTOR, CHOQUES REALES, SEMÁFORO Y SIRENA
// ============================================================================

class HorizonAudioManager {
    constructor() {
        this.ctx = null;
        this.isInitialized = false;

        this.tracks = [...window.FH6_DATA.tracks];
        this.currentTrackIndex = 0;
        this.isPlayingMusic = true;
        this.musicVolume = 0.48;
        this.sfxVolume = 0.42;

        this.customAudioElement = new Audio();
        this.customAudioElement.crossOrigin = 'anonymous';
        this.customAudioSource = null;

        this.analyser = null;
        this.freqData = new Uint8Array(16);

        this.sequencerTimer = null;
        this.stepIndex = 0;

        this.engineOsc1 = null;
        this.engineOsc2 = null;
        this.engineGain = null;
        this.engineFilter = null;
        this.driftGain = null;
        this.noiseBuffer = null;

        // Sirena policial
        this.sirenOsc = null;
        this.sirenGain = null;
        this.sirenActive = false;

        this.customAudioElement.addEventListener('ended', () => {
            this.nextTrack();
        });
    }

    init() {
        if (this.isInitialized) {
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            return;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        this.ctx = new AudioCtx();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 64;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

        this.musicMasterGain = this.ctx.createGain();
        this.musicMasterGain.gain.value = this.musicVolume;
        this.musicMasterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        try {
            this.customAudioSource = this.ctx.createMediaElementSource(this.customAudioElement);
            this.customAudioSource.connect(this.musicMasterGain);
        } catch (e) {}

        this.setupEngineAndSfx();
        this.isInitialized = true;
        this.startCurrentTrack();
    }

    setupEngineAndSfx() {
        if (!this.ctx) return;

        this.engineOsc1 = this.ctx.createOscillator();
        this.engineOsc2 = this.ctx.createOscillator();
        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineGain = this.ctx.createGain();

        this.engineOsc1.type = 'sawtooth';
        this.engineOsc2.type = 'triangle';
        this.engineOsc1.frequency.value = 70;
        this.engineOsc2.frequency.value = 140;

        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 340;
        this.engineFilter.Q.value = 3.8;

        this.engineGain.gain.value = 0.001;

        this.engineOsc1.connect(this.engineFilter);
        this.engineOsc2.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);

        this.engineOsc1.start();
        this.engineOsc2.start();

        // Buffer de ruido blanco compartido para derrapes y colisiones
        const bufferSize = this.ctx.sampleRate * 1.5;
        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = this.noiseBuffer;
        whiteNoise.loop = true;

        const bandpass = this.ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 1650;
        bandpass.Q.value = 4.5;

        this.driftGain = this.ctx.createGain();
        this.driftGain.gain.value = 0.0001;

        whiteNoise.connect(bandpass);
        bandpass.connect(this.driftGain);
        this.driftGain.connect(this.ctx.destination);
        whiteNoise.start();

        // Sirena de Patrulla de Tokio
        this.sirenOsc = this.ctx.createOscillator();
        this.sirenGain = this.ctx.createGain();
        this.sirenOsc.type = 'triangle';
        this.sirenOsc.frequency.value = 650;
        this.sirenGain.gain.value = 0.0001;
        this.sirenOsc.connect(this.sirenGain);
        this.sirenGain.connect(this.ctx.destination);
        this.sirenOsc.start();
    }

    updateEngine(rpm, maxRpm, throttle, isDrifting, baseFreq = 70, isPaused = false, policeDistance = null) {
        if (!this.isInitialized || !this.ctx) return;

        const now = this.ctx.currentTime;
        if (isPaused) {
            this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
            this.driftGain.gain.setTargetAtTime(0.0001, now, 0.08);
            this.sirenGain.gain.setTargetAtTime(0.0001, now, 0.08);
            return;
        }

        const rpmRatio = Math.max(0.12, Math.min(1.0, rpm / maxRpm));
        const freq1 = baseFreq * (0.75 + rpmRatio * 2.45);
        const freq2 = freq1 * 1.5;

        this.engineOsc1.frequency.setTargetAtTime(freq1, now, 0.035);
        this.engineOsc2.frequency.setTargetAtTime(freq2, now, 0.035);
        this.engineFilter.frequency.setTargetAtTime(240 + rpmRatio * 1550 + (throttle ? 340 : 0), now, 0.045);

        const targetEngineVol = (0.045 + rpmRatio * 0.095 + (throttle ? 0.045 : 0)) * this.sfxVolume;
        this.engineGain.gain.setTargetAtTime(targetEngineVol, now, 0.05);

        const targetDriftVol = isDrifting ? 0.10 * this.sfxVolume : 0.0001;
        this.driftGain.gain.setTargetAtTime(targetDriftVol, now, 0.07);

        // Modular sirena policial según distancia
        if (policeDistance !== null && policeDistance < 120) {
            const sirenWave = Math.sin(now * 6.5) * 240 + 760;
            this.sirenOsc.frequency.setTargetAtTime(sirenWave, now, 0.03);
            const prox = Math.max(0, 1 - policeDistance / 120);
            this.sirenGain.gain.setTargetAtTime(prox * 0.045 * this.sfxVolume, now, 0.08);
        } else {
            this.sirenGain.gain.setTargetAtTime(0.0001, now, 0.08);
        }
    }

    // Sonido de impacto / choque real entre vehículos
    playCrashSound(intensity = 0.6) {
        if (!this.isInitialized || !this.ctx || !this.noiseBuffer) return;
        const now = this.ctx.currentTime;
        const clamped = Math.max(0.2, Math.min(1.0, intensity));

        // Golpe grave de carrocería
        const thudOsc = this.ctx.createOscillator();
        const thudGain = this.ctx.createGain();
        thudOsc.type = 'sawtooth';
        thudOsc.frequency.setValueAtTime(140 * clamped + 50, now);
        thudOsc.frequency.exponentialRampToValueAtTime(28, now + 0.22);

        thudGain.gain.setValueAtTime(0.38 * clamped * this.sfxVolume, now);
        thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

        thudOsc.connect(thudGain);
        thudGain.connect(this.ctx.destination);
        thudOsc.start(now);
        thudOsc.stop(now + 0.25);

        // Crujido metálico
        const noiseSrc = this.ctx.createBufferSource();
        noiseSrc.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(950, now);
        filter.Q.value = 1.8;

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.32 * clamped * this.sfxVolume, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

        noiseSrc.connect(filter);
        filter.connect(nGain);
        nGain.connect(this.ctx.destination);
        noiseSrc.start(now);
        noiseSrc.stop(now + 0.20);
    }

    // Sonido del semáforo de salida estilo Need For Speed (PREPARADOS, LISTOS, ¡VAMOS!)
    playCountdownBeep(stage) {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (stage === 'ready' || stage === 'set') {
            const freq = stage === 'ready' ? 440 : 587.33;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now);

            gain.gain.setValueAtTime(0.22 * this.sfxVolume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.36);
        } else if (stage === 'go') {
            // Acorde explosivo para ¡VAMOS!
            [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, now);

                gain.gain.setValueAtTime(0.14 * this.sfxVolume, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.68);
            });
        }
    }

    playCheckpointSound() {
        if (!this.isInitialized || !this.ctx) return;
        const now = this.ctx.currentTime;
        [587.33, 880].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            gain.gain.setValueAtTime(0.18 * this.sfxVolume, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.26);
        });
    }

    startCurrentTrack() {
        this.stopMusicProcesses();
        if (!this.isPlayingMusic) return;

        const track = this.tracks[this.currentTrackIndex];
        if (!track) return;

        if (!this.isInitialized) {
            this.updateRadioUI();
            return;
        }

        if (track.isCustomFile && track.objectUrl) {
            this.customAudioElement.src = track.objectUrl;
            this.customAudioElement.volume = 1.0;
            this.customAudioElement.play().catch(() => {});
        } else {
            this.startProceduralSequencer(track);
        }

        this.updateRadioUI();
    }

    stopMusicProcesses() {
        if (this.sequencerTimer) {
            clearInterval(this.sequencerTimer);
            this.sequencerTimer = null;
        }
        try {
            this.customAudioElement.pause();
        } catch (e) {}
    }

    startProceduralSequencer(track) {
        if (!this.ctx) return;
        this.stepIndex = 0;
        const stepDurationMs = (60 / track.bpm / 2) * 1000;

        this.sequencerTimer = setInterval(() => {
            if (!this.isPlayingMusic || !this.ctx || this.ctx.state !== 'running') return;
            this.playSequencerStep(track, this.stepIndex);
            this.stepIndex = (this.stepIndex + 1) % 16;
        }, stepDurationMs);
    }

    playSequencerStep(track, step) {
        const now = this.ctx.currentTime;
        if (step % 4 === 0 || (track.style === 'dnb' && step === 10)) {
            this.triggerKick(now);
        }
        if (step === 4 || step === 12 || (track.style === 'dnb' && step === 14)) {
            this.triggerSnare(now);
        }
        if (step % 2 === 1) {
            this.triggerHiHat(now);
        }
        const bassFreq = track.bassPattern[step % track.bassPattern.length];
        if (bassFreq) {
            this.triggerSynthNote(now, bassFreq, 'sawtooth', 0.22, 0.24, 380);
        }
        const leadFreq = track.leadPattern[step % track.leadPattern.length];
        if (leadFreq && (step % 2 === 0 || track.style === 'eurobeat' || track.style === 'phonk')) {
            const waveType = track.style === 'phonk' ? 'square' : (track.style === 'lofi' ? 'sine' : 'sawtooth');
            const filterCutoff = track.style === 'lofi' ? 900 : 2400;
            const octaveMult = (step >= 8 && track.style === 'eurobeat') ? 1.5 : 1.0;
            this.triggerSynthNote(now, leadFreq * octaveMult, waveType, 0.16, 0.14, filterCutoff);
        }
    }

    triggerKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(135, time);
        osc.frequency.exponentialRampToValueAtTime(36, time + 0.14);
        gain.gain.setValueAtTime(0.45, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
        osc.connect(gain);
        gain.connect(this.musicMasterGain);
        osc.start(time);
        osc.stop(time + 0.19);
    }

    triggerSnare(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(210, time);
        osc.frequency.exponentialRampToValueAtTime(90, time + 0.09);
        gain.gain.setValueAtTime(0.22, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
        osc.connect(gain);
        gain.connect(this.musicMasterGain);
        osc.start(time);
        osc.stop(time + 0.13);
    }

    triggerHiHat(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'highpass';
        osc.frequency.setValueAtTime(6800, time);
        gain.gain.setValueAtTime(0.04, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        osc.connect(gain);
        gain.connect(this.musicMasterGain);
        osc.start(time);
        osc.stop(time + 0.045);
    }

    triggerSynthNote(time, freq, type, duration, peakGain, cutoff) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(cutoff, time);
        filter.frequency.exponentialRampToValueAtTime(cutoff * 0.4, time + duration);
        gain.gain.setValueAtTime(peakGain, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicMasterGain);
        osc.start(time);
        osc.stop(time + duration + 0.02);
    }

    selectTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        this.currentTrackIndex = index;
        this.isPlayingMusic = true;
        this.init();
        this.startCurrentTrack();
    }

    nextTrack() {
        this.currentTrackIndex = (this.currentTrackIndex + 1) % this.tracks.length;
        this.init();
        this.startCurrentTrack();
    }

    prevTrack() {
        this.currentTrackIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
        this.init();
        this.startCurrentTrack();
    }

    togglePlayPause() {
        this.init();
        this.isPlayingMusic = !this.isPlayingMusic;
        if (this.isPlayingMusic) {
            this.startCurrentTrack();
        } else {
            this.stopMusicProcesses();
            this.updateRadioUI();
        }
    }

    setMusicVolume(val) {
        this.musicVolume = Math.max(0, Math.min(1, parseFloat(val)));
        if (this.musicMasterGain && this.ctx) {
            this.musicMasterGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
        }
    }

    addCustomFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        let firstNewIndex = -1;

        Array.from(fileList).forEach((file) => {
            const url = URL.createObjectURL(file);
            const cleanName = file.name.replace(/\.[^/.]+$/, '');
            const newTrack = {
                id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                title: cleanName,
                artist: 'Tu Música Personal • MP3/Audio',
                genre: 'Pista Personalizada',
                isCustomFile: true,
                objectUrl: url
            };
            this.tracks.push(newTrack);
            if (firstNewIndex === -1) {
                firstNewIndex = this.tracks.length - 1;
            }
        });

        if (firstNewIndex !== -1) {
            this.selectTrack(firstNewIndex);
            if (window.populateTrackSelectors) {
                window.populateTrackSelectors();
            }
        }
    }

    getSpectrumBars() {
        if (!this.analyser || !this.isPlayingMusic) {
            return [15, 20, 12, 18, 14, 16, 12, 10];
        }
        this.analyser.getByteFrequencyData(this.freqData);
        const bars = [];
        for (let i = 0; i < 8; i++) {
            const val = this.freqData[i * 2] || 18;
            bars.push(Math.max(12, Math.min(100, Math.round((val / 255) * 100))));
        }
        return bars;
    }

    updateRadioUI() {
        const track = this.tracks[this.currentTrackIndex];
        if (!track) return;

        document.querySelectorAll('.js-track-title').forEach(el => { el.textContent = track.title; });
        document.querySelectorAll('.js-track-artist').forEach(el => { el.textContent = track.artist; });
        document.querySelectorAll('.js-track-genre').forEach(el => { el.textContent = track.genre; });
        document.querySelectorAll('.js-play-toggle').forEach(el => { el.textContent = this.isPlayingMusic ? '⏸' : '▶'; });
        document.querySelectorAll('.js-track-select').forEach(el => {
            if (el.value !== String(this.currentTrackIndex)) {
                el.value = String(this.currentTrackIndex);
            }
        });
    }
}

window.horizonAudio = new HorizonAudioManager();
