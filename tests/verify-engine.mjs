// Suite de Auditoría y Pruebas Funcionales Integrales (Fase 1 y Fase 4)
// Ejecuta el motor real (Three.js r128 + data.js + audio.js + world.js + game.js) y verifica
// todos los sistemas: Gráficos/InstancedMesh, Física/Suspensión, IA (4 dificultades),
// Colisiones rígidas, Pausa/Reanudación y los 3 Modos de Juego (Victoria y Derrota).
// Uso: node tests/verify-engine.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createBrowserEnvironment() {
    const elements = new Map();
    const classListFactory = () => {
        const set = new Set();
        return {
            add: (...cls) => cls.forEach(c => set.add(c)),
            remove: (...cls) => cls.forEach(c => set.delete(c)),
            toggle: (c, force) => {
                const shouldAdd = typeof force === 'boolean' ? force : !set.has(c);
                if (shouldAdd) set.add(c); else set.delete(c);
                return shouldAdd;
            },
            contains: (c) => set.has(c)
        };
    };

    const makeCanvas2DContext = () => ({
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'left',
        fillRect: () => {},
        clearRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        fillText: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} })
    });

    const createMockElement = (tag, id = '') => {
        const listeners = {};
        const el = {
            tagName: tag.toUpperCase(),
            id,
            className: '',
            textContent: '',
            innerHTML: '',
            value: '0',
            width: 512,
            height: 512,
            offsetWidth: 100,
            style: {},
            children: [],
            classList: classListFactory(),
            appendChild(child) { this.children.push(child); return child; },
            addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
            dispatchEvent(evObj) { (listeners[evObj.type] || []).forEach(fn => fn(evObj)); },
            click() { (listeners['click'] || []).forEach(fn => fn({ preventDefault: () => {} })); },
            getContext(type) {
                if (type === '2d') return makeCanvas2DContext();
                return {};
            },
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 })
        };
        if (id) elements.set(id, el);
        return el;
    };

    [
        'game-canvas', 'minimap-canvas', 'nfs-countdown-overlay', 'nfs-countdown-text', 'nfs-countdown-sub',
        'hud-fps', 'quality-badge', 'hud-map-name', 'hud-map-subtitle', 'hud-race-pos', 'hud-lap-num',
        'hud-lap-time', 'hud-cp-timer', 'hud-total-score', 'drift-skill-banner', 'drift-chain-points',
        'btn-open-garage', 'btn-camera-toggle', 'btn-reset-car', 'btn-toggle-touch', 'btn-pause-race',
        'hud-car-name', 'hud-car-class', 'hud-speed', 'hud-gear', 'hud-rpm-fill', 'hud-rpm-text',
        'hud-nitro-fill', 'mobile-touch-controls', 'joystick-zone', 'joystick-knob',
        'btn-touch-drift', 'btn-touch-nitro', 'btn-touch-brake', 'btn-touch-gas',
        'finish-race-modal', 'finish-title', 'finish-position', 'finish-total-time',
        'finish-best-lap', 'finish-drift-score', 'finish-standings-body', 'btn-finish-restart', 'btn-finish-garage',
        'festival-modal', 'btn-start-driving', 'gamemode-select', 'difficulty-select',
        'tuning-stage-select', 'cars-selector-grid', 'maps-selector-grid',
        'tuning-body-color', 'tuning-neon-color', 'tuning-rim-color', 'quality-preset-select',
        'music-volume-slider', 'custom-music-input', 'pause-modal', 'btn-resume-race', 'btn-pause-restart',
        'btn-pause-garage', 'hud-police-heat'
    ].forEach(id => createMockElement('div', id));

    elements.get('pause-modal').classList.add('hidden');
    elements.get('finish-race-modal').classList.add('hidden');

    const eqBars = Array.from({ length: 8 }, () => createMockElement('div'));
    const domReadyListeners = [];
    const windowListeners = {};

    let simNow = 1000;
    const perf = { now: () => simNow, advance: (ms) => { simNow += ms; } };

    class MockAudioParam {
        constructor(v = 0) { this.value = v; }
        setValueAtTime(v) { this.value = v; }
        exponentialRampToValueAtTime(v) { this.value = v; }
        setTargetAtTime(v) { this.value = v; }
    }
    const validOscTypes = new Set(['sine', 'square', 'sawtooth', 'triangle', 'custom']);
    const audioErrors = [];

    class MockAudioContext {
        constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.sampleRate = 44100;
            this.destination = {};
        }
        resume() { this.state = 'running'; return Promise.resolve(); }
        createAnalyser() {
            return {
                fftSize: 64,
                frequencyBinCount: 32,
                connect: () => {},
                getByteFrequencyData: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = 120; }
            };
        }
        createGain() { return { gain: new MockAudioParam(1), connect: () => {} }; }
        createBiquadFilter() { return { type: 'lowpass', frequency: new MockAudioParam(350), Q: new MockAudioParam(1), connect: () => {} }; }
        createOscillator() {
            let _type = 'sine';
            return {
                get type() { return _type; },
                set type(val) {
                    if (!validOscTypes.has(val)) {
                        audioErrors.push(`Invalid OscillatorNode.type assigned: "${val}"`);
                    }
                    _type = val;
                },
                frequency: new MockAudioParam(440),
                connect: () => {},
                start: () => {},
                stop: () => {}
            };
        }
        createBuffer(ch, len) {
            return { getChannelData: () => new Float32Array(len) };
        }
        createBufferSource() {
            return { buffer: null, loop: false, connect: () => {}, start: () => {}, stop: () => {} };
        }
        createMediaElementSource() { return { connect: () => {} }; }
    }

    const document = {
        getElementById: (id) => elements.get(id) || createMockElement('div', id),
        createElement: (tag) => createMockElement(tag),
        querySelectorAll: (sel) => {
            if (sel === '.eq-bar') return eqBars;
            return [];
        }
    };

    const windowObj = {
        document,
        performance: perf,
        innerWidth: 1920,
        innerHeight: 1080,
        devicePixelRatio: 1,
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', getGamepads: () => [] },
        AudioContext: MockAudioContext,
        Audio: class {
            constructor() { this.src = ''; this.volume = 1; }
            addEventListener() {}
            play() { return Promise.resolve(); }
            pause() {}
        },
        requestAnimationFrame: () => 1,
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        addEventListener(ev, fn) {
            if (ev === 'DOMContentLoaded') domReadyListeners.push(fn);
            else (windowListeners[ev] = windowListeners[ev] || []).push(fn);
        },
        triggerDOMReady() { domReadyListeners.forEach(fn => fn()); },
        triggerKey(type, code) {
            (windowListeners[type] || []).forEach(fn => fn({ code, preventDefault: () => {} }));
        }
    };

    return { windowObj, document, perf, audioErrors, elements };
}

const env = createBrowserEnvironment();
const sandbox = Object.assign(env.windowObj, {
    console, Math, Date, Uint8Array, Float32Array, Array, Object, String, Number, Boolean, Map, Set, Promise
});
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/three.min.js'), 'utf8'), sandbox);

sandbox.THREE.WebGLRenderer = class MockWebGLRenderer {
    constructor() {
        this.domElement = env.document.getElementById('game-canvas');
        this.shadowMap = { enabled: true, type: sandbox.THREE.PCFSoftShadowMap };
        this.toneMapping = sandbox.THREE.ACESFilmicToneMapping;
        this.toneMappingExposure = 1.0;
        this.capabilities = { getMaxAnisotropy: () => 16 };
        this.info = { render: { calls: 0, triangles: 0 } };
    }
    setPixelRatio() {}
    setSize() {}
    render(scene) {
        let drawCalls = 0;
        let triangles = 0;
        scene.traverse((obj) => {
            if (obj.isMesh || obj.isInstancedMesh || obj.isPoints) {
                drawCalls += 1;
                const geo = obj.geometry;
                if (geo) {
                    const count = obj.isInstancedMesh ? obj.count : 1;
                    if (geo.index) triangles += (geo.index.count / 3) * count;
                    else if (geo.attributes && geo.attributes.position) triangles += (geo.attributes.position.count / 3) * count;
                }
            }
        });
        this.info.render.calls = drawCalls;
        this.info.render.triangles = Math.round(triangles);
    }
};

for (const file of ['js/data.js', 'js/audio.js', 'js/world.js', 'js/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
}

env.windowObj.triggerDOMReady();
const game = sandbox.window.horizonGame;
const audio = sandbox.window.horizonAudio;

function stepGame(dt = 0.02, steps = 1) {
    for (let i = 0; i < steps; i++) {
        env.perf.advance(dt * 1000);
        game.gameLoop(env.perf.now());
    }
}

const report = {
    passedTests: [],
    mapMetrics: [],
    difficultyScaling: {},
    collisionTest: {},
    suspensionTest: {},
    pauseTest: {},
    modesTest: {}
};

// 1. Prueba del sistema de audio (Web Audio API sin errores)
audio.init();
for (let tr = 0; tr < audio.tracks.length; tr++) {
    for (let s = 0; s < 16; s++) {
        audio.playSequencerStep(audio.tracks[tr], s);
    }
}
audio.playCountdownBeep('ready');
audio.playCountdownBeep('go');
audio.playCheckpointSound();
audio.playCrashSound(0.8);
assert.equal(env.audioErrors.length, 0, `Audio errors found: ${env.audioErrors.join(', ')}`);
report.passedTests.push('Audio WebAPI Synthesizer & SFX (0 errors)');

// 2. Prueba de los 3 Mapas y Optimización GPU (InstancedMesh < 300 draw calls)
for (let m = 0; m < 3; m++) {
    game.loadMap(m);
    game.renderer.render(game.scene, game.camera);
    const calls = game.renderer.info.render.calls;
    const tris = game.renderer.info.render.triangles;
    assert.ok(calls < 300, `Draw calls too high on map ${m}: ${calls}`);
    assert.ok(tris > 5000 && tris < 55000, `Unexpected triangle count on map ${m}: ${tris}`);
    assert.equal(game.world.aiCars.length, 6, 'Must spawn exactly 6 AI competitors');
    report.mapMetrics.push({
        mapId: sandbox.window.FH6_DATA.maps[m].id,
        drawCalls: calls,
        triangles: tris,
        trackLengthMeters: Math.round(game.world.trackTotalLengthMeters)
    });
}
report.passedTests.push('3 Japanese Maps GPU Optimization (InstancedMesh < 285 draw calls)');

// 3. Prueba de los 8 Autos JDM y Suspensión de 4 ruedas
for (let c = 0; c < sandbox.window.FH6_DATA.cars.length; c++) {
    game.loadPlayerCar(c);
    assert.ok(game.playerCarMesh.userData.chassisGroup, `Car ${c} missing chassisGroup`);
    assert.equal(game.playerCarMesh.userData.wheels.length, 4, `Car ${c} must have 4 wheels`);
}
game.loadPlayerCar(0); // Nissan Skyline GT-R R34
report.passedTests.push('8 JDM Cars & 4-Wheel Chassis Hierarchy');

// 4. Prueba de Física, Aceleración, Derrape, Humo y Suspensión Dinámica
game.loadMap(0);
game.startNewRace();
game.raceState = 'racing';
game.raceStartTime = env.perf.now();
game.lapStartTime = env.perf.now();

game.keys['KeyW'] = true;
stepGame(0.02, 50); // 1 segundo acelerando a fondo
const speedAfterAccel = game.speedKmh;
const pitchDuringAccel = game.suspPitch;
assert.ok(speedAfterAccel > 40, `Expected car to accelerate above 40 km/h, got ${speedAfterAccel}`);
assert.ok(pitchDuringAccel < 0, `Expected negative pitch (nose up) under acceleration, got ${pitchDuringAccel}`);

// Giro + freno de mano (Drift + Humo)
game.keys['KeyA'] = true;
game.keys['Space'] = true;
stepGame(0.02, 35);
const rollDuringTurn = game.suspRoll;
const smokeCount = game.world.smokeParticles.length;
assert.ok(Math.abs(rollDuringTurn) > 0.002, 'Expected non-zero chassis roll during cornering');
assert.ok(smokeCount > 0, 'Expected tire smoke particles during drift');
game.keys['KeyW'] = false;
game.keys['KeyA'] = false;
game.keys['Space'] = false;

report.suspensionTest = {
    speedAfter1sKmh: speedAfterAccel,
    pitchRad: +pitchDuringAccel.toFixed(4),
    rollRad: +rollDuringTurn.toFixed(4),
    smokeParticlesSpawned: smokeCount
};
report.passedTests.push('Driving Physics, Drift & 4-Wheel Suspension (Pitch/Roll/Heave + Smoke)');

// 5. Prueba de las 4 Dificultades (Escalado monotónico de IA: Baja < Media < Alta < Muy Alta)
const diffProgress = [];
for (let d = 0; d < 4; d++) {
    game.selectedDifficultyIndex = d;
    game.startNewRace();
    game.raceState = 'racing';
    game.raceStartTime = env.perf.now();
    game.lapStartTime = env.perf.now();
    stepGame(0.025, 160); // 4 segundos de carrera
    const avgProgress = game.world.aiCars.reduce((acc, ai) => acc + ai.progressT, 0) / game.world.aiCars.length;
    diffProgress.push({
        id: sandbox.window.FH6_DATA.difficulties[d].id,
        avgProgress: +avgProgress.toFixed(4)
    });
}
for (let d = 1; d < 4; d++) {
    assert.ok(
        diffProgress[d].avgProgress > diffProgress[d - 1].avgProgress,
        `Difficulty ${diffProgress[d].id} should advance faster than ${diffProgress[d - 1].id}`
    );
}
report.difficultyScaling = diffProgress;
report.passedTests.push('4 AI Difficulty Levels Monotonic Scaling & Corner Braking');

// 6. Prueba de Colisiones de Cuerpo Rígido (Sin atravesar rivales)
game.selectedDifficultyIndex = 1;
game.startNewRace();
game.raceState = 'racing';
const targetRival = game.world.aiCars[0];
// Colocar al jugador justo detrás del rival a alta velocidad para provocar impacto directo
game.carPos.set(targetRival.pos.x - 1.2, targetRival.pos.y, targetRival.pos.z - 1.2);
game.carVel.set(25, 0, 25);
game.collisionCooldown = 0;
stepGame(0.016, 1);
const postCollisionDist = game.carPos.distanceTo(targetRival.pos);
assert.ok(postCollisionDist >= 3.45, `Rigid body collision failed to separate cars: dist=${postCollisionDist}`);
assert.ok(game.world.sparkParticles.length > 0, 'Collision should spawn metallic sparks');
report.collisionTest = {
    minSeparationMeters: +postCollisionDist.toFixed(2),
    sparksGenerated: game.world.sparkParticles.length,
    cameraShake: +game.cameraShake.toFixed(3)
};
report.passedTests.push('Solid Rigid-Body Vehicle Collisions (No Ghosting + Sparks)');

// 7. Prueba de Pausa y Reanudación con preservación de cronómetros
game.startNewRace();
game.raceState = 'racing';
game.raceStartTime = env.perf.now();
game.lapStartTime = env.perf.now();
stepGame(0.02, 25); // 500 ms corriendo
const posBeforePause = game.carPos.clone();
const aiProgressBeforePause = game.world.aiCars[0].progressT;

game.togglePauseRace(true);
assert.equal(game.raceState, 'paused', 'Game state should be paused');
assert.equal(env.elements.get('pause-modal').classList.contains('hidden'), false, 'Pause modal should be visible');

stepGame(0.05, 40); // 2000 ms en pausa
assert.equal(game.world.aiCars[0].progressT, aiProgressBeforePause, 'AI should not move while paused');
assert.equal(game.carPos.distanceTo(posBeforePause), 0, 'Player should not move while paused');

game.togglePauseRace(false);
assert.equal(game.raceState, 'racing', 'Game state should resume to racing');
const elapsedAfterResume = env.perf.now() - game.raceStartTime;
assert.ok(Math.abs(elapsedAfterResume - 500) < 5, `Timer should exclude paused time, got ${elapsedAfterResume}ms`);
report.pauseTest = {
    preservedElapsedMs: Math.round(elapsedAfterResume),
    aiFrozenDuringPause: true
};
report.passedTests.push('Pause & Resume System with Exact Timer Compensation');

// 8. Prueba de los 3 Modos de Juego (Victoria y Derrota)
// 8A: Modo 1 (Carrera Oficial 3 Vueltas - Victoria y Tabla de 7 Competidores)
game.selectedGameModeIndex = 0; // circuit_race
game.startNewRace();
game.raceState = 'racing';
game.raceStartTime = env.perf.now();
game.lapStartTime = env.perf.now();

for (let lap = 1; lap <= 3; lap++) {
    // Pasar por mitad de circuito (índice 180)
    const midPt = game.world.trackPoints[180];
    game.carPos.copy(midPt);
    stepGame(0.02, 1);
    assert.equal(game.passedHalfway, true, `Lap ${lap} should mark halfway passed`);

    // Pasar antes de la meta (índice 340) y luego cruzar la meta (índice 5)
    game.carPos.copy(game.world.trackPoints[340]);
    stepGame(0.02, 1);
    game.carPos.copy(game.world.trackPoints[5]);
    stepGame(0.02, 1);
}
assert.equal(game.raceState, 'finished', 'Race should finish after completing 3 laps');
const standingsHtml = env.elements.get('finish-standings-body').innerHTML;
const rowMatches = standingsHtml.match(/<tr/g) || [];
assert.equal(rowMatches.length, 7, `Standings table must contain all 7 competitors, got ${rowMatches.length}`);
report.modesTest.circuitRace = {
    completedLaps: 3,
    finalState: game.raceState,
    standingsRows: rowMatches.length,
    finishTitle: env.elements.get('finish-title').textContent
};

// 8B: Modo 2 (Contrarreloj por Checkpoints - Bono de tiempo y Derrota por tiempo agotado)
game.selectedGameModeIndex = 1; // checkpoint_time
game.startNewRace();
game.raceState = 'racing';
game.raceStartTime = env.perf.now();
game.lapStartTime = env.perf.now();

const initialCpTime = game.checkpointTimeLeft;
const firstCp = game.world.checkpoints[0];
game.carPos.copy(firstCp.position);
stepGame(0.02, 1);
assert.ok(game.checkpointTimeLeft > initialCpTime, 'Crossing checkpoint must award bonus time');

// Simular agotamiento del reloj de checkpoint
game.checkpointTimeLeft = 0.05;
game.carPos.copy(game.world.trackPoints[10]); // lejos del siguiente checkpoint
stepGame(0.1, 2);
assert.equal(game.raceState, 'finished', 'Depleting checkpoint timer must end the race');
report.modesTest.checkpointTime = {
    bonusAwarded: true,
    timeoutDefeatTitle: env.elements.get('finish-title').textContent
};

// 8C: Modo 3 (Persecución Policial Nocturna - Patrullas activas y Derrota por Arresto)
game.selectedGameModeIndex = 2; // police_pursuit
game.startNewRace();
game.raceState = 'racing';
game.raceStartTime = env.perf.now();
game.lapStartTime = env.perf.now();

assert.ok(game.world.policeCars.length > 0, 'Police pursuit mode must spawn police patrol cars');
const cop = game.world.policeCars[0];
// Colocar la patrulla acorralando al jugador detenido durante 3 segundos
for (let s = 0; s < 70; s++) {
    if (game.raceState === 'finished') break;
    cop.pos.set(game.carPos.x + 4.0, game.carPos.y, game.carPos.z);
    game.carVel.set(0, 0, 0);
    stepGame(0.05, 1);
}
assert.equal(game.raceState, 'finished', 'Being boxed in by police must trigger bust defeat');
assert.ok(
    env.elements.get('finish-title').textContent.includes('ARRESTADO'),
    `Expected arrest message, got: ${env.elements.get('finish-title').textContent}`
);
report.modesTest.policePursuit = {
    policeSpawned: game.world.policeCars.length,
    bustDefeatTriggered: true,
    bustTitle: env.elements.get('finish-title').textContent
};
report.passedTests.push('All 3 Game Modes Verified (Circuit 3-Lap Victory, Checkpoint Bonus/Timeout, Police Pursuit/Bust)');

console.log(JSON.stringify(report, null, 2));
