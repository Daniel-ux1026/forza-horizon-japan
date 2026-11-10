# Plan de Arquitectura Técnica: Forza Horizon 6 Japan (WebGL / WebGPU)

Este documento detalla la arquitectura de ingeniería para ejecutar un juego de conducción simcade de mundo abierto ambientado en Japón (Tokio, Hakone y Shibuya) dentro de navegadores de escritorio (PC) y móviles (Android) de forma 100% portable y sin instalaciones.

---

## 1. Optimización Extrema para WebGL / WebGPU (Unity URP)

### 1.1 Configuración de Universal Render Pipeline (URP) para Navegadores
* **Forward+ / Forward Rendering Simplificado:** Se utiliza el *Universal Renderer* en modo **Forward** con un máximo de `1 Additional Light per Object` (sin Deferred Rendering para evitar el alto consumo de ancho de banda de memoria de los *G-Buffers* en GPUs móviles Adreno/Mali).
* **Compresión Estricta de Texturas (ASTC / WebP / Basis Universal):**
  * **Android WebGL / WebGPU:** Formato **ASTC 6x6** para texturas de entorno y carrocerías, y **ASTC 4x4** para normales e interfaces. Reduce el consumo de VRAM hasta un **75%** frente a RGBA32.
  * **PC Desktop WebGL:** Compresión **DXT5 (BC3) / BC7** empaquetada o **KTX2 (Basis Universal / UASTC)** transcodificada en GPU al vuelo.
* **Presupuesto Poligonal (Polygon Budget) por Escena:**
  * **Escenario visible por frame:** Máximo `120,000 - 180,000 triángulos` en móvil y `350,000 triángulos` en PC mediante *Occlusion Culling* agresivo y *LOD Groups* (`LOD0` < 25m, `LOD1` 25m-80m, `LOD2` > 80m).
  * **Vehículo del Jugador (5 Autos JDM):** `18,000 - 25,000 triángulos` en `LOD0` y `4,500 triángulos` para vehículos IA rivales.
* **Eliminación de Postprocesado Pesado:**
  * Se desactivan por completo: *Screen Space Reflection (SSR)*, *Screen Space Ambient Occlusion (SSAO)*, *Motion Blur* y *Depth of Field*.
  * Se sustituyen por: **MatCap / Cubemap Reflections estáticos** en el shader de pintura metálica del vehículo y **Lut (Color Grading 16x16)** combinado con *Emissive Unlit Buffers* para simular el neón nocturno de Tokio a coste cero de GPU.

### 1.2 Estrategia de Iluminación Híbrida (100% Baked Environment + Low-Cost Vehicle Shadows)
* **Escenario 100% Horneado (Baked Lightmaps):**
  * Toda la iluminación de los rascacielos de Shuto Expressway, carteles LED de Shibuya y farolas de Hakone se pre-calcula con **Progressive GPU Lightmapper** en modo **Baked Indirect / Subtractive**.
  * Los *Lightmaps* se comprimen con **Directional Mode: Non-Directional** (ahorra la mitad de memoria de texturas de luz) y resolución máxima de `1024x1024` por sector.
* **Sombras en Tiempo Real Exclusivas para Vehículos:**
  * Únicamente los 5 vehículos dinámicos proyectan sombras (`Cast Shadows: On` solo en una malla *Shadow Proxy* de bajo poligonaje de 300 triángulos debajo del chasis).
  * `Shadow Distance` en URP limitado estrictamente a **35 metros en Android** y **70 metros en PC**, con **1 Cascade** en móvil y **2 Cascades** en escritorio.

---

## 2. Gestión de Memoria y Carga Instantánea (< 30MB - 50MB WASM Inicial)

### 2.1 Streaming Dinámico del Mapa de Japón con Unity Addressables + CDN
1. **Separación del Build Base (.wasm + .data inicial < 30MB):**
   * La escena inicial de arranque (*Bootstrap + Menú del Garaje + 1 Sector Base*) se compila con `Strip Engine Code = High`, `Managed Stripping Level = High` y compresión **Brotli (`.br`)**.
2. ** División de Japón en Sectores (Addressable Groups por Bioma/Tramo):**
   * `Group_Cars_JDM`: Cada uno de los 5 vehículos (*Skyline R34, RX-7 FD, Supra A80, NSX-R, Lexus LFA*) en su propio *AssetBundle* de `1.8 MB` cargado bajo demanda al seleccionarlo.
   * `Group_Map_Tokyo_Shuto`, `Group_Map_Hakone_Touge`, `Group_Map_Shibuya`: Divididos en *Chunks* espaciales de `500m x 500m` alojados en un CDN (Cloudflare R2 / AWS CloudFront / Firebase Hosting) con cabeceras `Cache-Control: public, max-age=31536000, immutable`.
   * A medida que el jugador conduce por un sector $N$, un `TriggerVolume` precarga de forma asíncrona el sector $N+1$ con `Addressables.LoadSceneAsync(chunkKey, LoadSceneMode.Additive)`.

### 2.2 Prevención de Errores "Out of Memory" (OOM) en Navegadores Móviles Android
* En navegadores de Android, una pestaña WebGL que supere los **512 MB - 768 MB** de RAM total es cerrada forzosamente por el sistema operativo.
* **Regla de Retención de Sectores ($N-2$):** Cuando el jugador avanza al sector $N$, el sector $N-2$ ejecuta inmediatamente `Addressables.UnloadSceneAsync()` seguido de `Addressables.Release(handle)` y `Resources.UnloadUnusedAssets()`.
* **Audio Streaming para la Radio Musical:** Las canciones nunca se descomprimen en RAM (`Load Type: Streaming` o reproducción directa mediante el `HTML5 Web Audio API / AudioContext` del navegador fuera del Heap de WebAssembly).

---

## 3. Adaptación de Interfaz Responsive y Controles Web Multiplataforma

### 3.1 Detección Automática Desktop vs. Android Mobile
* **Nuevo Input System de Unity (`InputSystem`):**
  * Define un `InputActionAsset` con tres esquemas (`Keyboard&Mouse`, `Gamepad`, `Touchscreen`).
  * Al detectar `Application.isMobilePlatform` o eventos `Touchscreen.current`, activa automáticamente el Canvas de controles táctiles (`OnScreenStick` para el joystick virtual analógico de dirección y `OnScreenButton` para Acelerador, Freno, Freno de Mano/Drift y Nitro).
* **Adaptación Responsive Universal:**
  * `CanvasScaler` configurado en `Scale With Screen Size`, resolución de referencia `1920x1080`, y `Screen Match Mode = Match Width Or Height (0.5)`.
  * Uso de anclajes (`RectTransform Anchors`) en las 4 esquinas respetando `Screen.safeArea` para evitar el *notch* o cámara frontal en teléfonos Android modernos.
