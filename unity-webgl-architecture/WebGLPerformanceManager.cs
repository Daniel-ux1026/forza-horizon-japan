using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Scripting;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
#if UNITY_ADDRESSABLES
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
#endif

namespace HorizonJapan.WebOptimization
{
    /// <summary>
    /// Gestor integral de rendimiento, tasa de refresco, Garbage Collector y memoria Addressables
    /// optimizado específicamente para compilaciones Unity WebGL / WebGPU en PC y Android.
    /// </summary>
    public class WebGLPerformanceManager : MonoBehaviour
    {
        public static WebGLPerformanceManager Instance { get; private set; }

        [Header("Frame Rate & Resolution Settings")]
        [SerializeField] private int desktopTargetFPS = 60;
        [SerializeField] private int mobileTargetFPS = 60;
        [SerializeField] private float minDynamicRenderScale = 0.65f;
        [SerializeField] private float maxDynamicRenderScale = 1.0f;

        [Header("Memory & GC Thresholds (WebGL)")]
        [Tooltip("Intervalo en segundos para limpieza preventiva en pausas o transiciones")]
        [SerializeField] private float memoryCheckInterval = 15f;
        [Tooltip("Umbral de caída de FPS para reducir automáticamente la escala de renderizado URP")]
        [SerializeField] private float lowFpsThreshold = 42f;

        private UniversalRenderPipelineAsset urpAsset;
        private float currentRenderScale = 1.0f;
        private float fpsAccumulator = 0f;
        private int fpsFrames = 0;
        private float currentFps = 60f;
        private bool isMobileBrowser = false;

        // Registro de sectores del mapa cargados vía Addressables para liberar memoria WASM
        private readonly Dictionary<string, object> loadedMapChunks = new Dictionary<string, object>();

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            urpAsset = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            DetectPlatformAndConfigure();
            ConfigureGarbageCollector();
        }

        private void Start()
        {
            StartCoroutine(MonitorPerformanceAndMemoryRoutine());
        }

        private void Update()
        {
            // Medición ligera de FPS sin asignar memoria (Zero-Allocation)
            fpsAccumulator += Time.unscaledDeltaTime;
            fpsFrames++;

            if (fpsAccumulator >= 1.0f)
            {
                currentFps = fpsFrames / fpsAccumulator;
                fpsAccumulator = 0f;
                fpsFrames = 0;
                AdjustDynamicResolutionScale();
            }
        }

        /// <summary>
        /// Configura Application.targetFrameRate, VSync y parámetros de URP según directiva #if UNITY_WEBGL
        /// </summary>
        private void DetectPlatformAndConfigure()
        {
            isMobileBrowser = Application.isMobilePlatform || SystemInfo.deviceType == DeviceType.Handheld;

#if UNITY_WEBGL && !UNITY_EDITOR
            // En WebGL, requestAnimationFrame del navegador controla el loop óptimo cuando vSyncCount = 0 y targetFrameRate = -1,
            // o bien fijamos explícitamente 60 FPS para evitar calentamiento en pantallas móviles de 120Hz.
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = isMobileBrowser ? mobileTargetFPS : desktopTargetFPS;

            // Desactivar ejecución en segundo plano para ahorrar batería y memoria en pestañas inactivas
            Application.runInBackground = false;

            // Ajustar configuración inicial de URP según dispositivo
            if (urpAsset != null)
            {
                currentRenderScale = isMobileBrowser ? 0.80f : 1.0f;
                urpAsset.renderScale = currentRenderScale;
                urpAsset.msaaSampleCount = isMobileBrowser ? 1 : 2; // Evitar MSAA 4x/8x en WebGL móvil
                urpAsset.shadowDistance = isMobileBrowser ? 35f : 70f; // Solo sombras cercanas para vehículos
            }

            // Reducir presupuesto de partículas y LOD Bias en navegadores móviles Android
            if (isMobileBrowser)
            {
                QualitySettings.lodBias = 0.75f;
                QualitySettings.maximumLODLevel = 1;
                QualitySettings.particleRaycastBudget = 16;
            }
#else
            QualitySettings.vSyncCount = 1;
            Application.targetFrameRate = desktopTargetFPS;
#endif
        }

        /// <summary>
        /// Optimiza el Garbage Collector para evitar tirones (stuttering) durante la conducción a alta velocidad.
        /// En WebGL (single-threaded o WASM), las pausas del GC detienen directamente el hilo principal del navegador.
        /// </summary>
        private void ConfigureGarbageCollector()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // Habilitar recolección incremental para repartir el trabajo en micro-slices por frame
            GarbageCollector.GCMode = GarbageCollector.Mode.Enabled;
            // Asignar un presupuesto máximo de 1.5 ms por frame al GC incremental
            GarbageCollector.CollectIncremental(1500000);
#endif
        }

        /// <summary>
        /// Llamar al iniciar una carrera o derrape intenso: desactiva temporalmente el GC automático
        /// si la memoria libre lo permite, evitando micro-pausas en curvas críticas.
        /// </summary>
        public void SetHighSpeedDrivingGCMode(bool isRacingActive)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (isRacingActive)
            {
                // Modo Manual durante tramos críticos; controlamos nosotros los micro-slices
                GarbageCollector.GCMode = GarbageCollector.Mode.Manual;
            }
            else
            {
                // Al pausar, abrir el menú de música o cambiar de auto, recolectamos de forma segura
                GarbageCollector.GCMode = GarbageCollector.Mode.Enabled;
                System.GC.Collect();
                Resources.UnloadUnusedAssets();
            }
#endif
        }

        /// <summary>
        /// Escala dinámicamente el Render Scale de URP si los FPS bajan de 42 FPS en móviles/PC.
        /// </summary>
        private void AdjustDynamicResolutionScale()
        {
            if (urpAsset == null) return;

            if (currentFps < lowFpsThreshold && currentRenderScale > minDynamicRenderScale)
            {
                currentRenderScale = Mathf.Max(minDynamicRenderScale, currentRenderScale - 0.05f);
                urpAsset.renderScale = currentRenderScale;
            }
            else if (currentFps > 57f && currentRenderScale < (isMobileBrowser ? 0.85f : maxDynamicRenderScale))
            {
                currentRenderScale = Mathf.Min(isMobileBrowser ? 0.85f : maxDynamicRenderScale, currentRenderScale + 0.02f);
                urpAsset.renderScale = currentRenderScale;
            }
        }

        /// <summary>
        /// Corrutina periódica para ejecutar GC incremental controlado y vigilar el heap de WebAssembly.
        /// </summary>
        private IEnumerator MonitorPerformanceAndMemoryRoutine()
        {
            WaitForSecondsRealtime wait = new WaitForSecondsRealtime(memoryCheckInterval);

            while (true)
            {
                yield return wait;

#if UNITY_WEBGL && !UNITY_EDITOR
                if (GarbageCollector.GCMode == GarbageCollector.Mode.Manual)
                {
                    // Ejecuta un paso incremental corto de 1 ms para evitar acumulación excesiva
                    GarbageCollector.CollectIncremental(1000000);
                }
#endif
            }
        }

        /// <summary>
        /// Descarga sectores lejanos del mapa de Japón para prevenir errores "Out of Memory" en el Heap de WebAssembly.
        /// </summary>
        public void UnloadDistantMapChunk(string chunkKey)
        {
            if (!loadedMapChunks.ContainsKey(chunkKey)) return;

#if UNITY_ADDRESSABLES
            if (loadedMapChunks[chunkKey] is AsyncOperationHandle handle && handle.IsValid())
            {
                Addressables.Release(handle);
            }
#endif
            loadedMapChunks.Remove(chunkKey);
            Resources.UnloadUnusedAssets();
        }
    }
}
