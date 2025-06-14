# SakugaDownAndClipGen

Una aplicación para descargar videos de Sakugabooru y generar clips automáticamente detectando cambios de escena, además de crear videos sincronizados con el ritmo de un audio.

## Características

*   **Descarga Versátil de Videos**:
    *   Soporte para URLs de Sakugabooru (posts individuales y búsquedas por etiquetas).
    *   Compatible con URLs directas de archivos de video.
    *   Descarga de múltiples videos a partir de un listado de etiquetas en un archivo de texto (mediante CLI).
*   **Potente Generación de Clips**:
    *   Detección de escenas configurable:
        *   Utiliza PySceneDetect (con FFmpeg como respaldo).
        *   Opción para usar FFmpeg directamente para la detección de escenas.
    *   Procesa videos locales existentes en tu disco duro.
    *   Genera clips para todos los videos dentro de una carpeta específica (procesamiento por lotes).
    *   Parámetros ajustables: duración mínima/máxima de clips y umbral de detección de escenas.
*   **Sincronización con Beats de Audio (Beat Sync)**:
    *   Sube un archivo de audio (MP3, WAV) a través de la interfaz web.
    *   Detecta automáticamente los beats del audio usando las herramientas de Aubio.
    *   Permite definir un segmento específico del audio (tiempos de inicio y fin) para la sincronización.
    *   Selecciona múltiples carpetas de clips existentes que servirán como material fuente.
    *   Genera un nuevo video donde los cortes entre los clips fuente se sincronizan con los beats detectados en el audio proporcionado.
    *   Interfaz web intuitiva para facilitar la carga del audio, la selección de clips fuente y la configuración de la salida.
*   **Interfaz de Usuario Dual**:
    *   **Interfaz Web Intuitiva**:
        *   Gestión centralizada de descargas, generación de clips y creación de videos Beat Sync.
        *   Vista previa de clips con reproducción automática y bucle.
        *   Eliminación individual de clips.
        *   Organización de clips en carpetas por video original.
        *   Actualizaciones de progreso en tiempo real mediante WebSockets.
    *   **Completa Interfaz de Línea de Comandos (CLI)**:
        *   Acceso a todas las funcionalidades principales de descarga y generación de clips.
        *   Ideal para automatización y scripts (Beat Sync actualmente solo disponible vía web).
*   **Utilidades Adicionales**:
    *   Renombrado de videos/clips mediante un script Python integrado (accesible vía API).
*   **Organización Automática**:
    *   Los videos descargados, clips generados y videos Beat Sync se guardan automáticamente en subdirectorios estructurados.

## Requisitos

- **Node.js**: Versión 14.0.0 o superior. Se puede descargar desde [nodejs.org](https://nodejs.org/).
- **Python**: Versión 3.7 o superior. Necesario para PySceneDetect. Se puede descargar desde [python.org](https://python.org/).
- **PySceneDetect**:
    - Se instala mediante pip: `pip install scenedetect[opencv]`
    - Asegúrate de que Python y pip estén en el PATH del sistema.
- **FFmpeg**:
    - Necesario para la generación de clips, videos Beat Sync y como motor de detección de escenas.
    - Descargar desde [ffmpeg.org](https://ffmpeg.org/download.html).
    - Debe estar accesible en el PATH del sistema, o puedes configurar la variable de entorno `FFMPEG_PATH` para apuntar al ejecutable `ffmpeg` y `FFPROBE_PATH` para `ffprobe`.
- **Aubio**:
    - Necesario para la detección de beats en la función "Beat Sync".
    - Descargar e instalar las herramientas de línea de comandos de Aubio desde [aubio.org](https://aubio.org/download).
    - Asegúrate de que `aubioonset` (o la herramienta de Aubio utilizada para la detección de onsets/beats) esté accesible en el PATH del sistema.

## Instalación

1.  **Clona el repositorio:**
    ```bash
    git clone https://github.com/tu-usuario/sakuga-down-and-clip-gen.git
    cd sakuga-down-and-clip-gen
    ```

2.  **Instala las dependencias de Node.js:**
    ```bash
    npm install
    ```

3.  **Compila el proyecto TypeScript:**
    ```bash
    npm run build
    ```

4.  **Instala FFmpeg y PySceneDetect:**
    *   Asegúrate de tener Python 3.7+ instalado.
    *   Instala PySceneDetect:
        ```bash
        pip install scenedetect[opencv]
        ```
    *   Descarga FFmpeg desde [ffmpeg.org](https://ffmpeg.org/download.html) y añádelo al PATH de tu sistema, o define las variables de entorno `FFMPEG_PATH` y `FFPROBE_PATH`.

5.  **Instala Aubio (para Beat Sync):**
    *   Visita [aubio.org/download](https://aubio.org/download) y sigue las instrucciones de instalación para tu sistema operativo.
    *   Asegúrate de que las herramientas de línea de comandos de Aubio (especialmente `aubioonset`) estén disponibles en el PATH de tu sistema.

6.  **(Opcional) Enlaza el comando CLI globalmente:**
    Si deseas usar el comando `sakuga-down-and-clip` directamente desde cualquier ubicación (no aplica a todas las funciones como Beat Sync):
    ```bash
    npm link 
    ```
    Esto te permitirá ejecutar comandos como `sakuga-down-and-clip download ...` en lugar de `node dist/index.js download ...`.

7.  **Cómo ejecutar:**
    *   **Para la interfaz web:**
        ```bash
        npm run dev -- server
        ```
        Luego accede a `http://localhost:3000` en tu navegador.
    *   **Para la interfaz de línea de comandos (CLI):**
        Consulta la sección "Uso de la CLI" para ver ejemplos de comandos. Si no usaste `npm link`, ejecutarás los comandos con `node dist/index.js <comando> [opciones]`.

## Uso

1. Acceder a la interfaz web en http://localhost:3000
2. Usar la sección 'Descargar' para obtener videos de Sakugabooru:
    - Por URL directa.
    - Por etiquetas (separadas por punto y coma).
3. Usar la sección 'Descargar Imágenes' para obtener imágenes según una consulta o un archivo de consultas.
4. Utilizar la sección 'Generar clips' para procesar los videos descargados:
    - Configurar duración mínima y máxima de los clips.
    - Ajustar el umbral de detección de cambios de escena.
5. Ver y gestionar los clips generados en la sección 'Explorador':
    - Los clips se reproducen automáticamente al pasar el cursor (en algunos navegadores).
    - Eliminar clips no deseados con el botón de borrado.
6. Utilizar la sección 'Renombrar Clips' para procesar y renombrar clips existentes en nuevas carpetas.
7. Experimenta con la función 'Beat Sync':
    - Navega a la pestaña "Beat Sync".
    - Sube un archivo de audio (MP3, WAV). La duración se detectará y mostrará.
    - Define los tiempos de inicio y fin del segmento de audio que deseas utilizar para la sincronización.
    - Selecciona una o más carpetas que contengan los videoclips que servirán como material fuente. Puedes filtrar la lista de carpetas.
    - Especifica un nombre para el video de salida (ej: `mi_video_sincronizado.mp4`).
    - Haz clic en "Generar Video Beat-Synced". La aplicación analizará el audio para encontrar los beats y luego cortará y unirá segmentos de los clips fuente para que coincidan con esos beats.
    - El video resultante aparecerá en la sección de resultados y estará disponible en la carpeta `output/beat_synced_videos`.

### Uso de la CLI (Interfaz de Línea de Comandos)

Puedes ejecutar los comandos de la CLI usando `node dist/index.js <comando> [opciones]` o, si has configurado un alias o enlace simbólico, directamente con `sakuga-down-and-clip-gen <comando> [opciones]`. La funcionalidad de Beat Sync no está disponible actualmente a través de la CLI.

Para obtener ayuda sobre cualquier comando y ver todas las opciones disponibles, usa la bandera `--help` (ej: `node dist/index.js download --help`).

**Ejemplos básicos:**

*   **Descargar videos por URL o etiqueta:**
    ```bash
    # Descargar un video específico de un post de Sakugabooru
    node dist/index.js download https://sakugabooru.com/post/show/12345

    # Descargar videos con una etiqueta específica
    node dist/index.js download "https://sakugabooru.com/post?tags=sword_fight"

    # Descargar videos usando un archivo de etiquetas (tags.txt contiene "sword_fight;magic_effects")
    node dist/index.js download --tags-file ./tags.txt --output ./mis_videos
    ```

*   **Generar clips de videos locales:**
    ```bash
    # Generar clips de un video específico
    node dist/index.js generate-clips ./mis_videos/mi_video.mp4 --output ./mis_clips

    # Generar clips de todos los videos en un directorio, usando FFmpeg para detección
    node dist/index.js generate-clips ./mis_videos/ --ffmpeg --min-duration 1.5 --max-duration 5.0
    ```

*   **Descargar y generar clips en un solo paso:**
    ```bash
    node dist/index.js download-and-clip --url "https://sakugabooru.com/post?tags=impact_frames" --clips-dir ./mis_clips_de_impacto
    ```

## Estructura del Proyecto

```
.
├── public/             # Archivos estáticos para el frontend (HTML, CSS, JS cliente)
├── src/                # Código fuente TypeScript del backend
│   ├── audioAnalyzer/    # Lógica para el análisis de audio y detección de beats (Aubio)
│   ├── beatSyncGenerator/ # Lógica para la generación de videos sincronizados con beats
│   ├── clipGenerator/    # Lógica para la generación de clips y detección de escenas
│   ├── downloader/       # Lógica para la descarga de videos desde Sakugabooru
│   ├── utils/            # Utilidades comunes (ej: manejo de FFmpeg)
│   ├── app.ts            # Configuración principal de la aplicación Express y rutas API
│   └── index.ts          # Punto de entrada de la aplicación (CLI y servidor)
├── output/             # Carpetas de almacenamiento generadas automáticamente
│   ├── downloads/        # Videos descargados
│   ├── clips/            # Clips generados, organizados en subcarpetas
│   ├── beat_synced_videos/ # Videos generados con la función Beat Sync
│   ├── temp_audio/       # Archivos de audio temporales subidos para análisis
│   └── temp/             # Archivos temporales de procesamiento (ej: segmentos de video)
└── assets/             # Recursos adicionales (si los hubiera)
```

## Tecnologías Utilizadas

- **Frontend**: HTML, CSS, JavaScript (vanilla), Bootstrap 5
- **Backend**: Node.js, Express.js, TypeScript
- **Comunicación en tiempo real**: Socket.IO (para feedback de descargas y progreso)
- **Procesamiento de video**: FFmpeg (cortar, concatenar, etc.)
- **Detección de escenas**: PySceneDetect (con OpenCV) y FFmpeg
- **Análisis de Audio**: Aubio (para detección de beats)
- **Gestión de dependencias**: npm
- **Bundling/Compilación**: TypeScript Compiler (`tsc`)

## Créditos y Apoyo al desarrollo

Si esta aplicación te ha ayudado, considera apoyar al desarrollo de esta y otras aplicaciones: https://ko-fi.com/markonichan

## Licencia

MIT
