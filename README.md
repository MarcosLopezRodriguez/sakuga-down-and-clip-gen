# SakugaDownAndClipGen

Una aplicación para descargar videos de Sakugabooru y generar clips automáticamente detectando cambios de escena.

## Características

- Descarga de videos desde Sakugabooru por URL o etiquetas
- Detección automática de cambios de escena usando PySceneDetect con respaldo de FFmpeg
- Generación de clips de vídeo basados en las escenas detectadas
- Interfaz web intuitiva para gestionar descargas y clips
- Vista previa de clips con reproducción automática y bucle
- Función para eliminar clips individualmente con un solo clic
- Agrupación de clips por video original para mejor organización

## Requisitos

- Node.js
- Python 3 con PySceneDetect instalado
- FFmpeg (como respaldo para la detección de escenas)

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/sakuga-down-and-clip-gen.git
cd sakuga-down-and-clip-gen

# Instalar dependencias
npm install

# Compilar el proyecto
npm run build

# Iniciar la aplicación por consola
npm start

# Iniciar la aplicación por interfaz web (localhost:3000)
npm run dev -- server 
```
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

## Estructura del Proyecto

```
.
├── public/                 # Archivos estáticos para el frontend
├── src/                    # Código fuente TypeScript
│   ├── clipGenerator/      # Generación de clips y detección de escenas
│   ├── downloader/         # Descarga de videos desde Sakugabooru
│   └── utils/              # Utilidades comunes
├── output/                 # Carpetas de almacenamiento
│   ├── downloads/          # Videos descargados
│   ├── clips/              # Clips generados
│   └── temp/               # Archivos temporales de procesamiento
└── assets/                 # Recursos adicionales
```

## Tecnologías Utilizadas

- **Frontend**: HTML, CSS, JavaScript, Bootstrap
- **Backend**: Node.js, Express, TypeScript
- **Comunicación en tiempo real**: Socket.IO
- **Procesamiento de video**: FFmpeg, PySceneDetect

## ❤️ Apoyo al desarrollo

Si esta aplicación te ha ayudado, considera apoyar al desarrollo de esta y otras aplicaciones: https://ko-fi.com/markonichan

## Licencia

MIT

