// ============================================================================
// MOTOR SIMCADE AVANZADO: COLISIONES REALES, IA (6 RIVALES), 3 VUELTAS Y TUNING
// ============================================================================

class HorizonGameEngine {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

        this.selectedCarIndex = 0;
        this.selectedMapIndex = 0;
        this.selectedDifficultyIndex = 1; // Media por defecto
        this.selectedGameModeIndex = 0;   // Carrera Oficial 3 Vueltas por defecto
        this.selectedTuningIndex = 0;     // Stage 1 por defecto

        this.maxLaps = 3;
        this.raceState = 'garage'; // 'garage' | 'countdown' | 'racing' | 'paused' | 'finished'
        this.cameraMode = 0;
        this.cameraShake = 0;
        this.pauseStartedAt = 0;

        // Estado físico del vehículo del jugador y suspensión de 4 ruedas
        this.carPos = new THREE.Vector3(0, 0, 0);
        this.carVel = new THREE.Vector3(0, 0, 0);
        this.carHeading = 0;
        this.visualDriftAngle = 0;
        this.speedKmh = 0;
        this.prevForwardSpeed = 0;
        this.suspPitch = 0;
        this.suspRoll = 0;
        this.suspHeave = 0;
        this.suspHeaveVel = 0;
        this.smokeAccum = 0;
        this.rpm = 1000;
        this.gear = 1;
        this.nitroAmount = 100;
        this.collisionCooldown = 0;

        // Progreso de carrera y tiempos
        this.lapCount = 1;
        this.playerProgressT = 0;
        this.playerTotalProgress = -0.016;
        this.crossedStartLine = false;
        this.passedHalfway = false;
        this.lastTrackIndex = 0;
        this.playerPositionRank = 7;
        this.raceStartTime = 0;
        this.lapStartTime = 0;
        this.bestLapMs = null;

        // Modo Contrarreloj por Checkpoints y Persecución Policial
        this.checkpointTimeLeft = 28.0;
        this.nextCheckpointIdx = 0;
        this.policeBustProgress = 0;

        // Puntuación de Drift
        this.totalSkillScore = 0;
        this.currentDriftChain = 0;
        this.driftMultiplier = 1.0;
        this.driftTimer = 0;

        // Controles (Teclado, Touch Android y Gamepad)
        this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
        this.keys = {};
        this.touchState = {
            gas: false,
            brake: false,
            drift: false,
            nitro: false,
            joystickSteer: 0,
            joystickActive: false
        };

        this.fps = 60;
        this.frameCount = 0;
        this.fpsLastTime = performance.now();
        this.qualityPreset = this.detectMobileDevice() ? 'mobile' : 'high';
        this.countdownTimers = [];

        this.initThreeJS();
        this.world = new window.HorizonWorldBuilder(this.scene, this.renderer);
        this.setupInputs();
        this.setupUIEvents();

        // Cargar escenario y auto inicial
        this.loadMap(this.selectedMapIndex);
        this.loadPlayerCar(this.selectedCarIndex);
        this.prepareStartingGrid();

        this.lastFrameTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    detectMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.innerWidth <= 920 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
    }

    initThreeJS() {
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2000);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: !this.detectMobileDevice(),
            powerPreference: 'high-performance'
        });

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.18;
        this.renderer.shadowMap.enabled = !this.detectMobileDevice();
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.applyQualityPreset(this.qualityPreset);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.45);
        this.dirLight.position.set(120, 240, 100);
        this.dirLight.castShadow = !this.detectMobileDevice();
        if (this.dirLight.castShadow) {
            this.dirLight.shadow.mapSize.width = 1024;
            this.dirLight.shadow.mapSize.height = 1024;
            this.dirLight.shadow.camera.near = 10;
            this.dirLight.shadow.camera.far = 750;
            this.dirLight.shadow.camera.left = -450;
            this.dirLight.shadow.camera.right = 450;
            this.dirLight.shadow.camera.top = 450;
            this.dirLight.shadow.camera.bottom = -450;
            this.dirLight.shadow.bias = -0.0006;
        }
        this.scene.add(this.dirLight);

        window.addEventListener('resize', () => this.onWindowResize());
    }

    applyQualityPreset(preset) {
        this.qualityPreset = preset;
        const dpr = window.devicePixelRatio || 1;
        if (preset === 'mobile') {
            this.renderer.setPixelRatio(Math.min(dpr, 1.15));
        } else if (preset === 'balanced') {
            this.renderer.setPixelRatio(Math.min(dpr, 1.5));
        } else {
            this.renderer.setPixelRatio(Math.min(dpr, 2.0));
        }
        const badge = document.getElementById('quality-badge');
        if (badge) {
            badge.textContent = preset === 'mobile' ? 'MODO MÓVIL ASTC' : (preset === 'balanced' ? 'EQUILIBRADO' : 'ULTRA HDR PC');
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    loadMap(index) {
        this.selectedMapIndex = index;
        const mapData = window.FH6_DATA.maps[index];
        if (!mapData) return;

        this.ambientLight.color.setHex(mapData.ambientColor);
        this.ambientLight.intensity = mapData.ambientIntensity;
        this.dirLight.color.setHex(mapData.sunColor);
        this.dirLight.intensity = mapData.sunIntensity;

        this.world.buildMap(mapData);
        this.prepareStartingGrid();

        const mapNameEl = document.getElementById('hud-map-name');
        const mapSubEl = document.getElementById('hud-map-subtitle');
        if (mapNameEl) mapNameEl.textContent = mapData.name;
        if (mapSubEl) {
            const diff = window.FH6_DATA.difficulties[this.selectedDifficultyIndex];
            const mode = window.FH6_DATA.gameModes[this.selectedGameModeIndex];
            mapSubEl.textContent = `${mode.shortName} • Dificultad: ${diff.name}`;
        }

        document.querySelectorAll('.map-card').forEach((card, idx) => {
            card.classList.toggle('active', idx === index);
        });
    }

    loadPlayerCar(index) {
        this.selectedCarIndex = index;
        const carData = window.FH6_DATA.cars[index];
        if (!carData) return;

        if (this.playerCarMesh) {
            this.scene.remove(this.playerCarMesh);
        }

        this.currentCarConfig = carData;
        this.playerCarMesh = this.world.createCarMesh(carData, false);
        this.scene.add(this.playerCarMesh);

        // Sincronizar selectores de color del taller de tuning
        const bodyPicker = document.getElementById('tuning-body-color');
        const neonPicker = document.getElementById('tuning-neon-color');
        const rimPicker = document.getElementById('tuning-rim-color');
        if (bodyPicker) bodyPicker.value = '#' + carData.color.toString(16).padStart(6, '0');
        if (neonPicker) neonPicker.value = '#' + carData.neonColor.toString(16).padStart(6, '0');
        if (rimPicker) rimPicker.value = '#' + carData.rimColor.toString(16).padStart(6, '0');

        const carNameEl = document.getElementById('hud-car-name');
        const carClassEl = document.getElementById('hud-car-class');
        if (carNameEl) carNameEl.textContent = carData.name;
        if (carClassEl) carClassEl.textContent = carData.classRating;

        document.querySelectorAll('.car-card').forEach((card, idx) => {
            card.classList.toggle('active', idx === index);
        });

        this.prepareStartingGrid();
    }

    // Coloca al jugador y a los 6 competidores en la Parrilla de Salida (Starting Grid)
    prepareStartingGrid() {
        if (!this.world.trackPoints.length || !this.currentCarConfig) return;

        const diffObj = window.FH6_DATA.difficulties[this.selectedDifficultyIndex];
        const modeObj = window.FH6_DATA.gameModes[this.selectedGameModeIndex];
        const policeCount = modeObj.id === 'police_pursuit' ? diffObj.policeCount : 0;

        this.world.setupStartingGridCompetitors(this.currentCarConfig.id, diffObj, policeCount);

        // Posicionar al jugador detrás de la fila de los 6 competidores en el centro de la parrilla
        const numPts = this.world.trackPoints.length;
        const playerStartIdx = numPts - 6;
        const p0 = this.world.trackPoints[playerStartIdx];
        const p1 = this.world.trackPoints[(playerStartIdx + 1) % numPts];
        const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();

        this.carPos.copy(p0);
        this.carVel.set(0, 0, 0);
        this.carHeading = Math.atan2(tangent.x, tangent.z);
        this.visualDriftAngle = 0;
        this.speedKmh = 0;
        this.prevForwardSpeed = 0;
        this.suspPitch = 0;
        this.suspRoll = 0;
        this.suspHeave = 0;
        this.suspHeaveVel = 0;
        this.nitroAmount = 100;

        this.lapCount = 1;
        this.playerProgressT = playerStartIdx / numPts;
        this.playerTotalProgress = (playerStartIdx - numPts) / numPts;
        this.crossedStartLine = false;
        this.passedHalfway = false;
        this.lastTrackIndex = playerStartIdx;
        this.playerPositionRank = 7;

        const diffCfg = window.FH6_DATA.difficulties[this.selectedDifficultyIndex] || window.FH6_DATA.difficulties[1];
        this.checkpointTimeLeft = 22.0 + diffCfg.checkpointBonusSec;
        this.nextCheckpointIdx = 0;
        this.policeBustProgress = 0;

        if (this.playerCarMesh) {
            this.playerCarMesh.position.copy(this.carPos);
            this.playerCarMesh.rotation.set(0, this.carHeading, 0);
            if (this.playerCarMesh.userData.chassisGroup) {
                this.playerCarMesh.userData.chassisGroup.position.set(0, 0, 0);
                this.playerCarMesh.userData.chassisGroup.rotation.set(0, 0, 0);
            }
        }
        this.updateCamera(0.1);
    }

    // Inicia la secuencia cinematográfica estilo Need For Speed: "PREPARADOS" -> "LISTOS" -> "¡VAMOS!"
    startNewRace() {
        window.horizonAudio.init();
        this.toggleGarageModal(false);
        this.hideFinishModal();
        this.hidePauseModal();

        this.countdownTimers.forEach(t => clearTimeout(t));
        this.countdownTimers = [];

        this.prepareStartingGrid();
        this.raceState = 'countdown';
        this.totalSkillScore = 0;
        this.currentDriftChain = 0;
        this.bestLapMs = null;

        const mapSubEl = document.getElementById('hud-map-subtitle');
        if (mapSubEl) {
            const diff = window.FH6_DATA.difficulties[this.selectedDifficultyIndex];
            const mode = window.FH6_DATA.gameModes[this.selectedGameModeIndex];
            mapSubEl.textContent = `${mode.shortName} • Dificultad: ${diff.name}`;
        }

        const overlay = document.getElementById('nfs-countdown-overlay');
        const textEl = document.getElementById('nfs-countdown-text');
        const subEl = document.getElementById('nfs-countdown-sub');

        if (!overlay || !textEl) {
            this.raceState = 'racing';
            this.raceStartTime = performance.now();
            this.lapStartTime = performance.now();
            return;
        }

        overlay.classList.remove('hidden');

        const triggerStage = (label, subtitle, cssClass, soundStage) => {
            textEl.className = 'nfs-countdown-word ' + cssClass;
            // Forzar reflow para reiniciar la transición CSS de escala/skew
            void textEl.offsetWidth;
            textEl.textContent = label;
            if (subEl) subEl.textContent = subtitle;
            window.horizonAudio.playCountdownBeep(soundStage);
        };

        // Paso 1: PREPARADOS
        triggerStage('PREPARADOS', 'PARRILLA DE 7 AUTOS • ACELERA PARA REVOLUCIONAR', 'stage-ready', 'ready');

        // Paso 2: LISTOS
        this.countdownTimers.push(setTimeout(() => {
            triggerStage('LISTOS', 'MANTÉN EL TURBO EN ZONA ÓPTIMA', 'stage-set', 'set');
        }, 1150));

        // Paso 3: ¡VAMOS! -> Arrancan los 7 autos
        this.countdownTimers.push(setTimeout(() => {
            const isPerfectLaunch = this.rpm >= 4800 && this.rpm <= 7800;
            triggerStage(
                '¡VAMOS!',
                isPerfectLaunch ? '🔥 ¡SALIDA TURBO PERFECTA! 🔥' : '🏁 ¡A POR EL 1º PUESTO EN 3 VUELTAS!',
                'stage-go',
                'go'
            );

            this.raceState = 'racing';
            this.raceStartTime = performance.now();
            this.lapStartTime = performance.now();

            // Impulso extra si revolucionó el motor en la salida
            if (isPerfectLaunch) {
                const forward = new THREE.Vector3(Math.sin(this.carHeading), 0, Math.cos(this.carHeading));
                this.carVel.addScaledVector(forward, 22);
            }
        }, 2300));

        // Ocultar cartel tras el arranque
        this.countdownTimers.push(setTimeout(() => {
            overlay.classList.add('hidden');
        }, 3250));
    }

    setupInputs() {
        window.addEventListener('keydown', (e) => {
            const code = e.code;
            this.keys[code] = true;
            window.horizonAudio.init();

            if (code === 'KeyC') {
                this.cameraMode = (this.cameraMode + 1) % 3;
            } else if (code === 'KeyR') {
                this.startNewRace();
            } else if (code === 'KeyM' || code === 'KeyN') {
                window.horizonAudio.nextTrack();
            } else if (code === 'KeyP') {
                this.togglePauseRace();
            } else if (code === 'KeyG') {
                this.toggleGarageModal();
            } else if (code === 'Escape') {
                if (this.raceState === 'racing' || this.raceState === 'paused') {
                    this.togglePauseRace();
                } else {
                    this.toggleGarageModal();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        const isMobile = this.detectMobileDevice();
        const touchControlsContainer = document.getElementById('mobile-touch-controls');
        if (isMobile && touchControlsContainer) {
            touchControlsContainer.classList.remove('hidden');
        }

        const bindTouchBtn = (id, prop) => {
            const el = document.getElementById(id);
            if (!el) return;
            const activate = (ev) => {
                ev.preventDefault();
                window.horizonAudio.init();
                this.touchState[prop] = true;
                el.classList.add('pressed');
            };
            const deactivate = (ev) => {
                ev.preventDefault();
                this.touchState[prop] = false;
                el.classList.remove('pressed');
            };
            el.addEventListener('touchstart', activate, { passive: false });
            el.addEventListener('touchend', deactivate, { passive: false });
            el.addEventListener('touchcancel', deactivate, { passive: false });
            el.addEventListener('mousedown', activate);
            el.addEventListener('mouseup', deactivate);
            el.addEventListener('mouseleave', deactivate);
        };

        bindTouchBtn('btn-touch-gas', 'gas');
        bindTouchBtn('btn-touch-brake', 'brake');
        bindTouchBtn('btn-touch-drift', 'drift');
        bindTouchBtn('btn-touch-nitro', 'nitro');

        const joyZone = document.getElementById('joystick-zone');
        const joyKnob = document.getElementById('joystick-knob');
        if (joyZone && joyKnob) {
            const maxRadius = 48;
            const handleMove = (clientX, clientY) => {
                const rect = joyZone.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                let dx = clientX - centerX;
                let dy = clientY - centerY;
                const dist = Math.hypot(dx, dy);
                if (dist > maxRadius) {
                    dx = (dx / dist) * maxRadius;
                    dy = (dy / dist) * maxRadius;
                }
                joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
                this.touchState.joystickSteer = -(dx / maxRadius);
            };

            const resetJoystick = () => {
                this.touchState.joystickActive = false;
                this.touchState.joystickSteer = 0;
                joyKnob.style.transform = 'translate(0px, 0px)';
            };

            joyZone.addEventListener('touchstart', (e) => {
                e.preventDefault();
                window.horizonAudio.init();
                this.touchState.joystickActive = true;
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: false });

            joyZone.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (!this.touchState.joystickActive) return;
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: false });

            joyZone.addEventListener('touchend', resetJoystick);
            joyZone.addEventListener('touchcancel', resetJoystick);
        }
    }

    pollInputs() {
        const keyGas = (this.keys['KeyW'] || this.keys['ArrowUp']) ? 1 : 0;
        const keyBrake = (this.keys['KeyS'] || this.keys['ArrowDown']) ? 1 : 0;
        const keyLeft = (this.keys['KeyA'] || this.keys['ArrowLeft']) ? 1 : 0;
        const keyRight = (this.keys['KeyD'] || this.keys['ArrowRight']) ? 1 : 0;
        const keyDrift = !!this.keys['Space'];
        const keyNitro = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

        let padGas = 0, padBrake = 0, padSteer = 0, padDrift = false, padNitro = false;
        if (navigator.getGamepads) {
            const pads = navigator.getGamepads();
            const pad = pads && pads[0];
            if (pad) {
                const axisX = pad.axes[0] || 0;
                if (Math.abs(axisX) > 0.12) padSteer = -axisX;
                if (pad.buttons[7]) padGas = pad.buttons[7].value;
                if (pad.buttons[6]) padBrake = pad.buttons[6].value;
                if (pad.buttons[0]) padDrift = pad.buttons[0].pressed;
                if (pad.buttons[1] || pad.buttons[2]) padNitro = pad.buttons[1]?.pressed || pad.buttons[2]?.pressed;
            }
        }

        this.input.throttle = Math.max(keyGas, this.touchState.gas ? 1 : 0, padGas);
        this.input.brake = Math.max(keyBrake, this.touchState.brake ? 1 : 0, padBrake);

        let steerVal = keyLeft - keyRight;
        if (this.touchState.joystickActive) {
            steerVal = this.touchState.joystickSteer;
        } else if (Math.abs(padSteer) > 0.05) {
            steerVal = padSteer;
        }

        this.input.steer = Math.max(-1, Math.min(1, steerVal));
        this.input.handbrake = keyDrift || this.touchState.drift || padDrift;
        this.input.nitro = keyNitro || this.touchState.nitro || padNitro;
    }

    // Resuelve las colisiones físicas reales (Rigid Body Separation + Momentum Transfer)
    // Ningún auto traspasa a otro como fantasma.
    resolveVehicleCollisions(dt) {
        if (this.collisionCooldown > 0) {
            this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
        }

        const allTrackCars = [...this.world.aiCars, ...this.world.policeCars];
        const minCarDist = 3.55; // Radio combinado de colisión sólida entre carrocerías

        // 1. Colisión Jugador <-> Competidores IA y Patrullas Policiales
        allTrackCars.forEach((ai) => {
            const dx = this.carPos.x - ai.pos.x;
            const dz = this.carPos.z - ai.pos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < minCarDist * minCarDist && distSq > 0.0001) {
                const dist = Math.sqrt(distSq);
                const overlap = minCarDist - dist;
                const nx = dx / dist;
                const nz = dz / dist;

                // Separación inmediata de cuerpos rígidos (impide atravesar al rival)
                this.carPos.x += nx * overlap * 0.65;
                this.carPos.z += nz * overlap * 0.65;
                ai.pos.x -= nx * overlap * 0.35;
                ai.pos.z -= nz * overlap * 0.35;
                ai.mesh.position.copy(ai.pos);

                // Velocidad relativa en la normal de impacto
                const relVx = this.carVel.x - ai.vel.x;
                const relVz = this.carVel.z - ai.vel.z;
                const impactSpeed = relVx * nx + relVz * nz;

                if (impactSpeed < 0) {
                    const restitution = 0.55; // Elasticidad metálica realista
                    const impulse = -(1 + restitution) * impactSpeed;

                    this.carVel.x += nx * impulse * 0.68;
                    this.carVel.z += nz * impulse * 0.68;

                    // Empujar también al auto rival IA lateral y longitudinalmente
                    const trackInfo = this.world.getClosestTrackInfo(ai.pos);
                    if (trackInfo) {
                        const sidePush = -(nx * trackInfo.right.x + nz * trackInfo.right.z) * Math.min(4.5, impulse * 0.25);
                        ai.laneOffset = THREE.MathUtils.clamp(ai.laneOffset + sidePush, -this.world.roadWidth * 0.42, this.world.roadWidth * 0.42);
                    }
                    ai.currentSpeedMs = Math.max(8, ai.currentSpeedMs - Math.abs(impactSpeed) * 0.22);

                    // Si es una patrulla policial en Modo Persecución, incrementa el medidor de arresto al embestir
                    if (ai.isPolice) {
                        this.policeBustProgress = Math.min(100, this.policeBustProgress + 8.5);
                    }

                    // Efectos visuales y sonoros de choque real
                    if (this.collisionCooldown <= 0 && Math.abs(impactSpeed) > 3.5) {
                        const contactPt = new THREE.Vector3(
                            (this.carPos.x + ai.pos.x) * 0.5,
                            this.carPos.y + 0.5,
                            (this.carPos.z + ai.pos.z) * 0.5
                        );
                        this.world.spawnCollisionSparks(contactPt);
                        const intensity = Math.min(1.0, Math.abs(impactSpeed) / 28);
                        window.horizonAudio.playCrashSound(intensity);
                        this.cameraShake = Math.min(0.65, intensity * 0.55);
                        this.collisionCooldown = 0.16;
                    }
                }
            }
        });

        // 2. Colisión entre Competidores IA entre sí (evita que se superpongan)
        for (let i = 0; i < allTrackCars.length; i++) {
            for (let j = i + 1; j < allTrackCars.length; j++) {
                const a = allTrackCars[i];
                const b = allTrackCars[j];
                const dx = a.pos.x - b.pos.x;
                const dz = a.pos.z - b.pos.z;
                const dSq = dx * dx + dz * dz;
                if (dSq < 11.0 && dSq > 0.001) {
                    const diffLane = a.laneOffset - b.laneOffset;
                    const push = (diffLane >= 0 ? 1 : -1) * 3.5 * dt;
                    a.laneOffset = THREE.MathUtils.clamp(a.laneOffset + push, -this.world.roadWidth * 0.42, this.world.roadWidth * 0.42);
                    b.laneOffset = THREE.MathUtils.clamp(b.laneOffset - push, -this.world.roadWidth * 0.42, this.world.roadWidth * 0.42);
                }
            }
        }
    }

    updatePhysics(dt) {
        if (!this.currentCarConfig || !this.playerCarMesh) return;
        this.pollInputs();

        const phys = this.currentCarConfig.physics;
        const tuning = window.FH6_DATA.tuningStages[this.selectedTuningIndex] || window.FH6_DATA.tuningStages[0];

        // Si estamos en el conteo "PREPARADOS, LISTOS", en pausa o en menú, no avanzar física
        if (this.raceState === 'countdown' || this.raceState === 'garage' || this.raceState === 'paused' || this.raceState === 'finished') {
            if (this.input.throttle > 0 && this.raceState === 'countdown') {
                this.rpm = Math.min(phys.redlineRpm, this.rpm + 6500 * dt);
            } else {
                this.rpm = Math.max(1050, this.rpm - 4200 * dt);
            }
            window.horizonAudio.updateEngine(
                this.rpm,
                phys.redlineRpm,
                this.input.throttle > 0 && this.raceState === 'countdown',
                false,
                phys.engineBaseFreq,
                this.raceState !== 'countdown',
                null
            );
            this.updateCamera(dt);
            return;
        }

        const tunedMaxSpeedKmh = phys.maxSpeedKmh + tuning.speedBonus;
        const maxSpeedMs = tunedMaxSpeedKmh / 3.6;

        const forward = new THREE.Vector3(Math.sin(this.carHeading), 0, Math.cos(this.carHeading));
        const right = new THREE.Vector3(Math.cos(this.carHeading), 0, -Math.sin(this.carHeading));

        let forwardSpeed = this.carVel.dot(forward);

        // Nitro boost + Llamaradas de escape
        let nitroBoost = 1.0;
        const usingNitro = this.input.nitro && this.nitroAmount > 1 && this.input.throttle > 0.1;
        if (usingNitro) {
            nitroBoost = 1.38;
            this.nitroAmount = Math.max(0, this.nitroAmount - dt * 26);
        } else {
            this.nitroAmount = Math.min(100, this.nitroAmount + dt * 9.5);
        }

        if (this.playerCarMesh.userData.flameMat) {
            this.playerCarMesh.userData.flameMat.opacity = usingNitro ? (0.65 + Math.random() * 0.35) : 0.0;
        }

        // Aceleración y Frenado con Tuning aplicado
        if (this.input.throttle > 0) {
            const speedRatio = Math.max(0, forwardSpeed / maxSpeedMs);
            const torqueCurve = Math.max(0.20, 1.0 - Math.pow(speedRatio, 1.65));
            const accel = phys.accelForce * tuning.accelMult * this.input.throttle * torqueCurve * nitroBoost;
            this.carVel.addScaledVector(forward, accel * dt);
        }

        if (this.input.brake > 0) {
            if (forwardSpeed > 1.5) {
                this.carVel.addScaledVector(forward, -phys.brakeForce * this.input.brake * dt);
            } else {
                this.carVel.addScaledVector(forward, -phys.accelForce * 0.45 * this.input.brake * dt);
            }
        }

        if (this.input.handbrake && forwardSpeed > 8) {
            this.carVel.multiplyScalar(1.0 - 0.52 * dt);
        }

        this.carVel.multiplyScalar(1.0 - 0.17 * dt);

        const currentSpeedMs = this.carVel.length();
        const effectiveMaxMs = maxSpeedMs * (nitroBoost > 1 ? 1.08 : 1.0);
        if (currentSpeedMs > effectiveMaxMs) {
            this.carVel.multiplyScalar(effectiveMaxMs / currentSpeedMs);
        }

        // Giro Simcade y Derrape
        const speedFactor = Math.min(1.0, currentSpeedMs / 8.5);
        const reverseSign = forwardSpeed >= -0.5 ? 1 : -1;
        const turnRate = phys.turnSpeed * tuning.handlingMult * this.input.steer * speedFactor * reverseSign;

        if (this.input.handbrake && currentSpeedMs > 12) {
            this.carHeading += turnRate * 1.34 * dt;
        } else {
            this.carHeading += turnRate * dt;
        }

        const newForward = new THREE.Vector3(Math.sin(this.carHeading), 0, Math.cos(this.carHeading));
        const newRight = new THREE.Vector3(Math.cos(this.carHeading), 0, -Math.sin(this.carHeading));

        const vForward = this.carVel.dot(newForward);
        const vLateral = this.carVel.dot(newRight);

        const isDrifting = (this.input.handbrake && currentSpeedMs > 12) || (Math.abs(vLateral) > 5.0 && currentSpeedMs > 18);
        const gripCoeff = isDrifting ? Math.max(0.65, phys.gripDrift - tuning.driftBonus) : phys.gripNormal;
        const dampedLateral = vLateral * Math.pow(1.0 - gripCoeff, dt * 10);

        this.carVel.copy(newForward).multiplyScalar(vForward).addScaledVector(newRight, dampedLateral);
        this.carPos.addScaledVector(this.carVel, dt);

        // Resolver colisiones reales con los 6 competidores y patrullas
        this.resolveVehicleCollisions(dt);

        // Mantener dentro de los límites de la pista y calcular vuelta / progreso
        const trackInfo = this.world.getClosestTrackInfo(this.carPos);
        let curbVibrationY = 0;
        let curbRollZ = 0;
        if (trackInfo) {
            this.carPos.y = THREE.MathUtils.lerp(this.carPos.y, trackInfo.point.y + 0.08, 0.38);

            // Vibración física y visual al pisar los Pianos 3D (Rumble Strips)
            const absLat = Math.abs(trackInfo.lateralOffset);
            if (absLat > this.world.roadWidth * 0.40 && currentSpeedMs > 5) {
                const freq = performance.now() * 0.055;
                curbVibrationY = Math.sin(freq) * 0.045 * Math.min(1, currentSpeedMs / 35);
                curbRollZ = Math.cos(freq) * 0.022 * Math.sign(trackInfo.lateralOffset);
            }

            const maxOffset = this.world.roadWidth * 0.46;
            if (Math.abs(trackInfo.lateralOffset) > maxOffset) {
                const sign = Math.sign(trackInfo.lateralOffset);
                const correction = Math.abs(trackInfo.lateralOffset) - maxOffset;
                this.carPos.addScaledVector(trackInfo.right, -sign * correction);
                this.carVel.multiplyScalar(0.95);
            }

            this.playerProgressT = trackInfo.progressT;
            if (trackInfo.index < 60 && this.lastTrackIndex > 300) {
                this.crossedStartLine = true;
            } else if (trackInfo.index >= 4 && trackInfo.index < 180) {
                this.crossedStartLine = true;
            }

            // Verificar paso por mitad de circuito para validar vuelta completa
            if (trackInfo.index > 150 && trackInfo.index < 210) {
                this.passedHalfway = true;
            }
            if (this.passedHalfway && trackInfo.index < 24 && this.lastTrackIndex > 325) {
                const now = performance.now();
                const lapTime = now - this.lapStartTime;
                if (!this.bestLapMs || lapTime < this.bestLapMs) {
                    this.bestLapMs = lapTime;
                }
                this.lapStartTime = now;
                this.passedHalfway = false;

                if (this.lapCount >= this.maxLaps) {
                    // ¡FIN DE LAS 3 VUELTAS!
                    this.lapCount = this.maxLaps;
                    this.playerTotalProgress = this.maxLaps + this.playerProgressT;
                    this.calculateRacePosition();
                    this.finishRace(true);
                    return;
                } else {
                    this.lapCount++;
                    window.horizonAudio.playCheckpointSound();
                }
            }
            this.lastTrackIndex = trackInfo.index;

            // Modo Contrarreloj por Checkpoints
            const modeObj = window.FH6_DATA.gameModes[this.selectedGameModeIndex];
            if (modeObj.id === 'checkpoint_time' && this.world.checkpoints.length > 0) {
                this.checkpointTimeLeft = Math.max(0, this.checkpointTimeLeft - dt);
                const targetCp = this.world.checkpoints[this.nextCheckpointIdx];
                if (targetCp) {
                    const numPts = this.world.trackPoints.length;
                    const idxDiff = Math.min(
                        Math.abs(trackInfo.index - targetCp.index),
                        numPts - Math.abs(trackInfo.index - targetCp.index)
                    );
                    if (idxDiff <= 10) {
                        const diffObj = window.FH6_DATA.difficulties[this.selectedDifficultyIndex];
                        this.checkpointTimeLeft += diffObj.checkpointBonusSec;
                        this.nextCheckpointIdx = (this.nextCheckpointIdx + 1) % this.world.checkpoints.length;
                        window.horizonAudio.playCheckpointSound();
                    }
                }
                if (this.checkpointTimeLeft <= 0) {
                    this.finishRace(false, '⏱️ ¡TIEMPO AGOTADO EN EL CHECKPOINT!');
                    return;
                }
            }
        }

        // Calcular posición en tiempo real (1º a 7º puesto)
        this.calculateRacePosition();

        // Calcular KM/H, Marcha y RPM
        this.speedKmh = Math.round(this.carVel.length() * 3.6);
        const gearRatios = [0, 62, 114, 168, 224, 282, 380];
        let calculatedGear = 1;
        for (let g = 1; g <= phys.gears; g++) {
            if (this.speedKmh >= gearRatios[g - 1]) {
                calculatedGear = g;
            }
        }
        this.gear = vForward < -1.5 ? 'R' : (this.speedKmh < 2 && this.input.throttle === 0 ? 'N' : calculatedGear);

        const gearMin = gearRatios[(calculatedGear - 1)] || 0;
        const gearMax = gearRatios[calculatedGear] || 355;
        const inGearProgress = Math.max(0, Math.min(1, (this.speedKmh - gearMin) / Math.max(1, gearMax - gearMin)));
        this.rpm = Math.round(1100 + inGearProgress * (phys.redlineRpm - 1100));

        // Puntos de Habilidad / Drift + Partículas de Humo de Neumáticos
        const targetDriftAngle = THREE.MathUtils.clamp(-vLateral * 0.032, -0.42, 0.42);
        this.visualDriftAngle = THREE.MathUtils.lerp(this.visualDriftAngle, targetDriftAngle, dt * 8);

        if (isDrifting && this.speedKmh > 45) {
            this.currentDriftChain += Math.round((this.speedKmh * 1.8 + Math.abs(vLateral) * 25) * dt);
            this.driftMultiplier = Math.min(5.0, +(1.0 + Math.floor(this.currentDriftChain / 800) * 0.5).toFixed(1));
            this.driftTimer = 1.8;

            this.smokeAccum += dt;
            if (this.smokeAccum >= 0.045) {
                this.smokeAccum = 0;
                this.world.spawnTireSmoke(this.carPos, newRight, this.currentCarConfig.dimensions.width);
            }
        } else if (this.driftTimer > 0) {
            this.driftTimer -= dt;
            if (this.driftTimer <= 0 && this.currentDriftChain > 0) {
                this.totalSkillScore += Math.round(this.currentDriftChain * this.driftMultiplier);
                this.currentDriftChain = 0;
                this.driftMultiplier = 1.0;
            }
        }

        // Dinámica de Suspensión de 4 Ruedas (Cabeceo / Pitch, Balanceo / Roll y Compresión Vertical / Heave)
        const safeDt = Math.max(0.004, dt);
        const longAccel = THREE.MathUtils.clamp((vForward - this.prevForwardSpeed) / safeDt, -38, 38);
        this.prevForwardSpeed = vForward;

        // Cabeceo: al acelerar el morro sube ligeramente (-X en este sistema donde +Z es adelante), al frenar se hunde (+X)
        const targetPitch = THREE.MathUtils.clamp(-longAccel * 0.0014, -0.042, 0.048);
        this.suspPitch = THREE.MathUtils.lerp(this.suspPitch, targetPitch, Math.min(1, dt * 10));

        // Balanceo lateral en curva + vibración sobre pianos 3D
        const targetRoll = THREE.MathUtils.clamp(-this.input.steer * 0.042 * speedFactor + vLateral * 0.0025, -0.065, 0.065) + curbRollZ;
        this.suspRoll = THREE.MathUtils.lerp(this.suspRoll, targetRoll, Math.min(1, dt * 12));

        // Resorte-amortiguador vertical (Heave)
        const curbImpulse = curbVibrationY * 18.0;
        const springForce = -135.0 * this.suspHeave - 15.5 * this.suspHeaveVel + curbImpulse;
        this.suspHeaveVel += springForce * dt;
        this.suspHeave = THREE.MathUtils.clamp(this.suspHeave + this.suspHeaveVel * dt, -0.06, 0.06);

        // Actualizar transformación del modelo 3D y sub-jerarquía del chasis suspendido
        this.playerCarMesh.position.set(this.carPos.x, this.carPos.y, this.carPos.z);
        this.playerCarMesh.rotation.set(0, this.carHeading + this.visualDriftAngle, 0);

        const chassisGroup = this.playerCarMesh.userData.chassisGroup;
        if (chassisGroup) {
            chassisGroup.position.y = this.suspHeave + curbVibrationY * 0.5;
            chassisGroup.rotation.x = this.suspPitch;
            chassisGroup.rotation.z = this.suspRoll;
        } else {
            this.playerCarMesh.rotation.z = this.suspRoll;
        }

        const wheels = this.playerCarMesh.userData.wheels;
        if (wheels && wheels.length === 4) {
            wheels.forEach((w, idx) => {
                w.children.forEach(c => { c.rotation.x += currentSpeedMs * dt * 2.2; });
                if (idx < 2) {
                    w.rotation.y = this.input.steer * 0.38;
                }
            });
        }

        if (this.playerCarMesh.userData.brakeMat) {
            this.playerCarMesh.userData.brakeMat.color.setHex(
                (this.input.brake > 0 || this.input.handbrake) ? 0xff1e1e : 0x991b1b
            );
        }

        this.updateCamera(dt);

        // Distancia a la patrulla policial más cercana y lógica del modo Persecución Policial Nocturna
        let minCopDist = null;
        if (this.world.policeCars.length > 0) {
            minCopDist = Infinity;
            this.world.policeCars.forEach(cop => {
                const d = this.carPos.distanceTo(cop.pos);
                if (d < minCopDist) minCopDist = d;
            });

            const modeObj = window.FH6_DATA.gameModes[this.selectedGameModeIndex];
            if (modeObj && modeObj.id === 'police_pursuit') {
                // Si una patrulla acorrala al jugador a baja velocidad, sube el medidor de arresto
                if (minCopDist < 11.5 && this.speedKmh < 55) {
                    const proximityFactor = 1.0 + (11.5 - minCopDist) * 0.12;
                    this.policeBustProgress = Math.min(100, this.policeBustProgress + 34.0 * proximityFactor * dt);
                } else if (minCopDist > 16.0 || this.speedKmh > 85) {
                    this.policeBustProgress = Math.max(0, this.policeBustProgress - 15.0 * dt);
                }

                if (this.policeBustProgress >= 100) {
                    this.finishRace(false, '🚨 ¡ARRESTADO POR LA POLICÍA DE TOKIO!');
                    return;
                }
            }
        }

        window.horizonAudio.updateEngine(
            this.rpm,
            phys.redlineRpm,
            this.input.throttle > 0,
            isDrifting,
            phys.engineBaseFreq,
            false,
            minCopDist
        );
    }

    calculateRacePosition() {
        let lapFraction = this.playerProgressT;
        if (this.lapCount === 1 && !this.crossedStartLine && this.playerProgressT > 0.75) {
            lapFraction = this.playerProgressT - 1.0;
        }
        this.playerTotalProgress = (this.lapCount - 1) + lapFraction;

        let rank = 1;
        this.world.aiCars.forEach(ai => {
            if (ai.progressT > this.playerTotalProgress) {
                rank++;
            }
        });
        this.playerPositionRank = rank;
    }

    finishRace(completedAllLaps = true, customReason = '') {
        this.raceState = 'finished';
        const totalRaceMs = Math.max(100, performance.now() - this.raceStartTime);

        const modal = document.getElementById('finish-race-modal');
        const titleEl = document.getElementById('finish-title');
        const posEl = document.getElementById('finish-position');
        const timeEl = document.getElementById('finish-total-time');
        const bestLapEl = document.getElementById('finish-best-lap');
        const driftEl = document.getElementById('finish-drift-score');
        const standingsBody = document.getElementById('finish-standings-body');

        if (modal) modal.classList.remove('hidden');

        // Construir tabla oficial de clasificación de los 7 competidores
        const entries = [];
        entries.push({
            isPlayer: true,
            name: `TÚ (${this.currentCarConfig ? this.currentCarConfig.name : 'Piloto'})`,
            progress: completedAllLaps ? (this.maxLaps + 0.001) : this.playerTotalProgress,
            timeMs: totalRaceMs,
            statusText: completedAllLaps ? this.formatTimeMs(totalRaceMs) : 'DNF'
        });

        this.world.aiCars.forEach((ai) => {
            let aiTimeMs = ai.finishTimeMs;
            if (!aiTimeMs) {
                const progressRatio = Math.max(0.25, ai.progressT / Math.max(0.5, this.maxLaps));
                aiTimeMs = totalRaceMs / progressRatio;
            }
            entries.push({
                isPlayer: false,
                name: `${ai.name} (${ai.classRating || 'S1'})`,
                progress: ai.finished ? (this.maxLaps + (totalRaceMs - aiTimeMs) * 0.00001) : ai.progressT,
                timeMs: aiTimeMs,
                statusText: this.formatTimeMs(aiTimeMs)
            });
        });

        entries.sort((a, b) => b.progress - a.progress);

        const playerRankIndex = entries.findIndex(e => e.isPlayer);
        if (playerRankIndex !== -1) {
            this.playerPositionRank = playerRankIndex + 1;
        }

        if (standingsBody) {
            standingsBody.innerHTML = entries.map((entry, idx) => `
                <tr class="${entry.isPlayer ? 'is-player' : ''}">
                    <td>${idx + 1}º</td>
                    <td>${entry.name}</td>
                    <td>${entry.statusText}</td>
                </tr>
            `).join('');
        }

        if (titleEl) {
            if (!completedAllLaps) {
                titleEl.textContent = customReason || '⏱️ FIN DE LA PRUEBA';
            } else if (this.playerPositionRank === 1) {
                titleEl.textContent = '🏆 ¡VICTORIA EN HORIZON JAPÓN! 🏆';
            } else if (this.playerPositionRank <= 3) {
                titleEl.textContent = `🥈 ¡PODIO CONSEGUIDO (${this.playerPositionRank}º PUESTO)!`;
            } else {
                titleEl.textContent = `🏁 CARRERA COMPLETADA (${this.playerPositionRank}º DE 7)`;
            }
        }
        if (posEl) posEl.textContent = `${this.playerPositionRank}º / 7`;
        if (timeEl) timeEl.textContent = this.formatTimeMs(totalRaceMs);
        if (bestLapEl) bestLapEl.textContent = this.bestLapMs ? this.formatTimeMs(this.bestLapMs) : this.formatTimeMs(totalRaceMs / 3);
        if (driftEl) driftEl.textContent = `${(this.totalSkillScore + this.currentDriftChain).toLocaleString()} PTS`;
    }

    hideFinishModal() {
        const modal = document.getElementById('finish-race-modal');
        if (modal) modal.classList.add('hidden');
    }

    hidePauseModal() {
        const modal = document.getElementById('pause-modal');
        if (modal) modal.classList.add('hidden');
    }

    togglePauseRace(forcePause) {
        const modal = document.getElementById('pause-modal');
        if (this.raceState !== 'racing' && this.raceState !== 'paused') return;

        const wantPause = typeof forcePause === 'boolean' ? forcePause : (this.raceState === 'racing');
        if (wantPause && this.raceState === 'racing') {
            this.raceState = 'paused';
            this.pauseStartedAt = performance.now();
            if (modal) modal.classList.remove('hidden');
            if (this.currentCarConfig) {
                window.horizonAudio.updateEngine(1050, this.currentCarConfig.physics.redlineRpm, false, false, this.currentCarConfig.physics.engineBaseFreq, true, null);
            }
        } else if (!wantPause && this.raceState === 'paused') {
            const pausedDuration = Math.max(0, performance.now() - this.pauseStartedAt);
            this.raceStartTime += pausedDuration;
            this.lapStartTime += pausedDuration;
            this.raceState = 'racing';
            if (modal) modal.classList.add('hidden');
        }
    }

    updateCamera(dt) {
        if (!this.playerCarMesh) return;

        const heading = this.carHeading;
        const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));

        if (this.cameraMode === 2) {
            const hoodPos = new THREE.Vector3().copy(this.carPos)
                .add(new THREE.Vector3(0, 1.38, 0))
                .addScaledVector(forward, 0.65);
            this.camera.position.copy(hoodPos);
            const lookTarget = new THREE.Vector3().copy(hoodPos).addScaledVector(forward, 35);
            this.camera.lookAt(lookTarget);
        } else {
            const distBack = this.cameraMode === 0 ? 6.6 : 9.0;
            const heightUp = this.cameraMode === 0 ? 2.55 : 3.5;

            const desiredCamPos = new THREE.Vector3().copy(this.carPos)
                .addScaledVector(forward, -distBack)
                .add(new THREE.Vector3(0, heightUp, 0));

            this.camera.position.lerp(desiredCamPos, Math.min(1, dt * 11));

            // Sacudida de cámara en colisiones reales
            if (this.cameraShake > 0.01) {
                this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
                this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
                this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);
            }

            const lookAtPos = new THREE.Vector3().copy(this.carPos)
                .addScaledVector(forward, 5.5)
                .add(new THREE.Vector3(0, 1.0, 0));
            this.camera.lookAt(lookAtPos);
        }

        const targetFov = 60 + Math.min(20, (this.speedKmh / 340) * 18);
        if (Math.abs(this.camera.fov - targetFov) > 0.2) {
            this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, dt * 5);
            this.camera.updateProjectionMatrix();
        }
    }

    updateHUD() {
        const speedEl = document.getElementById('hud-speed');
        const gearEl = document.getElementById('hud-gear');
        const rpmBarEl = document.getElementById('hud-rpm-fill');
        const rpmTextEl = document.getElementById('hud-rpm-text');
        const nitroBarEl = document.getElementById('hud-nitro-fill');

        if (speedEl) speedEl.textContent = String(this.speedKmh).padStart(3, '0');
        if (gearEl) gearEl.textContent = this.gear;

        if (rpmBarEl && this.currentCarConfig) {
            const pct = Math.min(100, Math.round((this.rpm / this.currentCarConfig.physics.redlineRpm) * 100));
            rpmBarEl.style.width = `${pct}%`;
            rpmBarEl.classList.toggle('redline', pct > 86);
        }
        if (rpmTextEl) rpmTextEl.textContent = `${this.rpm} RPM`;
        if (nitroBarEl) nitroBarEl.style.width = `${Math.round(this.nitroAmount)}%`;

        const skillBanner = document.getElementById('drift-skill-banner');
        const skillPointsEl = document.getElementById('drift-chain-points');
        const totalScoreEl = document.getElementById('hud-total-score');

        if (skillBanner && skillPointsEl) {
            if (this.currentDriftChain > 40) {
                skillBanner.classList.remove('hidden');
                skillPointsEl.textContent = `${this.currentDriftChain.toLocaleString()} PTS × ${this.driftMultiplier}x`;
            } else {
                skillBanner.classList.add('hidden');
            }
        }
        if (totalScoreEl) {
            totalScoreEl.textContent = this.totalSkillScore.toLocaleString();
        }

        const lapTimeEl = document.getElementById('hud-lap-time');
        const lapNumEl = document.getElementById('hud-lap-num');
        const posEl = document.getElementById('hud-race-pos');
        const cpTimerPill = document.getElementById('hud-cp-timer');
        const policeHeatPill = document.getElementById('hud-police-heat');

        if (lapTimeEl) {
            let elapsed = 0;
            if (this.raceState === 'racing') {
                elapsed = performance.now() - this.lapStartTime;
            } else if (this.raceState === 'paused') {
                elapsed = this.pauseStartedAt - this.lapStartTime;
            }
            lapTimeEl.textContent = this.formatTimeMs(Math.max(0, elapsed));
        }
        if (lapNumEl) {
            lapNumEl.textContent = `VUELTA ${this.lapCount} / ${this.maxLaps}`;
        }
        if (posEl) {
            posEl.textContent = `POS ${this.playerPositionRank} / 7`;
        }
        const modeObj = window.FH6_DATA.gameModes[this.selectedGameModeIndex];
        if (cpTimerPill) {
            if (modeObj && modeObj.id === 'checkpoint_time') {
                cpTimerPill.classList.remove('hidden');
                cpTimerPill.textContent = `⏱️ CHECKPOINT: ${this.checkpointTimeLeft.toFixed(1)}s`;
            } else {
                cpTimerPill.classList.add('hidden');
            }
        }
        if (policeHeatPill) {
            if (modeObj && modeObj.id === 'police_pursuit') {
                policeHeatPill.classList.remove('hidden');
                policeHeatPill.textContent = `🚨 PERSECUCIÓN • ARRESTO: ${Math.round(this.policeBustProgress)}%`;
            } else {
                policeHeatPill.classList.add('hidden');
            }
        }

        const bars = window.horizonAudio.getSpectrumBars();
        document.querySelectorAll('.eq-bar').forEach((b, i) => {
            b.style.height = `${bars[i] || 15}%`;
        });

        this.drawMinimap();
    }

    formatTimeMs(ms) {
        const totalSec = ms / 1000;
        const mins = Math.floor(totalSec / 60);
        const secs = Math.floor(totalSec % 60);
        const tenths = Math.floor((ms % 1000) / 100);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
    }

    drawMinimap() {
        if (!this.minimapCtx || !this.world.trackPoints.length) return;
        const ctx = this.minimapCtx;
        const w = this.minimapCanvas.width;
        const h = this.minimapCanvas.height;

        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const scale = 0.145;

        ctx.beginPath();
        this.world.trackPoints.forEach((pt, idx) => {
            const x = cx + pt.x * scale;
            const y = cy + pt.z * scale;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Dibujar los 6 competidores IA
        this.world.aiCars.forEach(ai => {
            const ax = cx + ai.pos.x * scale;
            const ay = cy + ai.pos.z * scale;
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
            ctx.fill();
        });

        // Dibujar patrullas policiales
        this.world.policeCars.forEach(cop => {
            const ax = cx + cop.pos.x * scale;
            const ay = cy + cop.pos.z * scale;
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.arc(ax, ay, 3.8, 0, Math.PI * 2);
            ctx.fill();
        });

        // Dibujar Jugador
        const px = cx + this.carPos.x * scale;
        const py = cy + this.carPos.z * scale;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    toggleGarageModal(forceState) {
        const modal = document.getElementById('festival-modal');
        if (!modal) return;
        const shouldOpen = typeof forceState === 'boolean' ? forceState : modal.classList.contains('hidden');
        modal.classList.toggle('hidden', !shouldOpen);
        if (shouldOpen) {
            this.hidePauseModal();
            this.raceState = 'garage';
        }
    }

    setupUIEvents() {
        // 1. Renderizar los 8 Autos JDM
        const carsGrid = document.getElementById('cars-selector-grid');
        if (carsGrid) {
            carsGrid.innerHTML = '';
            window.FH6_DATA.cars.forEach((car, idx) => {
                const hexColor = '#' + car.color.toString(16).padStart(6, '0');
                const card = document.createElement('div');
                card.className = `car-card ${idx === this.selectedCarIndex ? 'active' : ''}`;
                card.innerHTML = `
                    <div class="car-card-header">
                        <span class="car-color-dot" style="background:${hexColor}"></span>
                        <span class="car-class-pill">${car.classRating}</span>
                    </div>
                    <h4>${car.name}</h4>
                    <p class="car-category">${car.category}</p>
                    <p class="car-desc">${car.description}</p>
                    <div class="car-stats">
                        <div class="stat-row"><span>VEL (${car.physics.maxSpeedKmh} km/h)</span><div class="stat-bar"><div style="width:${car.stats.speed}%"></div></div></div>
                        <div class="stat-row"><span>ACELERACIÓN</span><div class="stat-bar"><div style="width:${car.stats.acceleration}%"></div></div></div>
                        <div class="stat-row"><span>MANEJO</span><div class="stat-bar"><div style="width:${car.stats.handling}%"></div></div></div>
                        <div class="stat-row"><span>DERRAPE (DRIFT)</span><div class="stat-bar"><div style="width:${car.stats.drift}%"></div></div></div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    window.horizonAudio.init();
                    this.loadPlayerCar(idx);
                });
                carsGrid.appendChild(card);
            });
        }

        // 2. Renderizar los 3 Mapas
        const mapsGrid = document.getElementById('maps-selector-grid');
        if (mapsGrid) {
            mapsGrid.innerHTML = '';
            window.FH6_DATA.maps.forEach((map, idx) => {
                const card = document.createElement('div');
                card.className = `map-card ${idx === this.selectedMapIndex ? 'active' : ''}`;
                card.innerHTML = `
                    <div class="map-badge">${map.badge}</div>
                    <h4>${map.name}</h4>
                    <p>${map.subtitle}</p>
                    <div class="map-meta">
                        <span>📏 ${map.lengthKm}</span>
                        <span>🔥 ${map.difficulty}</span>
                    </div>
                `;
                card.addEventListener('click', () => {
                    window.horizonAudio.init();
                    this.loadMap(idx);
                });
                mapsGrid.appendChild(card);
            });
        }

        // 3. Selector de las 4 Dificultades (Baja, Media, Alta, Muy Alta)
        const diffSelect = document.getElementById('difficulty-select');
        if (diffSelect) {
            diffSelect.innerHTML = '';
            window.FH6_DATA.difficulties.forEach((d, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.textContent = `Dificultad: ${d.name}`;
                diffSelect.appendChild(opt);
            });
            diffSelect.value = String(this.selectedDifficultyIndex);
            diffSelect.addEventListener('change', (e) => {
                this.selectedDifficultyIndex = parseInt(e.target.value, 10);
                this.prepareStartingGrid();
            });
        }

        // 4. Selector de los 3 Modos de Juego (Carrera 3 Vueltas, Checkpoints, Persecución Policial)
        const modeSelect = document.getElementById('gamemode-select');
        if (modeSelect) {
            modeSelect.innerHTML = '';
            window.FH6_DATA.gameModes.forEach((m, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.textContent = m.name;
                modeSelect.appendChild(opt);
            });
            modeSelect.value = String(this.selectedGameModeIndex);
            modeSelect.addEventListener('change', (e) => {
                this.selectedGameModeIndex = parseInt(e.target.value, 10);
                this.prepareStartingGrid();
            });
        }

        // 5. Taller de Tuning y Pintura en el Garaje
        const tuningSelect = document.getElementById('tuning-stage-select');
        if (tuningSelect) {
            tuningSelect.innerHTML = '';
            window.FH6_DATA.tuningStages.forEach((st, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.textContent = `${st.name} (+${st.speedBonus} km/h)`;
                tuningSelect.appendChild(opt);
            });
            tuningSelect.value = String(this.selectedTuningIndex);
            tuningSelect.addEventListener('change', (e) => {
                this.selectedTuningIndex = parseInt(e.target.value, 10);
            });
        }

        const applyCustomColors = () => {
            if (!this.currentCarConfig || !this.playerCarMesh) return;
            const bodyHex = document.getElementById('tuning-body-color')?.value;
            const neonHex = document.getElementById('tuning-neon-color')?.value;
            const rimHex = document.getElementById('tuning-rim-color')?.value;

            if (bodyHex && this.playerCarMesh.userData.paintMat) {
                this.currentCarConfig.color = parseInt(bodyHex.replace('#', ''), 16);
                this.playerCarMesh.userData.paintMat.color.set(bodyHex);
            }
            if (neonHex && this.playerCarMesh.userData.neonMat) {
                this.currentCarConfig.neonColor = parseInt(neonHex.replace('#', ''), 16);
                this.playerCarMesh.userData.neonMat.color.set(neonHex);
            }
            if (rimHex && this.playerCarMesh.userData.rimMat) {
                this.currentCarConfig.rimColor = parseInt(rimHex.replace('#', ''), 16);
                this.playerCarMesh.userData.rimMat.color.set(rimHex);
            }
        };

        ['tuning-body-color', 'tuning-neon-color', 'tuning-rim-color'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', applyCustomColors);
        });

        // 6. Radio Horizon Japón
        window.populateTrackSelectors = () => {
            const selects = document.querySelectorAll('.js-track-select');
            selects.forEach(sel => {
                sel.innerHTML = '';
                window.horizonAudio.tracks.forEach((tr, idx) => {
                    const opt = document.createElement('option');
                    opt.value = String(idx);
                    opt.textContent = `${idx + 1}. ${tr.title} (${tr.genre})`;
                    sel.appendChild(opt);
                });
                sel.value = String(window.horizonAudio.currentTrackIndex);
            });
            window.horizonAudio.updateRadioUI();
        };
        window.populateTrackSelectors();

        document.querySelectorAll('.js-track-select').forEach(sel => {
            sel.addEventListener('change', (e) => {
                window.horizonAudio.selectTrack(parseInt(e.target.value, 10));
            });
        });

        document.querySelectorAll('.js-prev-track').forEach(btn => {
            btn.addEventListener('click', () => window.horizonAudio.prevTrack());
        });
        document.querySelectorAll('.js-next-track').forEach(btn => {
            btn.addEventListener('click', () => window.horizonAudio.nextTrack());
        });
        document.querySelectorAll('.js-play-toggle').forEach(btn => {
            btn.addEventListener('click', () => window.horizonAudio.togglePlayPause());
        });

        const volSlider = document.getElementById('music-volume-slider');
        if (volSlider) {
            volSlider.addEventListener('input', (e) => {
                window.horizonAudio.setMusicVolume(e.target.value);
            });
        }

        const fileInput = document.getElementById('custom-music-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                window.horizonAudio.addCustomFiles(e.target.files);
            });
        }

        // Botones de inicio y control
        const openGarageBtn = document.getElementById('btn-open-garage');
        if (openGarageBtn) {
            openGarageBtn.addEventListener('click', () => this.toggleGarageModal(true));
        }

        const startDrivingBtn = document.getElementById('btn-start-driving');
        if (startDrivingBtn) {
            startDrivingBtn.addEventListener('click', () => this.startNewRace());
        }

        const restartFinishBtn = document.getElementById('btn-finish-restart');
        if (restartFinishBtn) {
            restartFinishBtn.addEventListener('click', () => this.startNewRace());
        }

        const garageFinishBtn = document.getElementById('btn-finish-garage');
        if (garageFinishBtn) {
            garageFinishBtn.addEventListener('click', () => {
                this.hideFinishModal();
                this.toggleGarageModal(true);
            });
        }

        const camBtn = document.getElementById('btn-camera-toggle');
        if (camBtn) {
            camBtn.addEventListener('click', () => {
                this.cameraMode = (this.cameraMode + 1) % 3;
            });
        }

        const resetBtn = document.getElementById('btn-reset-car');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.startNewRace());
        }

        const pauseHudBtn = document.getElementById('btn-pause-race');
        if (pauseHudBtn) {
            pauseHudBtn.addEventListener('click', () => this.togglePauseRace());
        }

        const resumeRaceBtn = document.getElementById('btn-resume-race');
        if (resumeRaceBtn) {
            resumeRaceBtn.addEventListener('click', () => this.togglePauseRace(false));
        }

        const pauseRestartBtn = document.getElementById('btn-pause-restart');
        if (pauseRestartBtn) {
            pauseRestartBtn.addEventListener('click', () => this.startNewRace());
        }

        const pauseGarageBtn = document.getElementById('btn-pause-garage');
        if (pauseGarageBtn) {
            pauseGarageBtn.addEventListener('click', () => {
                this.hidePauseModal();
                this.toggleGarageModal(true);
            });
        }

        const touchToggleBtn = document.getElementById('btn-toggle-touch');
        if (touchToggleBtn) {
            touchToggleBtn.addEventListener('click', () => {
                const tc = document.getElementById('mobile-touch-controls');
                if (tc) tc.classList.toggle('hidden');
            });
        }

        const qualitySelect = document.getElementById('quality-preset-select');
        if (qualitySelect) {
            qualitySelect.value = this.qualityPreset;
            qualitySelect.addEventListener('change', (e) => {
                this.applyQualityPreset(e.target.value);
            });
        }
    }

    gameLoop(timestamp) {
        const dt = Math.min(0.05, (timestamp - this.lastFrameTime) / 1000);
        this.lastFrameTime = timestamp;

        this.frameCount++;
        if (timestamp - this.fpsLastTime >= 1000) {
            this.fps = Math.round((this.frameCount * 1000) / (timestamp - this.fpsLastTime));
            this.frameCount = 0;
            this.fpsLastTime = timestamp;

            const fpsEl = document.getElementById('hud-fps');
            if (fpsEl) fpsEl.textContent = `${this.fps} FPS`;
        }

        this.updatePhysics(dt);
        if (this.raceState !== 'paused') {
            const raceElapsedMs = this.raceState === 'racing' ? Math.max(0, performance.now() - this.raceStartTime) : 0;
            this.world.updateDynamicElements(dt, this.raceState === 'racing', this.carPos, this.playerTotalProgress, raceElapsedMs);
        }
        this.updateHUD();

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame((t) => this.gameLoop(t));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.horizonGame = new HorizonGameEngine();
});
