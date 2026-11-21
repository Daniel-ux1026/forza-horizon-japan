# 🏎️ Forza Horizon Japan 6 — WebGL 3D Racing Edition

Videojuego de carreras 3D desarrollado con **JavaScript (ES6+)**, **Three.js (WebGL 2.0)** y **Web Audio API**, inspirado en la cultura automovilística japonesa (JDM) y circuitos internacionales de Perú.

## ✨ Características Principales

- **Flujo Cinematográfico Completo**:
  `WELCOME → MAIN_MENU → CAR_SELECTION (Garaje 3D 360°) → TRACK_SELECTION → RACE_SETUP → LOADING → RACING`
- **Garaje 3D Interactivo (360°)**:
  - **12 Vehículos 3D Seleccionables**:
    1. **Nissan GT-R (R35)** (2017 · `S1 862`)
    2. **Toyota GR Supra (A90)** (2020 · `S1 851`)
    3. **Mazda RX-7 (FD3S)** (1999 · `A 784`)
    4. **Honda NSX (NA2)** (2005 · `S1 846`)
    5. **Mitsubishi Lancer Evo IX** (2006 · `A 769`)
    6. **Subaru Impreza WRX STI** (2004 · `A 770`)
    7. **Nissan Skyline GT-R (R34)** (1999 · `S1 855`)
    8. **Honda Civic Type R (FK8)** (2017 · `A 774`)
    9. **BMW M4 Competition (G82)** (2021 · `S1 862`)
    10. **Porsche 911 GT3 (992)** (2021 · `S1 871`)
    11. **Ford Mustang GT (S550)** (2018 · `A 768`)
    12. **Lamborghini Huracán EVO** (2019 · `S1 872`)
  - Pinturas metalizadas PBR en tiempo real, personalización de llantas, neón inferior (*underglow*) y 3 etapas de preparación mecánica (Stage 1 / 2 / 3).
  - Soporte para modelos 3D externos `.glb` / `.gltf` en `assets/models/<id>.glb` y optimización de geometría por *mesh batching* (`< 290 draw calls`).
- **5 Circuitos Completos**:
  1. **Tokio: Autopista Shuto C1 & Wangan** (`tokyo_shuto`)
  2. **Paso de Hakone & Monte Fuji** (`hakone_touge`)
  3. **Distrito Shibuya & Akihabara Cyber Circuit** (`shibuya_neon`)
  4. **Perú: Autódromo Arequipa & Dunas de Trujillo** (`peru_arequipa_trujillo`)
  5. **Perú: Autódromo Andino Cusco & Lago Titicaca** (`peru_cusco_puno`)
- **3 Modos de Juego**:
  - 🏁 **Carrera de Circuito (3 Vueltas)** contra 6 rivales con IA.
  - ⏱️ **Contrarreloj por Checkpoints** con bonificación de tiempo por portal.
  - 🚨 **Persecución Policial Nocturna** con patrullas interceptoras y medidor de arresto.
- **4 Niveles de Dificultad de IA**: Baja, Media, Alta y Muy Alta (Experto).
- **Física Vehicular y Colisiones Sólidas**: Suspensión independiente en las 4 ruedas (cabeceo, balanceo, compresión), derrape con humo volumétrico, chispas de impacto y colisiones de cuerpo rígido sin traspasos.

---

## 🚀 Instalación y Ejecución Local

### Requisitos
- **Node.js** 18+ (para el servidor HTTP local y la suite de pruebas) o cualquier servidor estático.

### Comandos

```bash
# 1. Clonar el repositorio
git clone https://github.com/Daniel-ux1026/forza-horizon-japan.git
cd forza-horizon-japan

# 2. Ejecutar la suite de verificación del motor (10 pruebas automatizadas)
npm test

# 3. Iniciar el servidor local en http://localhost:8080
npm start
```

---

## 🎮 Controles

| Acción | Teclado |
|---|---|
| Acelerar | `W` o `↑` |
| Frenar / Reversa | `S` o `↓` |
| Girar Izquierda / Derecha | `A` / `D` o `←` / `→` |
| Freno de Mano (Drift) | `Espacio` |
| Nitro Boost | `Shift` |
| Cambiar Cámara | `C` |
| Abrir Garaje 3D / Tuning | `G` |
| Pausar Carrera | `P` o `Esc` |
| Reiniciar Carrera | `R` |

---

## 📂 Estructura del Proyecto

```text
forza-horizon-japan/
├── css/
│   └── styles.css           # Diseño UI/UX, pantallas cinematográficas, HUD y Garaje 3D
├── js/
│   ├── audio.js             # Sintetizador Web Audio API (motor, derrape, sirenas, radio y música)
│   ├── data.js              # Catálogo de 12 vehículos 3D, 5 circuitos, dificultades y modos
│   ├── world.js             # Motor 3D Three.js, Showroom 3D del Garaje, modelos de autos y circuitos
│   └── game.js              # Física vehicular, IA rival, colisiones, cámaras y máquina de estados
├── tests/
│   └── verify-engine.mjs    # Suite automatizada de pruebas técnicas y de rendimiento
├── tools/
│   └── server.mjs           # Servidor HTTP estático local
├── vendor/
│   └── three.min.js         # Librería Three.js r128
├── index.html               # Entrada principal de la aplicación
└── package.json             # Scripts npm (start, test)
```

---

## 👤 Autor

- **Daniel Olivos** — [@Daniel-ux1026](https://github.com/Daniel-ux1026)
