// ============================================================================
// INGENIERÍA GRÁFICA 3D AVANZADA Y OPTIMIZACIÓN GPU (THREE.JS / WEBGL)
// Incluye: InstancedMesh (reducción del 85% de Draw Calls), Gestión de VRAM,
// Filtrado Anisotrópico, Mitigación Z-Fighting, Pianos 3D, Skid Marks,
// Humo de Derrape, IA con Trazada/Frenada en Curva y Patrullas Policiales.
// ============================================================================

class HorizonWorldBuilder {
    constructor(scene, renderer = null) {
        this.scene = scene;
        this.renderer = renderer;
        this.maxAnisotropy = renderer && renderer.capabilities
            ? renderer.capabilities.getMaxAnisotropy()
            : 8;

        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);

        this.trackPoints = [];
        this.trackCurvatures = [];
        this.trackTotalLengthMeters = 2400;
        this.roadWidth = 19.5;
        this.currentMap = null;
        this.aiCars = [];
        this.policeCars = [];
        this.checkpoints = [];
        this.sakuraParticles = null;

        // Sistemas de partículas (Chispas de colisión + Humo de neumáticos)
        this.sparkParticles = [];
        this.smokeParticles = [];
        this.fxGroup = new THREE.Group();
        this.scene.add(this.fxGroup);

        // Geometrías y materiales compartidos para evitar duplicación en GPU
        this.sharedSparkGeo = new THREE.BoxGeometry(0.14, 0.14, 0.45);
        this.sharedSparkMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
        this.sharedSmokeGeo = new THREE.DodecahedronGeometry(0.42, 0);
        this.sharedSmokeMat = new THREE.MeshBasicMaterial({
            color: 0xe2e8f0,
            transparent: true,
            opacity: 0.36,
            depthWrite: false
        });

        this.textures = {};
        this.envMap = null;
        this.previewCache = new Map();
        this.carPreviewCache = new Map();
        this.initProceduralTextures();
        this.initShowroomLights();
        this.initDedicatedGarageShowroom();
    }

    initShowroomLights() {
        this.showroomGroup = new THREE.Group();
        this.showroomLightCyan = new THREE.PointLight(0x00e5ff, 2.2, 22);
        this.showroomLightViolet = new THREE.PointLight(0xa855f7, 1.9, 22);
        this.showroomLightRed = new THREE.PointLight(0xf43f5e, 1.8, 20);
        this.showroomGroup.add(this.showroomLightCyan, this.showroomLightViolet, this.showroomLightRed);
        this.scene.add(this.showroomGroup);
    }

    /**
     * Escena 3D dedicada para el Visor 360° del Garaje y las tarjetas 3D del catálogo.
     * Reutiliza el único WebGLRenderer principal para mantener un consumo mínimo de VRAM en RTX 3060 (6 GB).
     */
    initDedicatedGarageShowroom() {
        this.garageShowroomScene = new THREE.Scene();
        this.garageShowroomScene.background = new THREE.Color(0x070b18);
        this.garageShowroomCamera = new THREE.PerspectiveCamera(40, 16 / 9, 0.2, 250);

        // Iluminación de estudio PBR (Key, Fill, Rim Cian, Rim Magenta) para pinturas metalizadas y llantas
        const amb = new THREE.AmbientLight(0xdbeafe, 1.25);
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.15);
        keyLight.position.set(5.5, 9.0, 6.5);

        const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
        fillLight.position.set(-6.5, 4.2, 5.0);

        const rimPink = new THREE.PointLight(0xf43f5e, 2.6, 18);
        rimPink.position.set(-4.2, 2.4, -4.5);

        const rimCyan = new THREE.PointLight(0x00e5ff, 2.6, 18);
        rimCyan.position.set(4.2, 2.4, -4.5);

        this.garageShowroomScene.add(amb, keyLight, fillLight, rimPink, rimCyan);

        // Suelo de asfalto japonés nocturno húmedo con reflejos especulares
        const floorGeo = new THREE.PlaneGeometry(70, 70);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x0b1120,
            map: this.textures.road,
            roughness: 0.18,
            metalness: 0.65,
            envMap: this.envMap,
            envMapIntensity: 1.35
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.y = -0.02;
        this.garageShowroomScene.add(floorMesh);

        // Plataforma giratoria (Turntable Podium) con doble anillo LED Neón
        this.garageTurntableGroup = new THREE.Group();
        this.garageShowroomScene.add(this.garageTurntableGroup);

        const podiumGeo = new THREE.CylinderGeometry(3.15, 3.35, 0.08, 48);
        const podiumMat = new THREE.MeshStandardMaterial({
            color: 0x111827,
            roughness: 0.2,
            metalness: 0.82,
            envMap: this.envMap
        });
        const podiumMesh = new THREE.Mesh(podiumGeo, podiumMat);
        podiumMesh.position.y = 0.02;
        this.garageTurntableGroup.add(podiumMesh);

        const neonRingGeo = new THREE.RingGeometry(3.12, 3.26, 64);
        neonRingGeo.rotateX(-Math.PI / 2);
        this.garageNeonRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide });
        const neonRing = new THREE.Mesh(neonRingGeo, this.garageNeonRingMat);
        neonRing.position.y = 0.068;
        this.garageTurntableGroup.add(neonRing);

        const wall = new THREE.Mesh(new THREE.PlaneGeometry(31, 8),
            new THREE.MeshStandardMaterial({ color: 0x253237, roughness: 0.92 }));
        wall.position.set(0, 4, -9);
        this.garageShowroomScene.add(wall);
        const beamGeometry = new THREE.BoxGeometry(0.16, 7, 0.26);
        const beamMaterial = new THREE.MeshStandardMaterial({ color: 0x111a20, roughness: 0.86 });
        const stripGeometry = new THREE.PlaneGeometry(0.038, 3);
        const stripMaterial = new THREE.MeshBasicMaterial({ color: 0xb5eadf, toneMapped: false });
        for (const x of [-8, -5.4, -2.8, 2.8, 5.4, 8]) {
            const beam = new THREE.Mesh(beamGeometry, beamMaterial);
            beam.position.set(x, 3.5, -8.88);
            const strip = new THREE.Mesh(stripGeometry, stripMaterial);
            strip.position.set(x + 0.14, 2.25, -8.73);
            this.garageShowroomScene.add(beam, strip);
        }

        this.garageShowroomCarRoot = new THREE.Group();
        this.garageShowroomCarRoot.position.y = 0.06;
        this.garageTurntableGroup.add(this.garageShowroomCarRoot);
        this.garageShowroomCarMesh = null;
    }

    setGarageShowroomCar(carConfig) {
        if (!this.garageShowroomCarRoot || !carConfig) return null;
        while (this.garageShowroomCarRoot.children.length > 0) {
            this.garageShowroomCarRoot.remove(this.garageShowroomCarRoot.children[0]);
        }
        this.garageShowroomCarMesh = this.createCarMesh(carConfig, false);
        const wheels = this.garageShowroomCarMesh.userData.wheels;
        if (wheels && wheels.length >= 2) {
            wheels[0].rotation.y = 0.26;
            wheels[1].rotation.y = 0.26;
        }
        if (this.garageNeonRingMat) {
            this.garageNeonRingMat.color.setHex(carConfig.neonColor || 0x00e5ff);
        }
        this.garageShowroomCarRoot.add(this.garageShowroomCarMesh);
        return this.garageShowroomCarMesh;
    }

    renderGarageShowroomToCanvas(targetCanvas, turntableAngle = 0.58, cameraZoom = 5.15, cameraPitch = 1.48) {
        if (!targetCanvas || !this.renderer || !this.garageShowroomScene || !this.garageShowroomCamera) return false;

        const rect = typeof targetCanvas.getBoundingClientRect === 'function'
            ? targetCanvas.getBoundingClientRect()
            : { width: 560, height: 280 };
        const w = Math.max(320, Math.round(rect.width || targetCanvas.width || 560));
        const h = Math.max(200, Math.round(rect.height || targetCanvas.height || 280));

        if (targetCanvas.width !== w || targetCanvas.height !== h) {
            targetCanvas.width = w;
            targetCanvas.height = h;
        }

        this.garageShowroomCamera.aspect = w / h;
        this.garageShowroomCamera.updateProjectionMatrix();

        if (this.garageTurntableGroup) {
            this.garageTurntableGroup.rotation.y = turntableAngle;
        }

        this.garageShowroomCamera.position.set(0, cameraPitch, cameraZoom);
        this.garageShowroomCamera.lookAt(0, 0.62, 0);

        this.renderer.render(this.garageShowroomScene, this.garageShowroomCamera);

        const ctx = targetCanvas.getContext('2d');
        if (ctx && this.renderer.domElement) {
            try {
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
                return true;
            } catch (e) {}
        }
        return false;
    }

    /**
     * Renderiza una miniatura 3D real en WebGL de cualquier automóvil del catálogo sobre el escenario japonés nocturno.
     */
    generateCar3DPreviewDataUrl(carConfig) {
        if (!carConfig) return '';
        const cacheKey = `${carConfig.id}_${carConfig.color}_${carConfig.rimColor}_${carConfig.neonColor}`;
        if (this.carPreviewCache && this.carPreviewCache.has(cacheKey)) {
            return this.carPreviewCache.get(cacheKey);
        }

        let dataUrl = '';
        try {
            if (this.renderer && this.garageShowroomScene && this.garageShowroomCamera) {
                const prevCar = this.garageShowroomCarMesh;
                const tempMesh = this.createCarMesh(carConfig, false);
                if (tempMesh.userData.wheels && tempMesh.userData.wheels.length >= 2) {
                    tempMesh.userData.wheels[0].rotation.y = 0.28;
                    tempMesh.userData.wheels[1].rotation.y = 0.28;
                }

                while (this.garageShowroomCarRoot.children.length > 0) {
                    this.garageShowroomCarRoot.remove(this.garageShowroomCarRoot.children[0]);
                }
                this.garageShowroomCarRoot.add(tempMesh);
                this.garageTurntableGroup.rotation.y = -0.62;

                const thumbW = 420;
                const thumbH = 230;
                this.garageShowroomCamera.aspect = thumbW / thumbH;
                this.garageShowroomCamera.updateProjectionMatrix();
                this.garageShowroomCamera.position.set(0, 1.32, 4.85);
                this.garageShowroomCamera.lookAt(0, 0.58, 0);

                this.renderer.render(this.garageShowroomScene, this.garageShowroomCamera);

                const offCanvas = document.createElement('canvas');
                offCanvas.width = thumbW;
                offCanvas.height = thumbH;
                const ctx = offCanvas.getContext('2d');
                if (ctx && this.renderer.domElement && typeof ctx.drawImage === 'function') {
                    ctx.drawImage(this.renderer.domElement, 0, 0, thumbW, thumbH);
                    if (typeof offCanvas.toDataURL === 'function') {
                        const candidate = offCanvas.toDataURL('image/png');
                        if (candidate && candidate.startsWith('data:image/') && candidate.length > 128) {
                            dataUrl = candidate;
                        }
                    }
                }

                while (this.garageShowroomCarRoot.children.length > 0) {
                    this.garageShowroomCarRoot.remove(this.garageShowroomCarRoot.children[0]);
                }
                if (prevCar) {
                    this.garageShowroomCarRoot.add(prevCar);
                    this.garageShowroomCarMesh = prevCar;
                }
            }
        } catch (e) {}

        // Respaldo SVG vectorial 3D si se ejecuta en entorno de test sin WebGL framebuffer
        if (!dataUrl) {
            const hexBody = '#' + (carConfig.color || 0x38bdf8).toString(16).padStart(6, '0');
            const hexRim = '#' + (carConfig.rimColor || 0xe2e8f0).toString(16).padStart(6, '0');
            const hexNeon = '#' + (carConfig.neonColor || 0x00e5ff).toString(16).padStart(6, '0');
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 230" width="420" height="230">` +
                `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#070b18"/><stop offset="65%" stop-color="#111b36"/><stop offset="100%" stop-color="#090d1a"/></linearGradient></defs>` +
                `<rect width="420" height="230" fill="url(#bg)"/>` +
                `<polygon points="130,145 210,55 290,145" fill="#1e293b" opacity="0.65"/>` +
                `<ellipse cx="210" cy="182" rx="148" ry="18" fill="${hexNeon}" opacity="0.26"/>` +
                `<path d="M72,158 L98,122 L162,96 L268,96 L328,124 L352,156 L346,174 L76,174 Z" fill="${hexBody}" stroke="#ffffff" stroke-width="1.5"/>` +
                `<polygon points="154,102 256,102 292,124 122,124" fill="#090d16" opacity="0.88"/>` +
                `<circle cx="132" cy="170" r="24" fill="#0b0f19" stroke="${hexRim}" stroke-width="5"/>` +
                `<circle cx="292" cy="170" r="24" fill="#0b0f19" stroke="${hexRim}" stroke-width="5"/>` +
                `</svg>`;
            dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        }

        if (this.carPreviewCache) {
            this.carPreviewCache.set(cacheKey, dataUrl);
        }
        return dataUrl;
    }

    updateShowroomLights(carPos, timeSec = 0, active = true) {
        if (!this.showroomGroup) return;
        this.showroomGroup.visible = Boolean(active);
        if (!active || !carPos) return;

        const a1 = timeSec * 0.7;
        const a2 = a1 + (Math.PI * 2) / 3;
        const a3 = a1 + (Math.PI * 4) / 3;
        const r = 5.4;

        this.showroomLightCyan.position.set(carPos.x + Math.cos(a1) * r, carPos.y + 2.6, carPos.z + Math.sin(a1) * r);
        this.showroomLightViolet.position.set(carPos.x + Math.cos(a2) * r, carPos.y + 3.1, carPos.z + Math.sin(a2) * r);
        this.showroomLightRed.position.set(carPos.x + Math.cos(a3) * r, carPos.y + 2.2, carPos.z + Math.sin(a3) * r);
    }

    configureTextureQuality(texture, repeatX = 1, repeatY = 1) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
        texture.anisotropy = this.maxAnisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return texture;
    }

    initProceduralTextures() {
        // 1. Cubemap de Entorno HDR Simulado para Reflejos Metálicos Realistas
        const createFaceCanvas = (topCol, botCol, highlight) => {
            const c = document.createElement('canvas');
            c.width = 128;
            c.height = 128;
            const ctx = c.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 128);
            grad.addColorStop(0, topCol);
            grad.addColorStop(0.37, highlight);
            grad.addColorStop(0.49, '#475468');
            grad.addColorStop(1, botCol);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 128, 128);
            return c;
        };

        this.envMap = new THREE.CubeTexture([
            createFaceCanvas('#26394e', '#161f28', '#b9d2e3'),
            createFaceCanvas('#382f30', '#151823', '#e4bba3'),
            createFaceCanvas('#536884', '#253345', '#e2edf5'),
            createFaceCanvas('#131920', '#0b0e14', '#1e2931'),
            createFaceCanvas('#334154', '#141c24', '#e1e9f1'),
            createFaceCanvas('#2b3845', '#101921', '#91b6c6')
        ]);
        this.envMap.needsUpdate = true;
        this.scene.environment = this.envMap;

        // 2. Textura Base de Asfalto Japonés de Alta Densidad
        const roadCanvas = document.createElement('canvas');
        roadCanvas.width = 512;
        roadCanvas.height = 512;
        const rCtx = roadCanvas.getContext('2d');

        rCtx.fillStyle = '#292c31';
        rCtx.fillRect(0, 0, 512, 512);

        for (let i = 0; i < 9000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const shade = 22 + Math.floor(Math.random() * 44);
            rCtx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 4})`;
            rCtx.fillRect(x, y, 2, 2);
        }

        rCtx.fillStyle = 'rgba(8, 11, 18, 0.35)';
        [85, 175, 335, 425].forEach(laneX => {
            rCtx.fillRect(laneX - 18, 0, 12, 512);
            rCtx.fillRect(laneX + 6, 0, 12, 512);
        });

        this.textures.road = this.configureTextureQuality(
            new THREE.CanvasTexture(roadCanvas),
            1,
            160
        );

        // 3. Textura Dedicada para Líneas de Carril (Bordes blancos nítidos + línea central discontinua limpia)
        const laneCanvas = document.createElement('canvas');
        laneCanvas.width = 512;
        laneCanvas.height = 512;
        const lCtx = laneCanvas.getContext('2d');
        lCtx.clearRect(0, 0, 512, 512);

        // Líneas continuas de borde de pista (blancas de alto contraste)
        lCtx.fillStyle = 'rgba(248, 250, 252, 0.96)';
        lCtx.fillRect(14, 0, 10, 512);
        lCtx.fillRect(488, 0, 10, 512);

        // Línea divisoria central discontinua (evita saturar el asfalto ni cortar sobre las marcas de frenado)
        lCtx.fillStyle = 'rgba(245, 222, 162, 0.92)';
        lCtx.fillRect(253, 32, 6, 245);

        this.textures.laneMarkings = this.configureTextureQuality(
            new THREE.CanvasTexture(laneCanvas),
            1,
            150
        );

        // 4. Textura de Marcas de Frenada y Derrape (Skid Marks suaves en los carriles de trazada)
        const skidCanvas = document.createElement('canvas');
        skidCanvas.width = 256;
        skidCanvas.height = 256;
        const sCtx = skidCanvas.getContext('2d');
        sCtx.clearRect(0, 0, 256, 256);

        [44, 92, 148, 196].forEach((trackX) => {
            const grad = sCtx.createLinearGradient(0, 0, 0, 256);
            grad.addColorStop(0, 'rgba(5, 7, 12, 0.0)');
            grad.addColorStop(0.22, 'rgba(8, 10, 16, 0.52)');
            grad.addColorStop(0.78, 'rgba(8, 10, 16, 0.52)');
            grad.addColorStop(1, 'rgba(5, 7, 12, 0.0)');
            sCtx.fillStyle = grad;
            sCtx.fillRect(trackX, 0, 8, 256);
            sCtx.fillRect(trackX + 12, 0, 8, 256);
        });

        this.textures.skidMarks = this.configureTextureQuality(
            new THREE.CanvasTexture(skidCanvas),
            1,
            1
        );

        // 5A. Textura para Pianos 3D (Rumble Strips Rojo/Blanco)
        const curbCanvas = document.createElement('canvas');
        curbCanvas.width = 128;
        curbCanvas.height = 256;
        const cCtx = curbCanvas.getContext('2d');
        for (let y = 0; y < 256; y += 64) {
            const isPrimary = (y / 64) % 2 === 0;
            cCtx.fillStyle = isPrimary ? '#dc2626' : '#f8fafc';
            cCtx.fillRect(0, y, 128, 64);
            cCtx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            cCtx.fillRect(0, y + 56, 128, 8);
        }
        this.textures.curb3D = this.configureTextureQuality(
            new THREE.CanvasTexture(curbCanvas),
            1,
            220
        );

        // 5B. Textura para Pianos 3D Andinos (Turquesa/Blanco estilo Autódromo Cusco y Puno)
        const curbCyanCanvas = document.createElement('canvas');
        curbCyanCanvas.width = 128;
        curbCyanCanvas.height = 256;
        const ccCtx = curbCyanCanvas.getContext('2d');
        for (let y = 0; y < 256; y += 64) {
            const isPrimary = (y / 64) % 2 === 0;
            ccCtx.fillStyle = isPrimary ? '#0891b2' : '#f8fafc';
            ccCtx.fillRect(0, y, 128, 64);
            ccCtx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ccCtx.fillRect(0, y + 56, 128, 8);
        }
        this.textures.curbCyan3D = this.configureTextureQuality(
            new THREE.CanvasTexture(curbCyanCanvas),
            1,
            220
        );

        // 6. Textura Metálica para Barreras Bionda (W-Beam Guardrail)
        const railCanvas = document.createElement('canvas');
        railCanvas.width = 256;
        railCanvas.height = 64;
        const gCtx = railCanvas.getContext('2d');
        const railGrad = gCtx.createLinearGradient(0, 0, 0, 64);
        railGrad.addColorStop(0, '#94a3b8');
        railGrad.addColorStop(0.25, '#e2e8f0');
        railGrad.addColorStop(0.5, '#475569');
        railGrad.addColorStop(0.75, '#cbd5e1');
        railGrad.addColorStop(1, '#334155');
        gCtx.fillStyle = railGrad;
        gCtx.fillRect(0, 0, 256, 64);

        gCtx.fillStyle = '#ef4444';
        gCtx.fillRect(48, 22, 18, 20);
        gCtx.fillStyle = '#facc15';
        gCtx.fillRect(176, 22, 18, 20);

        this.textures.guardrail = this.configureTextureQuality(
            new THREE.CanvasTexture(railCanvas),
            180,
            1
        );

        // 7A. Textura de Trampa de Arena Desértica / Costera (Autódromo Arequipa & Trujillo)
        const createSandTexture = (baseHex, grainLight, grainDark, rakeAlpha, repeatX, repeatY) => {
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 256;
            const ctx = c.getContext('2d');
            ctx.fillStyle = baseHex;
            ctx.fillRect(0, 0, 256, 256);

            // Surcos longitudinales de trampa de arena de autódromo (raked sand trap grooves)
            for (let x = 0; x < 256; x += 8) {
                ctx.fillStyle = `rgba(0, 0, 0, ${rakeAlpha})`;
                ctx.fillRect(x, 0, 3, 256);
                ctx.fillStyle = `rgba(255, 255, 255, ${rakeAlpha * 0.65})`;
                ctx.fillRect(x + 3, 0, 2, 256);
            }

            // Granulometría de arena y grava
            for (let i = 0; i < 5500; i++) {
                const x = Math.random() * 256;
                const y = Math.random() * 256;
                ctx.fillStyle = Math.random() > 0.48 ? grainLight : grainDark;
                ctx.fillRect(x, y, 2, 2);
            }
            return this.configureTextureQuality(new THREE.CanvasTexture(c), repeatX, repeatY);
        };

        this.textures.sandDesert = createSandTexture('#d4a76a', 'rgba(245, 218, 175, 0.55)', 'rgba(156, 112, 64, 0.55)', 0.08, 3, 130);
        this.textures.sandAndean = createSandTexture('#b98552', 'rgba(219, 174, 125, 0.52)', 'rgba(124, 83, 45, 0.55)', 0.07, 3, 130);
        this.textures.gravelDark = createSandTexture('#2b3342', 'rgba(71, 85, 105, 0.5)', 'rgba(15, 23, 42, 0.6)', 0.06, 3, 130);

        // 7B. Texturas de Terreno Exterior según Bioma (Desierto, Valle Verde/Touge y Urbano)
        this.textures.groundDesert = createSandTexture('#c49862', 'rgba(232, 198, 150, 0.45)', 'rgba(138, 98, 54, 0.5)', 0.02, 85, 85);
        this.textures.groundGrass = createSandTexture('#4d5e3b', 'rgba(101, 128, 72, 0.45)', 'rgba(54, 69, 40, 0.55)', 0.02, 85, 85);
        this.textures.ground = createSandTexture('#1c2433', 'rgba(51, 65, 85, 0.45)', 'rgba(15, 23, 42, 0.6)', 0.02, 85, 85);

        // 8. Textura de Línea de Meta Ajedrezada
        const finishCanvas = document.createElement('canvas');
        finishCanvas.width = 512;
        finishCanvas.height = 128;
        const fCtx = finishCanvas.getContext('2d');
        const sq = 32;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 16; c++) {
                fCtx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#090d16';
                fCtx.fillRect(c * sq, r * sq, sq, sq);
            }
        }
        this.textures.finishLine = this.configureTextureQuality(
            new THREE.CanvasTexture(finishCanvas),
            1,
            1
        );

        // 9. Textura Tileable para Rascacielos
        const bldCanvas = document.createElement('canvas');
        bldCanvas.width = 256;
        bldCanvas.height = 256;
        const bCtx = bldCanvas.getContext('2d');
        bCtx.fillStyle = '#070b14';
        bCtx.fillRect(0, 0, 256, 256);

        for (let row = 8; row < 248; row += 24) {
            bCtx.fillStyle = '#1e293b';
            bCtx.fillRect(0, row - 4, 256, 3);

            for (let col = 8; col < 248; col += 24) {
                const rand = Math.random();
                if (rand > 0.26) {
                    if (rand > 0.89) bCtx.fillStyle = '#38bdf8';
                    else if (rand > 0.78) bCtx.fillStyle = '#fde047';
                    else if (rand > 0.70) bCtx.fillStyle = '#f43f5e';
                    else bCtx.fillStyle = '#e2e8f0';
                    bCtx.fillRect(col, row, 16, 14);
                } else {
                    bCtx.fillStyle = '#0f172a';
                    bCtx.fillRect(col, row, 16, 14);
                }
            }
        }
        this.textures.building = this.configureTextureQuality(
            new THREE.CanvasTexture(bldCanvas),
            1,
            1
        );

        // 10. Textura Orgánica con Canal Alfa Nítido para Follaje de Cerezo (Sakura Crossed Billboards)
        const sakCanvas = document.createElement('canvas');
        sakCanvas.width = 256;
        sakCanvas.height = 256;
        const skCtx = sakCanvas.getContext('2d');
        skCtx.clearRect(0, 0, 256, 256);

        // Ramas secundarias orgánicas dentro de la copa
        skCtx.strokeStyle = '#3e1f0d';
        skCtx.lineCap = 'round';
        skCtx.lineWidth = 7;
        skCtx.beginPath();
        skCtx.moveTo(128, 240);
        skCtx.lineTo(128, 120);
        skCtx.moveTo(128, 185);
        skCtx.lineTo(68, 105);
        skCtx.moveTo(128, 165);
        skCtx.lineTo(192, 96);
        skCtx.moveTo(95, 140);
        skCtx.lineTo(48, 78);
        skCtx.moveTo(160, 130);
        skCtx.lineTo(208, 72);
        skCtx.stroke();

        // Racimos densos de flores de cerezo con volumen sombreado (reemplaza la esfera sólida)
        const blossomClusters = [
            { x: 128, y: 92, r: 58 },
            { x: 74, y: 118, r: 48 },
            { x: 182, y: 114, r: 48 },
            { x: 96, y: 74, r: 44 },
            { x: 162, y: 76, r: 44 },
            { x: 52, y: 88, r: 36 },
            { x: 204, y: 86, r: 36 },
            { x: 128, y: 136, r: 46 }
        ];
        const blossomPalette = ['#be185d', '#db2777', '#ec4899', '#f472b6', '#f9a8d4', '#fbcfe8', '#fdf2f8'];
        blossomClusters.forEach((cl) => {
            for (let i = 0; i < 65; i++) {
                const ang = Math.random() * Math.PI * 2;
                const dist = Math.pow(Math.random(), 0.6) * cl.r;
                const bx = cl.x + Math.cos(ang) * dist;
                const by = cl.y + Math.sin(ang) * dist * 0.85;
                const br = 4 + Math.random() * 8;
                // Sombra inferior y brillo superior
                const colorIdx = by > cl.y + 8
                    ? Math.floor(Math.random() * 3)
                    : 2 + Math.floor(Math.random() * (blossomPalette.length - 2));
                skCtx.fillStyle = blossomPalette[colorIdx];
                skCtx.beginPath();
                skCtx.arc(bx, by, br, 0, Math.PI * 2);
                skCtx.fill();
            }
        });
        this.textures.sakuraBranch = new THREE.CanvasTexture(sakCanvas);
        this.textures.sakuraBranch.anisotropy = this.maxAnisotropy;

        // 11. Textura Circular Radial para Pétalos / Partículas (evita que WebGL dibuje cuadrados grises)
        const partCanvas = document.createElement('canvas');
        partCanvas.width = 64;
        partCanvas.height = 64;
        const pCtx = partCanvas.getContext('2d');
        pCtx.clearRect(0, 0, 64, 64);
        const radGrad = pCtx.createRadialGradient(32, 32, 2, 32, 32, 28);
        radGrad.addColorStop(0, 'rgba(255, 240, 248, 1.0)');
        radGrad.addColorStop(0.55, 'rgba(249, 168, 212, 0.92)');
        radGrad.addColorStop(1, 'rgba(249, 168, 212, 0.0)');
        pCtx.fillStyle = radGrad;
        pCtx.beginPath();
        pCtx.arc(32, 32, 28, 0, Math.PI * 2);
        pCtx.fill();
        this.textures.roundParticle = new THREE.CanvasTexture(partCanvas);

        const pine = document.createElement('canvas');
        pine.width = 128;
        pine.height = 256;
        const brush = pine.getContext('2d');
        brush.fillStyle = '#685849';
        brush.fillRect(61, 29, 6, 226);
        let state = 14587;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        for (let tier = 0; tier < 17; tier++) {
            const tip = 3 + tier * 12;
            const span = 6 + tier * 3.55;
            for (let twig = 0; twig < 90; twig++) {
                const x = (random() * 2 - 1) * span;
                const y = tip + Math.abs(x) * 0.45 + random() * 19;
                const shade = Math.round(88 + (1 - Math.abs(x) / span) * 25 + random() * 36);
                brush.fillStyle = `rgb(${shade},${shade + 9},${shade})`;
                brush.beginPath();
                brush.arc(64 + x, y, 1.2 + random() * (2 + tier * 0.18), 0, Math.PI * 2);
                brush.fill();
            }
        }
        this.textures.pine = this.configureTextureQuality(new THREE.CanvasTexture(pine));

        const contact = document.createElement('canvas');
        contact.width = contact.height = 64;
        const shadowBrush = contact.getContext('2d');
        const shadow = shadowBrush.createRadialGradient(32, 32, 6, 32, 32, 32);
        shadow.addColorStop(0, 'rgba(0,0,0,.80)');
        shadow.addColorStop(0.55, 'rgba(0,0,0,.48)');
        shadow.addColorStop(1, 'rgba(0,0,0,0)');
        shadowBrush.fillStyle = shadow;
        shadowBrush.fillRect(0, 0, 64, 64);
        this.textures.carShadow = new THREE.CanvasTexture(contact);
    }

    createNeonSignTexture(textJP, textEN, bgHex, borderHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = bgHex;
        ctx.fillRect(0, 0, 256, 128);

        ctx.strokeStyle = borderHex;
        ctx.lineWidth = 8;
        ctx.strokeRect(6, 6, 244, 116);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(textJP, 128, 56, 213);

        ctx.fillStyle = borderHex;
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(textEN, 128, 98, 213);

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = this.maxAnisotropy;
        return tex;
    }

    createTrafficSignTexture(type) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 128, 128);

        if (type === 'tomare') {
            ctx.fillStyle = '#dc2626';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(10, 14);
            ctx.lineTo(118, 14);
            ctx.lineTo(64, 118);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 26px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('止まれ', 64, 48);
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('STOP', 64, 72);
        } else if (type === 'curve') {
            ctx.fillStyle = '#facc15';
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(64, 8);
            ctx.lineTo(120, 64);
            ctx.lineTo(64, 120);
            ctx.lineTo(8, 64);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#090d16';
            ctx.font = 'bold 44px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('↱', 64, 80);
        } else {
            ctx.fillStyle = '#0284c7';
            ctx.fillRect(6, 16, 116, 96);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 5;
            ctx.strokeRect(10, 20, 108, 88);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('東京 ↑', 64, 56);
            ctx.font = 'bold 15px sans-serif';
            ctx.fillText('SHUTO C1', 64, 88);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = this.maxAnisotropy;
        return tex;
    }

    evaluateTrackSpline(t, mapConfig) {
        const angle = t * Math.PI * 2;
        const rx = mapConfig.curveRadiusX || 370;
        const rz = mapConfig.curveRadiusZ || 270;

        let x = Math.cos(angle) * rx;
        let z = Math.sin(angle) * rz;
        let y = 0;

        if (mapConfig.curveComplexity === 'touge') {
            x += Math.sin(angle * 3) * 66 + Math.cos(angle * 5) * 24;
            z += Math.cos(angle * 2) * 56 + Math.sin(angle * 4) * 30;
            // Elevación progresiva asentada sobre talud de montaña y arena (evita que la pista flote en el cielo)
            y = Math.sin(angle * 2) * 3.8 + Math.cos(angle * 3) * 1.8 + 4.2;
        } else if (mapConfig.curveComplexity === 'peru_desert_gp') {
            // Autódromo Arequipa & Trujillo: horquillas técnicas y recta rápida de boxes
            x += Math.sin(angle * 2) * 72 + Math.cos(angle * 4) * 28;
            z += Math.sin(angle * 3) * 54 + Math.cos(angle * 2) * 24;
            y = Math.sin(angle * 2) * 1.8 + Math.cos(angle) * 1.1 + 1.8;
        } else if (mapConfig.curveComplexity === 'peru_andean_gp') {
            // Autódromo Cusco & Puno: eses enlazadas del altiplano y curvón peraltado junto al lago
            x += Math.cos(angle * 3) * 64 + Math.sin(angle * 4) * 26;
            z += Math.sin(angle * 2) * 60 + Math.cos(angle * 5) * 22;
            y = Math.sin(angle * 3) * 2.4 + Math.cos(angle * 2) * 1.4 + 2.5;
        } else if (mapConfig.curveComplexity === 'urban') {
            x += Math.sin(angle * 4) * 52;
            z += Math.cos(angle * 3) * 48;
            y = Math.sin(angle * 2) * 2.0 + 2.2;
        } else {
            x += Math.sin(angle * 2) * 65;
            z += Math.cos(angle * 3) * 45;
            y = Math.sin(angle * 2) * 3.2 + 3.4;
        }

        return new THREE.Vector3(x, y, z);
    }

    /**
     * Libera recursos de geometría y materiales en GPU al cambiar de mapa
     * para evitar fugas de VRAM.
     */
    disposeWorldGroup() {
        const materials = new Set();
        const geometries = new Set();
        this.worldGroup.traverse((obj) => {
            if (obj.geometry) geometries.add(obj.geometry);
            if (obj.material) [].concat(obj.material).forEach((material) => materials.add(material));
            if (obj.isInstancedMesh) obj.dispose();
        });
        const sharedTextures = new Set([this.envMap, ...Object.values(this.textures)]);
        const textures = new Set();
        for (const material of materials) {
            for (const value of Object.values(material)) {
                if (value?.isTexture && !sharedTextures.has(value)) textures.add(value);
            }
            material.dispose();
        }
        textures.forEach((texture) => texture.dispose());
        geometries.forEach((geometry) => geometry.dispose());
        this.worldGroup.clear();
    }

    buildMap(mapConfig) {
        this.currentMap = mapConfig;
        this.disposeWorldGroup();

        this.aiCars = [];
        this.policeCars = [];
        this.checkpoints = [];
        this.sakuraParticles = null;

        this.scene.background = new THREE.Color(mapConfig.skyColorHorizon);
        this.scene.fog = new THREE.FogExp2(mapConfig.fogColor, mapConfig.fogDensity);

        const segments = 360;
        this.trackPoints = [];
        for (let i = 0; i < segments; i++) {
            const t = i / segments;
            this.trackPoints.push(this.evaluateTrackSpline(t, mapConfig));
        }

        // Calcular longitud física real de la vuelta y curvatura por segmento
        let totalLen = 0;
        this.trackCurvatures = [];
        for (let i = 0; i < segments; i++) {
            const prev = this.trackPoints[(i - 1 + segments) % segments];
            const curr = this.trackPoints[i];
            const next = this.trackPoints[(i + 1) % segments];
            totalLen += curr.distanceTo(next);

            const v1 = new THREE.Vector2(curr.x - prev.x, curr.z - prev.z).normalize();
            const v2 = new THREE.Vector2(next.x - curr.x, next.z - curr.z).normalize();
            const dot = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
            this.trackCurvatures.push(Math.acos(dot));
        }
        this.trackTotalLengthMeters = Math.max(1800, totalLen);

        // 0. Domo de Cielo Degradado 3D y Cordillera Perimetral (elimina el corte brusco cielo/suelo)
        this.buildSkyDome(mapConfig);
        this.buildPerimeterMountains(mapConfig);

        // 1. Terreno base con textura adaptada al bioma (Desierto Peruano, Pradera Andina/Hakone o Urbano)
        const groundGeo = new THREE.PlaneGeometry(3600, 3600);
        let groundTex = this.textures.ground;
        if (mapConfig.runoffType === 'sand_desert') {
            groundTex = this.textures.groundDesert;
        } else if (mapConfig.runoffType === 'sand_warm' || mapConfig.runoffType === 'sand_andean') {
            groundTex = this.textures.groundGrass;
        }
        const groundMat = new THREE.MeshStandardMaterial({
            color: mapConfig.groundColor,
            map: groundTex,
            roughness: 0.92,
            metalness: 0.04
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.65;
        ground.receiveShadow = true;
        this.worldGroup.add(ground);

        // 2. Asfalto + Líneas de Carril + Pianos 3D + Trampas de Arena y Talud Continuo (0 huecos bajo la pista)
        this.buildRoadAndLaneMeshes();
        this.build3DRumbleCurbs(mapConfig);
        this.buildTrackSandRunoffAndEmbankment(mapConfig);
        this.buildCornerSkidMarks();

        // 3. Vallas Metálicas Bionda + Postes Instanciados (InstancedMesh)
        this.buildMetallicGuardrails(mapConfig);

        // 4. Señales de Tráfico ("止まれ", Dirección y Curva) ancladas al talud
        this.buildJapaneseTrafficSigns();

        // 5. Pórtico de Salida / Meta + Checkpoints
        this.buildFestivalStartGate(mapConfig);
        this.buildCheckpointArches();

        // 6. Monumentos, Autódromos del Perú, Rascacielos, Farolas y Vegetación
        if (mapConfig.hasMountFuji) this.buildMountFuji();
        if (mapConfig.hasTokyoTower) this.buildTokyoTower();
        if (mapConfig.hasToriiGates) this.buildToriiGatesAlongTrack();
        if (mapConfig.hasSkyscrapers) this.buildCitySkyscrapers();
        if (mapConfig.hasAutodromePits) this.buildPeruvianAutodromeComplex(mapConfig);
        if (mapConfig.hasVolcanMisti) this.buildVolcanMistiAndPacific();
        if (mapConfig.hasAndeanLake) this.buildLakeTiticacaAndAndeanTown();

        if (mapConfig.atmosphere.night) this.buildStreetLightsWithSpotlights();
        this.buildRoadsideLandscape(mapConfig);

        if (mapConfig.hasSakura) {
            this.buildSakuraTreesAndPetals();
        }
    }

    getSkyLightDirection(mapConfig) {
        const { azimuth, elevation } = mapConfig.atmosphere;
        const horizontal = Math.cos(elevation);
        return new THREE.Vector3(Math.cos(azimuth) * horizontal, Math.sin(elevation), Math.sin(azimuth) * horizontal);
    }

    buildSkyDome(mapConfig) {
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
            uniforms: {
                zenith: { value: new THREE.Color(mapConfig.skyColorTop) },
                middle: { value: new THREE.Color(mapConfig.skyColorMid) },
                horizon: { value: new THREE.Color(mapConfig.skyColorHorizon) },
                lightTint: { value: new THREE.Color(mapConfig.sunColor) },
                lightDirection: { value: this.getSkyLightDirection(mapConfig) },
                cloudCover: { value: mapConfig.atmosphere.clouds },
                night: { value: Number(mapConfig.atmosphere.night) }
            },
            vertexShader: `
                varying vec3 skyDirection;
                void main() {
                    skyDirection = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 zenith, middle, horizon, lightTint, lightDirection;
                uniform float cloudCover, night;
                varying vec3 skyDirection;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                float noise(vec2 p) {
                    vec2 cell = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
                               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
                }
                void main() {
                    vec3 sky = normalize(skyDirection);
                    float height = max(0.0, sky.y);
                    float towardLight = max(0.0, dot(sky, lightDirection));
                    vec3 color = mix(horizon, middle, smoothstep(-0.055, 0.33, sky.y));
                    color = mix(color, zenith, smoothstep(0.12, 0.83, height));
                    color = mix(color, lightTint, pow(towardLight, 16.0) * mix(0.36, 0.09, night));
                    float disk = smoothstep(mix(0.99928, 0.99963, night), 0.99988, towardLight);
                    color = mix(color, mix(vec3(1.0, 0.93, 0.75), vec3(0.74, 0.86, 1.0), night), disk);

                    vec2 clouds = sky.xz * vec2(4.0, 6.5) / (0.24 + height);
                    float billow = 0.59 * noise(clouds) + 0.27 * noise(clouds * 2.09 + 7.0)
                        + 0.14 * noise(clouds * 4.17 - 13.0);
                    float edge = 0.71 - 0.28 * cloudCover;
                    float cloud = smoothstep(edge, edge + 0.17, billow) * smoothstep(0.015, 0.18, height);
                    vec3 cloudTint = mix(mix(middle, vec3(0.96, 0.96, 0.94), pow(towardLight, 3.0) * 0.45 + 0.40), middle * 0.72, night);
                    gl_FragColor = vec4(mix(color, cloudTint, cloud * mix(0.91, 0.50, night)), 1.0);
                }
            `
        });
        const skyGeo = new THREE.SphereGeometry(1650, 32, 24);
        const skyDome = new THREE.Mesh(skyGeo, skyMat);
        skyDome.renderOrder = -100;
        this.worldGroup.add(skyDome);
    }

    /**
     * Dos crestas continuas aportan profundidad sin añadir objetos al trazado.
     */
    buildPerimeterMountains(mapConfig) {
        const palettes = {
            gravel_dark: [0x141b32, 0x31394b], sand_desert: [0x845e4e, 0xa68b79],
            sand_andean: [0x405260, 0x8795a1], sand_warm: [0x334344, 0x6b6883]
        };
        const positions = [];
        const colors = [];
        const indices = [];
        const steps = 144;
        const urban = mapConfig.atmosphere.night;
        const shade = new THREE.Color();
        for (let layer = 0; layer < 2; layer++) {
            const color = new THREE.Color(palettes[mapConfig.runoffType][layer]);
            const offset = positions.length / 3;
            for (let i = 0; i <= steps; i++) {
                const angle = i / steps * Math.PI * 2;
                const wave = 0.53 + Math.sin(angle * 5 + layer) * 0.19 + Math.cos(angle * 9 - layer) * 0.12;
                const ridge = wave + Math.sin(angle * 23) * 0.07 + Math.cos(angle * 37) * 0.035;
                const radius = 610 + layer * 385 + Math.cos(angle * 4 + layer) * 52;
                const height = ridge * (urban ? 55 : 116) + layer * (urban ? 30 : 88);
                for (let row = 0; row < 3; row++) {
                    const distance = radius + (row - 2) * (layer ? 72 : 54);
                    const y = row === 0 ? -1.4 : height * (row === 1 ? 0.43 : 1.0);
                    positions.push(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
                    const slope = (Math.cos(angle * 9 - layer) - Math.sin(angle * 23)) * 0.10;
                    shade.copy(color).multiplyScalar(0.78 + row * 0.13 + slope);
                    colors.push(shade.r, shade.g, shade.b);
                    if (i > 0 && row > 0) {
                        const vertex = offset + i * 3 + row;
                        indices.push(vertex - 4, vertex - 3, vertex - 1, vertex - 3, vertex, vertex - 1);
                    }
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        this.worldGroup.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }

    buildRoadsideLandscape(mapConfig) {
        const forest = mapConfig.runoffType === 'sand_warm';
        const desert = mapConfig.runoffType === 'sand_desert';
        const urban = mapConfig.atmosphere.night;
        const transforms = [];
        const palette = (forest ? [0x779674, 0x81966d, 0xa78a65, 0x7b9573]
            : desert ? [0x8b6545, 0xae845f, 0xc49a71]
                : urban ? [0x2a3447, 0x3b4053, 0x50515f] : [0x727347, 0x5d663a, 0x929054]).map((color) => new THREE.Color(color));
        const point = new THREE.Object3D();
        for (let i = 0; i < this.trackPoints.length; i += 5) {
            const center = this.trackPoints[i];
            const next = this.trackPoints[(i + 1) % this.trackPoints.length];
            const dx = next.x - center.x;
            const dz = next.z - center.z;
            const length = Math.hypot(dx, dz);
            for (const side of [-1, 1]) {
                for (let layer = 0; layer < (forest ? 2 : 1); layer++) {
                    const seed = (i * 83 + side * 61 + layer * 23 + 503) % 101 / 101;
                    const offset = side * (this.roadWidth / 2 + 9 + seed * (urban ? 12 : 22) + layer * 29);
                    const x = center.x + dz / length * offset;
                    const z = center.z - dx / length * offset;
                    const width = (forest ? 2.4 : urban ? 3.2 : 0.65) + seed * (desert ? 4.8 : 2.2);
                    if (!this.isPositionClearOfTrack(x, z, 2 + width * 1.5)) continue;
                    const height = forest ? 11 + seed * 14 : urban ? 1.5 + seed * 4 : 0.6 + seed * 2.8;
                    point.rotation.set(0, urban ? Math.atan2(dx, dz) : seed * Math.PI * 2, 0);
                    point.scale.set(width * (forest ? 2.15 : 1), height, width * (urban ? 1.4 : 1));
                    point.position.set(x, forest ? height * 0.5 - 0.6 : height * 0.34 - 0.65, z);
                    point.updateMatrix();
                    const color = palette[Math.floor(seed * palette.length)];
                    transforms.push([point.matrix.clone(), color]);
                    if (forest) {
                        point.rotation.y += Math.PI / 2;
                        point.updateMatrix();
                        transforms.push([point.matrix.clone(), color]);
                    }
                }
            }
        }
        const geometry = forest ? new THREE.PlaneGeometry(1, 1) : urban ? new THREE.BoxGeometry(1.6, 1, 2) : new THREE.IcosahedronGeometry(1, 0);
        const material = forest ? new THREE.MeshBasicMaterial({ map: this.textures.pine, alphaTest: 0.38, side: THREE.DoubleSide })
            : new THREE.MeshStandardMaterial({ roughness: 0.94 });
        const landscape = new THREE.InstancedMesh(geometry, material, transforms.length);
        transforms.forEach(([matrix, color], index) => {
            landscape.setMatrixAt(index, matrix);
            landscape.setColorAt(index, color);
        });
        this.worldGroup.add(landscape);
    }

    /**
     * Verifica geométricamente que cualquier posición candidata (x, z) en el mundo
     * respete una distancia mínima libre respecto a TODOS los segmentos de la pista.
     * Evita que dunas, taludes, edificios o árboles invadan el asfalto en curvas cerradas o eses.
     */
    isPositionClearOfTrack(x, z, extraClearance = 4.0) {
        const minAllowedDist = this.roadWidth * 0.5 + 1.5 + extraClearance;
        const minAllowedSq = minAllowedDist * minAllowedDist;
        const pts = this.trackPoints;
        const n = pts.length;

        for (let i = 0; i < n; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            const abx = b.x - a.x;
            const abz = b.z - a.z;
            const apx = x - a.x;
            const apz = z - a.z;
            const lenSq = abx * abx + abz * abz;
            let t = 0;
            if (lenSq > 0.0001) {
                t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / lenSq));
            }
            const cx = a.x + abx * t;
            const cz = a.z + abz * t;
            const dx = x - cx;
            const dz = z - cz;
            if (dx * dx + dz * dz < minAllowedSq) {
                return false;
            }
        }
        return true;
    }

    /**
     * Construye únicamente el zócalo/muro de soporte vertical ESTRICTAMENTE debajo de la calzada
     * (sin franjas laterales de arena ni tierra que se plieguen o invadan el asfalto en las curvas),
     * garantizando que el 100% de la pista se vea completamente limpia y despejada en los 5 escenarios.
     */
    buildTrackSandRunoffAndEmbankment(mapConfig) {
        const numPts = this.trackPoints.length;
        const edgeOffset = this.roadWidth * 0.5 + 0.85; // Exactamente bajo el borde del piano 3D

        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.88,
            metalness: 0.12
        });

        [-1, 1].forEach((side) => {
            const wallPos = [];
            const wallUvs = [];
            const wallIdx = [];

            for (let i = 0; i <= numPts; i++) {
                const idx = i % numPts;
                const nextIdx = (i + 1) % numPts;
                const p = this.trackPoints[idx];
                const pNext = this.trackPoints[nextIdx];

                const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
                const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

                const ptEdge = new THREE.Vector3().copy(p).addScaledVector(right, side * edgeOffset);

                // Muro vertical estrictamente bajo el borde de la pista (nunca sobresale hacia los lados ni hacia arriba)
                wallPos.push(
                    ptEdge.x, p.y + 0.02, ptEdge.z,
                    ptEdge.x, -0.65, ptEdge.z
                );

                const v = i / numPts;
                wallUvs.push(0, v, 1, v);

                if (i < numPts) {
                    const b = i * 2;
                    if (side === 1) {
                        wallIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
                    } else {
                        wallIdx.push(b + 1, b, b + 2, b + 3, b + 1, b + 2);
                    }
                }
            }

            const wGeo = new THREE.BufferGeometry();
            wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
            wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUvs, 2));
            wGeo.setIndex(wallIdx);
            wGeo.computeVertexNormals();
            const wMesh = new THREE.Mesh(wGeo, wallMat);
            wMesh.receiveShadow = true;
            this.worldGroup.add(wMesh);
        });
    }

    buildRoadAndLaneMeshes() {
        const numPts = this.trackPoints.length;
        const positions = [];
        const lanePositions = [];
        const uvs = [];
        const indices = [];

        const halfW = this.roadWidth * 0.5;

        for (let i = 0; i <= numPts; i++) {
            const idx = i % numPts;
            const nextIdx = (i + 1) % numPts;
            const p = this.trackPoints[idx];
            const pNext = this.trackPoints[nextIdx];

            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

            const leftPt = new THREE.Vector3().copy(p).addScaledVector(right, -halfW);
            const rightPt = new THREE.Vector3().copy(p).addScaledVector(right, halfW);

            positions.push(leftPt.x, leftPt.y + 0.08, leftPt.z);
            positions.push(rightPt.x, rightPt.y + 0.08, rightPt.z);

            lanePositions.push(leftPt.x, leftPt.y + 0.095, leftPt.z);
            lanePositions.push(rightPt.x, rightPt.y + 0.095, rightPt.z);

            const vCoord = i / numPts;
            uvs.push(0, vCoord);
            uvs.push(1, vCoord);

            if (i < numPts) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        const roadGeo = new THREE.BufferGeometry();
        roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        roadGeo.setIndex(indices);
        roadGeo.computeVertexNormals();

        const roadMat = new THREE.MeshStandardMaterial({
            map: this.textures.road,
            roughness: this.currentMap.atmosphere.night ? 0.27 : 0.82,
            metalness: this.currentMap.atmosphere.night ? 0.23 : 0.05,
            envMap: this.envMap,
            envMapIntensity: 0.45
        });

        const roadMesh = new THREE.Mesh(roadGeo, roadMat);
        roadMesh.receiveShadow = true;
        this.worldGroup.add(roadMesh);

        const laneGeo = new THREE.BufferGeometry();
        laneGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanePositions, 3));
        laneGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        laneGeo.setIndex(indices);
        laneGeo.computeVertexNormals();

        const laneMat = new THREE.MeshStandardMaterial({
            map: this.textures.laneMarkings,
            transparent: true,
            roughness: 0.3,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            depthWrite: false
        });

        const laneMesh = new THREE.Mesh(laneGeo, laneMat);
        laneMesh.receiveShadow = true;
        this.worldGroup.add(laneMesh);
    }

    build3DRumbleCurbs(mapConfig) {
        const numPts = this.trackPoints.length;
        const curbWidth = 1.15;
        const innerOffset = this.roadWidth * 0.5 - 0.25;
        const outerOffset = innerOffset + curbWidth;
        const curbTex = (mapConfig && mapConfig.curbStyle === 'cyan_white')
            ? this.textures.curbCyan3D
            : this.textures.curb3D;

        [-1, 1].forEach((side) => {
            const positions = [];
            const uvs = [];
            const indices = [];

            for (let i = 0; i <= numPts; i++) {
                const idx = i % numPts;
                const nextIdx = (i + 1) % numPts;
                const p = this.trackPoints[idx];
                const pNext = this.trackPoints[nextIdx];

                const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
                const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

                const rippleHeight = 0.16 + Math.sin(i * 1.8) * 0.038;

                const ptInner = new THREE.Vector3().copy(p).addScaledVector(right, side * innerOffset);
                const ptPeak = new THREE.Vector3().copy(p).addScaledVector(right, side * (innerOffset + curbWidth * 0.55));
                const ptOuter = new THREE.Vector3().copy(p).addScaledVector(right, side * outerOffset);

                positions.push(
                    ptInner.x, ptInner.y + 0.085, ptInner.z,
                    ptPeak.x, ptPeak.y + rippleHeight, ptPeak.z,
                    ptOuter.x, ptOuter.y + 0.04, ptOuter.z
                );

                const v = i / numPts;
                uvs.push(0, v, 0.5, v, 1, v);

                if (i < numPts) {
                    const b = i * 3;
                    if (side === 1) {
                        indices.push(b, b + 1, b + 3, b + 1, b + 4, b + 3);
                        indices.push(b + 1, b + 2, b + 4, b + 2, b + 5, b + 4);
                    } else {
                        indices.push(b + 1, b, b + 3, b + 4, b + 1, b + 3);
                        indices.push(b + 2, b + 1, b + 4, b + 5, b + 2, b + 4);
                    }
                }
            }

            const curbGeo = new THREE.BufferGeometry();
            curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            curbGeo.setIndex(indices);
            curbGeo.computeVertexNormals();

            const curbMat = new THREE.MeshStandardMaterial({
                map: curbTex,
                roughness: 0.45,
                metalness: 0.1,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });

            const curbMesh = new THREE.Mesh(curbGeo, curbMat);
            curbMesh.castShadow = true;
            curbMesh.receiveShadow = true;
            this.worldGroup.add(curbMesh);
        });
    }

    /**
     * Genera todas las marcas de frenada en curva en UNA sola malla combinada (1 Draw Call)
     * con polygonOffset para evitar cualquier Z-Fighting.
     */
    buildCornerSkidMarks() {
        const numPts = this.trackPoints.length;
        const positions = [];
        const uvs = [];
        const indices = [];
        let vertexOffset = 0;

        let i = 0;
        while (i < numPts) {
            if (this.trackCurvatures[i] > 0.020) {
                const startIdx = Math.max(0, i - 3);
                const endIdx = Math.min(numPts - 1, i + 9);
                const stripHalfW = this.roadWidth * 0.36;
                const totalSteps = endIdx - startIdx + 1;

                for (let step = 0; step < totalSteps; step++) {
                    const k = startIdx + step;
                    const p = this.trackPoints[k % numPts];
                    const pNext = this.trackPoints[(k + 1) % numPts];
                    const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
                    const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

                    const leftPt = new THREE.Vector3().copy(p).addScaledVector(right, -stripHalfW);
                    const rightPt = new THREE.Vector3().copy(p).addScaledVector(right, stripHalfW);

                    positions.push(leftPt.x, leftPt.y + 0.105, leftPt.z);
                    positions.push(rightPt.x, rightPt.y + 0.105, rightPt.z);

                    const v = step / Math.max(1, totalSteps - 1);
                    uvs.push(0, v, 1, v);

                    if (step < totalSteps - 1) {
                        const base = vertexOffset + step * 2;
                        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
                    }
                }
                vertexOffset += totalSteps * 2;
                i = endIdx + 6;
            } else {
                i++;
            }
        }

        if (positions.length === 0) return;

        const skidGeo = new THREE.BufferGeometry();
        skidGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        skidGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        skidGeo.setIndex(indices);

        const skidMat = new THREE.MeshBasicMaterial({
            map: this.textures.skidMarks,
            transparent: true,
            opacity: 0.30,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        });

        this.worldGroup.add(new THREE.Mesh(skidGeo, skidMat));
    }

    /**
     * Barreras Metálicas Bionda con Postes anclados a la berma de arena/grava (1 Draw Call para 360 postes).
     */
    buildMetallicGuardrails(mapConfig) {
        const numPts = this.trackPoints.length;
        const railOffset = this.roadWidth * 0.5 + 1.05;

        const railMat = new THREE.MeshStandardMaterial({
            map: this.textures.guardrail,
            metalness: 0.59,
            roughness: 0.48,
            envMap: this.envMap,
            side: THREE.DoubleSide
        });

        const postMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            metalness: 0.8,
            roughness: 0.35
        });

        const neonTopMat = new THREE.MeshBasicMaterial({
            color: mapConfig.shoulderColor
        });

        const postGeo = new THREE.BoxGeometry(0.18, 1.65, 0.18);
        const postTransforms = [];
        const dummy = new THREE.Object3D();

        [-1, 1].forEach((side) => {
            const railPositions = [];
            const railUvs = [];
            const railIndices = [];

            const neonPositions = [];
            const neonIndices = [];

            for (let i = 0; i <= numPts; i++) {
                const idx = i % numPts;
                const nextIdx = (i + 1) % numPts;
                const p = this.trackPoints[idx];
                const pNext = this.trackPoints[nextIdx];

                const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
                const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * railOffset);

                railPositions.push(pos.x, pos.y + 0.38, pos.z);
                railPositions.push(pos.x, pos.y + 0.95, pos.z);

                neonPositions.push(pos.x, pos.y + 0.96, pos.z);
                neonPositions.push(pos.x, pos.y + 1.06, pos.z);

                const u = i / numPts;
                railUvs.push(u, 0, u, 1);

                if (i < numPts) {
                    const b = i * 2;
                    railIndices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
                    neonIndices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);

                    if (i % 2 === 0) {
                        dummy.position.set(pos.x, pos.y + 0.30, pos.z);
                        dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
                        dummy.updateMatrix();
                        postTransforms.push(dummy.matrix.clone());
                    }
                }
            }

            const rGeo = new THREE.BufferGeometry();
            rGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
            rGeo.setAttribute('uv', new THREE.Float32BufferAttribute(railUvs, 2));
            rGeo.setIndex(railIndices);
            rGeo.computeVertexNormals();

            const rMesh = new THREE.Mesh(rGeo, railMat);
            rMesh.castShadow = true;
            rMesh.receiveShadow = true;
            this.worldGroup.add(rMesh);

            const nGeo = new THREE.BufferGeometry();
            nGeo.setAttribute('position', new THREE.Float32BufferAttribute(neonPositions, 3));
            nGeo.setIndex(neonIndices);
            this.worldGroup.add(new THREE.Mesh(nGeo, neonTopMat));
        });

        const instancedPosts = new THREE.InstancedMesh(postGeo, postMat, postTransforms.length);
        instancedPosts.castShadow = true;
        instancedPosts.receiveShadow = true;
        postTransforms.forEach((mat, idx) => instancedPosts.setMatrixAt(idx, mat));
        instancedPosts.instanceMatrix.needsUpdate = true;
        this.worldGroup.add(instancedPosts);
    }

    buildJapaneseTrafficSigns() {
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });
        const signTypes = ['direction', 'curve', 'tomare'];
        const signMaterials = signTypes.map(type => {
            const tex = this.createTrafficSignTexture(type);
            return new THREE.MeshStandardMaterial({
                map: tex,
                emissive: 0xffffff,
                emissiveMap: tex,
                emissiveIntensity: 0.45,
                transparent: true,
                alphaTest: 0.1,
                side: THREE.DoubleSide
            });
        });

        // Poste con cimentación extendida para que nunca quede flotando sobre la berma
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.09, 5.2, 8);
        const boardGeo = new THREE.PlaneGeometry(1.45, 1.45);
        const poleMatrices = [];
        const dummy = new THREE.Object3D();

        for (let i = 10; i < this.trackPoints.length; i += 18) {
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            const side = (i % 36 === 10) ? -1 : 1;
            const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * (this.roadWidth * 0.5 + 2.1));

            dummy.position.set(pos.x, p.y + 1.2, pos.z);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            poleMatrices.push(dummy.matrix.clone());

            const matIdx = this.trackCurvatures[i] > 0.02 ? 1 : (i % 3);
            const board = new THREE.Mesh(boardGeo, signMaterials[matIdx]);
            board.position.set(pos.x, p.y + 3.45, pos.z);
            board.lookAt(pos.x - tangent.x, p.y + 3.45, pos.z - tangent.z);
            this.worldGroup.add(board);
        }

        const instPoles = new THREE.InstancedMesh(poleGeo, poleMat, poleMatrices.length);
        poleMatrices.forEach((m, i) => instPoles.setMatrixAt(i, m));
        instPoles.instanceMatrix.needsUpdate = true;
        this.worldGroup.add(instPoles);
    }

    /**
     * Farolas de Circuito optimizadas con THREE.InstancedMesh (4 Draw Calls en total)
     * + THREE.SpotLight atenuadas reales sobre el asfalto.
     */
    buildStreetLightsWithSpotlights() {
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
        const bulbMat = new THREE.MeshStandardMaterial({
            color: 0xe0f2fe,
            emissive: 0x38bdf8,
            emissiveIntensity: 2.2
        });
        const coneMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const poleGeo = new THREE.CylinderGeometry(0.14, 0.22, 10.6, 8);
        const armGeo = new THREE.BoxGeometry(0.14, 0.14, 4.2);
        const bulbGeo = new THREE.BoxGeometry(0.9, 0.18, 0.45);
        const coneGeo = new THREE.ConeGeometry(4.2, 8.5, 12, 1, true);

        const poleMats = [];
        const armMats = [];
        const bulbMats = [];
        const coneMats = [];
        const dummy = new THREE.Object3D();

        let spotLightCount = 0;
        const maxActiveSpotLights = 8;

        for (let i = 0; i < this.trackPoints.length; i += 14) {
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            const side = (i % 28 === 0) ? 1 : -1;
            const basePos = new THREE.Vector3().copy(p).addScaledVector(right, side * (this.roadWidth * 0.5 + 1.55));
            const armDir = new THREE.Vector3().copy(right).multiplyScalar(-side);

            // Mástil hundido en la berma para no flotar nunca
            dummy.position.set(basePos.x, p.y + 3.5, basePos.z);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            poleMats.push(dummy.matrix.clone());

            // Brazo
            const armPos = new THREE.Vector3().copy(basePos).addScaledVector(armDir, 2.1);
            dummy.position.set(armPos.x, p.y + 8.7, armPos.z);
            dummy.lookAt(basePos.x + armDir.x * 5, p.y + 8.7, basePos.z + armDir.z * 5);
            dummy.updateMatrix();
            armMats.push(dummy.matrix.clone());

            // Cabezal LED
            const headPos = new THREE.Vector3().copy(basePos).addScaledVector(armDir, 3.8);
            dummy.position.set(headPos.x, p.y + 8.62, headPos.z);
            dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
            dummy.updateMatrix();
            bulbMats.push(dummy.matrix.clone());

            // Cono de luz
            dummy.position.set(headPos.x, p.y + 4.3, headPos.z);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            coneMats.push(dummy.matrix.clone());

            if (spotLightCount < maxActiveSpotLights && i % 56 === 0) {
                const spot = new THREE.SpotLight(0x38bdf8, 1.35, 38, Math.PI / 3.2, 0.65, 1.5);
                spot.position.set(headPos.x, p.y + 8.5, headPos.z);
                spot.target.position.set(p.x, p.y, p.z);
                this.worldGroup.add(spot);
                this.worldGroup.add(spot.target);
                spotLightCount++;
            }
        }

        const addInst = (geo, mat, matrices, castShadow = false) => {
            const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
            inst.castShadow = castShadow;
            matrices.forEach((m, idx) => inst.setMatrixAt(idx, m));
            inst.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(inst);
        };

        addInst(poleGeo, poleMat, poleMats, true);
        addInst(armGeo, poleMat, armMats, false);
        addInst(bulbGeo, bulbMat, bulbMats, false);
        addInst(coneGeo, coneMat, coneMats, false);
    }

    buildFestivalStartGate(mapConfig) {
        const p0 = this.trackPoints[0];
        const p1 = this.trackPoints[1];
        const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();
        const angle = Math.atan2(tangent.x, tangent.z);

        const gateGroup = new THREE.Group();
        gateGroup.position.copy(p0);
        gateGroup.rotation.y = angle;

        const finishPlaneGeo = new THREE.PlaneGeometry(this.roadWidth * 0.96, 3.6);
        const finishPlaneMat = new THREE.MeshStandardMaterial({
            map: this.textures.finishLine,
            roughness: 0.4,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3
        });
        const finishPlane = new THREE.Mesh(finishPlaneGeo, finishPlaneMat);
        finishPlane.rotation.x = -Math.PI / 2;
        finishPlane.position.set(0, 0.12, 0);
        finishPlane.receiveShadow = true;
        gateGroup.add(finishPlane);

        const pillarGeo = new THREE.BoxGeometry(1.4, 12.5, 1.4);
        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            emissive: mapConfig && mapConfig.hasAutodromePits ? 0xef4444 : 0xf43f5e,
            emissiveIntensity: 0.65
        });

        const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
        leftPillar.position.set(-this.roadWidth * 0.54, 4.25, 0);
        leftPillar.castShadow = true;
        gateGroup.add(leftPillar);

        const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
        rightPillar.position.set(this.roadWidth * 0.54, 4.25, 0);
        rightPillar.castShadow = true;
        gateGroup.add(rightPillar);

        const isPeru = mapConfig && mapConfig.hasAutodromePits;
        const bannerTex = this.createNeonSignTexture(
            'APEX ROUTES',
            isPeru ? 'GRAN PREMIO DEL PERÚ' : 'GRAN PREMIO DE JAPÓN',
            '#090d16',
            isPeru ? '#ef4444' : '#00e5ff'
        );
        const bannerGeo = new THREE.BoxGeometry(this.roadWidth * 1.15, 3.1, 1.0);
        const bannerMat = new THREE.MeshStandardMaterial({
            map: bannerTex,
            emissive: 0xffffff,
            emissiveMap: bannerTex,
            emissiveIntensity: 0.9
        });
        const banner = new THREE.Mesh(bannerGeo, bannerMat);
        banner.position.set(0, 9.5, 0);
        gateGroup.add(banner);

        this.worldGroup.add(gateGroup);
    }

    buildCheckpointArches() {
        const checkpointIndices = [72, 144, 216, 288];
        const archMat = new THREE.MeshStandardMaterial({
            color: 0x22c55e,
            emissive: 0x22c55e,
            emissiveIntensity: 1.1,
            transparent: true,
            opacity: 0.82
        });

        checkpointIndices.forEach((ptIdx, cpNumber) => {
            const p = this.trackPoints[ptIdx];
            const pNext = this.trackPoints[(ptIdx + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const angle = Math.atan2(tangent.x, tangent.z);

            const cpGroup = new THREE.Group();
            cpGroup.position.copy(p);
            cpGroup.rotation.y = angle;

            const leftLaser = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 11, 8), archMat);
            leftLaser.position.set(-this.roadWidth * 0.5, 3.8, 0);
            cpGroup.add(leftLaser);

            const rightLaser = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 11, 8), archMat);
            rightLaser.position.set(this.roadWidth * 0.5, 3.8, 0);
            cpGroup.add(rightLaser);

            const topBar = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth, 0.65, 0.65), archMat);
            topBar.position.set(0, 9.0, 0);
            cpGroup.add(topBar);

            this.worldGroup.add(cpGroup);
            this.checkpoints.push({
                index: ptIdx,
                cpNumber: cpNumber + 1,
                position: p,
                meshGroup: cpGroup
            });
        });
    }

    buildMountFuji() {
        const rings = [[410, -1], [305, 56], [209, 120], [139, 192], [101, 235], [34, 315], [16, 320], [0, 317]];
        const positions = [];
        const colors = [];
        const indices = [];
        const rock = new THREE.Color(0x596277);
        const snow = new THREE.Color(0xe4dce0);
        const color = new THREE.Color();
        const segments = 56;
        rings.forEach(([radius, height], ringIndex) => {
            for (let i = 0; i <= segments; i++) {
                const angle = i / segments * Math.PI * 2;
                const ridge = Math.sin(angle * 13) * 0.14 + Math.cos(angle * 21) * 0.08;
                const distance = radius * (1 + ridge * (ringIndex < 5 ? 0.6 : 0.23));
                const y = height + ridge * (ringIndex === 4 ? 91 : 19);
                positions.push(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
                color.copy(ringIndex >= 4 ? snow : rock).multiplyScalar(0.88 + Math.sin(angle - 2) * 0.13 + ridge * 0.24);
                colors.push(color.r, color.g, color.b);
                if (ringIndex && i) {
                    const a = (ringIndex - 1) * (segments + 1) + i - 1;
                    const b = a + segments + 1;
                    indices.push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        const mountain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        mountain.position.set(720, -2, 695);
        this.worldGroup.add(mountain);
    }

    buildTokyoTower() {
        const towerGroup = new THREE.Group();
        towerGroup.position.set(140, -1, -90);

        const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.4 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x475569, emissiveIntensity: 0.3 });
        const deckMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.9 });

        const heights = [28, 26, 24, 22, 20, 18];
        const radii = [18, 13, 9.5, 7, 4.8, 2.5];
        let currentY = 0;

        for (let i = 0; i < heights.length; i++) {
            const h = heights[i];
            const rBottom = radii[i];
            const rTop = radii[i + 1] || 1.2;
            const segGeo = new THREE.CylinderGeometry(rTop, rBottom, h, 8);
            const segMesh = new THREE.Mesh(segGeo, i % 2 === 0 ? redMat : whiteMat);
            segMesh.position.y = currentY + h / 2;
            towerGroup.add(segMesh);
            currentY += h;
        }

        const obsMesh = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 22), deckMat);
        obsMesh.position.y = 42;
        towerGroup.add(obsMesh);

        const spireMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.0, 35, 6), redMat);
        spireMesh.position.y = currentY + 17.5;
        towerGroup.add(spireMesh);

        this.worldGroup.add(towerGroup);
    }

    /**
     * Puertas Torii con columnas de cimentación profunda (3 Draw Calls en total)
     * para que nunca se vean flotando en pendientes.
     */
    buildToriiGatesAlongTrack() {
        const toriiMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 });
        const blackMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 });

        const colGeo = new THREE.CylinderGeometry(0.55, 0.68, 13.5, 10);
        const topBeamGeo = new THREE.BoxGeometry(this.roadWidth * 1.3, 0.9, 1.1);
        const subBeamGeo = new THREE.BoxGeometry(this.roadWidth * 1.18, 0.65, 0.8);

        const colMats = [];
        const topMats = [];
        const subMats = [];
        const dummy = new THREE.Object3D();

        for (let i = 24; i < this.trackPoints.length; i += 32) {
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
            const angle = Math.atan2(tangent.x, tangent.z);

            [-1, 1].forEach((side) => {
                const cPos = new THREE.Vector3().copy(p).addScaledVector(right, side * this.roadWidth * 0.56);
                dummy.position.set(cPos.x, p.y + 3.05, cPos.z);
                dummy.rotation.set(0, angle, 0);
                dummy.updateMatrix();
                colMats.push(dummy.matrix.clone());
            });

            dummy.position.set(p.x, p.y + 9.8, p.z);
            dummy.rotation.set(0, angle, 0);
            dummy.updateMatrix();
            topMats.push(dummy.matrix.clone());

            dummy.position.set(p.x, p.y + 8.0, p.z);
            dummy.rotation.set(0, angle, 0);
            dummy.updateMatrix();
            subMats.push(dummy.matrix.clone());
        }

        const addInst = (geo, mat, matrices) => {
            const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
            inst.castShadow = true;
            inst.receiveShadow = true;
            matrices.forEach((m, idx) => inst.setMatrixAt(idx, m));
            inst.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(inst);
        };

        addInst(colGeo, toriiMat, colMats);
        addInst(topBeamGeo, blackMat, topMats);
        addInst(subBeamGeo, toriiMat, subMats);
    }

    buildCitySkyscrapers() {
        const bldMat = new THREE.MeshStandardMaterial({
            map: this.textures.building,
            emissive: 0xffffff,
            emissiveMap: this.textures.building,
            emissiveIntensity: 0.65,
            roughness: 0.3,
            metalness: 0.5
        });

        const signTexts = [
            ['東京 WANGAN', 'SHUTO EXPWY', '#0f172a', '#00e5ff'],
            ['秋葉原 CYBER', 'AKIHABARA', '#1e1b4b', '#f43f5e'],
            ['渋谷 DRIFT', 'SHIBUYA 109', '#090d16', '#a855f7'],
            ['頭文字 TOUGE', 'JDM LEGENDS', '#18181b', '#facc15']
        ];

        const signMats = signTexts.map(s => {
            const tex = this.createNeonSignTexture(s[0], s[1], s[2], s[3]);
            return new THREE.MeshStandardMaterial({
                map: tex,
                emissive: 0xffffff,
                emissiveMap: tex,
                emissiveIntensity: 1.25,
                roughness: 0.2,
                side: THREE.DoubleSide
            });
        });

        // 4 arquetipos de rascacielos asentados firmemente desde el suelo (-2m)
        const archetypes = [
            { w: 16, d: 16, h: 46 },
            { w: 20, d: 18, h: 64 },
            { w: 22, d: 20, h: 82 },
            { w: 26, d: 22, h: 102 }
        ];

        const archData = archetypes.map(({ w, d, h }) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            const uvAttr = geo.attributes.uv;
            const repeatX = Math.max(1, Math.round(w / 14));
            const repeatY = Math.max(1, Math.round(h / 18));
            for (let uIdx = 0; uIdx < uvAttr.count; uIdx++) {
                uvAttr.setXY(uIdx, uvAttr.getX(uIdx) * repeatX, uvAttr.getY(uIdx) * repeatY);
            }
            uvAttr.needsUpdate = true;
            return { geo, h, matrices: [] };
        });

        const dummy = new THREE.Object3D();
        const signGeo = new THREE.PlaneGeometry(11, 5.5);

        for (let i = 4; i < this.trackPoints.length; i += 7) {
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            [-1, 1].forEach((side, sideIdx) => {
                const archIdx = (i + sideIdx) % archData.length;
                const arch = archData[archIdx];
                const dist = this.roadWidth * 0.5 + 24 + (i % 3) * 8;
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * dist);

                if (!this.isPositionClearOfTrack(pos.x, pos.z, 16.0)) return;

                dummy.position.set(pos.x, arch.h * 0.5 - 3.0, pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                arch.matrices.push(dummy.matrix.clone());

                if (i % 14 === 0) {
                    const signPos = new THREE.Vector3().copy(p).addScaledVector(right, side * (this.roadWidth * 0.5 + 6.8));
                    if (this.isPositionClearOfTrack(signPos.x, signPos.z, 3.5)) {
                        const signMesh = new THREE.Mesh(signGeo, signMats[(i + sideIdx) % signMats.length]);
                        signMesh.position.set(signPos.x, p.y + 8.5 + (i % 8), signPos.z);
                        signMesh.lookAt(p.x, p.y + 6.5, p.z);
                        this.worldGroup.add(signMesh);
                    }
                }
            });
        }

        archData.forEach(({ geo, matrices }) => {
            if (!matrices.length) return;
            const inst = new THREE.InstancedMesh(geo, bldMat, matrices.length);
            inst.castShadow = true;
            inst.receiveShadow = true;
            matrices.forEach((m, idx) => inst.setMatrixAt(idx, m));
            inst.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(inst);
        });
    }

    /**
     * Cerezos Sakura orgánicos multi-plano (sin las esferas rosas artificiales)
     * anclados firmemente en el suelo exterior y con pétalos circulares suaves.
     */
    buildSakuraTreesAndPetals() {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3e1f0d, roughness: 0.92 });
        const crossedPlaneMat = new THREE.MeshStandardMaterial({
            map: this.textures.sakuraBranch,
            alphaTest: 0.28,
            transparent: true,
            roughness: 0.65,
            side: THREE.DoubleSide
        });

        // Tronco largo (6.8m) que penetra en el suelo para no flotar jamás
        const trunkGeo = new THREE.CylinderGeometry(0.24, 0.52, 6.8, 8);
        const crossedPlaneGeo = new THREE.PlaneGeometry(7.6, 6.8);

        const trunkMats = [];
        const planeMats = [];
        const dummy = new THREE.Object3D();

        for (let i = 3; i < this.trackPoints.length; i += 5) {
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            [-1, 1].forEach((side) => {
                const offset = this.roadWidth * 0.5 + 8.5 + ((i * 7) % 10);
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * offset);
                if (!this.isPositionClearOfTrack(pos.x, pos.z, 5.5)) return;

                const groundSurfaceY = -0.15;

                dummy.position.set(pos.x, groundSurfaceY + 1.4, pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                trunkMats.push(dummy.matrix.clone());

                const baseRot = (i * 0.7) % Math.PI;
                const sc = 0.92 + (i % 4) * 0.14;
                // 3 planos cruzados a 60° + 1 plano inclinado de copa superior (100% orgánico, sin esfera)
                for (let pIdx = 0; pIdx < 3; pIdx++) {
                    dummy.position.set(pos.x, groundSurfaceY + 4.9 * sc, pos.z);
                    dummy.rotation.set((pIdx - 1) * 0.12, baseRot + (pIdx * Math.PI) / 3, 0);
                    dummy.scale.set(sc, sc, sc);
                    dummy.updateMatrix();
                    planeMats.push(dummy.matrix.clone());
                }
            });
        }

        const addInst = (geo, mat, matrices) => {
            if (!matrices.length) return;
            const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
            inst.castShadow = true;
            inst.receiveShadow = true;
            matrices.forEach((m, idx) => inst.setMatrixAt(idx, m));
            inst.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(inst);
        };

        addInst(trunkGeo, trunkMat, trunkMats);
        addInst(crossedPlaneGeo, crossedPlaneMat, planeMats);

        const petalCount = 360;
        const petalGeo = new THREE.BufferGeometry();
        const petalPositions = new Float32Array(petalCount * 3);
        for (let i = 0; i < petalCount; i++) {
            const pt = this.trackPoints[i % this.trackPoints.length];
            petalPositions[i * 3] = pt.x + (Math.random() - 0.5) * 40;
            petalPositions[i * 3 + 1] = pt.y + 1.5 + Math.random() * 14;
            petalPositions[i * 3 + 2] = pt.z + (Math.random() - 0.5) * 40;
        }
        petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPositions, 3));
        const petalMat = new THREE.PointsMaterial({
            color: 0xfbcfe8,
            map: this.textures.roundParticle,
            alphaTest: 0.15,
            size: 0.65,
            transparent: true,
            opacity: 0.88,
            depthWrite: false
        });
        this.sakuraParticles = new THREE.Points(petalGeo, petalMat);
        this.worldGroup.add(this.sakuraParticles);
    }

    /**
     * Construye el Complejo Oficial de Autódromo Peruano (inspirado en las fotos de RACING.PE
     * de Arequipa, Trujillo, Cusco y Puno): Edificio de Boxes (Pit Lane), Torre de Control,
     * Tribunas Techadas y Barreras de Neumáticos Rojos/Blancos fuera de la pista.
     */
    buildPeruvianAutodromeComplex(mapConfig) {
        const p0 = this.trackPoints[8];
        const p1 = this.trackPoints[9];
        const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();
        const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
        const angle = Math.atan2(tangent.x, tangent.z);

        const pitGroup = new THREE.Group();
        const pitPos = new THREE.Vector3().copy(p0).addScaledVector(right, -(this.roadWidth * 0.5 + 24.0));
        pitGroup.position.set(pitPos.x, -0.1, pitPos.z);
        pitGroup.rotation.y = angle;

        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.15 });
        const darkGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.85 });
        const redAccentMat = new THREE.MeshStandardMaterial({
            color: mapConfig.curbStyle === 'cyan_white' ? 0x0891b2 : 0xdc2626,
            roughness: 0.4
        });

        // 1. Edificio Principal de Boxes (Pit Garages) retirado de la calzada
        const mainBld = new THREE.Mesh(new THREE.BoxGeometry(12, 7.5, 48), whiteMat);
        mainBld.position.set(0, 3.75, 0);
        mainBld.castShadow = true;
        mainBld.receiveShadow = true;
        pitGroup.add(mainBld);

        // Franja superior RACING.PE y visera de boxes
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.4, 50), redAccentMat);
        fascia.position.set(0, 7.6, 0);
        pitGroup.add(fascia);

        // Ventanal VIP en segundo piso
        const vipGlass = new THREE.Mesh(new THREE.BoxGeometry(12.3, 2.2, 44), darkGlassMat);
        vipGlass.position.set(0, 5.4, 0);
        pitGroup.add(vipGlass);

        // 5 Puertas de Garaje de Boxes hacia la pista
        for (let b = -2; b <= 2; b++) {
            const bayDoor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 6.2), darkGlassMat);
            bayDoor.position.set(6.0, 1.6, b * 8.6);
            pitGroup.add(bayDoor);
        }

        // 2. Torre de Control de Carrera (Race Control Tower)
        const towerBase = new THREE.Mesh(new THREE.BoxGeometry(9, 18, 9), whiteMat);
        towerBase.position.set(-2, 9, -29);
        towerBase.castShadow = true;
        pitGroup.add(towerBase);

        const towerCabin = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4.5, 11.5), darkGlassMat);
        towerCabin.position.set(-2, 16.5, -29);
        pitGroup.add(towerCabin);

        const towerRoof = new THREE.Mesh(new THREE.BoxGeometry(12.5, 1.1, 12.5), redAccentMat);
        towerRoof.position.set(-2, 19.2, -29);
        pitGroup.add(towerRoof);

        // 3. Tribuna Techada Frente a Boxes (lado opuesto de la recta principal)
        const grandStandGroup = new THREE.Group();
        const standPos = new THREE.Vector3().copy(p0).addScaledVector(right, this.roadWidth * 0.5 + 25.0);
        grandStandGroup.position.set(standPos.x, -0.1, standPos.z);
        grandStandGroup.rotation.y = angle;

        for (let step = 0; step < 5; step++) {
            const tier = new THREE.Mesh(
                new THREE.BoxGeometry(2.2, 1.2 + step * 1.1, 46),
                step % 2 === 0 ? whiteMat : redAccentMat
            );
            tier.position.set(step * 2.1, (1.2 + step * 1.1) * 0.5, 0);
            tier.castShadow = true;
            grandStandGroup.add(tier);
        }

        const canopy = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.6, 48), whiteMat);
        canopy.position.set(4.2, 9.5, 0);
        canopy.rotation.z = 0.12;
        grandStandGroup.add(canopy);

        if (this.isPositionClearOfTrack(pitPos.x, pitPos.z, 12.0)) {
            this.worldGroup.add(pitGroup);
        }
        if (this.isPositionClearOfTrack(standPos.x, standPos.z, 12.0)) {
            this.worldGroup.add(grandStandGroup);
        }

        // 4. Barreras de Neumáticos Rojos y Blancos (Tire Walls) exteriores a los guardarraíles
        const tireGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.35, 10);
        const redTireMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.85 });
        const whiteTireMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85 });
        const redTireMats = [];
        const whiteTireMats = [];
        const dummy = new THREE.Object3D();

        for (let i = 0; i < this.trackPoints.length; i += 3) {
            if (this.trackCurvatures[i] > 0.016) {
                const pt = this.trackPoints[i];
                const ptNext = this.trackPoints[(i + 1) % this.trackPoints.length];
                const tan = new THREE.Vector3().subVectors(ptNext, pt).normalize();
                const rVec = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();

                [-1, 1].forEach((side) => {
                    const tPos = new THREE.Vector3().copy(pt).addScaledVector(rVec, side * (this.roadWidth * 0.5 + 8.5));
                    if (!this.isPositionClearOfTrack(tPos.x, tPos.z, 4.5)) return;
                    dummy.position.set(tPos.x, 0.45, tPos.z);
                    dummy.rotation.set(0, 0, 0);
                    dummy.updateMatrix();
                    if ((i + (side > 0 ? 1 : 0)) % 2 === 0) {
                        redTireMats.push(dummy.matrix.clone());
                    } else {
                        whiteTireMats.push(dummy.matrix.clone());
                    }
                });
            }
        }

        if (redTireMats.length > 0) {
            const instRed = new THREE.InstancedMesh(tireGeo, redTireMat, redTireMats.length);
            redTireMats.forEach((m, idx) => instRed.setMatrixAt(idx, m));
            instRed.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(instRed);
        }
        if (whiteTireMats.length > 0) {
            const instWhite = new THREE.InstancedMesh(tireGeo, whiteTireMat, whiteTireMats.length);
            whiteTireMats.forEach((m, idx) => instWhite.setMatrixAt(idx, m));
            instWhite.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(instWhite);
        }
    }

    /**
     * Escenario Perú 1 (Autódromo Arequipa & Trujillo):
     * Volcán Misti nevado al fondo, dunas de arena dorada en el horizonte lejano (100% fuera de la pista) y costa del Pacífico.
     */
    buildVolcanMistiAndPacific() {
        // 1. Volcán Misti (Arequipa) - Cono simétrico icónico con cumbre nevada
        const mistiGroup = new THREE.Group();
        mistiGroup.position.set(-480, -2, -590);

        const coneGeo = new THREE.ConeGeometry(340, 235, 32);
        const coneMat = new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 0.9 });
        const coneMesh = new THREE.Mesh(coneGeo, coneMat);
        coneMesh.position.y = 117;
        mistiGroup.add(coneMesh);

        const snowGeo = new THREE.ConeGeometry(118, 82, 32);
        const snowMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
        const snowMesh = new THREE.Mesh(snowGeo, snowMat);
        snowMesh.position.y = 194;
        mistiGroup.add(snowMesh);

        // Volcán Chachani adyacente
        const chachaniMesh = new THREE.Mesh(new THREE.ConeGeometry(280, 185, 24), coneMat);
        chachaniMesh.position.set(290, 92, -40);
        mistiGroup.add(chachaniMesh);

        this.worldGroup.add(mistiGroup);

        // 2. Bahía Costera del Pacífico (Trujillo / Huanchaco) en el horizonte oriental
        const oceanGeo = new THREE.PlaneGeometry(2600, 950);
        const oceanMat = new THREE.MeshStandardMaterial({
            color: 0x0284c7,
            roughness: 0.18,
            metalness: 0.65
        });
        const ocean = new THREE.Mesh(oceanGeo, oceanMat);
        ocean.rotation.x = -Math.PI / 2;
        ocean.position.set(0, -0.45, 880);
        this.worldGroup.add(ocean);

        // 3. Dunas de Arena Dorada instanciadas ÚNICAMENTE en el horizonte exterior lejano (> 760m, jamás sobre o cerca de la pista)
        const duneGeo = new THREE.ConeGeometry(32, 12, 12);
        const duneMat = new THREE.MeshStandardMaterial({
            map: this.textures.sandDesert,
            roughness: 0.92
        });
        const duneMats = [];
        const dummy = new THREE.Object3D();
        const horizonCount = 28;

        for (let i = 0; i < horizonCount; i++) {
            const ang = (i / horizonCount) * Math.PI * 2;
            const dist = 760 + (i % 3) * 90;
            const posX = Math.cos(ang) * dist;
            const posZ = Math.sin(ang) * dist;
            if (!this.isPositionClearOfTrack(posX, posZ, 130.0)) continue;

            const sc = 0.85 + (i % 3) * 0.25;
            dummy.position.set(posX, (12 * sc * 0.4) - 1.2, posZ);
            dummy.rotation.set(0, i * 0.4, 0);
            dummy.scale.set(sc * 1.25, sc * 0.65, sc);
            dummy.updateMatrix();
            duneMats.push(dummy.matrix.clone());
        }

        if (duneMats.length > 0) {
            const instDunes = new THREE.InstancedMesh(duneGeo, duneMat, duneMats.length);
            instDunes.receiveShadow = true;
            duneMats.forEach((m, idx) => instDunes.setMatrixAt(idx, m));
            instDunes.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(instDunes);
        }
    }

    /**
     * Escenario Perú 2 (Autódromo Cusco & Lago Titicaca - Puno):
     * Gran Lago Titicaca azul profundo, laderas andinas y casas tradicionales de ladrillo/teja terracota.
     */
    buildLakeTiticacaAndAndeanTown() {
        // 1. Espejo de agua del Lago Titicaca (Puno)
        const lakeGeo = new THREE.PlaneGeometry(2400, 1050);
        const lakeMat = new THREE.MeshStandardMaterial({
            color: 0x307d92,
            roughness: 0.31,
            metalness: 0.34,
            envMap: this.envMap,
            envMapIntensity: 0.65
        });
        const lake = new THREE.Mesh(lakeGeo, lakeMat);
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(0, -0.42, -820);
        this.worldGroup.add(lake);

        // 2. Viviendas Andinas de Ladrillo y Tejado Terracota (estilo Cusco / Puno en las fotos aéreas)
        const wallGeo = new THREE.BoxGeometry(9.5, 6.2, 8.5);
        const roofGeo = new THREE.ConeGeometry(7.2, 3.2, 4);
        const facade = document.createElement('canvas');
        facade.width = facade.height = 128;
        const brush = facade.getContext('2d');
        brush.fillStyle = '#af8163';
        brush.fillRect(0, 0, 128, 128);
        brush.fillStyle = '#956750';
        for (let y = 7; y < 128; y += 8) {
            brush.fillRect(0, y, 128, 1);
            for (let x = (y % 16 ? 0 : 8); x < 128; x += 16) brush.fillRect(x, y, 1, 8);
        }
        brush.fillStyle = '#473d36';
        brush.fillRect(53, 71, 22, 57);
        [19, 52, 85].forEach((x) => {
            brush.fillStyle = '#d9b68b';
            brush.fillRect(x - 2, 25, 22, 31);
            brush.fillStyle = '#273338';
            brush.fillRect(x, 27, 18, 26);
            brush.fillStyle = '#48594e';
            brush.fillRect(x + 8, 27, 2, 26);
        });
        const wallMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(facade), roughness: 0.92 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x8f432e, roughness: 0.86 });

        const wallMats = [];
        const roofMats = [];
        const dummy = new THREE.Object3D();

        for (let i = 6; i < this.trackPoints.length; i += 6) {
            if (i < 22 || i > 338) continue; // Dejar libre la zona de Boxes
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            [-1, 1].forEach((side) => {
                const dist = this.roadWidth * 0.5 + 34 + ((i * 7) % 28);
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * dist);
                if (!this.isPositionClearOfTrack(pos.x, pos.z, 12.0)) return;
                const rotY = Math.atan2(tangent.x, tangent.z);

                dummy.position.set(pos.x, 2.5, pos.z);
                dummy.rotation.set(0, rotY, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                wallMats.push(dummy.matrix.clone());

                dummy.position.set(pos.x, 7.1, pos.z);
                dummy.rotation.set(0, rotY + Math.PI / 4, 0);
                dummy.updateMatrix();
                roofMats.push(dummy.matrix.clone());
            });
        }

        if (wallMats.length > 0) {
            const instWalls = new THREE.InstancedMesh(wallGeo, wallMat, wallMats.length);
            instWalls.castShadow = true;
            instWalls.receiveShadow = true;
            wallMats.forEach((m, idx) => instWalls.setMatrixAt(idx, m));
            instWalls.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(instWalls);
        }

        if (roofMats.length > 0) {
            const instRoofs = new THREE.InstancedMesh(roofGeo, roofMat, roofMats.length);
            instRoofs.castShadow = true;
            roofMats.forEach((m, idx) => instRoofs.setMatrixAt(idx, m));
            instRoofs.instanceMatrix.needsUpdate = true;
            this.worldGroup.add(instRoofs);
        }
    }

    /**
     * Fusiona todas las sub-mallas estáticas de un grupo que comparten el mismo Material
     * en una única BufferGeometry por material. Reduce en un 75% los Draw Calls por vehículo
     * manteniendo el 100% del detalle geométrico 3D y las pinturas dinámicas en RTX 3060.
     */
    mergeChildMeshesByMaterial(parentGroup) {
        const buckets = new Map();
        const children = [...parentGroup.children];

        children.forEach((child) => {
            if (!child.isMesh || !child.geometry || !child.material) return;
            const mat = child.material;
            if (!buckets.has(mat)) buckets.set(mat, []);
            buckets.get(mat).push(child);
        });

        buckets.forEach((meshes, mat) => {
            if (meshes.length <= 1) return;

            const mergedPos = [];
            const mergedNorm = [];
            const mergedIdx = [];
            let vertexOffset = 0;
            let anyCastShadow = false;
            let anyReceiveShadow = false;
            const tempVec = new THREE.Vector3();
            const normalMat = new THREE.Matrix3();

            meshes.forEach((m) => {
                m.updateMatrix();
                if (m.castShadow) anyCastShadow = true;
                if (m.receiveShadow) anyReceiveShadow = true;

                const geo = m.geometry;
                const posAttr = geo.attributes.position;
                const normAttr = geo.attributes.normal;
                if (!posAttr) return;

                normalMat.getNormalMatrix(m.matrix);

                for (let i = 0; i < posAttr.count; i++) {
                    tempVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(m.matrix);
                    mergedPos.push(tempVec.x, tempVec.y, tempVec.z);

                    if (normAttr) {
                        tempVec.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)).applyMatrix3(normalMat).normalize();
                        mergedNorm.push(tempVec.x, tempVec.y, tempVec.z);
                    } else {
                        mergedNorm.push(0, 1, 0);
                    }
                }

                if (geo.index) {
                    const idxArr = geo.index.array;
                    for (let j = 0; j < idxArr.length; j++) {
                        mergedIdx.push(idxArr[j] + vertexOffset);
                    }
                } else {
                    for (let j = 0; j < posAttr.count; j++) {
                        mergedIdx.push(j + vertexOffset);
                    }
                }

                vertexOffset += posAttr.count;
                parentGroup.remove(m);
            });

            if (mergedPos.length > 0) {
                const mergedGeo = new THREE.BufferGeometry();
                mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPos, 3));
                mergedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNorm, 3));
                mergedGeo.setIndex(mergedIdx);

                const mergedMesh = new THREE.Mesh(mergedGeo, mat);
                mergedMesh.castShadow = anyCastShadow;
                mergedMesh.receiveShadow = anyReceiveShadow;
                parentGroup.add(mergedMesh);
            }
        });
    }

    createCarShell(sections, material) {
        const positions = [];
        const indices = [];
        const perimeter = 8;
        sections.forEach(([z, width, bottom, top, crown], ring) => {
            const seam = (top - bottom) * 0.22;
            positions.push(
                -width * 0.84, bottom, z, width * 0.84, bottom, z,
                width, bottom + seam, z, width * 0.98, top - seam, z,
                width * crown, top, z, -width * crown, top, z,
                -width * 0.98, top - seam, z, -width, bottom + seam, z
            );
            if (!ring) return;
            for (let i = 0; i < perimeter; i++) {
                const a = (ring - 1) * perimeter + i;
                const b = (ring - 1) * perimeter + (i + 1) % perimeter;
                indices.push(a, b, a + perimeter, b, b + perimeter, a + perimeter);
            }
        });
        const front = (sections.length - 1) * perimeter;
        for (let i = 1; i < perimeter - 1; i++) {
            indices.push(0, i + 1, i, front, front + i, front + i + 1);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    createCarMesh(carConfig, isPolice = false) {
        const carGroup = new THREE.Group();
        // Sub-grupo de carrocería suspendida (permite animar Pitch, Roll y Heave sin despegar las ruedas del asfalto)
        const chassisGroup = new THREE.Group();
        carGroup.add(chassisGroup);

        const dim = carConfig.dimensions || { width: 1.92, height: 1.32, length: 4.55, spoilerType: 'gt_high', taillightStyle: 'quad_round', bodyStyle: 'gtr_aero' };
        const style = dim.bodyStyle || 'gtr_aero';

        // Pintura metalizada multicapa (Clearcoat & Metallic Flake PBR)
        const paintMat = new THREE.MeshPhysicalMaterial({
            color: isPolice ? 0xf8fafc : carConfig.color,
            roughness: 0.25,
            metalness: 0.58,
            clearcoat: 0.92,
            clearcoatRoughness: 0.18,
            envMap: this.envMap,
            envMapIntensity: 1.28
        });

        const carbonMat = new THREE.MeshStandardMaterial({
            color: isPolice ? 0x09090b : (carConfig.secondaryColor || 0x0f172a),
            roughness: 0.28,
            metalness: 0.62,
            envMap: this.envMap,
            envMapIntensity: 1.15
        });

        const accentMat = new THREE.MeshStandardMaterial({
            color: isPolice ? 0xef4444 : (carConfig.accentColor || carConfig.neonColor || 0x00e5ff),
            roughness: 0.22,
            metalness: 0.75,
            envMap: this.envMap
        });

        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x111e29,
            roughness: 0.16,
            metalness: 0.73,
            envMap: this.envMap,
            envMapIntensity: 1.65
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            roughness: 0.08,
            metalness: 0.96,
            envMap: this.envMap,
            envMapIntensity: 1.5
        });

        // 1. Suelo aerodinámico, Splitter delantero y Difusor trasero con aletas
        const underbody = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 1.01, 0.12, dim.length * 1.02), carbonMat);
        underbody.position.y = 0.21;
        chassisGroup.add(underbody);

        const frontSplitter = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 1.03, 0.05, 0.36), carbonMat);
        frontSplitter.position.set(0, 0.18, dim.length * 0.48);
        chassisGroup.add(frontSplitter);

        const frontAccentLip = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 1.04, 0.032, 0.08), accentMat);
        frontAccentLip.position.set(0, 0.175, dim.length * 0.515);
        chassisGroup.add(frontAccentLip);

        // Faldones laterales esculpidos (Side Skirts)
        [-1, 1].forEach((side) => {
            const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, dim.length * 0.56), carbonMat);
            skirt.position.set(side * (dim.width * 0.505), 0.24, 0);
            chassisGroup.add(skirt);
        });

        // 2. Cuerpo inferior esculpido y cintura aerodinámica
        const isLowSupercar = (style === 'supercar_wedge' || style === 'sleek_rotary' || style === 'porsche_curve');
        const beltHeight = isLowSupercar ? dim.height * 0.36 : dim.height * 0.41;

        const belt = 0.25 + beltHeight;
        const halfWidth = dim.width * 0.5;
        const crown = style === 'coupe_boxy' || style.startsWith('sedan') ? 0.91 : 0.80;
        const nose = isLowSupercar ? 0.69 : 0.89;
        chassisGroup.add(this.createCarShell([
            [-0.50, halfWidth * 0.86, 0.29, belt * 0.88, crown],
            [-0.45, halfWidth * 0.98, 0.24, belt, crown],
            [-0.32, halfWidth * 1.09, 0.25, belt * 1.09, crown],
            [-0.06, halfWidth, 0.27, belt * 1.04, crown],
            [0.18, halfWidth * 0.98, 0.26, belt * 1.07, crown],
            [0.32, halfWidth * 1.04, 0.25, belt * 1.03, crown],
            [0.46, halfWidth * 0.96, 0.24, belt * nose + 0.09, crown],
            [0.50, halfWidth * 0.83, 0.26, belt * nose, crown]
        ].map(([z, width, bottom, top, cap]) => [z * dim.length, width, bottom, top, cap]), paintMat));

        // Pasos de rueda ensanchados (Widebody Fender Flares)
        const archGeo = new THREE.TorusGeometry(0.355, 0.038, 5, 12, Math.PI);
        archGeo.rotateY(Math.PI / 2);
        const wheelZFront = dim.length * 0.31;
        const wheelZRear = -dim.length * 0.31;
        [
            [-dim.width * 0.54, 0.36, wheelZFront],
            [dim.width * 0.54, 0.36, wheelZFront],
            [-dim.width * 0.55, 0.36, wheelZRear],
            [dim.width * 0.55, 0.36, wheelZRear]
        ].forEach(([ax, ay, az]) => {
            const arch = new THREE.Mesh(archGeo, isPolice ? carbonMat : paintMat);
            arch.position.set(ax, ay, az);
            arch.castShadow = true;
            chassisGroup.add(arch);
        });

        // 3. Capó delantero inclinado y parachoques frontal según el modelo real
        const hoodY = 0.24 + beltHeight + 0.04;
        const hoodSlope = isLowSupercar ? 0.16 : 0.10;

        // Detalles icónicos de capó y parrilla según marca/estilo
        if (style === 'sedan_scoop') {
            // Toma de aire Boxer STI en el capó
            const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.11, 0.42), paintMat);
            scoop.position.set(0, hoodY + 0.11, dim.length * 0.22);
            scoop.rotation.x = 0.06;
            const scoopIntake = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.05), carbonMat);
            scoopIntake.position.set(0, hoodY + 0.11, dim.length * 0.43);
            chassisGroup.add(scoop, scoopIntake);
        } else if (style === 'sedan_rally' || style === 'gtr_aero') {
            // Rejillas NACA de extracción térmica (Evo IX / GT-R R35)
            [-0.32, 0.32].forEach((vx) => {
                const vent = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.38), carbonMat);
                vent.position.set(vx, hoodY + 0.08, dim.length * 0.25);
                vent.rotation.x = hoodSlope;
                chassisGroup.add(vent);
            });
        } else if (style === 'euro_coupe') {
            // Doble parrilla vertical estilo BMW M4 Competition (G82)
            [-0.17, 0.17].forEach((gx) => {
                const kidney = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.08), carbonMat);
                kidney.position.set(gx, 0.44, dim.length * 0.49);
                chassisGroup.add(kidney);
            });
        }

        // Franjas de Competición (Mustang GT S550)
        if (carConfig.hasRacingStripes) {
            [-0.16, 0.16].forEach((sx) => {
                const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, dim.length * 0.35), accentMat);
                hoodStripe.position.set(sx, hoodY + 0.095, dim.length * 0.27);
                hoodStripe.rotation.x = hoodSlope;
                const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, dim.length * 0.36), accentMat);
                roofStripe.position.set(sx, 1.245, -dim.length * 0.05);
                chassisGroup.add(hoodStripe, roofStripe);
            });
        }

        // Tomas laterales de motor central (NSX, Huracán, 911 GT3)
        if (isLowSupercar) {
            [-1, 1].forEach((side) => {
                const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.55), carbonMat);
                sideIntake.position.set(side * (dim.width * 0.49), 0.52, -dim.length * 0.14);
                chassisGroup.add(sideIntake);
            });
        }

        // Intercooler frontal metálico y rejilla inferior
        const grilleIntake = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.64, 0.18, 0.07), carbonMat);
        grilleIntake.position.set(0, 0.42, dim.length * 0.50);
        chassisGroup.add(grilleIntake);
        const grilleSlat = new THREE.BoxGeometry(dim.width * 0.52, 0.011, 0.013);
        for (let row = 0; row < 3; row++) {
            const slat = new THREE.Mesh(grilleSlat, carbonMat);
            slat.position.set(0, 0.38 + row * 0.043, dim.length * 0.50 + 0.037);
            chassisGroup.add(slat);
        }

        // 4. Cabina Acristalada Aerodinámica (Parabrisas inclinado, Cristales laterales, Luneta Fastback y Techo)
        const cabinTopY = dim.height * 0.94;
        const bodyLine = belt * 0.97;
        const sedan = style.startsWith('sedan') || style === 'hatch_aero';
        const rearRoofZ = sedan ? -0.18 : -0.13;
        const frontRoofZ = isLowSupercar ? 0.09 : 0.035;
        const roofMat = ['nsx', 'm4_g82', 'r35'].includes(carConfig.id) ? carbonMat : paintMat;
        chassisGroup.add(this.createCarShell([
            [-0.34, halfWidth * 0.82, bodyLine, bodyLine + 0.06, 0.91],
            [rearRoofZ, halfWidth * 0.76, bodyLine, cabinTopY - 0.08, 0.70],
            [rearRoofZ + 0.04, halfWidth * 0.77, bodyLine, cabinTopY - 0.024, 0.72],
            [frontRoofZ, halfWidth * 0.77, bodyLine, cabinTopY - 0.024, 0.72],
            [frontRoofZ + 0.025, halfWidth * 0.78, bodyLine, cabinTopY - 0.068, 0.73],
            [0.26, halfWidth * 0.87, bodyLine, bodyLine + 0.07, 0.93]
        ].map(([z, width, bottom, top, cap]) => [z * dim.length, width, bottom, top, cap]), glassMat));
        chassisGroup.add(this.createCarShell([
            [rearRoofZ, halfWidth * 0.54, cabinTopY - 0.093, cabinTopY - 0.074, 0.83],
            [rearRoofZ + 0.04, halfWidth * 0.57, cabinTopY - 0.047, cabinTopY, 0.87],
            [frontRoofZ - 0.025, halfWidth * 0.57, cabinTopY - 0.047, cabinTopY, 0.87],
            [frontRoofZ + 0.026, halfWidth * 0.55, cabinTopY - 0.092, cabinTopY - 0.067, 0.85]
        ].map(([z, width, bottom, top, cap]) => [z * dim.length, width, bottom, top, cap]), roofMat));

        // Retrovisores aerodinámicos con soporte
        const mirrorGeo = new THREE.BoxGeometry(0.24, 0.10, 0.15);
        [-1, 1].forEach((side) => {
            const mirror = new THREE.Mesh(mirrorGeo, paintMat);
            mirror.position.set(side * (dim.width * 0.53), 0.84, dim.length * 0.13);
            chassisGroup.add(mirror);
        });

        // 5. Alerón Trasero 3D según la configuración del modelo
        if (dim.spoilerType === 'ducktail_gt') {
            const ducktail = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.88, 0.11, 0.22), carbonMat);
            ducktail.position.set(0, 0.86, -dim.length * 0.45);
            ducktail.rotation.x = -0.28;
            chassisGroup.add(ducktail);
        } else {
            const wingHeight = dim.spoilerType === 'swan_neck' ? 1.16 : 1.11;
            const standGeo = new THREE.BoxGeometry(0.06, 0.34, 0.24);
            [-1, 1].forEach((side) => {
                const stand = new THREE.Mesh(standGeo, carbonMat);
                stand.position.set(side * (dim.width * 0.32), wingHeight - 0.17, -dim.length * 0.43);
                chassisGroup.add(stand);
            });

            const wingBlade = new THREE.Mesh(
                new THREE.BoxGeometry(dim.width * 0.98, 0.065, 0.32),
                (dim.spoilerType === 'hoop_wing' || dim.spoilerType === 'wrc_box') ? paintMat : carbonMat
            );
            wingBlade.position.set(0, wingHeight, -dim.length * 0.44);
            wingBlade.castShadow = true;
            chassisGroup.add(wingBlade);

            // Endplates laterales del alerón GT
            const endplateGeo = new THREE.BoxGeometry(0.04, 0.22, 0.36);
            [-1, 1].forEach((side) => {
                const plate = new THREE.Mesh(endplateGeo, paintMat);
                plate.position.set(side * (dim.width * 0.49), wingHeight - 0.02, -dim.length * 0.44);
                chassisGroup.add(plate);
            });
        }

        // 6. Difusor trasero y Sistema de Escape 3D
        const rearDiffuser = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.86, 0.17, 0.18), carbonMat);
        rearDiffuser.position.set(0, 0.26, -dim.length * 0.485);
        chassisGroup.add(rearDiffuser);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.088, 0.02), chromeMat);
        plate.position.set(0, 0.46, -dim.length * 0.50 - 0.013);
        chassisGroup.add(plate);

        const exhaustGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.24, 12);
        exhaustGeo.rotateX(Math.PI / 2);
        if (dim.taillightStyle === 'tri_exhaust') {
            [-0.14, 0, 0.14].forEach((exX) => {
                const pipe = new THREE.Mesh(exhaustGeo, chromeMat);
                pipe.position.set(exX, 0.27, -dim.length * 0.50);
                chassisGroup.add(pipe);
            });
        } else {
            [-dim.width * 0.29, -dim.width * 0.21, dim.width * 0.21, dim.width * 0.29].forEach((exX) => {
                const pipe = new THREE.Mesh(exhaustGeo, chromeMat);
                pipe.position.set(exX, 0.27, -dim.length * 0.50);
                chassisGroup.add(pipe);
            });
        }

        const flameMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.0 });
        const flameGeo = new THREE.ConeGeometry(0.11, 0.65, 8);
        flameGeo.rotateX(-Math.PI / 2);
        const flameL = new THREE.Mesh(flameGeo, flameMat);
        flameL.position.set(-dim.width * 0.26, 0.27, -dim.length * 0.50 - 0.32);
        const flameR = new THREE.Mesh(flameGeo, flameMat);
        flameR.position.set(dim.width * 0.26, 0.27, -dim.length * 0.50 - 0.32);
        chassisGroup.add(flameL, flameR);

        // 7. Faros Delanteros LED Matrix y Luces Traseras
        const headlightMat = new THREE.MeshBasicMaterial({ color: 0xf0f9ff });
        const drlAccentMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        if (style === 'porsche_curve') {
            const ovalHlGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16);
            ovalHlGeo.rotateX(Math.PI / 2.6);
            [-dim.width * 0.35, dim.width * 0.35].forEach((hx) => {
                const hl = new THREE.Mesh(ovalHlGeo, headlightMat);
                hl.position.set(hx, 0.63, dim.length * 0.45);
                chassisGroup.add(hl);
            });
        } else {
            const hlGeo = new THREE.BoxGeometry(0.38, 0.11, 0.09);
            [-1, 1].forEach((side) => {
                const hl = new THREE.Mesh(hlGeo, headlightMat);
                hl.position.set(side * (dim.width * 0.32), belt * nose - 0.022, dim.length * 0.50 + 0.007);
                hl.rotation.y = -side * 0.14;
                const drl = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.028, 0.095), drlAccentMat);
                drl.position.set(side * (dim.width * 0.32), belt * nose - 0.065, dim.length * 0.50 + 0.010);
                drl.rotation.y = -side * 0.14;
                chassisGroup.add(hl, drl);
            });
        }

        const tailZ = -dim.length * 0.50;
        const tailY = belt * 0.88 - 0.071;
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.80, 0.15, 0.055), carbonMat);
        fascia.position.set(0, tailY, tailZ - 0.012);
        chassisGroup.add(fascia);

        const brakeMat = new THREE.MeshBasicMaterial({ color: 0xe94240 });
        if (dim.taillightStyle === 'quad_round') {
            const roundGeo = new THREE.TorusGeometry(0.054, 0.017, 5, 16);
            [-0.66, -0.41, 0.41, 0.66].forEach((xOff) => {
                const tl = new THREE.Mesh(roundGeo, brakeMat);
                tl.position.set(xOff, tailY, tailZ - 0.042);
                chassisGroup.add(tl);
            });
        } else {
            const fullWidth = dim.taillightStyle === 'wide_bar';
            const lens = new THREE.BoxGeometry(dim.width * (fullWidth ? 0.74 : 0.22), 0.045, 0.030);
            for (const x of fullWidth ? [0] : [-halfWidth * 0.54, halfWidth * 0.54]) {
                const light = new THREE.Mesh(lens, brakeMat);
                light.position.set(x, tailY, tailZ - 0.042);
                chassisGroup.add(light);
            }
        }

        let sirenLightRed = null;
        let sirenLightBlue = null;
        if (isPolice) {
            const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.28), chromeMat);
            barBase.position.set(0, cabinTopY + 0.08, -0.1);
            chassisGroup.add(barBase);

            sirenLightRed = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.24), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
            sirenLightRed.position.set(-0.28, cabinTopY + 0.14, -0.1);
            sirenLightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.24), new THREE.MeshBasicMaterial({ color: 0x0066ff }));
            sirenLightBlue.position.set(0.28, cabinTopY + 0.14, -0.1);
            chassisGroup.add(sirenLightRed, sirenLightBlue);
        }

        const neonMat = new THREE.MeshBasicMaterial({
            color: isPolice ? 0xef4444 : (carConfig.neonColor || 0x00e5ff),
            transparent: true,
            opacity: 0.48,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        });
        const neonPlane = new THREE.Mesh(new THREE.PlaneGeometry(dim.width * 0.94, dim.length * 0.86), neonMat);
        neonPlane.rotation.x = -Math.PI / 2;
        neonPlane.position.y = 0.05;
        carGroup.add(neonPlane);

        const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(dim.width * 1.65, dim.length * 1.28),
            new THREE.MeshBasicMaterial({ map: this.textures.carShadow, transparent: true, depthWrite: false,
                polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
        contactShadow.rotation.x = -Math.PI / 2;
        contactShadow.position.y = 0.025;
        carGroup.add(contactShadow);

        // 8. Llantas 3D Detalladas: Neumático de Perfil Bajo + Aro Metálico + 6 Radios 3D + Disco Ventilado + Pinza Brembo
        const wheels = [];
        const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.29, 24);
        wheelGeo.rotateZ(Math.PI / 2);
        const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0f19, roughness: 0.78, metalness: 0.1 });

        const rimBarrelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.30, 20);
        rimBarrelGeo.rotateZ(Math.PI / 2);
        const rimMat = new THREE.MeshStandardMaterial({
            color: carConfig.rimColor || 0xcbd5e1,
            metalness: 0.92,
            roughness: 0.14,
            envMap: this.envMap,
            envMapIntensity: 1.5
        });

        const spokeGeo = new THREE.BoxGeometry(0.31, 0.042, 0.46);
        const hubCapGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.32, 12);
        hubCapGeo.rotateZ(Math.PI / 2);

        const brakeDiscGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.06, 16);
        brakeDiscGeo.rotateZ(Math.PI / 2);
        const discMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.3 });

        const caliperGeo = new THREE.BoxGeometry(0.12, 0.16, 0.09);
        const caliperMat = new THREE.MeshStandardMaterial({
            color: carConfig.caliperColor || 0xef4444,
            roughness: 0.25,
            metalness: 0.65
        });

        const wheelPositions = [
            [-dim.width * 0.49, 0.36, wheelZFront],
            [dim.width * 0.49, 0.36, wheelZFront],
            [-dim.width * 0.49, 0.36, wheelZRear],
            [dim.width * 0.49, 0.36, wheelZRear]
        ];

        wheelPositions.forEach((pos) => {
            const wGroup = new THREE.Group();
            wGroup.position.set(pos[0], pos[1], pos[2]);
            wGroup.add(new THREE.Mesh(wheelGeo, tireMat));
            wGroup.add(new THREE.Mesh(rimBarrelGeo, rimMat));
            wGroup.add(new THREE.Mesh(brakeDiscGeo, discMat));

            for (let sp = 0; sp < 3; sp++) {
                const spoke = new THREE.Mesh(spokeGeo, rimMat);
                spoke.rotation.x = (sp * Math.PI) / 3;
                wGroup.add(spoke);
            }

            wGroup.add(new THREE.Mesh(hubCapGeo, chromeMat));

            const caliper = new THREE.Mesh(caliperGeo, caliperMat);
            caliper.position.set(pos[0] > 0 ? 0.08 : -0.08, 0.06, -0.11);
            wGroup.add(caliper);

            // Fusionar aro + 3 radios en 1 sola malla por rueda para optimizar Draw Calls en GPU
            this.mergeChildMeshesByMaterial(wGroup);

            carGroup.add(wGroup);
            wheels.push(wGroup);
        });

        // Fusionar paneles de carrocería, fibra de carbono, cristales y escapes por material
        this.mergeChildMeshesByMaterial(chassisGroup);

        carGroup.userData = {
            chassisGroup,
            wheels,
            brakeMat,
            paintMat,
            rimMat,
            neonMat,
            flameMat,
            sirenLightRed,
            sirenLightBlue
        };

        // 9. Soporte opcional para modelos GLB/GLTF externos (assets/models/<id>.glb)
        if (!isPolice && carConfig.glbPath && typeof window !== 'undefined' && window.THREE && window.THREE.GLTFLoader) {
            try {
                const loader = new window.THREE.GLTFLoader();
                loader.load(
                    carConfig.glbPath,
                    (gltf) => {
                        if (gltf && gltf.scene) {
                            chassisGroup.clear();
                            gltf.scene.traverse((child) => {
                                if (child.isMesh) {
                                    child.castShadow = true;
                                    child.receiveShadow = true;
                                    if (child.material && child.material.name && child.material.name.toLowerCase().includes('paint')) {
                                        child.material = paintMat;
                                    }
                                }
                            });
                            chassisGroup.add(gltf.scene);
                        }
                    },
                    undefined,
                    () => {}
                );
            } catch (e) {}
        }

        return carGroup;
    }

    setupStartingGridCompetitors(playerCarId, difficultyObj, includePoliceCount = 0) {
        this.aiCars.forEach(ai => this.worldGroup.remove(ai.mesh));
        this.policeCars.forEach(cop => this.worldGroup.remove(cop.mesh));
        this.aiCars = [];
        this.policeCars = [];

        const availableCars = window.FH6_DATA.cars.filter(c => c.id !== playerCarId);
        const numCompetitors = 6;
        const numPts = this.trackPoints.length;

        for (let i = 0; i < numCompetitors; i++) {
            const carData = availableCars[i % availableCars.length];
            const mesh = this.createCarMesh(carData, false);
            this.worldGroup.add(mesh);

            const row = Math.floor(i / 2);
            const side = (i % 2 === 0) ? -1 : 1;
            const laneOffset = side * 3.6;
            const startT = (1.0 - 0.004 * (row + 1) + (side > 0 ? 0.0015 : 0)) % 1.0;

            const exactIdx = startT * numPts;
            const idx0 = Math.floor(exactIdx) % numPts;
            const idx1 = (idx0 + 1) % numPts;
            const p0 = this.trackPoints[idx0];
            const p1 = this.trackPoints[idx1];
            const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            const startPos = new THREE.Vector3().copy(p0).addScaledVector(right, laneOffset);
            const heading = Math.atan2(tangent.x, tangent.z);

            mesh.position.copy(startPos);
            mesh.rotation.y = heading;

            const baseMaxMs = (carData.physics.maxSpeedKmh / 3.6) * difficultyObj.aiSpeedMult;
            const skillVariance = 0.94 + (i / numCompetitors) * 0.11;

            this.aiCars.push({
                id: 'rival_' + (i + 1),
                name: carData.name,
                classRating: carData.classRating,
                mesh,
                pos: startPos.clone(),
                vel: new THREE.Vector3(0, 0, 0),
                heading,
                currentSpeedMs: 0,
                targetMaxSpeedMs: baseMaxMs * skillVariance,
                accelRate: carData.physics.accelForce * difficultyObj.aiSpeedMult * 0.88,
                aggression: difficultyObj.aiAggression || 0.65,
                laneOffset,
                preferredLaneOffset: laneOffset,
                progressT: startT - 1.0, // Progreso continuo (3.0 = 3 vueltas completadas)
                lap: 1,
                passedHalfway: false,
                finished: false,
                finishTimeMs: null,
                radius: 2.15
            });
        }

        for (let p = 0; p < includePoliceCount; p++) {
            const copConfig = window.FH6_DATA.cars[0];
            const copMesh = this.createCarMesh(copConfig, true);
            this.worldGroup.add(copMesh);

            const startT = 0.04 + p * 0.09;
            const idx0 = Math.floor(startT * numPts) % numPts;
            const idx1 = (idx0 + 1) % numPts;
            const p0 = this.trackPoints[idx0];
            const p1 = this.trackPoints[idx1];
            const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();

            copMesh.position.copy(p0);
            copMesh.rotation.y = Math.atan2(tangent.x, tangent.z);

            this.policeCars.push({
                id: 'police_' + (p + 1),
                name: `Patrulla Keishicho #${p + 1}`,
                mesh: copMesh,
                pos: p0.clone(),
                vel: new THREE.Vector3(0, 0, 0),
                heading: Math.atan2(tangent.x, tangent.z),
                currentSpeedMs: 0,
                targetMaxSpeedMs: 88 * difficultyObj.aiSpeedMult,
                accelRate: 44,
                laneOffset: (p % 2 === 0 ? -2.8 : 2.8),
                preferredLaneOffset: (p % 2 === 0 ? -2.8 : 2.8),
                progressT: startT,
                lap: 1,
                isPolice: true,
                radius: 2.2
            });
        }
    }

    spawnCollisionSparks(contactPoint) {
        for (let i = 0; i < 12; i++) {
            const spark = new THREE.Mesh(this.sharedSparkGeo, this.sharedSparkMat);
            spark.position.copy(contactPoint);
            spark.position.y += 0.5;

            const angle = Math.random() * Math.PI * 2;
            const speed = 6 + Math.random() * 14;
            const vy = 3 + Math.random() * 7;

            this.fxGroup.add(spark);
            this.sparkParticles.push({
                mesh: spark,
                vx: Math.cos(angle) * speed,
                vy,
                vz: Math.sin(angle) * speed,
                life: 0.36
            });
        }
    }

    spawnTireSmoke(position, rightVec, width = 1.9) {
        if (this.smokeParticles.length > 45) return;
        [-1, 1].forEach((side) => {
            const puff = new THREE.Mesh(this.sharedSmokeGeo, this.sharedSmokeMat);
            puff.position.copy(position).addScaledVector(rightVec, side * width * 0.42);
            puff.position.y += 0.22;
            this.fxGroup.add(puff);
            this.smokeParticles.push({
                mesh: puff,
                vy: 1.1 + Math.random() * 0.8,
                scaleRate: 2.4,
                life: 0.42
            });
        });
    }

    updateDynamicElements(dt, canRaceMove, playerPos, playerTotalProgress = 0, raceElapsedMs = 0) {
        if (!this.trackPoints.length) return;
        const numPts = this.trackPoints.length;

        // Actualizar chispas de colisión
        for (let i = this.sparkParticles.length - 1; i >= 0; i--) {
            const sp = this.sparkParticles[i];
            sp.life -= dt;
            if (sp.life <= 0) {
                this.fxGroup.remove(sp.mesh);
                this.sparkParticles.splice(i, 1);
            } else {
                sp.mesh.position.x += sp.vx * dt;
                sp.mesh.position.y += sp.vy * dt;
                sp.mesh.position.z += sp.vz * dt;
                sp.vy -= 18 * dt;
            }
        }

        // Actualizar humo de neumáticos en derrape
        for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
            const sm = this.smokeParticles[i];
            sm.life -= dt;
            if (sm.life <= 0) {
                this.fxGroup.remove(sm.mesh);
                this.smokeParticles.splice(i, 1);
            } else {
                sm.mesh.position.y += sm.vy * dt;
                const s = 1 + (0.42 - sm.life) * sm.scaleRate;
                sm.mesh.scale.set(s, s, s);
            }
        }

        if (this.sakuraParticles) {
            const posAttr = this.sakuraParticles.geometry.attributes.position;
            for (let i = 0; i < posAttr.count; i++) {
                const pt = this.trackPoints[i % numPts];
                let y = posAttr.getY(i) - dt * 1.9;
                if (y < pt.y + 0.4) y = pt.y + 14.5;
                posAttr.setY(i, y);
            }
            posAttr.needsUpdate = true;
        }

        if (!canRaceMove) return;

        const allTrackUnits = [...this.aiCars, ...this.policeCars];
        const nowSec = performance.now() * 0.001;
        const trackLen = this.trackTotalLengthMeters || 2400;

        allTrackUnits.forEach((ai, unitIdx) => {
            const wrappedNow = ((ai.progressT % 1) + 1) % 1;
            const curIdx = Math.floor(wrappedNow * numPts) % numPts;
            const lookAheadIdx = (curIdx + 10) % numPts;

            // 1. Control de velocidad en curva (Frenada anticipada en horquillas Touge)
            const upcomingCurvature = Math.max(this.trackCurvatures[curIdx] || 0, this.trackCurvatures[lookAheadIdx] || 0);
            const cornerFactor = THREE.MathUtils.clamp(1.0 - upcomingCurvature * 7.2, 0.58, 1.0);
            let desiredSpeedMs = ai.targetMaxSpeedMs * cornerFactor;

            // 2. IA de Intercepción Policial en Modo Tokyo Heat
            if (ai.isPolice && playerPos) {
                const progressDiff = playerTotalProgress - ai.progressT;
                if (progressDiff > 0.015) {
                    desiredSpeedMs = ai.targetMaxSpeedMs * 1.22; // Acelerar para alcanzar al fugitivo
                } else if (progressDiff < -0.025) {
                    desiredSpeedMs = ai.targetMaxSpeedMs * 0.55; // Esperar emboscada más adelante
                }

                const infoPlayer = this.getClosestTrackInfo(playerPos);
                if (infoPlayer) {
                    ai.laneOffset = THREE.MathUtils.lerp(ai.laneOffset, infoPlayer.lateralOffset, dt * 2.4);
                }

                const blink = Math.floor(nowSec * 10 + unitIdx) % 2 === 0;
                if (ai.mesh.userData.sirenLightRed && ai.mesh.userData.sirenLightBlue) {
                    ai.mesh.userData.sirenLightRed.material.color.setHex(blink ? 0xff0000 : 0x220000);
                    ai.mesh.userData.sirenLightBlue.material.color.setHex(blink ? 0x001133 : 0x0088ff);
                }
            } else {
                // Maniobra de adelantamiento si tiene otro rival justo delante en su mismo carril
                for (let j = 0; j < this.aiCars.length; j++) {
                    const other = this.aiCars[j];
                    if (other === ai) continue;
                    const dProg = other.progressT - ai.progressT;
                    if (dProg > 0 && dProg < 0.014 && Math.abs(other.laneOffset - ai.laneOffset) < 2.4) {
                        ai.preferredLaneOffset = other.laneOffset > 0 ? -4.2 : 4.2;
                        break;
                    }
                }
                ai.laneOffset = THREE.MathUtils.lerp(ai.laneOffset, ai.preferredLaneOffset, dt * 1.6);
            }

            if (ai.currentSpeedMs < desiredSpeedMs) {
                ai.currentSpeedMs = Math.min(desiredSpeedMs, ai.currentSpeedMs + ai.accelRate * dt);
            } else {
                ai.currentSpeedMs = THREE.MathUtils.lerp(ai.currentSpeedMs, desiredSpeedMs, dt * 3.2);
            }

            // Avanzar según la longitud física real del circuito
            const deltaT = (ai.currentSpeedMs * dt) / trackLen;
            ai.progressT += deltaT;

            // Actualizar vuelta actual y registrar tiempo final al cruzar 3 vueltas (progressT >= 3.0)
            if (!ai.isPolice) {
                ai.lap = Math.min(3, Math.max(1, Math.floor(ai.progressT) + 1));
                if (ai.progressT >= 3.0 && !ai.finished) {
                    ai.finished = true;
                    ai.finishTimeMs = raceElapsedMs;
                }
            }

            const wrappedT = ((ai.progressT % 1) + 1) % 1;
            const exactIdx = wrappedT * numPts;
            const idx0 = Math.floor(exactIdx) % numPts;
            const idx1 = (idx0 + 1) % numPts;
            const frac = exactIdx - Math.floor(exactIdx);

            const p0 = this.trackPoints[idx0];
            const p1 = this.trackPoints[idx1];
            const p2 = this.trackPoints[(idx1 + 1) % numPts];
            const centerPos = new THREE.Vector3().lerpVectors(p0, p1, frac);
            const tan0 = new THREE.Vector3().subVectors(p1, p0).normalize();
            const tan1 = new THREE.Vector3().subVectors(p2, p1).normalize();
            const tangent = new THREE.Vector3().lerpVectors(tan0, tan1, frac).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            ai.pos.copy(centerPos).addScaledVector(right, ai.laneOffset);
            ai.pos.y = centerPos.y + 0.08;
            ai.heading = Math.atan2(tangent.x, tangent.z);
            ai.vel.copy(tangent).multiplyScalar(ai.currentSpeedMs);

            ai.mesh.position.copy(ai.pos);
            ai.mesh.rotation.y = ai.heading;

            // Inclinación de suspensión en curva para rivales IA
            if (ai.mesh.userData.chassisGroup) {
                ai.mesh.userData.chassisGroup.rotation.z = THREE.MathUtils.lerp(
                    ai.mesh.userData.chassisGroup.rotation.z,
                    (this.trackCurvatures[idx0] || 0) * 1.4,
                    Math.min(1, dt * 8)
                );
            }

            if (ai.mesh.userData.wheels) {
                ai.mesh.userData.wheels.forEach(w => {
                    w.children.forEach(c => { c.rotation.x += ai.currentSpeedMs * dt * 2.1; });
                });
            }
        });
    }

    /**
     * Proyección continua sub-segmento sobre la spline del circuito.
     * Evita saltos discretos ("escalones" de altura o tangente) entre los 360 nodos,
     * eliminando por completo el temblor de cámara al avanzar.
     */
    getClosestTrackInfo(position) {
        const numPts = this.trackPoints.length;
        if (!numPts) return null;

        let bestIdx = 0;
        let minDistSq = Infinity;

        for (let i = 0; i < numPts; i++) {
            const pt = this.trackPoints[i];
            const dx = position.x - pt.x;
            const dz = position.z - pt.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < minDistSq) {
                minDistSq = dSq;
                bestIdx = i;
            }
        }

        // Evaluar proyección continua en el segmento anterior [prevIdx -> bestIdx] y siguiente [bestIdx -> nextIdx]
        const prevIdx = (bestIdx - 1 + numPts) % numPts;
        const nextIdx = (bestIdx + 1) % numPts;

        const projectOnSegment = (idxA, idxB) => {
            const a = this.trackPoints[idxA];
            const b = this.trackPoints[idxB];
            const abx = b.x - a.x;
            const abz = b.z - a.z;
            const lenSq = Math.max(0.0001, abx * abx + abz * abz);
            const apx = position.x - a.x;
            const apz = position.z - a.z;
            const t = THREE.MathUtils.clamp((apx * abx + apz * abz) / lenSq, 0, 1);
            const px = a.x + abx * t;
            const pz = a.z + abz * t;
            const dSq = (position.x - px) * (position.x - px) + (position.z - pz) * (position.z - pz);
            return { idxA, idxB, t, dSq };
        };

        const segPrev = projectOnSegment(prevIdx, bestIdx);
        const segNext = projectOnSegment(bestIdx, nextIdx);
        const chosen = segPrev.dSq < segNext.dSq ? segPrev : segNext;

        const pA = this.trackPoints[chosen.idxA];
        const pB = this.trackPoints[chosen.idxB];
        const pC = this.trackPoints[(chosen.idxB + 1) % numPts];

        const interpPoint = new THREE.Vector3().lerpVectors(pA, pB, chosen.t);

        const tanA = new THREE.Vector3().subVectors(pB, pA).normalize();
        const tanB = new THREE.Vector3().subVectors(pC, pB).normalize();
        const tangent = new THREE.Vector3().lerpVectors(tanA, tanB, chosen.t).normalize();
        const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

        const toCar = new THREE.Vector3().subVectors(position, interpPoint);
        const lateralOffset = toCar.dot(right);

        return {
            point: interpPoint,
            tangent,
            right,
            lateralOffset,
            progressT: (chosen.idxA + chosen.t) / numPts,
            index: bestIdx
        };
    }

    /**
     * Genera una vista previa panorámica real de cada circuito a partir de sus datos,
     * colores atmosféricos, hitos 3D y coordenadas reales del spline.
     */
    generateCircuitPreviewDataUrl(mapConfig) {
        if (!mapConfig) return '';
        if (this.previewCache && this.previewCache.has(mapConfig.id)) {
            return this.previewCache.get(mapConfig.id);
        }

        const toHex = (num) => '#' + (num || 0).toString(16).padStart(6, '0');
        const skyTop = toHex(mapConfig.skyColorTop);
        const skyMid = toHex(mapConfig.skyColorMid);
        const skyHor = toHex(mapConfig.skyColorHorizon);
        const groundCol = toHex(mapConfig.groundColor);
        const shoulderCol = toHex(mapConfig.shoulderColor);

        // Muestrear el spline real del circuito (96 puntos)
        const sampleCount = 96;
        const rawPts = [];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < sampleCount; i++) {
            const p = this.evaluateTrackSpline(i / sampleCount, mapConfig);
            rawPts.push(p);
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }

        const w = 440;
        const h = 210;
        const padX = 120;
        const padY = 32;
        const spanX = Math.max(1, maxX - minX);
        const spanZ = Math.max(1, maxZ - minZ);
        const scale = Math.min((w - padX * 2) / spanX, (h - padY * 2) / spanZ);
        const cx = w * 0.62;
        const cy = h * 0.56;
        const midX = (minX + maxX) * 0.5;
        const midZ = (minZ + maxZ) * 0.5;

        const mappedPts = rawPts.map(p => ({
            x: +(cx + (p.x - midX) * scale).toFixed(1),
            y: +(cy + (p.z - midZ) * scale).toFixed(1)
        }));

        let dataUrl = '';
        try {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.65);
                skyGrad.addColorStop(0, skyTop);
                skyGrad.addColorStop(0.55, skyMid);
                skyGrad.addColorStop(1, skyHor);
                ctx.fillStyle = skyGrad;
                ctx.fillRect(0, 0, w, h);

                ctx.fillStyle = groundCol;
                ctx.fillRect(0, h * 0.56, w, h * 0.44);

                // Siluetas de hitos emblemáticos del escenario a la izquierda
                ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
                ctx.beginPath();
                ctx.moveTo(0, h * 0.58);
                ctx.lineTo(65, h * 0.25);
                ctx.lineTo(135, h * 0.58);
                ctx.fill();

                if (mapConfig.hasTokyoTower || mapConfig.hasSkyscrapers) {
                    ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
                    [16, 42, 72, 102, 134].forEach((bx, bi) => {
                        const bh = 42 + (bi % 3) * 22;
                        ctx.fillRect(bx, h * 0.58 - bh, 20, bh);
                    });
                    ctx.fillStyle = shoulderCol;
                    ctx.fillRect(88, h * 0.58 - 76, 5, 76);
                }

                // Trazado real del circuito con escapatoria de arena y línea de meta
                ctx.beginPath();
                mappedPts.forEach((pt, idx) => {
                    if (idx === 0) ctx.moveTo(pt.x, pt.y);
                    else ctx.lineTo(pt.x, pt.y);
                });
                ctx.closePath();
                ctx.strokeStyle = 'rgba(214, 180, 122, 0.55)';
                ctx.lineWidth = 14;
                ctx.stroke();

                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 9;
                ctx.stroke();

                ctx.strokeStyle = shoulderCol;
                ctx.lineWidth = 2.6;
                ctx.stroke();

                if (typeof canvas.toDataURL === 'function') {
                    const candidate = canvas.toDataURL('image/png');
                    if (candidate && candidate.startsWith('data:image/') && candidate.length > 64) {
                        dataUrl = candidate;
                    }
                }
            }
        } catch (e) {}

        // Respaldo SVG vectorial de alta definición con el spline real si toDataURL no está disponible
        if (!dataUrl) {
            const polyPoints = mappedPts.map(p => `${p.x},${p.y}`).join(' ');
            const startPt = mappedPts[0] || { x: cx, y: cy };
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
                `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
                `<stop offset="0%" stop-color="${skyTop}"/><stop offset="55%" stop-color="${skyMid}"/><stop offset="100%" stop-color="${skyHor}"/>` +
                `</linearGradient></defs>` +
                `<rect width="${w}" height="${h}" fill="url(#sky)"/>` +
                `<rect y="${Math.round(h * 0.56)}" width="${w}" height="${Math.round(h * 0.44)}" fill="${groundCol}" opacity="0.88"/>` +
                `<polygon points="0,120 75,38 155,120" fill="#0f172a" opacity="0.55"/>` +
                `<polygon points="90,120 165,48 245,120" fill="#1e293b" opacity="0.45"/>` +
                `<polygon points="${polyPoints}" fill="none" stroke="rgba(214,180,122,0.55)" stroke-width="14" stroke-linejoin="round"/>` +
                `<polygon points="${polyPoints}" fill="none" stroke="#0f172a" stroke-width="9" stroke-linejoin="round"/>` +
                `<polygon points="${polyPoints}" fill="none" stroke="${shoulderCol}" stroke-width="2.8" stroke-linejoin="round"/>` +
                `<circle cx="${startPt.x}" cy="${startPt.y}" r="5.5" fill="#f43f5e" stroke="#ffffff" stroke-width="2"/>` +
                `</svg>`;
            dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        }

        if (this.previewCache) {
            this.previewCache.set(mapConfig.id, dataUrl);
        }
        return dataUrl;
    }
}

window.HorizonWorldBuilder = HorizonWorldBuilder;
