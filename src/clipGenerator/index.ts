import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import ffprobe from 'ffprobe-static';
import { ffprobeCache } from '../utils/ffprobeCache';

/**
 * Opciones para la detección de escenas
 */
export interface SceneDetectionOptions {
    minDuration?: number;          // Minimum duration in seconds (default: 0.8)
    maxDuration?: number;          // Maximum duration in seconds (default: 4.0)
    threshold?: number;            // Scene change threshold for PySceneDetect (default: 8)
    maxClipsPerVideo?: number;     // Maximum clips to keep per video (default: unlimited)
    scenePadding?: number;         // Seconds to pad before and after each clip (default: 0.1)
    minGapBetweenClips?: number;   // Minimum separation between clips in seconds (default: 0.1)
    detectionMethod?: 'auto' | 'pyscenedetect' | 'ffmpeg'; // Preferred detection strategy
    useFFmpegDetection?: boolean;  // Legacy flag kept for backwards compatibility
}

type NormalizedSegment = {
    seg: [number, number];
    raw: [number, number];
    duration: number;
};

// Configuración de rutas para FFmpeg
let FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
let FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobe.path;

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
    // Verificar si ffmpeg está disponible en el PATH
    if (isExecutableAvailable('ffmpeg')) {
        try {
            const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
            const output = execSync(cmd, { encoding: 'utf8' }).trim();
            const paths = output.split(/\r?\n/);
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
    FFPROBE_PATH = process.env.FFPROBE_PATH || ffmpegPath.replace('ffmpeg.exe', 'ffprobe.exe');
    console.log(`FFmpeg detectado en: ${FFMPEG_PATH}`);
    console.log(`FFprobe detectado en: ${FFPROBE_PATH}`);
} else {
    console.warn('No se pudo detectar FFmpeg automáticamente. Se intentará usar los comandos "ffmpeg" y "ffprobe" directamente.');
    FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobe.path;
}

export class ClipGenerator {
    private outputDirectory: string;
    private ffmpegPath: string;
    private ffprobePath: string;

    constructor(
        outputDirectory: string = 'output/clips',
        ffmpegPath?: string,
        ffprobePath?: string
    ) {
        this.outputDirectory = outputDirectory;
        this.ffmpegPath = ffmpegPath || FFMPEG_PATH;
        this.ffprobePath = ffprobePath || FFPROBE_PATH;

        console.log(`Usando FFmpeg en: ${this.ffmpegPath}`);
        console.log(`Usando FFprobe en: ${this.ffprobePath}`);

        // Crear directorio de salida si no existe
        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory, { recursive: true });
        }
    }

    private resolveDetectionMethod(options: SceneDetectionOptions = {}): 'auto' | 'pyscenedetect' | 'ffmpeg' {
        if (options.detectionMethod) {
            return options.detectionMethod;
        }
        if (options.useFFmpegDetection) {
            return 'ffmpeg';
        }
        return 'auto';
    }

    private sanitizeSceneOptions(options: SceneDetectionOptions = {}): SceneDetectionOptions {
        const sanitized: SceneDetectionOptions = { ...options };

        const minDuration = typeof sanitized.minDuration === 'number' && Number.isFinite(sanitized.minDuration) && sanitized.minDuration > 0
            ? sanitized.minDuration
            : 0.8;
        const maxDurationCandidate = typeof sanitized.maxDuration === 'number' && Number.isFinite(sanitized.maxDuration) && sanitized.maxDuration > 0
            ? sanitized.maxDuration
            : 4.0;
        const maxDuration = Math.max(minDuration, maxDurationCandidate);

        sanitized.minDuration = minDuration;
        sanitized.maxDuration = maxDuration;

        const threshold = typeof sanitized.threshold === 'number' && Number.isFinite(sanitized.threshold)
            ? sanitized.threshold
            : 8;
        sanitized.threshold = threshold;

        sanitized.scenePadding = typeof sanitized.scenePadding === 'number' && Number.isFinite(sanitized.scenePadding) && sanitized.scenePadding >= 0
            ? sanitized.scenePadding
            : 0.1;

        sanitized.minGapBetweenClips = typeof sanitized.minGapBetweenClips === 'number' && Number.isFinite(sanitized.minGapBetweenClips) && sanitized.minGapBetweenClips >= 0
            ? sanitized.minGapBetweenClips
            : 0.1;

        if (typeof sanitized.maxClipsPerVideo === 'number' && Number.isFinite(sanitized.maxClipsPerVideo)) {
            if (sanitized.maxClipsPerVideo <= 0) {
                delete sanitized.maxClipsPerVideo;
            } else {
                sanitized.maxClipsPerVideo = Math.floor(sanitized.maxClipsPerVideo);
            }
        } else {
            delete sanitized.maxClipsPerVideo;
        }

        if (sanitized.detectionMethod === 'ffmpeg') {
            sanitized.useFFmpegDetection = true;
        }

        return sanitized;
    }

    private getFfmpegSceneThreshold(options: SceneDetectionOptions): number {
        const raw = options.threshold ?? 8;
        const normalized = raw > 1 ? raw / 100 : raw;
        if (!Number.isFinite(normalized) || normalized <= 0) {
            return 0.1;
        }
        return Math.min(Math.max(normalized, 0.01), 1);
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
    private async prepareSegments(
        videoPath: string,
        segments: [number, number][],
        options: SceneDetectionOptions = {},
        knownVideoDuration?: number
    ): Promise<[number, number][]> {
        if (!segments.length) {
            return [];
        }

        const minDuration = Math.max(0, options.minDuration ?? 0.8);
        const padding = Math.max(0, options.scenePadding ?? 0.1);
        const minGap = Math.max(0, options.minGapBetweenClips ?? 0.1);
        const maxClips = options.maxClipsPerVideo && options.maxClipsPerVideo > 0
            ? Math.floor(options.maxClipsPerVideo)
            : 0;
        const videoDuration = typeof knownVideoDuration === 'number' && !Number.isNaN(knownVideoDuration)
            ? knownVideoDuration
            : await this.getVideoDuration(videoPath);

        const candidates: NormalizedSegment[] = [];

        for (const [start, end] of segments) {
            if ((end - start) < minDuration) {
                continue;
            }
            const paddedStart = Math.max(0, start - padding);
            const paddedEnd = Math.min(videoDuration, end + padding);
            if (paddedEnd - paddedStart <= 0.1) {
                continue;
            }
            candidates.push({
                seg: [paddedStart, paddedEnd],
                raw: [start, end],
                duration: paddedEnd - paddedStart
            });
        }

        if (!candidates.length) {
            return [];
        }

        let selection = candidates.filter(item => item.duration > 0.1);

        if (!selection.length) {
            return [];
        }

        if (maxClips && selection.length > maxClips) {
            selection = [...selection]
                .sort((a, b) => {
                    if (b.duration === a.duration) {
                        return a.seg[0] - b.seg[0];
                    }
                    return b.duration - a.duration;
                })
                .slice(0, maxClips);
        }

        selection.sort((a, b) => a.seg[0] - b.seg[0]);

        const merged: NormalizedSegment[] = [];

        for (const current of selection) {
            if (!merged.length) {
                merged.push({
                    seg: [...current.seg] as [number, number],
                    raw: [...current.raw] as [number, number],
                    duration: current.duration
                });
                continue;
            }

            const last = merged[merged.length - 1];
            const rawGap = current.raw[0] - last.raw[1];
            const shouldMerge = rawGap < 0 || (rawGap > 0 && rawGap < minGap);

            if (shouldMerge) {
                last.raw[1] = Math.max(last.raw[1], current.raw[1]);
                last.seg[0] = Math.min(last.seg[0], current.seg[0]);
                last.seg[1] = Math.min(videoDuration, Math.max(last.seg[1], current.seg[1]));
                last.duration = last.seg[1] - last.seg[0];
            } else {
                merged.push({
                    seg: [...current.seg] as [number, number],
                    raw: [...current.raw] as [number, number],
                    duration: current.duration
                });
            }
        }

        if (maxClips && merged.length > maxClips) {
            const trimmed = [...merged]
                .sort((a, b) => {
                    if (b.duration === a.duration) {
                        return a.seg[0] - b.seg[0];
                    }
                    return b.duration - a.duration;
                })
                .slice(0, maxClips)
                .sort((a, b) => a.seg[0] - b.seg[0]);
            return trimmed.map(item => item.seg);
        }

        return merged.map(item => item.seg);
    }

    async detectScenesAndGenerateClips(
        videoPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        const sanitizedOptions = this.sanitizeSceneOptions(options);
        const minDuration = sanitizedOptions.minDuration ?? 0.8;
        const maxDuration = sanitizedOptions.maxDuration ?? Math.max(minDuration, 4.0);
        const threshold = sanitizedOptions.threshold ?? 8;

        console.log(`Detecting scenes in ${videoPath}...`);
        console.log(`Options: minDuration=${minDuration}, maxDuration=${maxDuration}, threshold=${threshold}, maxClips=${sanitizedOptions.maxClipsPerVideo ?? 'unlimited'}`);

        return new Promise((resolve, reject) => {
            const tempDir = path.join(this.outputDirectory, '../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const videoBaseName = path.basename(videoPath, path.extname(videoPath));
            const csvFile = path.join(tempDir, `${videoBaseName}-Scenes.csv`);

            const args = [
                '-m', 'scenedetect',
                '--input', videoPath,
                'detect-content',
                '--threshold', threshold.toString(),
                'list-scenes',
                '--output', tempDir,
                '--filename', `${videoBaseName}-Scenes.csv`
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
                        const timeSegments: [number, number][] = [];

                        if (fs.existsSync(csvFile)) {
                            const csvContent = fs.readFileSync(csvFile, 'utf8');
                            const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');

                            for (let i = 1; i < lines.length; i++) {
                                const columns = lines[i].split(',');
                                if (columns.length < 7) {
                                    continue;
                                }

                                const startTimeSeconds = parseFloat(columns[3]);
                                const endTimeSeconds = parseFloat(columns[6]);

                                if (!Number.isFinite(startTimeSeconds) || !Number.isFinite(endTimeSeconds)) {
                                    continue;
                                }

                                const duration = endTimeSeconds - startTimeSeconds;

                                if (duration < minDuration) {
                                    continue;
                                }

                                if (duration > maxDuration) {
                                    let chunkStart = startTimeSeconds;
                                    while (chunkStart + minDuration <= endTimeSeconds) {
                                        const chunkEnd = Math.min(chunkStart + maxDuration, endTimeSeconds);
                                        timeSegments.push([chunkStart, chunkEnd]);
                                        if (chunkEnd >= endTimeSeconds) {
                                            break;
                                        }
                                        chunkStart = chunkEnd;
                                    }
                                } else {
                                    timeSegments.push([startTimeSeconds, endTimeSeconds]);
                                }
                            }
                        } else {
                            console.warn(`Scene CSV not found at ${csvFile}, PySceneDetect output:\n${stdoutData}`);
                        }

                        const videoDuration = await this.getVideoDuration(videoPath);
                        const normalizedSegments = await this.prepareSegments(videoPath, timeSegments, sanitizedOptions, videoDuration);

                        console.log(`Selected ${normalizedSegments.length} clips for generation`);

                        if (!normalizedSegments.length) {
                            resolve([]);
                            return;
                        }

                        const nombreVideo = path.basename(videoPath, path.extname(videoPath));
                        const directorioVideo = path.join(this.outputDirectory, nombreVideo);
                        if (!fs.existsSync(directorioVideo)) {
                            fs.mkdirSync(directorioVideo, { recursive: true });
                        }

                        const clipPaths: string[] = [];
                        for (let i = 0; i < normalizedSegments.length; i++) {
                            const [inicio, fin] = normalizedSegments[i];
                            const outputFileName = `${nombreVideo}_scene${i + 1}.mp4`;
                            const outputPath = path.join(directorioVideo, outputFileName);

                            try {
                                await this.generateClipWithoutAudio(videoPath, inicio, fin, outputPath);
                                clipPaths.push(outputPath);
                                console.log(`Generated clip ${i + 1}/${normalizedSegments.length}: ${outputFileName}`);
                            } catch (error) {
                                console.error(`Error generando clip ${outputFileName}:`, error);
                            }
                        }

                        resolve(clipPaths);
                    } catch (error) {
                        console.error('Error processing scenes:', error);
                        reject(error);
                    }
                } else {
                    console.error(`PySceneDetect process exited with error code ${code}`);
                    console.error(`stderr: ${stderrData}`);

                    if (sanitizedOptions.detectionMethod === 'pyscenedetect') {
                        reject(new Error(`PySceneDetect failed with code ${code}`));
                        return;
                    }

                    try {
                        const clipPaths = await this.detectScenesWithFFmpegAndGenerateClips(videoPath, sanitizedOptions);
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
     * Alternativa usando FFmpeg para detectar cambios de escena
     * y generar clips sin depender de PySceneDetect
     * @param videoPath Ruta al video fuente
     * @param options Opciones de detección
     * @returns Promesa con array de rutas a los clips generados
     */
    async generateClipsForVideo(
        videoPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        const sanitizedOptions = this.sanitizeSceneOptions(options);
        const detectionMethod = this.resolveDetectionMethod(sanitizedOptions);
        sanitizedOptions.detectionMethod = detectionMethod;
        sanitizedOptions.useFFmpegDetection = detectionMethod === 'ffmpeg';

        if (detectionMethod === 'ffmpeg') {
            return this.detectScenesWithFFmpegAndGenerateClips(videoPath, sanitizedOptions);
        }

        if (detectionMethod === 'pyscenedetect') {
            return this.detectScenesAndGenerateClips(videoPath, sanitizedOptions);
        }

        try {
            return await this.detectScenesAndGenerateClips(videoPath, sanitizedOptions);
        } catch (error) {
            console.warn(`PySceneDetect failed for ${videoPath}, falling back to FFmpeg:`, error);
            return this.detectScenesWithFFmpegAndGenerateClips(videoPath, sanitizedOptions);
        }
    }


    async detectScenesWithFFmpegAndGenerateClips(
        videoPath: string,
        options: SceneDetectionOptions = {}
    ): Promise<string[]> {
        const sanitizedOptions = this.sanitizeSceneOptions(options);
        const minDuration = sanitizedOptions.minDuration ?? 0.8;
        const maxDuration = sanitizedOptions.maxDuration ?? Math.max(minDuration, 4.0);
        const threshold = this.getFfmpegSceneThreshold(sanitizedOptions);

        console.log(`Detecting scenes with FFmpeg in ${videoPath} using threshold ${threshold}`);

        return new Promise((resolve, reject) => {
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
                if (code !== 0) {
                    console.error('FFmpeg stderr:', stderrData);
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                    return;
                }

                try {
                    const sceneChanges: number[] = [];
                    const regex = /pts_time:(\d+\.\d+)/g;
                    let match;

                    while ((match = regex.exec(stderrData)) !== null) {
                        sceneChanges.push(parseFloat(match[1]));
                    }

                    if (!sceneChanges.length || sceneChanges[0] > 0.1) {
                        sceneChanges.unshift(0);
                    }

                    const videoDuration = await this.getVideoDuration(videoPath);
                    if (sceneChanges[sceneChanges.length - 1] !== videoDuration) {
                        sceneChanges.push(videoDuration);
                    }

                    const timeSegments: [number, number][] = [];

                    for (let i = 0; i < sceneChanges.length - 1; i++) {
                        const startTime = sceneChanges[i];
                        const endTime = sceneChanges[i + 1];
                        const duration = endTime - startTime;

                        if (duration < minDuration) {
                            continue;
                        }

                        if (duration > maxDuration) {
                            let chunkStart = startTime;
                            while (chunkStart + minDuration <= endTime) {
                                const chunkEnd = Math.min(chunkStart + maxDuration, endTime);
                                timeSegments.push([chunkStart, chunkEnd]);
                                if (chunkEnd >= endTime) {
                                    break;
                                }
                                chunkStart = chunkEnd;
                            }
                        } else {
                            timeSegments.push([startTime, endTime]);
                        }
                    }

                    const normalizedSegments = await this.prepareSegments(videoPath, timeSegments, sanitizedOptions, videoDuration);

                    console.log(`FFmpeg produced ${normalizedSegments.length} normalized segments`);

                    if (!normalizedSegments.length) {
                        resolve([]);
                        return;
                    }

                    const nombreVideo = path.basename(videoPath, path.extname(videoPath));
                    const directorioVideo = path.join(this.outputDirectory, nombreVideo);
                    if (!fs.existsSync(directorioVideo)) {
                        fs.mkdirSync(directorioVideo, { recursive: true });
                    }

                    const clipPaths: string[] = [];
                    for (let i = 0; i < normalizedSegments.length; i++) {
                        const [inicio, fin] = normalizedSegments[i];
                        const outputFileName = `${nombreVideo}_scene${i + 1}.mp4`;
                        const outputPath = path.join(directorioVideo, outputFileName);

                        try {
                            await this.generateClipWithoutAudio(videoPath, inicio, fin, outputPath);
                            clipPaths.push(outputPath);
                            console.log(`Generated clip ${i + 1}/${normalizedSegments.length}: ${outputFileName}`);
                        } catch (error) {
                            console.error(`Error generando clip ${outputFileName}:`, error);
                        }
                    }

                    resolve(clipPaths);
                } catch (error) {
                    console.error('Error processing FFmpeg scene detection:', error);
                    reject(error);
                }
            });

            ffmpegProcess.on('error', (err) => {
                reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
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

        for (const videoFile of videoFiles) {
            const videoPath = path.join(directoryPath, videoFile);
            console.log(`Processing video: ${videoPath}`);

            try {
                const clips = await this.generateClipsForVideo(videoPath, options);

                allClips.push(...clips);
                console.log(`Generated ${clips.length} clips from ${videoPath}`);
            } catch (error) {
                console.error(`Failed to process video ${videoPath}:`, error);
            }
        }

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

        // Listar todos los archivos y directorios en la carpeta de entrada
        const elementos = fs.readdirSync(inputDirectory);

        // Función para procesar un video (similar a la función Python)
        const procesarVideo = async (rutaVideo: string): Promise<string[]> => {
            console.log(`Procesando ${rutaVideo}...`);

            // Detectar escenas usando FFmpeg
            const escenas = await this.detectScenesFFmpeg(rutaVideo, options);

            // Filtrar y ajustar escenas según duración
            const escenasFiltradas: [number, number][] = [];

            for (const [inicio, fin] of escenas) {
                const duracion = fin - inicio;

                if (duracion < minDuration) {
                    continue;
                } else if (duracion > maxDuration) {
                    // Dividir escena en clips de duración máxima
                    const numClips = Math.floor(duracion / maxDuration);
                    for (let i = 0; i < numClips; i++) {
                        const clipInicio = inicio + (i * maxDuration);
                        const clipFin = clipInicio + maxDuration;
                        escenasFiltradas.push([clipInicio, clipFin]);
                    }
                    // Agregar el resto si es mayor que la duración mínima
                    const resto = duracion % maxDuration;
                    if (resto >= minDuration) {
                        const clipInicio = inicio + (numClips * maxDuration);
                        escenasFiltradas.push([clipInicio, fin]);
                    }
                } else {
                    escenasFiltradas.push([inicio, fin]);
                }
            }

            // Crear directorio específico para este video
            const nombreVideo = path.basename(rutaVideo, path.extname(rutaVideo));
            const directorioVideo = path.join(this.outputDirectory, nombreVideo);
            if (!fs.existsSync(directorioVideo)) {
                fs.mkdirSync(directorioVideo, { recursive: true });
            }

            // Generar clips para cada escena
            const clipPaths: string[] = [];
            for (let i = 0; i < escenasFiltradas.length; i++) {
                const [inicio, fin] = escenasFiltradas[i];
                const outputFileName = `${nombreVideo}_scene${i + 1}.mp4`;
                const outputPath = path.join(directorioVideo, outputFileName);

                try {
                    // Generar clip usando FFmpeg (sin audio como en Python)
                    await this.generateClipWithoutAudio(rutaVideo, inicio, fin, outputPath);
                    clipPaths.push(outputPath);
                } catch (error) {
                    console.error(`Error generando clip ${outputFileName}:`, error);
                }
            }

            console.log(`Procesamiento de ${rutaVideo} completado.`);
            return clipPaths;
        };

        // Función para procesar carpeta o archivo (similar a la función Python)
        const procesarCarpetaOArchivo = async (ruta: string): Promise<string[]> => {
            const rutaAbs = path.resolve(ruta);
            const clips: string[] = [];

            if (fs.statSync(rutaAbs).isDirectory()) {
                console.log(`Procesando carpeta: ${rutaAbs}`);
                const archivos = fs.readdirSync(rutaAbs);
                for (const archivo of archivos) {
                    const rutaArchivo = path.join(rutaAbs, archivo);
                    if (archivo.endsWith('.mp4')) {
                        const clipsPaths = await procesarVideo(rutaArchivo);
                        clips.push(...clipsPaths);
                    }
                }
            } else if (rutaAbs.endsWith('.mp4')) {
                const clipsPaths = await procesarVideo(rutaAbs);
                clips.push(...clipsPaths);
            } else {
                console.warn(`Elemento no válido: ${rutaAbs}`);
            }

            return clips;
        };

        // Procesar todos los elementos en la carpeta de videos
        for (const elemento of elementos) {
            const rutaElemento = path.join(inputDirectory, elemento);
            const clips = await procesarCarpetaOArchivo(rutaElemento);
            allClips.push(...clips);
        }

        return allClips;
    }

    private async getVideoDuration(videoPath: string): Promise<number> {
        return ffprobeCache.getDuration(videoPath, this.ffprobePath);
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
        const sanitizedOptions = this.sanitizeSceneOptions(options);
        const threshold = this.getFfmpegSceneThreshold(sanitizedOptions); // Valor por defecto como en la implementación Python

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
