import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import * as os from 'os';

/**
 * Opciones para la detección de escenas
 */
export interface SceneDetectionOptions {
    minDuration?: number;  // Duración mínima en segundos (default: 1.0)
    maxDuration?: number;  // Duración máxima en segundos (default: 3.0)
    threshold?: number;    // Umbral para detectar cambios de escena (default: 30)
}

// Configuración de rutas para FFmpeg
let FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
let FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

// Función para verificar si un ejecutable está disponible
function isExecutableAvailable(executableName: string): boolean {
    try {
        if (process.platform === 'win32') {
            execSync(`where ${executableName}`, { stdio: 'ignore' });
        } else {
            execSync(`which ${executableName}`, { stdio: 'ignore' });
        }
        return true;
    } catch (e) {
        return false;
    }
}

// Intentar buscar FFmpeg de manera más exhaustiva
function findFFmpegPath(): string | null {
    // Verificar si está en el PATH
    if (isExecutableAvailable('ffmpeg')) {
        try {
            const output = execSync('where ffmpeg', { encoding: 'utf8' }).trim();
            const paths = output.split('\n');
            if (paths.length > 0) {
                return paths[0].trim();
            }
        } catch (e) {
            // Continuar con otros métodos si falla
        }
    }

    // Rutas comunes donde puede estar instalado FFmpeg en Windows
    const commonPaths = [
        'C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\FFmpeg\\bin\\ffmpeg.exe',
        'C:\\FFmpeg\\bin\\ffmpeg.exe',
        path.join(process.env.ProgramFiles || '', 'FFmpeg', 'bin', 'ffmpeg.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'FFmpeg', 'bin', 'ffmpeg.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(process.env.APPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        'ffmpeg.exe'
    ];

    // Comprobar cada ruta
    for (const ffmpegPath of commonPaths) {
        if (fs.existsSync(ffmpegPath)) {
            return ffmpegPath;
        }
    }

    return null;
}

// Buscar las rutas de FFmpeg y FFprobe
const ffmpegPath = findFFmpegPath();
if (ffmpegPath) {
    FFMPEG_PATH = ffmpegPath;
    FFPROBE_PATH = ffmpegPath.replace('ffmpeg.exe', 'ffprobe.exe');
    console.log(`FFmpeg detectado en: ${FFMPEG_PATH}`);
    console.log(`FFprobe detectado en: ${FFPROBE_PATH}`);
} else {
    console.warn('No se pudo detectar FFmpeg automáticamente. Se intentará usar los comandos "ffmpeg" y "ffprobe" directamente.');
}

export class ClipGenerator {
    private outputDirectory: string;
    private ffmpegPath: string;
    private ffprobePath: string;
    private concurrencyLimit: number;

    constructor(
        outputDirectory: string = 'output/clips',
        ffmpegPath?: string,
        ffprobePath?: string,
        concurrencyLimit?: number
    ) {
        this.outputDirectory = outputDirectory;
        this.ffmpegPath = ffmpegPath || FFMPEG_PATH;
        this.ffprobePath = ffprobePath || FFPROBE_PATH;
        
        // Default concurrency: half of CPU cores, minimum 1, maximum 4 as a sensible default.
        const defaultConcurrency = Math.max(1, Math.min(4, Math.floor((os.cpus()?.length || 2) / 2)));
        this.concurrencyLimit = concurrencyLimit === undefined ? defaultConcurrency : Math.max(1, concurrencyLimit);

        console.log(`ClipGenerator initialized with concurrency limit: ${this.concurrencyLimit}`);
        console.log(`Usando FFmpeg en: ${this.ffmpegPath}`);
        console.log(`Usando FFprobe en: ${this.ffprobePath}`);

        // Crear directorio de salida si no existe
        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory, { recursive: true });
        }
    }

    /**
     * Returns the configured concurrency limit.
     */
    public getConcurrencyLimit(): number {
        return this.concurrencyLimit;
    }

    /**
     * Genera un clip de video a partir de un video fuente
     * @param videoPath Ruta al video fuente
     * @param startTime Tiempo de inicio en segundos
     * @param endTime Tiempo final en segundos
     * @param outputName Nombre personalizado para el archivo de salida (opcional)
     * @returns Promesa con la ruta al clip generado
     */
    async generateClip(
        videoPath: string,
        startTime: number,
        endTime: number,
        outputName?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(videoPath)) {
                console.error(`Error: Video file not found: ${videoPath}`);
                return reject(new Error(`Video file not found: ${videoPath}`));
            }

            // Crear nombre de archivo de salida si no se proporciona uno
            const videoName = path.basename(videoPath, path.extname(videoPath));
            const outputFileName = outputName || `${videoName}_clip_${startTime}_${endTime}.mp4`;
            const outputPath = path.join(this.outputDirectory, outputFileName);

            console.log(`Generating clip from ${startTime}s to ${endTime}s from video ${videoPath}`);
            console.log(`Output path: ${outputPath}`);

            // Asegurar que el directorio de salida existe
            if (!fs.existsSync(this.outputDirectory)) {
                console.log(`Creating output directory: ${this.outputDirectory}`);
                fs.mkdirSync(this.outputDirectory, { recursive: true });
            }

            // Comando para generar el clip usando ffmpeg
            const duration = endTime - startTime;
            const args = [
                '-i', videoPath,
                '-ss', startTime.toString(),
                '-t', duration.toString(),
                '-c:v', 'libx264',
                '-an', // Sin audio
                '-y', // Sobrescribir si existe
                outputPath
            ];

            console.log(`Running ffmpeg command: ${this.ffmpegPath} ${args.join(' ')}`);
            const ffmpegProcess = spawn(this.ffmpegPath, args);

            ffmpegProcess.stdout.on('data', (data) => {
                console.log(`ffmpeg stdout: ${data}`);
            });

            ffmpegProcess.stderr.on('data', (data) => {
                console.log(`ffmpeg stderr: ${data}`); // ffmpeg muestra info en stderr
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`Clip successfully generated at ${outputPath}`);
                    // Verificar que el archivo realmente existe
                    if (fs.existsSync(outputPath)) {
                        console.log(`Output file verified at ${outputPath}`);
                        resolve(outputPath);
                    } else {
                        console.error(`Error: Output file not found at ${outputPath} despite successful ffmpeg exit code`);
                        reject(new Error(`Output file not found at ${outputPath}`));
                    }
                } else {
                    console.error(`Error: ffmpeg process exited with code ${code}`);
                    reject(new Error(`ffmpeg process exited with code ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                console.error(`Error: Failed to start ffmpeg process: ${err.message}`);
                reject(new Error(`Failed to start ffmpeg process: ${err.message}`));
            });
        });
    }

    /**
     * Genera múltiples clips a partir de un video fuente
     * @param videoPath Ruta al video fuente
     * @param timeSegments Array de pares [inicio, fin] en segundos
     * @returns Promesa con array de rutas a los clips generados
     */
    async generateMultipleClips(
        videoPath: string,
        timeSegments: [number, number][]
    ): Promise<string[]> {
        const clipPaths: string[] = [];

        for (const [startTime, endTime] of timeSegments) {
            try {
                const clipPath = await this.generateClip(videoPath, startTime, endTime);
                clipPaths.push(clipPath);
            } catch (error) {
                console.error(`Failed to generate clip ${startTime}-${endTime}:`, error);
            }
        }

        return clipPaths;
    }

    /**
     * Detecta automáticamente escenas en un video y genera clips
     * @param videoPath Ruta al video fuente
     * @param options Opciones de detección de escenas
     * @returns Promesa con array de rutas a los clips generados
     */
    async detectScenesAndGenerateClips(
        videoPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        // Valores por defecto
        const minDuration = options.minDuration || 1.0;
        const maxDuration = options.maxDuration || 3.0;
        const threshold = options.threshold || 30;

        console.log(`Detecting scenes in ${videoPath}...`);
        console.log(`Options: minDuration=${minDuration}, maxDuration=${maxDuration}, threshold=${threshold}`);

        return new Promise((resolve, reject) => {
            // Crear un directorio temporal para los archivos de análisis
            const tempDir = path.join(this.outputDirectory, '../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Nombre base del video para el archivo CSV
            const videoBaseName = path.basename(videoPath, path.extname(videoPath));
            const csvFile = path.join(tempDir, `${videoBaseName}-Scenes.csv`);

            // Comando para detectar escenas usando PySceneDetect sin la opción --csv
            const args = [
                '-m', 'scenedetect',
                '--input', videoPath,
                'detect-content',
                '--threshold', threshold.toString(),
                'list-scenes',
                '--output', tempDir,
                '--filename-format', `${videoBaseName}-Scenes.csv`
            ];

            const sceneDetectProcess = spawn('python', args);

            let stdoutData = '';
            let stderrData = '';

            sceneDetectProcess.stdout.on('data', (data) => {
                const output = data.toString();
                stdoutData += output;
                console.log('PySceneDetect stdout:', output);
            });

            sceneDetectProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
                console.error('PySceneDetect stderr:', data.toString());
            });

            sceneDetectProcess.on('close', async (code) => {
                if (code === 0) {
                    try {
                        // Lista para almacenar los límites de escenas (cada cambio de escena)
                        const sceneChanges: number[] = [];
                        let timeSegments: [number, number][] = [];

                        // Verificar si el archivo CSV existe (PySceneDetect lo genera por defecto)
                        if (fs.existsSync(csvFile)) {
                            console.log(`Found scene data file: ${csvFile}`);

                            // Leer el archivo CSV
                            const csvContent = fs.readFileSync(csvFile, 'utf8');
                            const lines = csvContent.split('\n').filter(line => line.trim() !== '');

                            // Extraer tiempos de inicio y fin de las escenas del CSV
                            // Típicamente el CSV tiene este formato:
                            // Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds),Length (frames),Length (timecode),Length (seconds)

                            // Saltamos la línea de encabezado
                            for (let i = 1; i < lines.length; i++) {
                                const columns = lines[i].split(',');
                                if (columns.length >= 7) {
                                    // Índices basados en el formato del CSV
                                    const startTimeSeconds = parseFloat(columns[3]); // Start Time (seconds)
                                    const endTimeSeconds = parseFloat(columns[6]);   // End Time (seconds)
                                    const duration = endTimeSeconds - startTimeSeconds;

                                    // Solo considerar escenas que tengan una duración adecuada
                                    if (duration >= minDuration && duration <= maxDuration) {
                                        timeSegments.push([startTimeSeconds, endTimeSeconds]);
                                    } else if (duration > maxDuration) {
                                        // Para escenas muy largas, solo tomamos el inicio (más probable que tenga acción interesante)
                                        timeSegments.push([startTimeSeconds, startTimeSeconds + maxDuration]);
                                    }
                                    // Las escenas muy cortas se ignoran
                                }
                            }

                            // Limitar el número máximo de clips a 5 por video para evitar clips innecesarios
                            // Ordenamos por duración para quedarnos con los clips más significativos
                            timeSegments.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
                            if (timeSegments.length > 5) {
                                console.log(`Limiting clips to the 5 most significant ones (from ${timeSegments.length})`);
                                timeSegments = timeSegments.slice(0, 5);
                                // Reordenar por tiempo de inicio para mantener coherencia temporal
                                timeSegments.sort((a, b) => a[0] - b[0]);
                            }
                        } else {
                            console.log(`CSV file not found at expected location: ${csvFile}`);
                            console.log('Trying to parse scene information from stdout...');

                            // Intentar extraer información de la salida estándar
                            const sceneInfoRegex = /\|\s+(\d+)\s+\|\s+\d+\s+\|\s+(\d+:\d+:\d+\.\d+)\s+\|\s+\d+\s+\|\s+(\d+:\d+:\d+\.\d+)\s+\|/g;
                            let match;

                            while ((match = sceneInfoRegex.exec(stdoutData)) !== null) {
                                const sceneNumber = parseInt(match[1]);
                                const startTimeStr = match[2];
                                const endTimeStr = match[3];

                                const startTime = this.timeToSeconds(startTimeStr);
                                const endTime = this.timeToSeconds(endTimeStr);

                                if (!isNaN(startTime) && !isNaN(endTime)) {
                                    const duration = endTime - startTime;

                                    if (duration >= minDuration && duration <= maxDuration) {
                                        timeSegments.push([startTime, endTime]);
                                    } else if (duration > maxDuration) {
                                        // Para escenas muy largas, solo tomamos el inicio
                                        timeSegments.push([startTime, startTime + maxDuration]);
                                    }
                                }
                            }

                            // Limitamos a 5 clips significativos
                            timeSegments.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
                            if (timeSegments.length > 5) {
                                timeSegments = timeSegments.slice(0, 5);
                                // Reordenar por tiempo
                                timeSegments.sort((a, b) => a[0] - b[0]);
                            }
                        }

                        console.log(`Selected ${timeSegments.length} clips for generation`);

                        // Crear directorio específico para este video
                        const nombreVideo = path.basename(videoPath, path.extname(videoPath));
                        const directorioVideo = path.join(this.outputDirectory, nombreVideo);
                        if (!fs.existsSync(directorioVideo)) {
                            fs.mkdirSync(directorioVideo, { recursive: true });
                        }

                        // Generar clips para cada segmento
                        const clipPaths: string[] = [];
                        for (let i = 0; i < timeSegments.length; i++) {
                            const [inicio, fin] = timeSegments[i];
                            const outputFileName = `${nombreVideo}_scene${i + 1}.mp4`;
                            const outputPath = path.join(directorioVideo, outputFileName);

                            try {
                                // Generar clip usando FFmpeg (sin audio como en Python)
                                await this.generateClipWithoutAudio(videoPath, inicio, fin, outputPath);
                                clipPaths.push(outputPath);
                                console.log(`Generated clip ${i + 1}/${timeSegments.length}: ${outputFileName}`);
                            } catch (error) {
                                console.error(`Error generando clip ${outputFileName}:`, error);
                            }
                        }

                        console.log(`Successfully generated ${clipPaths.length} clips from ${videoPath}`);
                        resolve(clipPaths);
                    } catch (error) {
                        console.error('Error processing scenes:', error);
                        reject(error);
                    }
                } else {
                    console.error(`PySceneDetect process exited with error code ${code}`);
                    console.error(`stderr: ${stderrData}`);

                    // Intento con ffmpeg como fallback
                    console.warn(`PySceneDetect failed, falling back to FFmpeg method${stderrData ? ': ' + stderrData : ''}`);

                    try {
                        const clipPaths = await this.detectScenesWithFFmpegAndGenerateClips(videoPath, options);
                        resolve(clipPaths);
                    } catch (ffmpegError) {
                        console.error('Error processing FFmpeg fallback:', ffmpegError);
                        reject(ffmpegError);
                    }
                }
            });

            sceneDetectProcess.on('error', (spawnErr) => {
                reject(new Error(`Failed to start PySceneDetect process: ${spawnErr.message}`));
            });
        });
    }

    /**
     * Convierte un tiempo en formato "HH:MM:SS.mmm" a segundos
     * @param timeString Tiempo en formato "HH:MM:SS.mmm"
     * @returns Tiempo en segundos
     */
    private timeToSeconds(timeString: string): number {
        if (!timeString) return 0;

        try {
            const parts = timeString.trim().split(':');
            if (parts.length === 3) {
                const hours = parseInt(parts[0]) || 0;
                const minutes = parseInt(parts[1]) || 0;
                const seconds = parseFloat(parts[2]) || 0;
                return hours * 3600 + minutes * 60 + seconds;
            } else if (parts.length === 2) {
                const minutes = parseInt(parts[0]) || 0;
                const seconds = parseFloat(parts[1]) || 0;
                return minutes * 60 + seconds;
            } else if (parts.length === 1) {
                return parseFloat(parts[0]) || 0;
            }
            return 0;
        } catch (error) {
            console.error(`Error al convertir tiempo "${timeString}" a segundos:`, error);
            return 0;
        }
    }

    /**
     * Alternativa usando FFmpeg para detectar cambios de escena
     * y generar clips sin depender de PySceneDetect
     * @param videoPath Ruta al video fuente
     * @param options Opciones de detección
     * @returns Promesa con array de rutas a los clips generados
     */
    async detectScenesWithFFmpegAndGenerateClips(
        videoPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        const minDuration = options.minDuration || 1.0;
        const maxDuration = options.maxDuration || 3.0;
        const threshold = options.threshold || 0.3;

        console.log(`Detecting scenes with FFmpeg in ${videoPath}...`);

        return new Promise((resolve, reject) => {
            // Crear un directorio temporal para los archivos de análisis
            const tempDir = path.join(this.outputDirectory, '../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempTxtFile = path.join(
                tempDir,
                `ffmpeg_scenes_${path.basename(videoPath, path.extname(videoPath))}_${Date.now()}.txt`
            );

            // Usar FFmpeg para detectar cambios de escena
            const args = [
                '-i', videoPath,
                '-filter:v', `select='gt(scene,${threshold})',showinfo`,
                '-f', 'null',
                '-'
            ];

            const ffmpegProcess = spawn(this.ffmpegPath, args);

            let stderrData = '';

            ffmpegProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            ffmpegProcess.on('close', async (code) => {
                if (code === 0) {
                    try {
                        // Analizar la salida de FFmpeg para encontrar los cambios de escena
                        const sceneChanges: number[] = [];
                        const regex = /pts_time:(\d+\.\d+)/g;
                        let match;

                        while ((match = regex.exec(stderrData)) !== null) {
                            sceneChanges.push(parseFloat(match[1]));
                        }

                        // Añadir el tiempo 0 si no está
                        if (sceneChanges.length === 0 || sceneChanges[0] > 0.1) {
                            sceneChanges.unshift(0);
                        }

                        // Obtener la duración total del video usando FFprobe
                        const videoDuration = await this.getVideoDuration(videoPath);
                        sceneChanges.push(videoDuration);

                        // Crear segmentos basados en los cambios de escena
                        const timeSegments: [number, number][] = [];

                        for (let i = 0; i < sceneChanges.length - 1; i++) {
                            const startTime = sceneChanges[i];
                            const endTime = sceneChanges[i + 1];
                            const duration = endTime - startTime;

                            if (duration < minDuration) {
                                continue;
                            } else if (duration > maxDuration) {
                                // Dividir en clips de duración máxima
                                const numClips = Math.floor(duration / maxDuration);
                                for (let j = 0; j < numClips; j++) {
                                    const clipStart = startTime + (j * maxDuration);
                                    const clipEnd = clipStart + maxDuration;
                                    timeSegments.push([clipStart, clipEnd]);
                                }

                                // Resto si es mayor que la duración mínima
                                const remainingDuration = duration % maxDuration;
                                if (remainingDuration >= minDuration) {
                                    const clipStart = startTime + (numClips * maxDuration);
                                    timeSegments.push([clipStart, endTime]);
                                }
                            } else {
                                timeSegments.push([startTime, endTime]);
                            }
                        }

                        console.log(`Found ${timeSegments.length} valid scene segments`);

                        // Crear directorio específico para este video
                        const nombreVideo = path.basename(videoPath, path.extname(videoPath));
                        const directorioVideo = path.join(this.outputDirectory, nombreVideo);
                        if (!fs.existsSync(directorioVideo)) {
                            fs.mkdirSync(directorioVideo, { recursive: true });
                        }

                        // Generar clips para cada segmento
                        const clipPaths: string[] = [];
                        for (let i = 0; i < timeSegments.length; i++) {
                            const [inicio, fin] = timeSegments[i];
                            const outputFileName = `${nombreVideo}_scene${i + 1}.mp4`;
                            const outputPath = path.join(directorioVideo, outputFileName);

                            try {
                                // Generar clip usando FFmpeg (sin audio como en Python)
                                await this.generateClipWithoutAudio(videoPath, inicio, fin, outputPath);
                                clipPaths.push(outputPath);
                                console.log(`Generated clip ${i + 1}/${timeSegments.length}: ${outputFileName}`);
                            } catch (error) {
                                console.error(`Error generando clip ${outputFileName}:`, error);
                            }
                        }

                        console.log(`Successfully generated ${clipPaths.length} clips from ${videoPath}`);
                        resolve(clipPaths);
                    } catch (error) {
                        console.error('Error processing FFmpeg scene detection:', error);
                        reject(error);
                    }
                } else {
                    console.error('FFmpeg stderr:', stderrData);
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
            });
        });
    }

    /**
     * Obtiene la duración de un video en segundos
     * @param videoPath Ruta al archivo de video
     * @returns Promesa con la duración en segundos
     */
    private async getVideoDuration(videoPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            // Usar FFprobe para obtener la duración del video
            const args = [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                videoPath
            ];

            const ffprobeProcess = spawn(this.ffprobePath, args);

            let stdoutData = '';
            let stderrData = '';

            ffprobeProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            ffprobeProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            ffprobeProcess.on('close', (code) => {
                if (code === 0) {
                    const duration = parseFloat(stdoutData.trim());
                    if (!isNaN(duration)) {
                        resolve(duration);
                    } else {
                        reject(new Error('Could not parse video duration'));
                    }
                } else {
                    console.error('FFprobe stderr:', stderrData);
                    reject(new Error(`FFprobe process exited with code ${code}`));
                }
            });

            ffprobeProcess.on('error', (err) => {
                reject(new Error(`Failed to start FFprobe process: ${err.message}`));
            });
        });
    }

    /**
     * Procesa un directorio completo de videos
     * @param directoryPath Ruta al directorio con videos
     * @param options Opciones de detección de escenas
     * @returns Promesa con array de rutas a todos los clips generados
     */
    async processDirectory(
        directoryPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        if (!fs.existsSync(directoryPath)) {
            throw new Error(`Directory not found: ${directoryPath}`);
        }

        console.log(`Processing directory: ${directoryPath}`);
        const files = fs.readdirSync(directoryPath);
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
        const videoFiles = files.filter(file =>
            videoExtensions.includes(path.extname(file).toLowerCase())
        );

        console.log(`Found ${videoFiles.length} video files in directory`);

        const allClips: string[] = [];
        const processingPromises: Promise<string[]>[] = [];
        let currentlyActivePromises: Promise<any>[] = [];

        for (const videoFile of videoFiles) {
            const videoPath = path.join(directoryPath, videoFile);

            const task = async (): Promise<string[]> => {
                console.log(`Starting processing for video: ${videoPath}`);
                let clips: string[] = [];
                try {
                    // Attempt PySceneDetect first
                    clips = await this.detectScenesAndGenerateClips(videoPath, options);
                } catch (pyscenesError) {
                    console.warn(`PySceneDetect failed for ${videoPath}: ${pyscenesError}. Falling back to FFmpeg method.`);
                    try {
                        clips = await this.detectScenesWithFFmpegAndGenerateClips(videoPath, options);
                    } catch (ffmpegFallbackError) {
                        console.error(`FFmpeg fallback also failed for ${videoPath}: ${ffmpegFallbackError}`);
                        throw ffmpegFallbackError; // Rethrow to be caught by the outer catch
                    }
                }
                console.log(`Finished processing for video: ${videoPath}, found ${clips.length} clips.`);
                return clips;
            };

            const wrappedPromise = task()
                .then(clips => {
                    allClips.push(...clips);
                    currentlyActivePromises = currentlyActivePromises.filter(p => p !== wrappedPromise);
                    return clips;
                })
                .catch(error => {
                    console.error(`Failed to process video ${videoPath}:`, error.message);
                    currentlyActivePromises = currentlyActivePromises.filter(p => p !== wrappedPromise);
                    return []; // Return empty array for this video in case of error
                });

            processingPromises.push(wrappedPromise);
            currentlyActivePromises.push(wrappedPromise);

            if (currentlyActivePromises.length >= this.concurrencyLimit) {
                try {
                    await Promise.race(currentlyActivePromises);
                } catch (raceError) {
                    // Individual promise rejections are handled in their .catch blocks
                    // Promise.race itself will throw if a promise in it rejects,
                    // but we mainly use it to "unblock" and let the loop continue.
                    console.debug("Promise.race caught an error, this is usually handled by individual promises.", raceError);
                }
            }
        }

        // Wait for all processing to complete
        await Promise.allSettled(processingPromises);

        console.log(`Finished processing directory ${directoryPath}. Total clips generated: ${allClips.length}`);
        return allClips;
    }

    /**
     * Procesa videos según la implementación Python del SceneDetect
     * Esta función implementa el mismo comportamiento que el script Python existente
     * @param inputDirectory Directorio con los videos a procesar
     * @param options Opciones de detección de escenas
     * @returns Promesa con array de rutas a todos los clips generados
     */
    async processVideosLikePython(
        inputDirectory: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        // Valores por defecto, como en el script Python
        const minDuration = options.minDuration || 1.0;
        const maxDuration = options.maxDuration || 2.99;

        console.log(`Procesando carpeta de videos: ${inputDirectory}`);
        console.log(`Directorio de salida: ${this.outputDirectory}`);

        // Crear el directorio de salida si no existe
        if (!fs.existsSync(this.outputDirectory)) {
            fs.mkdirSync(this.outputDirectory, { recursive: true });
        }

        // Función para limpiar nombres de archivos (similar a la función Python)
        const limpiarNombresArchivos = (directorio: string) => {
            const archivos = fs.readdirSync(directorio);
            for (const archivo of archivos) {
                const nuevoNombre = archivo.replace(/[\\/:*?"<>|()[\]]/g, '');
                if (nuevoNombre !== archivo) {
                    fs.renameSync(
                        path.join(directorio, archivo),
                        path.join(directorio, nuevoNombre)
                    );
                    console.log(`Renombrado: ${archivo} -> ${nuevoNombre}`);
                }
            }
        };

        // Limpiar nombres de archivos
        limpiarNombresArchivos(inputDirectory);

        const allClips: string[] = [];
        const processingPromises: Promise<string[]>[] = [];
        let currentlyActivePromises: Promise<any>[] = [];

        // Limpiar nombres de archivos
        this.limpiarNombresArchivosRecursivo(inputDirectory);
        
        const videoFilesToProcess: string[] = [];

        // Función recursiva para encontrar todos los archivos .mp4
        const findMp4Files = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    findMp4Files(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.mp4')) {
                    videoFilesToProcess.push(fullPath);
                }
            }
        };
        findMp4Files(inputDirectory);

        console.log(`Found ${videoFilesToProcess.length} .mp4 files for processing like Python.`);

        for (const videoPath of videoFilesToProcess) {
            const task = async (): Promise<string[]> => {
                console.log(`Procesando (Python-like) ${videoPath}...`);
                // Detectar escenas usando FFmpeg
                const escenas = await this.detectScenesFFmpeg(videoPath, options);
                const escenasFiltradas: [number, number][] = [];

                for (const [inicio, fin] of escenas) {
                    const duracion = fin - inicio;
                    if (duracion < minDuration) continue;
                    if (duracion > maxDuration) {
                        const numClips = Math.floor(duracion / maxDuration);
                        for (let i = 0; i < numClips; i++) {
                            escenasFiltradas.push([inicio + (i * maxDuration), inicio + ((i + 1) * maxDuration)]);
                        }
                        const resto = duracion % maxDuration;
                        if (resto >= minDuration) {
                            escenasFiltradas.push([inicio + (numClips * maxDuration), fin]);
                        }
                    } else {
                        escenasFiltradas.push([inicio, fin]);
                    }
                }

                const nombreVideo = path.basename(videoPath, path.extname(videoPath));
                const directorioVideo = path.join(this.outputDirectory, nombreVideo);
                if (!fs.existsSync(directorioVideo)) {
                    fs.mkdirSync(directorioVideo, { recursive: true });
                }

                const clipPaths: string[] = [];
                for (let i = 0; i < escenasFiltradas.length; i++) {
                    const [inicio, fin] = escenasFiltradas[i];
                    const outputFileName = `${nombreVideo}_scene${i + 1}.mp4`;
                    const outputPath = path.join(directorioVideo, outputFileName);
                    try {
                        await this.generateClipWithoutAudio(videoPath, inicio, fin, outputPath);
                        clipPaths.push(outputPath);
                    } catch (error) {
                        console.error(`Error generando clip (Python-like) ${outputFileName}:`, error);
                    }
                }
                console.log(`Procesamiento (Python-like) de ${videoPath} completado. Clips: ${clipPaths.length}`);
                return clipPaths;
            };
            
            const wrappedPromise = task()
                .then(clips => {
                    allClips.push(...clips);
                    currentlyActivePromises = currentlyActivePromises.filter(p => p !== wrappedPromise);
                    return clips;
                })
                .catch(error => {
                    console.error(`Failed to process video (Python-like) ${videoPath}:`, error.message);
                    currentlyActivePromises = currentlyActivePromises.filter(p => p !== wrappedPromise);
                    return []; 
                });

            processingPromises.push(wrappedPromise);
            currentlyActivePromises.push(wrappedPromise);

            if (currentlyActivePromises.length >= this.concurrencyLimit) {
                try {
                    await Promise.race(currentlyActivePromises);
                } catch (raceError) {
                     console.debug("Promise.race caught an error (Python-like), handled by individual promises.", raceError);
                }
            }
        }

        await Promise.allSettled(processingPromises);
        console.log(`Finished processing (Python-like) all videos. Total clips: ${allClips.length}`);
        return allClips;
    }

    /**
     * Helper to recursively clean filenames in a directory.
     */
    private limpiarNombresArchivosRecursivo(directorio: string): void {
        const archivos = fs.readdirSync(directorio, { withFileTypes: true });
        for (const archivo of archivos) {
            const rutaCompleta = path.join(directorio, archivo.name);
            const nuevoNombre = archivo.name.replace(/[\\/:*?"<>|()[\]]/g, '');
            let nuevaRutaCompleta = rutaCompleta;

            if (nuevoNombre !== archivo.name) {
                nuevaRutaCompleta = path.join(directorio, nuevoNombre);
                fs.renameSync(rutaCompleta, nuevaRutaCompleta);
                console.log(`Renombrado: ${archivo.name} -> ${nuevoNombre} en ${directorio}`);
            }

            if (archivo.isDirectory()) {
                this.limpiarNombresArchivosRecursivo(nuevaRutaCompleta); // Recurse with the new path if renamed
            }
        }
    }
    
    /**
     * Genera clips sin audio directamente
     */
    private async generateClipWithoutAudio(
        videoPath: string,
        startTime: number,
        endTime: number,
        outputPath: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(videoPath)) {
                return reject(new Error(`Video file not found: ${videoPath}`));
            }

            // Duración del clip
            const duration = endTime - startTime;

            // Comando para generar el clip sin audio usando FFmpeg (como en el script Python)
            const args = [
                '-i', videoPath,
                '-ss', startTime.toString(),
                '-t', duration.toString(),
                '-c:v', 'libx264',
                '-an', // Sin audio
                '-y',  // Sobrescribir si existe
                outputPath
            ];

            console.log(`Generando clip de ${startTime}s a ${endTime}s`);
            const ffmpegProcess = spawn(this.ffmpegPath, args);

            ffmpegProcess.stderr.on('data', (data) => {
                // FFmpeg muestra información en stderr
                console.log(`ffmpeg: ${data}`);
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    console.log(`Clip generado correctamente: ${outputPath}`);
                    resolve(outputPath);
                } else {
                    reject(new Error(`Error generando clip, código: ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                reject(new Error(`Error iniciando proceso ffmpeg: ${err.message}`));
            });
        });
    }

    /**
     * Detecta escenas en un video usando FFmpeg
     * Versión simplificada basada en el algoritmo de ContentDetector
     */
    private async detectScenesFFmpeg(
        videoPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<[number, number][]> {
        const threshold = options.threshold || 0.3; // Valor por defecto como en la implementación Python

        return new Promise((resolve, reject) => {
            // Usar FFmpeg para detectar cambios de escena
            const args = [
                '-i', videoPath,
                '-filter:v', `select='gt(scene,${threshold})',showinfo`,
                '-f', 'null',
                '-'
            ];

            console.log(`Detectando escenas en ${videoPath}...`);
            const ffmpegProcess = spawn(this.ffmpegPath, args);

            let stderrData = '';

            ffmpegProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            ffmpegProcess.on('close', async (code) => {
                if (code === 0) {
                    try {
                        // Analizar la salida de FFmpeg para encontrar los cambios de escena
                        const sceneChanges: number[] = [];
                        const regex = /pts_time:(\d+\.\d+)/g;
                        let match;

                        while ((match = regex.exec(stderrData)) !== null) {
                            sceneChanges.push(parseFloat(match[1]));
                        }

                        // Añadir el tiempo 0 si no está
                        if (sceneChanges.length === 0 || sceneChanges[0] > 0.1) {
                            sceneChanges.unshift(0);
                        }

                        // Obtener la duración total del video
                        const videoDuration = await this.getVideoDuration(videoPath);
                        sceneChanges.push(videoDuration);

                        // Crear pares de inicio-fin de escenas
                        const scenes: [number, number][] = [];
                        for (let i = 0; i < sceneChanges.length - 1; i++) {
                            scenes.push([sceneChanges[i], sceneChanges[i + 1]]);
                        }

                        console.log(`Se detectaron ${scenes.length} escenas en ${videoPath}`);
                        resolve(scenes);
                    } catch (error) {
                        console.error('Error procesando detección de escenas:', error);
                        reject(error);
                    }
                } else {
                    reject(new Error(`Error en detección de escenas, código: ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                reject(new Error(`Error iniciando FFmpeg: ${err.message}`));
            });
        });
    }
}

export default ClipGenerator;