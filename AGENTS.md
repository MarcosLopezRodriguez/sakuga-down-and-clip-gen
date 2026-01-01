# Guía del Proyecto: Sakuga Downloader & Clip Generator

Este documento sirve como fuente de verdad sobre la estructura, arquitectura y decisiones técnicas del proyecto `sakuga-down-and-clip-gen`.

## Propósito del Proyecto
Herramienta diseñada para automatizar el flujo de trabajo con videos de Sakugabooru. Permite descargar videos basados en URLs o etiquetas, realizar detección de escenas para generar clips cortos y sincronizar dichos clips con el ritmo de una pista de audio (beat-syncing).

## Estructura de Carpetas

```text
sakuga-down-and-clip-gen/
├── src/                    # Código fuente principal (TypeScript)
│   ├── index.ts            # Punto de entrada CLI y orquestación
│   ├── app.ts              # Servidor Express y lógica de API/WebSockets
│   ├── downloader/         # Módulo de descarga (Sakugabooru scraping)
│   ├── clipGenerator/      # Módulo de generación de clips (FFmpeg/SceneDetect)
│   ├── audioAnalyzer/      # Análisis de audio para detección de beats
│   ├── beatSyncGenerator/  # Generación de montajes sincronizados
│   ├── frontend/           # Código del frontend (SPA en TS)
│   ├── types/              # Definiciones de tipos globales
│   └── utils/              # Utilidades compartidas (Cache, Logger, etc.)
├── public/                 # Assets estáticos y build del frontend
├── output/                 # Directorio por defecto para archivos generados (GIT IGNORED)
│   ├── downloads/          # Videos originales descargados
│   ├── clips/              # Clips extraídos
│   └── beat_synced_videos/ # Montajes finales
├── Dockerfile/compose.yml  # Configuración de containerización
└── rename_clips.py         # Script auxiliar Python para renombrado masivo
```

## Arquitectura y Patrones

### Diseño Modular y Orientado a Objetos (Alta Certeza)
El núcleo del sistema está organizado en clases de responsabilidad única (`Downloader`, `ClipGenerator`, etc.). Estas clases encapsulan la complejidad de las herramientas externas (Axios/Cheerio para scraping, FFmpeg para video).

### Comunicación Basada en Eventos (Alta Certeza)
Se utiliza `EventEmitter` (implícito en el uso de Socket.io y patrones observados en `app.ts`) para notificar el progreso de tareas largas (descargas, procesamiento) desde el backend al frontend.

### Interfaz Dual: CLI y Web (Alta Certeza)
- **CLI**: Implementada con `yargs` en `src/index.ts`.
- **Web**: Servidor Express en `src/app.ts` que sirve una SPA y expone una API REST + WebSockets.

### Integración de Herramientas Externas (Estrategia)
El proyecto actúa como un "pegamento" de alto nivel para:
- **FFmpeg/FFprobe**: Manipulación de video y extracción de metadatos.
- **Python (Opcional/Auxiliar)**: Uso de `PySceneDetect` para detección avanzada de escenas y scripts de renombrado.

## Convenciones y Reglas de Extensión

### Gestión de Rutas
- Utilizar siempre `path.join` y rutas absolutas basadas en el directorio de trabajo del proceso.
- Las rutas de salida deben ser configurables pero tender a residir dentro de `output/`.

### Manejo de Larga Ejecución
- Cualquier operación que involucre procesamiento de video debe ser asíncrona.
- Se debe informar del progreso a través de los canales de WebSockets definidos en `SakugaDownAndClipGen.setupWebSockets`.

### Tipado
- Mantener el tipado estricto en TypeScript. Nuevos tipos complejos deben ir en `src/types/` o en el módulo correspondiente si son locales.

### Dependencias
- Evitar añadir dependencias pesadas si FFmpeg puede realizar la tarea.
- FFmpeg y FFprobe se resuelven dinámicamente o vía variables de entorno.

## Flujos Principales

### 1. Descarga y Clip (Auto-Flow)
`Entrada URL/Tag` -> `Downloader` (Scraping + Download) -> `ClipGenerator` (Análisis de escenas) -> `FFmpeg` (Extracción de segmentos) -> `Output`.

### 2. Beat-Syncing
`Audio Upload` -> `AudioAnalyzer` (Deteción de transitorios) -> `Selección de Clips` -> `BeatSyncGenerator` -> `FFmpeg` (Concatenación y ajuste de velocidad) -> `Video Final`.

## Decisiones Técnicas Observadas (Inferencias)

- **Caché de FFprobe**: Se observa un `ffprobeCache` en `src/utils`. Inferencia: El análisis de video es costoso y se busca evitar re-ejecuciones innecesarias sobre el mismo archivo.
- **Esbuild para Frontend**: Se prefiere a Webpack/Vite por simplicidad y velocidad en un entorno de herramientas internas.
- **Scripts en Python**: Inferencia: Se aprovecha la madurez del ecosistema de procesamiento de video en Python para tareas específicas que en Node.js serían más complejas o menos eficientes.

## Anti-patrones (Qué NO hacer)

- **Bloquear el Event Loop**: No realizar procesamiento síncrono de archivos grandes en los handlers de Express.
- **Hardcodear rutas**: No usar strings directamente para rutas (e.g., `output/clips/myvideo.mp4`), usar `path.join`.
- **Saltarse el Logger**: Existe un logger en `src/utils`, usarlo en lugar de `console.log` en módulos de lógica de negocio (aunque el código actual usa mucho `console.log`, la tendencia debería ser hacia el logger).

## Incertidumbres y Deuda
- **Gestión de Errores FFmpeg**: No está claro cómo se recupera el sistema ante fallos críticos de procesos externos (spawn) más allá de capturar el evento `error`.
- **Limpieza de Temporales**: El uso intenso de carpetas temporales (`output/temp_audio`) parece requerir un mecanismo de limpieza manual o periódico no detectado explícitamente.
