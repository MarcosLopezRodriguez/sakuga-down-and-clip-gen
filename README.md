# SakugaDownAndClipGen

Una aplicación para descargar videos de Sakugabooru y generar clips automáticamente detectando cambios de escena.

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
*   **Interfaz de Usuario Dual**:
    *   **Interfaz Web Intuitiva**:
        *   Gestión centralizada de descargas y clips.
        *   Vista previa de clips con reproducción automática y bucle.
        *   Eliminación individual de clips.
        *   Organización de clips en carpetas por video original.
        *   Actualizaciones de progreso en tiempo real mediante WebSockets.
    *   **Completa Interfaz de Línea de Comandos (CLI)**:
        *   Acceso a todas las funcionalidades principales: descarga, generación de clips, y operaciones combinadas.
        *   Ideal para automatización y scripts.
*   **Utilidades Adicionales**:
    *   Renombrado de videos/clips mediante un script Python integrado (accesible vía API).
*   **Organización Automática**:
    *   Los videos descargados y los clips generados se guardan automáticamente en subdirectorios estructurados.

## Requisitos

- **Node.js**: Versión 14.0.0 o superior. Se puede descargar desde [nodejs.org](https://nodejs.org/).
- **Python**: Versión 3.7 o superior. Necesario para PySceneDetect. Se puede descargar desde [python.org](https://python.org/).
- **PySceneDetect**:
    - Se instala mediante pip: `pip install scenedetect[opencv]`
    - Asegúrate de que Python y pip estén en el PATH del sistema.
- **FFmpeg**:
    - Necesario para la generación de clips y como motor de detección de escenas.
    - Descargar desde [ffmpeg.org](https://ffmpeg.org/download.html).
    - Debe estar accesible en el PATH del sistema, o puedes configurar la variable de entorno `FFMPEG_PATH` para apuntar al ejecutable `ffmpeg`.

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
    *   Descarga FFmpeg desde [ffmpeg.org](https://ffmpeg.org/download.html) y añádelo al PATH de tu sistema, o define la variable de entorno `FFMPEG_PATH`.

5.  **(Opcional) Enlaza el comando CLI globalmente:**
    Si deseas usar el comando `sakuga-down-and-clip` directamente desde cualquier ubicación:
    ```bash
    npm link 
    ```
    Esto te permitirá ejecutar comandos como `sakuga-down-and-clip download ...` en lugar de `node dist/index.js download ...`.

6.  **Cómo ejecutar:**
    *   **Para la interfaz web:**
        ```bash
        npm run dev -- server
        ```
        Luego accede a `http://localhost:3000` en tu navegador.
    *   **Para la interfaz de línea de comandos (CLI):**
        Consulta la sección "Uso de la CLI" para ver ejemplos de comandos. Si no usaste `npm link`, ejecutarás los comandos con `node dist/index.js <comando> [opciones]`.
## Uso

1. Acceder a la interfaz web en http://localhost:3000
2. Usar la sección 'Descargar' para obtener videos de Sakugabooru
    - Por URL directa
    - Por etiquetas (separadas por punto y coma)
3. Utilizar la sección 'Generar clips' para procesar los videos descargados
    - Configurar duración mínima y máxima de los clips
    - Ajustar el umbral de detección de cambios de escena
4. Ver y gestionar los clips generados en la sección 'Explorador'
    - Los clips se reproducen automáticamente
    - Eliminar clips no deseados con el botón de borrado

### Uso de la CLI (Interfaz de Línea de Comandos)

Puedes ejecutar los comandos de la CLI usando `node dist/index.js <comando> [opciones]` o, si has configurado un alias o enlace simbólico, directamente con `sakuga-down-and-clip-gen <comando> [opciones]`.

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
├── public/             # Archivos estáticos para el frontend
├── src/                # Código fuente TypeScript
│   ├── clipGenerator/    # Generación de clips y detección de escenas
│   ├── downloader/       # Descarga de videos desde Sakugabooru
│   └── utils/            # Utilidades comunes
├── output/             # Carpetas de almacenamiento
│   ├── downloads/        # Videos descargados
│   ├── clips/            # Clips generados
│   └── temp/             # Archivos temporales de procesamiento
└── assets/             # Recursos adicionales
```

## Tecnologías Utilizadas

- **Frontend**: HTML, CSS, JavaScript, Bootstrap
- **Backend**: Node.js, Express, TypeScript
- **Comunicación en tiempo real**: Socket.IO
- **Procesamiento de video**: FFmpeg, PySceneDetect

## Créditos y Apoyo al desarrollo

Si esta aplicación te ha ayudado, considera apoyar al desarrollo de esta y otras aplicaciones: https://ko-fi.com/markonichan

## Licencia

MIT
