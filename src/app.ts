import express, { Request } from 'express';
import multer from 'multer';
import { Downloader } from './downloader';
import { ClipGenerator } from './clipGenerator';
import { AudioAnalyzer } from './audioAnalyzer';
import { BeatSyncGenerator } from './beatSyncGenerator';
import * as path from 'path';
import * as fs from 'fs';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { spawn } from 'child_process';

// Interface for requests with file uploads
interface RequestWithFile extends Request {
    file?: Express.Multer.File;
}

export class SakugaDownAndClipGen {
    private downloader: Downloader;
    private clipGenerator: ClipGenerator;
    private app: express.Application;
    private server: http.Server;
    private io: Server;
    private port: number;
    private downloadDirectory: string;
    private clipDirectory: string;
    private randomNamesDirectory: string;
    private tempAudioDirectory: string;
    private audioAnalyzer: AudioAnalyzer;
    private beatSyncGenerator: BeatSyncGenerator;
    private beatSyncedVideosDirectory: string;
    private upload: multer.Multer;
    constructor(
        downloadDirectory: string = 'output/downloads',
        clipDirectory: string = 'output/clips',
        randomNamesDirectory: string = 'output/random_names',
        tempAudioDirectory: string = 'output/temp_audio',
        beatSyncedVideosDirectory: string = 'output/beat_synced_videos',
        port: number = 3000
    ) {
        this.downloader = new Downloader('https://www.sakugabooru.com', downloadDirectory);
        this.clipGenerator = new ClipGenerator(clipDirectory); // FFMPEG_PATH and FFPROBE_PATH are resolved within ClipGenerator

        // Define FFMPEG paths locally
        const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
        const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

        this.audioAnalyzer = new AudioAnalyzer(FFMPEG_PATH);
        this.beatSyncedVideosDirectory = beatSyncedVideosDirectory;

        this.beatSyncGenerator = new BeatSyncGenerator(FFMPEG_PATH, FFPROBE_PATH, this.beatSyncedVideosDirectory);
        this.port = port;
        this.downloadDirectory = downloadDirectory;
        this.clipDirectory = clipDirectory;
        this.randomNamesDirectory = randomNamesDirectory;
        this.tempAudioDirectory = tempAudioDirectory;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server);

        // Configurar WebSockets para actualizaciones en tiempo real
        this.setupWebSockets();

        // Asegurar que los directorios existan
        if (!fs.existsSync(downloadDirectory)) {
            fs.mkdirSync(downloadDirectory, { recursive: true });
        }

        if (!fs.existsSync(clipDirectory)) {
            fs.mkdirSync(clipDirectory, { recursive: true });
        }

        if (!fs.existsSync(randomNamesDirectory)) {
            fs.mkdirSync(randomNamesDirectory, { recursive: true });
        }

        if (!fs.existsSync(this.tempAudioDirectory)) {
            fs.mkdirSync(this.tempAudioDirectory, { recursive: true });
        }

        if (!fs.existsSync(this.beatSyncedVideosDirectory)) {
            fs.mkdirSync(this.beatSyncedVideosDirectory, { recursive: true });
        }        // Configure multer
        const storage = multer.diskStorage({
            destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
                cb(null, this.tempAudioDirectory);
            },
            filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
                // Generate a unique filename to avoid collisions
                cb(null, `${Date.now()}-${file.originalname}`);
            }
        });

        const fileFilter = (req: any, file: any, cb: any) => {
            if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/wav' || file.mimetype === 'audio/x-wav') {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only MP3 and WAV are allowed.'), false);
            }
        };

        this.upload = multer({
            storage: storage,
            limits: {
                fileSize: 1024 * 1024 * 50 // 50MB limit
            },
            fileFilter: fileFilter
        });

        this.setupExpressApp();
    }

    /**
     * Configura los eventos de WebSockets
     */
    private setupWebSockets() {
        this.io.on('connection', (socket: Socket) => {
            console.log('Cliente conectado');

            // Eventos personalizados aquí si son necesarios

            socket.on('disconnect', () => {
                console.log('Cliente desconectado');
            });
        });

        // Conectar eventos del downloader a WebSockets
        this.downloader.on('downloadStarted', (videoInfo) => {
            this.io.emit('downloadStarted', videoInfo);
        });

        this.downloader.on('downloadProgress', (videoInfo) => {
            this.io.emit('downloadProgress', videoInfo);
        });

        this.downloader.on('downloadComplete', (videoInfo) => {
            this.io.emit('downloadComplete', videoInfo);
            // Notificar también la actualización de la lista de directorios
            const downloads = this.getDirectoryContents(this.downloadDirectory);
            this.io.emit('directoriesUpdated', { type: 'downloads', contents: downloads });
        });
    }

    /**
     * Configura la aplicación Express
     */
    private setupExpressApp(): void {
        // Middleware para procesar JSON
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Servir archivos estáticos
        this.app.use(express.static(path.join(__dirname, '../public')));

        // Servir los videos y clips descargados
        this.app.use('/downloads', express.static(this.downloadDirectory));
        this.app.use('/clips', express.static(this.clipDirectory));
        this.app.use('/beat_synced_videos', express.static(this.beatSyncedVideosDirectory));

        // Endpoint para la página principal
        this.app.get('/', this.handleGetHome.bind(this));

        // API para obtener información de los directorios
        this.app.get('/api/downloads', this.handleGetDownloads.bind(this));
        this.app.get('/api/clips', this.handleGetClips.bind(this));

        // Nuevas APIs para carpetas
        this.app.get('/api/download-folders', this.handleGetDownloadFolders.bind(this));
        this.app.get('/api/folder/:folder/videos', this.handleGetFolderVideos.bind(this));

        // API para descargar un video
        this.app.post('/api/download', this.handlePostDownload.bind(this));

        // API para descargar por etiquetas
        this.app.post('/api/download-by-tags', this.handlePostDownloadByTags.bind(this));

        // API para generar clips de un video
        this.app.post('/api/generate-clips', this.handlePostGenerateClips.bind(this));

        // API para generar clips de todos los videos en una carpeta
        this.app.post('/api/generate-clips-from-folder', this.handlePostGenerateClipsFromFolder.bind(this));

        // API para descargar y generar clips en un solo paso
        this.app.post('/api/download-and-clip', this.handlePostDownloadAndClip.bind(this));

        // API para eliminar un clip
        this.app.post('/api/delete-clip', this.handlePostDeleteClip.bind(this));

        // API para eliminar todos los clips de un video
        this.app.post('/api/delete-clips-folder', this.handlePostDeleteClipsFolder.bind(this));

        // API para eliminar un video descargado
        this.app.post('/api/delete-video', this.handlePostDeleteVideo.bind(this));

        // API for listing clip folders and renaming videos
        this.app.get('/api/clips/list-folders', this.handleListClipFolders.bind(this));
        this.app.get('/api/random-names/list-folders', this.handleListRandomNameFolders.bind(this));
        this.app.post('/api/clips/rename-videos', this.handleRenameVideos.bind(this));

        // API for audio analysis
        this.app.post('/api/audio/analyze', this.upload.single('audioFile'), this.handlePostAudioAnalyze.bind(this));

        // API for beat-matched video generation
        this.app.post('/api/video/generate-beat-matched', this.handlePostGenerateBeatMatchedVideo.bind(this));
    }

    // Handlers para las rutas de Express
    private handleGetHome(req: express.Request, res: express.Response): void {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }

    private handleGetDownloads(req: express.Request, res: express.Response): void {
        const downloads = this.getDirectoryContents(this.downloadDirectory);
        res.json(downloads);
    }

    private async handleGetClips(req: express.Request, res: express.Response): Promise<void> {
        try {
            const clips = (await this.getDirectoryContentsWithDuration(this.clipDirectory))
                .filter(item => item.type === 'video');
            res.json(clips);
        } catch (error: any) {
            console.error('Error obteniendo clips:', error);
            res.status(500).json({ error: error.message });
        }
    }

    private async handlePostDownload(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { url } = req.body;
            if (!url) {
                res.status(400).json({ error: 'Se requiere una URL' });
                return;
            }

            console.log(`Descargando video desde: ${url}`);

            // Responder de inmediato
            res.json({ success: true, message: 'Descarga iniciada' });

            // Iniciar la descarga en background
            const videoPath = await this.downloader.downloadVideo(url);

            // La notificación se manejará a través de WebSockets
        } catch (error: any) {
            // Si ya se envió la respuesta, notificar el error por WebSocket
            if (res.headersSent) {
                this.io.emit('downloadError', { error: error.message });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    }

    private async handlePostDownloadByTags(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { tags } = req.body;
            if (!tags || !Array.isArray(tags) || tags.length === 0) {
                res.status(400).json({ error: 'Se requieren etiquetas válidas' });
                return;
            }

            console.log(`Procesando etiquetas: ${tags.join(', ')}`);

            // Responder de inmediato
            res.json({ success: true, message: 'Descarga de etiquetas iniciada' });

            // Iniciar descargas en background
            for (const tag of tags) {
                const tagUrl = `${this.downloader['baseUrl']}/post?tags=${tag}`;
                await this.downloader.downloadVideosFromTag(tagUrl);
            }

            // Las notificaciones se manejarán a través de WebSockets
        } catch (error: any) {
            // Si ya se envió la respuesta, notificar el error por WebSocket
            if (res.headersSent) {
                this.io.emit('downloadError', { error: error.message });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    }

    private async handlePostGenerateClips(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { videoPath, minDuration, maxDuration, threshold } = req.body;
            if (!videoPath) {
                res.status(400).json({ error: 'Se requiere la ruta del video' });
                return;
            }

            const sceneOptions = {
                minDuration: minDuration || 1.0,
                maxDuration: maxDuration || 3.0,
                threshold: threshold || 30
            };

            // Se usa siempre PySceneDetect con fallback a FFmpeg
            const clipPaths = await this.clipGenerator.detectScenesAndGenerateClips(
                videoPath,
                sceneOptions
            );

            res.json({ success: true, clipPaths });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    private async handlePostGenerateClipsFromFolder(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { folderPath = '', minDuration, maxDuration, threshold, useFFmpeg } = req.body;
            if (folderPath === undefined) {
                res.status(400).json({ error: 'Se requiere la ruta de la carpeta' });
                return;
            }

            // Determinar la ruta completa del directorio
            let videosDirectory: string;
            if (folderPath === '') {
                // Si no se especifica una carpeta, usar el directorio de descargas completo
                videosDirectory = this.downloadDirectory;
            } else {
                // Si se especifica una carpeta, construir la ruta
                videosDirectory = path.join(this.downloadDirectory, folderPath);
            }

            if (!fs.existsSync(videosDirectory)) {
                res.status(404).json({ error: `La carpeta ${folderPath} no existe` });
                return;
            }

            // Crear un mock request y response para reutilizar handlePostGenerateClips
            const results: Array<{ videoPath: string, clipPaths: string[] }> = [];
            const processDirectory = async (dirPath: string) => {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);

                    if (entry.isDirectory()) {
                        // Procesar subdirectorios recursivamente
                        await processDirectory(fullPath);
                    } else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                        // Crear un mock request para cada video
                        const mockReq = {
                            body: {
                                videoPath: fullPath,
                                minDuration,
                                maxDuration,
                                threshold,
                                useFFmpeg
                            }
                        } as express.Request;

                        // Crear un mock response para capturar el resultado
                        let responseData: any;
                        const mockRes = {
                            json: (data: any) => {
                                responseData = data;
                                return mockRes;
                            },
                            status: (code: number) => mockRes
                        } as unknown as express.Response;

                        // Procesar el video usando handlePostGenerateClips
                        await this.handlePostGenerateClips(mockReq, mockRes);

                        if (responseData && responseData.success) {
                            results.push({
                                videoPath: fullPath.replace(/\\/g, '/'),
                                clipPaths: responseData.clipPaths.map((p: string) => p.replace(/\\/g, '/'))
                            });
                        }
                    }
                }
            };

            await processDirectory(videosDirectory);

            // Notificar la actualización de la lista de clips
            const clips = (await this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
            this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });

            res.json({ success: true, results });
        } catch (error: any) {
            console.error('Error en la generación de clips desde carpeta:', error);
            res.status(500).json({ error: error.message });
        }
    }

    private async handlePostDownloadAndClip(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { url, tags, minDuration, maxDuration, threshold, useFFmpeg } = req.body;

            if (!url && (!tags || !Array.isArray(tags) || tags.length === 0)) {
                res.status(400).json({ error: 'Se requiere una URL o etiquetas válidas' });
                return;
            }

            const sceneOptions = {
                minDuration: minDuration || 1.0,
                maxDuration: maxDuration || 3.0,
                threshold: threshold || (useFFmpeg ? 0.3 : 30),
                useFFmpegDetection: useFFmpeg || false
            };

            let results: Map<string, string[]>;

            if (url) {
                console.log(`Procesando URL: ${url}`);
                if (url.includes('/post?tags=')) {
                    const tagName = new URL(url).searchParams.get('tags') || '';
                    results = await this.downloadTagsAndGenerateClips([tagName], sceneOptions);
                } else {
                    const clipPaths = await this.downloadAndGenerateClips(url, []);
                    results = new Map();
                    results.set(url, clipPaths);
                }
            } else {
                console.log(`Procesando etiquetas: ${tags.join(', ')}`);
                results = await this.downloadTagsAndGenerateClips(tags, sceneOptions);
            }

            // Convertir el Map a un objeto para la respuesta JSON
            const resultsObject: Record<string, string[]> = {};
            results.forEach((clips, video) => {
                resultsObject[video] = clips;
            });

            res.json({ success: true, results: resultsObject });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // Handler for listing subfolders in the clip directory
    private handleListClipFolders(req: express.Request, res: express.Response): void {
        const clipsBaseDir = this.clipDirectory; // output/clips

        if (!fs.existsSync(clipsBaseDir)) {
            console.log(`Directory ${clipsBaseDir} does not exist.`);
            res.status(200).json([]); // Return empty array if base directory doesn't exist
            return;
        }

        try {
            const entries = fs.readdirSync(clipsBaseDir, { withFileTypes: true });
            const folders = entries
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
            res.json(folders);
        } catch (error: any) {
            console.error(`Error reading directory ${clipsBaseDir}:`, error);
            res.status(500).json({ error: `Failed to list folders in ${clipsBaseDir}` });
        }
    }

    private handleListRandomNameFolders(req: express.Request, res: express.Response): void {
        const baseDir = this.randomNamesDirectory;

        if (!fs.existsSync(baseDir)) {
            res.status(200).json([]);
            return;
        }

        try {
            const entries = fs.readdirSync(baseDir, { withFileTypes: true });
            const folders = entries.filter(e => e.isDirectory()).map(e => e.name);
            res.json(folders);
        } catch (error: any) {
            console.error(`Error reading directory ${baseDir}:`, error);
            res.status(500).json({ error: `Failed to list folders in ${baseDir}` });
        }
    }

    // Handler for renaming videos using the Python script
    private handleRenameVideos(req: express.Request, res: express.Response): void {
        const { selectedFolders, outputSubfolder } = req.body;

        if (!selectedFolders || !Array.isArray(selectedFolders) || selectedFolders.length === 0) {
            res.status(400).json({
                status: "error",
                message: "Invalid request body. 'selectedFolders' is required and must be a non-empty array."
            });
            return;
        }

        if (!outputSubfolder || typeof outputSubfolder !== 'string' || outputSubfolder.trim() === '') {
            res.status(400).json({
                status: "error",
                message: "Invalid request body. 'outputSubfolder' is required and must be a non-empty string."
            });
            return;
        }

        const clipsBaseDir = this.clipDirectory; // output/clips
        const inputDirs = selectedFolders.map(folder => path.join(clipsBaseDir, folder));
        const outputDir = path.join(this.randomNamesDirectory, outputSubfolder.trim());

        // Ensure output directory for the script exists, though the script should also handle this
        try {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
        } catch (mkdirError: any) {
            console.error(`Error creating output directory ${outputDir}:`, mkdirError); res.status(500).json({
                status: "error",
                message: "Failed to create output directory for processed videos.",
                details: mkdirError.message
            });
            return;
        }

        // Validate that input directories exist
        for (const dir of inputDirs) {
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
                res.status(400).json({
                    status: "error",
                    message: `Invalid input directory: ${dir}. Folder does not exist or is not a directory.`,
                });
                return;
            }
        } const pythonScriptPath = path.resolve(__dirname, '../rename_clips.py'); // Script is at project root

        if (!fs.existsSync(pythonScriptPath)) {
            console.error(`Python script not found at ${pythonScriptPath}`);
            res.status(500).json({
                status: "error",
                message: "Python script 'rename_clips.py' not found on the server.",
                details: `Expected at ${pythonScriptPath}`
            });
            return;
        }

        const scriptArgs = [
            '--input_dirs', ...inputDirs,
            '--output_dir', outputDir
        ];

        console.log(`Executing script: python ${pythonScriptPath} ${scriptArgs.join(' ')}`);

        const pythonProcess = spawn('python', [pythonScriptPath, ...scriptArgs]);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });








        pythonProcess.on('close', (code) => {
            console.log(`Python script stdout:\n${stdoutData}`);
            console.error(`Python script stderr:\n${stderrData}`);
            if (code === 0) {
                res.status(200).json({
                    status: "success",
                    message: "Videos renamed successfully."
                });
            } else {
                res.status(500).json({
                    status: "error",
                    message: "Error processing videos.",
                    details: stderrData.trim() || `Python script exited with code ${code}`
                });
            }
        });

        pythonProcess.on('error', (err) => {
            console.error('Failed to start Python script:', err);
            res.status(500).json({
                status: "error",
                message: "Failed to start video processing script.",
                details: err.message
            });
        });
    }

    /**
     * Maneja la solicitud para eliminar un clip
     */
    private async handlePostDeleteClip(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { clipPath } = req.body;

            if (!clipPath) {
                res.status(400).json({ error: 'Se requiere la ruta del clip a eliminar' });
                return;
            }

            // Construir la ruta completa al archivo
            const fullPath = path.join(this.clipDirectory, clipPath);

            console.log(`Intentando eliminar clip: ${fullPath}`);

            // Verificar que el archivo existe y que esté dentro del directorio de clips (seguridad)
            if (!fs.existsSync(fullPath)) {
                res.status(404).json({ error: 'Clip no encontrado' });
                return;
            }

            // Comprobar que la ruta está dentro del directorio de clips permitido
            const normalizedClipDir = path.normalize(this.clipDirectory);
            const normalizedFullPath = path.normalize(fullPath);

            if (!normalizedFullPath.startsWith(normalizedClipDir)) {
                res.status(403).json({ error: 'Acceso denegado: ruta de archivo no permitida' });
                return;
            }

            // Eliminar el archivo
            fs.unlinkSync(fullPath);
            console.log(`Clip eliminado: ${clipPath}`);

            // Verificar si la carpeta del clip está vacía y eliminarla si lo está
            const clipDir = path.dirname(fullPath);
            const remainingFiles = fs.readdirSync(clipDir);

            // Check if the directory is empty and is not the main clip directory
            if (remainingFiles.length === 0 && clipDir !== this.clipDirectory) {
                try {
                    fs.rmdirSync(clipDir);
                    console.log(`Carpeta vacía eliminada: ${clipDir}`);
                } catch (rmDirError) {
                    console.warn(`No se pudo eliminar la carpeta vacía: ${clipDir}`, rmDirError);
                }
            }

            // Actualizar la lista de clips y notificar a los clientes
            const clips = (await this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
            this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });

            res.json({ success: true, message: 'Clip eliminado correctamente' });
        } catch (error: any) {
            console.error('Error al eliminar clip:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Maneja la solicitud para eliminar todos los clips de un video (carpeta)
     */
    private async handlePostDeleteClipsFolder(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { folderPath } = req.body;

            if (!folderPath) {
                res.status(400).json({ error: 'Se requiere la carpeta de clips a eliminar' });
                return;
            }

            const fullFolderPath = path.join(this.clipDirectory, folderPath);
            console.log(`Intentando eliminar carpeta de clips: ${fullFolderPath}`);

            if (!fs.existsSync(fullFolderPath) || !fs.statSync(fullFolderPath).isDirectory()) {
                res.status(404).json({ error: 'Carpeta no encontrada' });
                return;
            }

            const normalizedBase = path.normalize(this.clipDirectory);
            const normalizedFull = path.normalize(fullFolderPath);

            if (!normalizedFull.startsWith(normalizedBase)) {
                res.status(403).json({ error: 'Acceso denegado: ruta de carpeta no permitida' });
                return;
            }

            fs.rmSync(fullFolderPath, { recursive: true, force: true });
            console.log(`Carpeta de clips eliminada: ${folderPath}`);

            const clips = (await this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
            this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });

            res.json({ success: true, message: 'Clips eliminados correctamente' });
        } catch (error: any) {
            console.error('Error al eliminar carpeta de clips:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Maneja la solicitud para eliminar un video descargado
     */
    private async handlePostDeleteVideo(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { videoPath } = req.body;

            if (!videoPath) {
                res.status(400).json({ error: 'Se requiere la ruta del video a eliminar' });
                return;
            }

            const fullPath = path.join(this.downloadDirectory, videoPath);
            console.log(`Intentando eliminar video: ${fullPath}`);

            if (!fs.existsSync(fullPath)) {
                res.status(404).json({ error: 'Video no encontrado' });
                return;
            }

            const normalizedDir = path.normalize(this.downloadDirectory);
            const normalizedFullPath = path.normalize(fullPath);

            if (!normalizedFullPath.startsWith(normalizedDir)) {
                res.status(403).json({ error: 'Acceso denegado: ruta de archivo no permitida' });
                return;
            }

            fs.unlinkSync(fullPath);
            console.log(`Video eliminado: ${videoPath}`);

            const videoDir = path.dirname(fullPath);
            if (fs.existsSync(videoDir) && videoDir !== this.downloadDirectory) {
                const remaining = fs.readdirSync(videoDir);
                if (remaining.length === 0) {
                    try {
                        fs.rmdirSync(videoDir);
                        console.log(`Carpeta vacía eliminada: ${videoDir}`);
                    } catch (e) {
                        console.warn(`No se pudo eliminar la carpeta vacía: ${videoDir}`, e);
                    }
                }
            }

            const downloads = this.getDirectoryContents(this.downloadDirectory);
            this.io.emit('directoriesUpdated', { type: 'downloads', contents: downloads });

            res.json({ success: true, message: 'Video eliminado correctamente' });
        } catch (error: any) {
            console.error('Error al eliminar video:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Obtiene todas las carpetas disponibles en el directorio de descargas
     */
    private async handleGetDownloadFolders(req: express.Request, res: express.Response): Promise<void> {
        try {
            const folders = this.getDirectoryFolders(this.downloadDirectory);
            res.json(folders);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Obtiene los videos de una carpeta específica
     */
    private async handleGetFolderVideos(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { folder } = req.params;

            if (!folder) {
                res.status(400).json({ error: 'Se requiere especificar una carpeta' });
                return;
            }

            const folderPath = path.join(this.downloadDirectory, folder);

            if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
                res.status(404).json({ error: 'Carpeta no encontrada' });
                return;
            }

            const videos = this.getDirectoryContents(folderPath, folder);
            res.json(videos);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Inicia el servidor Express
     */
    public startServer(): void {
        this.server.listen(this.port, () => {
            console.log(`Servidor iniciado en http://localhost:${this.port}`);
        });
    }

    /**
     * Obtiene solo las carpetas de un directorio
     */
    private getDirectoryFolders(directory: string): { name: string, path: string }[] {
        if (!fs.existsSync(directory)) {
            return [];
        }

        const folders: { name: string, path: string }[] = [];
        const entries = fs.readdirSync(directory, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                folders.push({
                    name: entry.name,
                    path: entry.name
                });
            }
        }

        return folders;
    }

    /**
     * Obtiene el contenido de un directorio con soporte para filtrado por carpeta
     */
    private getDirectoryContents(
        directory: string,
        baseFolder: string = ''
    ): { name: string, path: string, type: string, size: number }[] {
        if (!fs.existsSync(directory)) {
            return [];
        }

        const contents: { name: string, path: string, type: string, size: number }[] = [];
        const processDirectory = (dir: string, relativePath: string = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                let entryRelativePath: string;

                if (baseFolder) {
                    // Si hay una carpeta base, la incluimos en la ruta relativa
                    entryRelativePath = path.join(baseFolder, relativePath, entry.name);
                } else {
                    entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
                }

                if (entry.isDirectory()) {
                    contents.push({
                        name: entry.name,
                        path: entryRelativePath,
                        type: 'directory',
                        size: 0
                    });
                    processDirectory(fullPath, path.join(relativePath, entry.name));
                } else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                    const stats = fs.statSync(fullPath);
                    contents.push({
                        name: entry.name,
                        path: entryRelativePath,
                        type: 'video',
                        size: stats.size
                    });
                }
            }
        };

        processDirectory(directory);
        return contents;
    }

    /**
     * Obtiene la duración de un video utilizando FFprobe
     */
    private async getVideoDurationFFprobe(videoPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
            const args = [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                videoPath
            ];

            const ffprobeProcess = spawn(ffprobePath, args);
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
     * Obtiene el contenido de un directorio e incluye la duración de los videos
     */
    private async getDirectoryContentsWithDuration(
        directory: string,
        baseFolder: string = ''
    ): Promise<{ name: string, path: string, type: string, size: number, duration?: number }[]> {
        const contents: { name: string, path: string, type: string, size: number, duration?: number }[] = [];

        if (!fs.existsSync(directory)) {
            return contents;
        }

        const processDirectory = async (dir: string, relativePath: string = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                let entryRelativePath: string;

                if (baseFolder) {
                    entryRelativePath = path.join(baseFolder, relativePath, entry.name);
                } else {
                    entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
                }

                if (entry.isDirectory()) {
                    contents.push({
                        name: entry.name,
                        path: entryRelativePath,
                        type: 'directory',
                        size: 0
                    });
                    await processDirectory(fullPath, path.join(relativePath, entry.name));
                } else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                    const stats = fs.statSync(fullPath);
                    let duration = 0;
                    try {
                        duration = await this.getVideoDurationFFprobe(fullPath);
                    } catch (e) {
                        console.warn(`No se pudo obtener la duración de ${fullPath}:`, e);
                    }
                    contents.push({
                        name: entry.name,
                        path: entryRelativePath,
                        type: 'video',
                        size: stats.size,
                        duration
                    });
                }
            }
        };

        await processDirectory(directory);
        return contents;
    }

    /**
     * Descarga un video y luego genera clips basados en segmentos de tiempo específicos
     * @param videoUrl URL del video a descargar
     * @param timeSegments Segmentos de tiempo [inicio, fin] en segundos
     * @returns Rutas de los clips generados
     */
    async downloadAndGenerateClips(
        videoUrl: string,
        timeSegments: [number, number][]
    ): Promise<string[]> {
        try {
            // 1. Descargar el video
            console.log(`Descargando video desde: ${videoUrl}`);
            const videoPath = await this.downloader.downloadVideo(videoUrl);

            // 2. Generar clips del video descargado
            console.log(`Generando clips del video descargado: ${videoPath}`);

            // Si no se proporcionan segmentos, detectar escenas automáticamente
            if (timeSegments.length === 0) {
                return await this.clipGenerator.detectScenesAndGenerateClips(videoPath);
            }

            const clipPaths = await this.clipGenerator.generateMultipleClips(videoPath, timeSegments);
            return clipPaths;
        } catch (error) {
            console.error('Error en el proceso de descarga y generación de clips:', error);
            throw error;
        }
    }

    /**
     * Descarga videos basados en etiquetas desde Sakugabooru y genera clips automáticamente
     * @param tags Etiquetas para buscar en Sakugabooru
     * @param sceneOptions Opciones para la detección de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    async downloadTagsAndGenerateClips(
        tags: string[],
        sceneOptions: {
            minDuration?: number,
            maxDuration?: number,
            threshold?: number,
            useFFmpegDetection?: boolean
        } = {}
    ): Promise<Map<string, string[]>> {
        const resultsMap = new Map<string, string[]>();

        for (const tag of tags) {
            try {
                console.log(`Procesando etiqueta: ${tag}`);
                const tagUrl = `${this.downloader['baseUrl']}/post?tags=${tag}`;

                // Descargar videos para esta etiqueta
                const videoPaths = await this.downloader.downloadVideosFromTag(tagUrl);

                // Para cada video descargado, generar clips
                for (const videoPath of videoPaths) {
                    let clipPaths: string[];

                    if (sceneOptions.useFFmpegDetection) {
                        // Usar FFmpeg para detección de escenas
                        clipPaths = await this.clipGenerator.detectScenesWithFFmpegAndGenerateClips(
                            videoPath,
                            sceneOptions
                        );
                    } else {
                        // Usar PySceneDetect para detección de escenas
                        clipPaths = await this.clipGenerator.detectScenesAndGenerateClips(
                            videoPath,
                            sceneOptions
                        );
                    }

                    resultsMap.set(videoPath, clipPaths);
                }
            } catch (error) {
                console.error(`Error procesando la etiqueta ${tag}:`, error);
            }
        }

        return resultsMap;
    }

    /**
     * Procesa un archivo de etiquetas para descargar videos y generar clips
     * @param tagsFilePath Ruta al archivo de etiquetas (separadas por punto y coma)
     * @param sceneOptions Opciones para la detección de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    async processTagsFileAndGenerateClips(
        tagsFilePath: string,
        sceneOptions: {
            minDuration?: number,
            maxDuration?: number,
            threshold?: number,
            useFFmpegDetection?: boolean
        } = {}
    ): Promise<Map<string, string[]>> {
        try {
            if (!fs.existsSync(tagsFilePath)) {
                throw new Error(`Archivo de etiquetas no encontrado: ${tagsFilePath}`);
            }

            const content = fs.readFileSync(tagsFilePath, 'utf-8').trim();

            if (!content) {
                throw new Error("El archivo de etiquetas está vacío");
            }

            const tags = content.split(';')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);

            return await this.downloadTagsAndGenerateClips(tags, sceneOptions);
        } catch (error) {
            console.error(`Error procesando archivo de etiquetas:`, error);
            throw error;
        }
    }

    /**
     * Procesa videos ya descargados y genera clips
     * @param videosDirectory Directorio que contiene videos ya descargados
     * @param sceneOptions Opciones para la detección de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    async processVideosDirectoryAndGenerateClips(
        videosDirectory: string, // This parameter is the base directory containing video files or subfolders with videos
        sceneOptions: {
            minDuration?: number,
            maxDuration?: number,
            threshold?: number,
            useFFmpegDetection?: boolean // Option to choose detection method
        } = {}
    ): Promise<Map<string, string[]>> { // Returns a map of original video paths to array of generated clip paths
        const resultsMap = new Map<string, string[]>(); // Initialize a map to store results

        try {
            // Check if the provided directory exists
            if (!fs.existsSync(videosDirectory)) {
                console.error(`Error: Videos directory does not exist at ${videosDirectory}`);
                throw new Error(`El directorio de videos no existe: ${videosDirectory}`);
            }

            // Recursive function to process files and subdirectories
            const processDirectory = async (currentDirPath: string) => {
                const entries = fs.readdirSync(currentDirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(currentDirPath, entry.name);

                    if (entry.isDirectory()) {
                        // If entry is a directory, recurse into it
                        console.log(`Scanning subdirectory: ${fullPath}`);
                        await processDirectory(fullPath);
                    } else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                        // If entry is a supported video file, process it
                        console.log(`Procesando video: ${fullPath}`);
                        this.io.emit('clipGenerationStatus', { video: fullPath, status: 'processing' });


                        let clipPaths: string[]; // Array to hold paths of generated clips

                        // Choose scene detection method based on sceneOptions
                        if (sceneOptions.useFFmpegDetection) {
                            clipPaths = await this.clipGenerator.detectScenesWithFFmpegAndGenerateClips(
                                fullPath,
                                sceneOptions
                            );
                        } else {
                            clipPaths = await this.clipGenerator.detectScenesAndGenerateClips(
                                fullPath,
                                sceneOptions
                            );
                        }
                        this.io.emit('clipGenerationStatus', { video: fullPath, status: 'completed', clips: clipPaths.length });
                        resultsMap.set(fullPath, clipPaths); // Store the result in the map
                    }
                }
            };

            await processDirectory(videosDirectory); // Start processing from the root videosDirectory

        } catch (error) {
            console.error(`Error procesando directorio de videos: ${videosDirectory}`, error);
            this.io.emit('clipGenerationError', { directory: videosDirectory, error: (error as Error).message });
            throw error; // Re-throw the error to be handled by the caller
        }
        // Notificar la actualización de la lista de clips
        const clips = (await this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
        this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });
        return resultsMap; // Return the map of results
    }    /**
     * Handles audio analysis requests
     */
    private async handlePostAudioAnalyze(req: RequestWithFile, res: express.Response): Promise<void> {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No audio file uploaded.' });
            return;
        }

        const audioFilePath = req.file.path;

        try {
            console.log(`Analyzing audio file: ${audioFilePath}`);
            const analysisResult = await this.audioAnalyzer.analyzeBeats(audioFilePath);
            res.json({ success: true, analysis: analysisResult, audioFileName: path.basename(audioFilePath) });
        } catch (error: any) {
            console.error(`Error analyzing audio file ${audioFilePath}:`, error);
            res.status(500).json({ success: false, error: `Failed to analyze audio: ${error.message}` });
        }
    }

    /**
     * Handles beat-matched video generation requests
     */
    private async handlePostGenerateBeatMatchedVideo(req: express.Request, res: express.Response): Promise<void> {
        try {
            const {
                beatTimestamps, // array of numbers
                audioStartTime, // number
                audioEndTime,   // number
                sourceClipFolderPaths, // array of strings (relative paths)
                outputVideoName, // string
                audioFileName // string (name of analyzed audio file)
            } = req.body;

            // Validation
            if (!beatTimestamps || !Array.isArray(beatTimestamps) || beatTimestamps.some(isNaN)) {
                res.status(400).json({ success: false, error: 'Invalid or missing beatTimestamps. Must be an array of numbers.' });
                return;
            }
            if (typeof audioStartTime !== 'number' || typeof audioEndTime !== 'number') {
                res.status(400).json({ success: false, error: 'Invalid or missing audioStartTime/audioEndTime. Must be numbers.' });
                return;
            }
            if (audioEndTime <= audioStartTime) {
                res.status(400).json({ success: false, error: 'audioEndTime must be greater than audioStartTime.' });
                return;
            }
            if (!sourceClipFolderPaths || !Array.isArray(sourceClipFolderPaths) || sourceClipFolderPaths.some(p => typeof p !== 'string')) {
                res.status(400).json({ success: false, error: 'Invalid or missing sourceClipFolderPaths. Must be an array of strings.' });
                return;
            }
            if (!outputVideoName || typeof outputVideoName !== 'string' || outputVideoName.trim() === '') {
                res.status(400).json({ success: false, error: 'Invalid or missing outputVideoName. Must be a non-empty string.' });
                return;
            }
            if (!audioFileName || typeof audioFileName !== 'string') {
                res.status(400).json({ success: false, error: 'Invalid or missing audioFileName.' });
                return;
            }
            // Sanitize outputVideoName to prevent path traversal
            const sanitizedOutputVideoName = path.basename(outputVideoName);
            if (sanitizedOutputVideoName !== outputVideoName || !/\.(mp4|webm|mkv)$/i.test(sanitizedOutputVideoName)) {
                res.status(400).json({ success: false, error: 'Invalid outputVideoName. It should be a valid filename with .mp4, .webm, or .mkv extension and no path characters.' });
                return;
            }

            console.log(`Generating beat-matched video: ${sanitizedOutputVideoName}`);
            // this.clipDirectory is the base for sourceClipFolderPaths
            const sanitizedAudioFileName = path.basename(audioFileName);
            const audioFilePath = path.join(this.tempAudioDirectory, sanitizedAudioFileName);

            if (!fs.existsSync(audioFilePath)) {
                res.status(400).json({ success: false, error: 'Audio file not found on server.' });
                return;
            }

            const generatedVideoPath = await this.beatSyncGenerator.generateVideoFromAudioBeats(
                beatTimestamps,
                audioStartTime,
                audioEndTime,
                sourceClipFolderPaths,
                sanitizedOutputVideoName,
                this.randomNamesDirectory,
                audioFilePath
            );

            // Make path relative to the server's static serving for client access
            const relativeVideoPath = path.join('beat_synced_videos', sanitizedOutputVideoName).replace(/\\/g, '/');

            res.json({ success: true, videoPath: relativeVideoPath, absoluteVideoPath: generatedVideoPath });

            fs.unlink(audioFilePath, (err) => {
                if (err) {
                    console.error(`Failed to delete temporary audio file ${audioFilePath}:`, err);
                }
            });

        } catch (error: any) {
            console.error('Error generating beat-matched video:', error);
            res.status(500).json({ success: false, error: `Failed to generate beat-matched video: ${error.message}` });
        }
    }
}

export default SakugaDownAndClipGen;