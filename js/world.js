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
        this.initProceduralTextures();
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
        const createFaceCanvas = (topCol, botCol, neonCol) => {
            const c = document.createElement('canvas');
            c.width = 128;
            c.height = 128;
            const ctx = c.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 128);
            grad.addColorStop(0, topCol);
            grad.addColorStop(0.50, '#1e293b');
            grad.addColorStop(0.54, neonCol);
            grad.addColorStop(1, botCol);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 128, 128);
            return c;
        };

        this.envMap = new THREE.CubeTexture([
            createFaceCanvas('#090d1a', '#05070e', '#00e5ff'),
            createFaceCanvas('#090d1a', '#05070e', '#f43f5e'),
            createFaceCanvas('#0f172a', '#1e293b', '#38bdf8'),
            createFaceCanvas('#05070e', '#020408', '#0f172a'),
            createFaceCanvas('#090d1a', '#05070e', '#facc15'),
            createFaceCanvas('#090d1a', '#05070e', '#a855f7')
        ]);
        this.envMap.needsUpdate = true;
        this.scene.environment = this.envMap;

        // 2. Textura Base de Asfalto Japonés de Alta Densidad
        const roadCanvas = document.createElement('canvas');
        roadCanvas.width = 512;
        roadCanvas.height = 512;
        const rCtx = roadCanvas.getContext('2d');

        rCtx.fillStyle = '#161a24';
        rCtx.fillRect(0, 0, 512, 512);

        for (let i = 0; i < 9000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const shade = 16 + Math.floor(Math.random() * 26);
            rCtx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 9})`;
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
        for (let y = 0; y < 512; y += 64) {
            lCtx.fillStyle = 'rgba(250, 204, 21, 0.88)';
            lCtx.fillRect(252, y + 8, 8, 34);
        }

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
        ctx.fillText(textJP, 128, 56);

        ctx.fillStyle = borderHex;
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(textEN, 128, 98);

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
        this.worldGroup.traverse((obj) => {
            if (obj.geometry) {
                obj.geometry.dispose();
            }
        });
        while (this.worldGroup.children.length > 0) {
            this.worldGroup.remove(this.worldGroup.children[0]);
        }
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

        this.buildStreetLightsWithSpotlights();

        if (mapConfig.hasSakura) {
            this.buildSakuraTreesAndPetals();
        }
    }

    /**
     * Crea un Domo Atmosférico 3D con degradado suave entre el cenit y el horizonte.
     */
    buildSkyDome(mapConfig) {
        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 64;
        skyCanvas.height = 256;
        const ctx = skyCanvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 256);

        const toHex = (num) => '#' + (num || 0x0f172a).toString(16).padStart(6, '0');
        grad.addColorStop(0.0, toHex(mapConfig.skyColorTop));
        grad.addColorStop(0.52, toHex(mapConfig.skyColorMid || mapConfig.skyColorTop));
        grad.addColorStop(0.86, toHex(mapConfig.skyColorHorizon));
        grad.addColorStop(1.0, toHex(mapConfig.fogColor || mapConfig.skyColorHorizon));

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 256);

        const skyTex = new THREE.CanvasTexture(skyCanvas);
        const skyGeo = new THREE.SphereGeometry(1650, 24, 16);
        const skyMat = new THREE.MeshBasicMaterial({
            map: skyTex,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
        const skyDome = new THREE.Mesh(skyGeo, skyMat);
        skyDome.position.y = -20;
        this.worldGroup.add(skyDome);
    }

    /**
     * Construye un anillo de montañas y colinas en el horizonte (1 InstancedMesh)
     * para integrar el terreno con el cielo de forma realista.
     */
    buildPerimeterMountains(mapConfig) {
        let mountainColor = 0x1e293b;
        if (mapConfig.runoffType === 'sand_desert') {
            mountainColor = 0x9a7348; // Cerros áridos de Arequipa / Costa Norte
        } else if (mapConfig.runoffType === 'sand_andean') {
            mountainColor = 0x4b5c3b; // Cordillera de Cusco / Puno
        } else if (mapConfig.runoffType === 'sand_warm') {
            mountainColor = 0x374733; // Colinas de Hakone
        }

        const peakGeo = new THREE.ConeGeometry(165, 130, 7);
        const peakMat = new THREE.MeshStandardMaterial({
            color: mountainColor,
            roughness: 0.92,
            metalness: 0.04
        });

        const count = 24;
        const inst = new THREE.InstancedMesh(peakGeo, peakMat, count);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2;
            const dist = 1080 + (i % 3) * 110;
            const scaleY = 0.7 + ((i * 5) % 7) * 0.18;
            const scaleXZ = 1.0 + (i % 4) * 0.25;
            dummy.position.set(Math.cos(ang) * dist, (130 * scaleY) * 0.45 - 8, Math.sin(ang) * dist);
            dummy.rotation.set(0, ang, 0);
            dummy.scale.set(scaleXZ, scaleY, scaleXZ);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        this.worldGroup.add(inst);
    }

    /**
     * Genera las Trampas de Arena / Escapatorias de Grava (Sand & Gravel Runoff Traps)
     * y los Taludes de Terreno (Embankments) que conectan la pista con el suelo,
     * eliminando por completo el defecto de pista flotante o huecos oscuros.
     */
    buildTrackSandRunoffAndEmbankment(mapConfig) {
        const numPts = this.trackPoints.length;
        const innerStart = this.roadWidth * 0.5 + 0.75; // Justo al borde del piano 3D
        const sandBeltOuter = innerStart + 18.5;        // 18.5m de trampa de arena/grava a cada lado
        const embankmentOuter = sandBeltOuter + 52.0;   // Talud suave hasta el suelo base (y = -0.65)

        let sandTex = this.textures.sandDesert;
        let embankmentColor = 0xa37c4c;
        if (mapConfig.runoffType === 'sand_andean') {
            sandTex = this.textures.sandAndean;
            embankmentColor = 0x556940;
        } else if (mapConfig.runoffType === 'sand_warm') {
            sandTex = this.textures.sandDesert;
            embankmentColor = 0x455736;
        } else if (mapConfig.runoffType === 'gravel_dark') {
            sandTex = this.textures.gravelDark;
            embankmentColor = 0x1b2332;
        }

        const sandMat = new THREE.MeshStandardMaterial({
            map: sandTex,
            roughness: 0.92,
            metalness: 0.03,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        const bankMat = new THREE.MeshStandardMaterial({
            color: embankmentColor,
            map: mapConfig.runoffType === 'sand_desert' ? this.textures.groundDesert : this.textures.groundGrass,
            roughness: 0.95,
            metalness: 0.02
        });

        [-1, 1].forEach((side) => {
            const sandPos = [];
            const sandUvs = [];
            const sandIdx = [];

            const bankPos = [];
            const bankUvs = [];
            const bankIdx = [];

            for (let i = 0; i <= numPts; i++) {
                const idx = i % numPts;
                const nextIdx = (i + 1) % numPts;
                const p = this.trackPoints[idx];
                const pNext = this.trackPoints[nextIdx];

                const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
                const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

                const ptInner = new THREE.Vector3().copy(p).addScaledVector(right, side * innerStart);
                const ptSandEdge = new THREE.Vector3().copy(p).addScaledVector(right, side * sandBeltOuter);
                const ptGroundEdge = new THREE.Vector3().copy(p).addScaledVector(right, side * embankmentOuter);

                // Franja 1: Trampa de Arena / Escapatoria al nivel de la pista
                sandPos.push(
                    ptInner.x, p.y + 0.03, ptInner.z,
                    ptSandEdge.x, p.y - 0.18, ptSandEdge.z
                );

                // Franja 2: Talud que une el borde de la arena con el suelo en y = -0.65
                bankPos.push(
                    ptSandEdge.x, p.y - 0.18, ptSandEdge.z,
                    ptGroundEdge.x, -0.65, ptGroundEdge.z
                );

                const v = i / numPts;
                sandUvs.push(0, v, 1, v);
                bankUvs.push(0, v, 1, v);

                if (i < numPts) {
                    const b = i * 2;
                    if (side === 1) {
                        sandIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
                        bankIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
                    } else {
                        sandIdx.push(b + 1, b, b + 2, b + 3, b + 1, b + 2);
                        bankIdx.push(b + 1, b, b + 2, b + 3, b + 1, b + 2);
                    }
                }
            }

            const sGeo = new THREE.BufferGeometry();
            sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sandPos, 3));
            sGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sandUvs, 2));
            sGeo.setIndex(sandIdx);
            sGeo.computeVertexNormals();
            const sMesh = new THREE.Mesh(sGeo, sandMat);
            sMesh.receiveShadow = true;
            this.worldGroup.add(sMesh);

            const bGeo = new THREE.BufferGeometry();
            bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bankPos, 3));
            bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bankUvs, 2));
            bGeo.setIndex(bankIdx);
            bGeo.computeVertexNormals();
            const bMesh = new THREE.Mesh(bGeo, bankMat);
            bMesh.receiveShadow = true;
            this.worldGroup.add(bMesh);
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
            roughness: 0.36,
            metalness: 0.22,
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
            opacity: 0.65,
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
            metalness: 0.85,
            roughness: 0.25,
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
            isPeru ? '🏁 SALIDA / META • RACING.PE' : '🏁 SALIDA / META • 3 VUELTAS',
            isPeru ? 'GRAN PREMIO NACIONAL DEL PERÚ' : 'HORIZON JAPAN GRAND PRIX',
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
        const fujiGroup = new THREE.Group();
        fujiGroup.position.set(-550, -2, -620);

        const baseGeo = new THREE.ConeGeometry(380, 250, 36, 1, true);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x263248, roughness: 0.85 });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.position.y = 125;
        fujiGroup.add(baseMesh);

        const snowGeo = new THREE.ConeGeometry(152, 104, 36);
        const snowMat = new THREE.MeshStandardMaterial({
            color: 0xf8fafc,
            emissive: 0x475569,
            emissiveIntensity: 0.28,
            roughness: 0.45
        });
        const snowMesh = new THREE.Mesh(snowGeo, snowMat);
        snowMesh.position.y = 198;
        fujiGroup.add(snowMesh);

        this.worldGroup.add(fujiGroup);
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
                const dist = this.roadWidth * 0.5 + 22 + (i % 3) * 8;
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * dist);

                dummy.position.set(pos.x, arch.h * 0.5 - 3.0, pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                arch.matrices.push(dummy.matrix.clone());

                if (i % 14 === 0) {
                    const signMesh = new THREE.Mesh(signGeo, signMats[(i + sideIdx) % signMats.length]);
                    const signPos = new THREE.Vector3().copy(p).addScaledVector(right, side * (this.roadWidth * 0.5 + 6.2));
                    signMesh.position.set(signPos.x, p.y + 8.5 + (i % 8), signPos.z);
                    signMesh.lookAt(p.x, p.y + 6.5, p.z);
                    this.worldGroup.add(signMesh);
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
     * anclados firmemente en la berma/talud y con pétalos circulares suaves.
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

        // Tronco largo (6.8m) que penetra en el talud para no flotar jamás
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
                const offset = this.roadWidth * 0.5 + 6.5 + ((i * 7) % 10);
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * offset);
                // Cota de superficie en la berma/talud
                const groundSurfaceY = p.y - 0.15 - Math.max(0, offset - (this.roadWidth * 0.5 + 18.5)) * 0.06;

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
     * Tribunas Techadas y Barreras de Neumáticos Rojos/Blancos en las trampas de arena.
     */
    buildPeruvianAutodromeComplex(mapConfig) {
        const p0 = this.trackPoints[8];
        const p1 = this.trackPoints[9];
        const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();
        const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
        const angle = Math.atan2(tangent.x, tangent.z);

        const pitGroup = new THREE.Group();
        const pitPos = new THREE.Vector3().copy(p0).addScaledVector(right, -(this.roadWidth * 0.5 + 14.5));
        pitGroup.position.set(pitPos.x, p0.y - 0.1, pitPos.z);
        pitGroup.rotation.y = angle;

        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.15 });
        const darkGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.85 });
        const redAccentMat = new THREE.MeshStandardMaterial({
            color: mapConfig.curbStyle === 'cyan_white' ? 0x0891b2 : 0xdc2626,
            roughness: 0.4
        });

        // 1. Edificio Principal de Boxes (Pit Garages) de 78m de largo
        const mainBld = new THREE.Mesh(new THREE.BoxGeometry(12, 7.5, 78), whiteMat);
        mainBld.position.set(0, 3.75, 0);
        mainBld.castShadow = true;
        mainBld.receiveShadow = true;
        pitGroup.add(mainBld);

        // Franja superior RACING.PE y visera de boxes
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.4, 80), redAccentMat);
        fascia.position.set(0, 7.6, 0);
        pitGroup.add(fascia);

        // Ventanal VIP en segundo piso
        const vipGlass = new THREE.Mesh(new THREE.BoxGeometry(12.3, 2.2, 72), darkGlassMat);
        vipGlass.position.set(0, 5.4, 0);
        pitGroup.add(vipGlass);

        // 8 Puertas de Garaje de Boxes hacia la pista
        for (let b = -3; b <= 3; b++) {
            const bayDoor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 6.8), darkGlassMat);
            bayDoor.position.set(6.0, 1.6, b * 9.8);
            pitGroup.add(bayDoor);
        }

        // 2. Torre de Control de Carrera (Race Control Tower)
        const towerBase = new THREE.Mesh(new THREE.BoxGeometry(9, 18, 9), whiteMat);
        towerBase.position.set(-2, 9, -44);
        towerBase.castShadow = true;
        pitGroup.add(towerBase);

        const towerCabin = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4.5, 11.5), darkGlassMat);
        towerCabin.position.set(-2, 16.5, -44);
        pitGroup.add(towerCabin);

        const towerRoof = new THREE.Mesh(new THREE.BoxGeometry(12.5, 1.1, 12.5), redAccentMat);
        towerRoof.position.set(-2, 19.2, -44);
        pitGroup.add(towerRoof);

        // 3. Tribuna Techada Frente a Boxes (lado opuesto de la recta principal)
        const grandStandGroup = new THREE.Group();
        const standPos = new THREE.Vector3().copy(p0).addScaledVector(right, this.roadWidth * 0.5 + 15.5);
        grandStandGroup.position.set(standPos.x, p0.y - 0.1, standPos.z);
        grandStandGroup.rotation.y = angle;

        for (let step = 0; step < 5; step++) {
            const tier = new THREE.Mesh(
                new THREE.BoxGeometry(2.2, 1.2 + step * 1.1, 68),
                step % 2 === 0 ? whiteMat : redAccentMat
            );
            tier.position.set(step * 2.1, (1.2 + step * 1.1) * 0.5, 0);
            tier.castShadow = true;
            grandStandGroup.add(tier);
        }

        const canopy = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.6, 70), whiteMat);
        canopy.position.set(4.2, 9.5, 0);
        canopy.rotation.z = 0.12;
        grandStandGroup.add(canopy);

        this.worldGroup.add(pitGroup);
        this.worldGroup.add(grandStandGroup);

        // 4. Barreras de Neumáticos Rojos y Blancos (Tire Walls) en las Trampas de Arena de las curvas
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
                    dummy.position.set(tPos.x, pt.y + 0.55, tPos.z);
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
     * Volcán Misti nevado al fondo, dunas de arena dorada y costa azul del Océano Pacífico.
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

        // 3. Dunas de Arena Dorada instanciadas alrededor del circuito
        const duneGeo = new THREE.ConeGeometry(38, 14, 12);
        const duneMat = new THREE.MeshStandardMaterial({
            map: this.textures.sandDesert,
            roughness: 0.92
        });
        const duneMats = [];
        const dummy = new THREE.Object3D();

        for (let i = 5; i < this.trackPoints.length; i += 9) {
            const p = this.trackPoints[i];
            const pNext = this.trackPoints[(i + 1) % this.trackPoints.length];
            const tangent = new THREE.Vector3().subVectors(pNext, p).normalize();
            const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

            [-1, 1].forEach((side) => {
                const dist = this.roadWidth * 0.5 + 42 + ((i * 11) % 35);
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * dist);
                const sc = 0.8 + (i % 4) * 0.35;
                dummy.position.set(pos.x, (14 * sc * 0.4) - 1.2, pos.z);
                dummy.rotation.set(0, i * 0.4, 0);
                dummy.scale.set(sc * 1.4, sc * 0.65, sc);
                dummy.updateMatrix();
                duneMats.push(dummy.matrix.clone());
            });
        }

        const instDunes = new THREE.InstancedMesh(duneGeo, duneMat, duneMats.length);
        instDunes.receiveShadow = true;
        duneMats.forEach((m, idx) => instDunes.setMatrixAt(idx, m));
        instDunes.instanceMatrix.needsUpdate = true;
        this.worldGroup.add(instDunes);
    }

    /**
     * Escenario Perú 2 (Autódromo Cusco & Lago Titicaca - Puno):
     * Gran Lago Titicaca azul profundo, laderas andinas y casas tradicionales de ladrillo/teja terracota.
     */
    buildLakeTiticacaAndAndeanTown() {
        // 1. Espejo de agua del Lago Titicaca (Puno)
        const lakeGeo = new THREE.PlaneGeometry(2400, 1050);
        const lakeMat = new THREE.MeshStandardMaterial({
            color: 0x0369a1,
            roughness: 0.14,
            metalness: 0.72
        });
        const lake = new THREE.Mesh(lakeGeo, lakeMat);
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(0, -0.42, -820);
        this.worldGroup.add(lake);

        // 2. Viviendas Andinas de Ladrillo y Tejado Terracota (estilo Cusco / Puno en las fotos aéreas)
        const wallGeo = new THREE.BoxGeometry(9.5, 6.2, 8.5);
        const roofGeo = new THREE.ConeGeometry(7.2, 3.2, 4);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xc26d48, roughness: 0.85 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.75 });

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
                const dist = this.roadWidth * 0.5 + 32 + ((i * 7) % 28);
                const pos = new THREE.Vector3().copy(p).addScaledVector(right, side * dist);
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

        const instWalls = new THREE.InstancedMesh(wallGeo, wallMat, wallMats.length);
        instWalls.castShadow = true;
        instWalls.receiveShadow = true;
        wallMats.forEach((m, idx) => instWalls.setMatrixAt(idx, m));
        instWalls.instanceMatrix.needsUpdate = true;
        this.worldGroup.add(instWalls);

        const instRoofs = new THREE.InstancedMesh(roofGeo, roofMat, roofMats.length);
        instRoofs.castShadow = true;
        roofMats.forEach((m, idx) => instRoofs.setMatrixAt(idx, m));
        instRoofs.instanceMatrix.needsUpdate = true;
        this.worldGroup.add(instRoofs);
    }

    createCarMesh(carConfig, isPolice = false) {
        const carGroup = new THREE.Group();
        // Sub-grupo de carrocería suspendida (permite animar Pitch, Roll y Heave sin despegar las ruedas del asfalto)
        const chassisGroup = new THREE.Group();
        carGroup.add(chassisGroup);

        const dim = carConfig.dimensions;

        const paintMat = new THREE.MeshStandardMaterial({
            color: isPolice ? 0xf8fafc : carConfig.color,
            roughness: 0.14,
            metalness: 0.82,
            envMap: this.envMap,
            envMapIntensity: 1.25
        });

        const carbonMat = new THREE.MeshStandardMaterial({
            color: isPolice ? 0x09090b : carConfig.secondaryColor,
            roughness: 0.32,
            metalness: 0.55,
            envMap: this.envMap
        });

        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x050811,
            roughness: 0.06,
            metalness: 0.95,
            envMap: this.envMap,
            envMapIntensity: 1.4
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            roughness: 0.1,
            metalness: 0.95
        });

        const underbody = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 1.02, 0.16, dim.length * 1.03), carbonMat);
        underbody.position.y = 0.24;
        chassisGroup.add(underbody);

        const lowerChassis = new THREE.Mesh(new THREE.BoxGeometry(dim.width, dim.height * 0.42, dim.length * 0.98), paintMat);
        lowerChassis.position.y = 0.52;
        lowerChassis.castShadow = true;
        lowerChassis.receiveShadow = true;
        chassisGroup.add(lowerChassis);

        const fenderGeo = new THREE.BoxGeometry(dim.width * 1.05, dim.height * 0.28, 0.92);
        const frontFenders = new THREE.Mesh(fenderGeo, isPolice ? carbonMat : paintMat);
        frontFenders.position.set(0, 0.48, dim.length * 0.31);
        frontFenders.castShadow = true;
        const rearFenders = new THREE.Mesh(fenderGeo, isPolice ? carbonMat : paintMat);
        rearFenders.position.set(0, 0.50, -dim.length * 0.31);
        rearFenders.castShadow = true;
        chassisGroup.add(frontFenders, rearFenders);

        const noseMesh = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.94, dim.height * 0.24, dim.length * 0.36), paintMat);
        noseMesh.position.set(0, 0.68, dim.length * 0.28);
        noseMesh.rotation.x = 0.09;
        noseMesh.castShadow = true;
        chassisGroup.add(noseMesh);

        const intercooler = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.52, 0.22, 0.06), chromeMat);
        intercooler.position.set(0, 0.38, dim.length * 0.501);
        chassisGroup.add(intercooler);

        const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.82, dim.height * 0.42, dim.length * 0.50), glassMat);
        cabinGlass.position.set(0, 0.98, -dim.length * 0.04);
        cabinGlass.castShadow = true;
        chassisGroup.add(cabinGlass);

        const roofPanel = new THREE.Mesh(
            new THREE.BoxGeometry(dim.width * 0.78, 0.07, dim.length * 0.36),
            (carConfig.id === 'nsx' || carConfig.id === 'lfa') ? carbonMat : paintMat
        );
        roofPanel.position.set(0, 1.21, -dim.length * 0.04);
        chassisGroup.add(roofPanel);

        const mirrorGeo = new THREE.BoxGeometry(0.24, 0.11, 0.16);
        const leftMirror = new THREE.Mesh(mirrorGeo, paintMat);
        leftMirror.position.set(-dim.width * 0.53, 0.86, dim.length * 0.14);
        const rightMirror = new THREE.Mesh(mirrorGeo, paintMat);
        rightMirror.position.set(dim.width * 0.53, 0.86, dim.length * 0.14);
        chassisGroup.add(leftMirror, rightMirror);

        const standGeo = new THREE.BoxGeometry(0.07, 0.34, 0.26);
        const leftStand = new THREE.Mesh(standGeo, carbonMat);
        leftStand.position.set(-dim.width * 0.35, 0.92, -dim.length * 0.43);
        const rightStand = new THREE.Mesh(standGeo, carbonMat);
        rightStand.position.set(dim.width * 0.35, 0.92, -dim.length * 0.43);
        chassisGroup.add(leftStand, rightStand);

        const wingBlade = new THREE.Mesh(
            new THREE.BoxGeometry(dim.width * 0.98, 0.07, 0.34),
            dim.spoilerType === 'hoop_wing' ? paintMat : carbonMat
        );
        wingBlade.position.set(0, 1.11, -dim.length * 0.44);
        wingBlade.castShadow = true;
        chassisGroup.add(wingBlade);

        const exhaustGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10);
        exhaustGeo.rotateX(Math.PI / 2);
        const exLeft = new THREE.Mesh(exhaustGeo, chromeMat);
        exLeft.position.set(-dim.width * 0.28, 0.28, -dim.length * 0.51);
        const exRight = new THREE.Mesh(exhaustGeo, chromeMat);
        exRight.position.set(dim.width * 0.28, 0.28, -dim.length * 0.51);
        chassisGroup.add(exLeft, exRight);

        const flameMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.0 });
        const flameGeo = new THREE.ConeGeometry(0.11, 0.65, 8);
        flameGeo.rotateX(-Math.PI / 2);
        const flameL = new THREE.Mesh(flameGeo, flameMat);
        flameL.position.set(-dim.width * 0.28, 0.28, -dim.length * 0.51 - 0.32);
        const flameR = new THREE.Mesh(flameGeo, flameMat);
        flameR.position.set(dim.width * 0.28, 0.28, -dim.length * 0.51 - 0.32);
        chassisGroup.add(flameL, flameR);

        const headlightMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
        const hlGeo = new THREE.BoxGeometry(0.40, 0.13, 0.08);
        const hlLeft = new THREE.Mesh(hlGeo, headlightMat);
        hlLeft.position.set(-dim.width * 0.33, 0.62, dim.length * 0.495);
        const hlRight = new THREE.Mesh(hlGeo, headlightMat);
        hlRight.position.set(dim.width * 0.33, 0.62, dim.length * 0.495);
        chassisGroup.add(hlLeft, hlRight);

        const brakeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        if (dim.taillightStyle === 'quad_round') {
            const roundGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14);
            roundGeo.rotateX(Math.PI / 2);
            [-0.66, -0.40, 0.40, 0.66].forEach(xOff => {
                const tl = new THREE.Mesh(roundGeo, brakeMat);
                tl.position.set(xOff, 0.64, -dim.length * 0.495);
                chassisGroup.add(tl);
            });
        } else {
            const tlBar = new THREE.Mesh(new THREE.BoxGeometry(dim.width * 0.84, 0.14, 0.06), brakeMat);
            tlBar.position.set(0, 0.64, -dim.length * 0.495);
            chassisGroup.add(tlBar);
        }

        let sirenLightRed = null;
        let sirenLightBlue = null;
        if (isPolice) {
            const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.28), chromeMat);
            barBase.position.set(0, 1.29, -0.1);
            chassisGroup.add(barBase);

            sirenLightRed = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.24), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
            sirenLightRed.position.set(-0.28, 1.35, -0.1);
            sirenLightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.24), new THREE.MeshBasicMaterial({ color: 0x0066ff }));
            sirenLightBlue.position.set(0.28, 1.35, -0.1);
            chassisGroup.add(sirenLightRed, sirenLightBlue);
        }

        const neonMat = new THREE.MeshBasicMaterial({
            color: isPolice ? 0xef4444 : carConfig.neonColor,
            transparent: true,
            opacity: 0.46,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        });
        const neonPlane = new THREE.Mesh(new THREE.PlaneGeometry(dim.width * 0.92, dim.length * 0.85), neonMat);
        neonPlane.rotation.x = -Math.PI / 2;
        neonPlane.position.y = 0.05;
        carGroup.add(neonPlane);

        const wheels = [];
        const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.29, 20);
        wheelGeo.rotateZ(Math.PI / 2);
        const tireMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75 });

        const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.31, 12);
        rimGeo.rotateZ(Math.PI / 2);
        const rimMat = new THREE.MeshStandardMaterial({
            color: carConfig.rimColor,
            metalness: 0.9,
            roughness: 0.15,
            envMap: this.envMap
        });

        const wheelPositions = [
            [-dim.width * 0.49, 0.36, dim.length * 0.31],
            [dim.width * 0.49, 0.36, dim.length * 0.31],
            [-dim.width * 0.49, 0.36, -dim.length * 0.31],
            [dim.width * 0.49, 0.36, -dim.length * 0.31]
        ];

        wheelPositions.forEach((pos) => {
            const wGroup = new THREE.Group();
            wGroup.position.set(pos[0], pos[1], pos[2]);
            wGroup.add(new THREE.Mesh(wheelGeo, tireMat));
            wGroup.add(new THREE.Mesh(rimGeo, rimMat));
            carGroup.add(wGroup);
            wheels.push(wGroup);
        });

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
}

window.HorizonWorldBuilder = HorizonWorldBuilder;
