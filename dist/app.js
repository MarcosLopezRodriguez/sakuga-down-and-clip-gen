"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SakugaDownAndClipGen = void 0;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const downloader_1 = require("./downloader");
const clipGenerator_1 = require("./clipGenerator");
const audioAnalyzer_1 = require("./audioAnalyzer");
const beatSyncGenerator_1 = require("./beatSyncGenerator");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const fsp = fs.promises;
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const child_process_1 = require("child_process");
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
const ffprobeCache_1 = require("./utils/ffprobeCache");
class SakugaDownAndClipGen {
    constructor(downloadDirectory = 'output/downloads', clipDirectory = 'output/clips', randomNamesDirectory = 'output/random_names', tempAudioDirectory = 'output/temp_audio', beatSyncedVideosDirectory = 'output/beat_synced_videos', port = 3000) {
        this.downloader = new downloader_1.Downloader('https://www.sakugabooru.com', downloadDirectory);
        this.clipGenerator = new clipGenerator_1.ClipGenerator(clipDirectory); // FFMPEG_PATH and FFPROBE_PATH are resolved within ClipGenerator
        // Define FFMPEG paths locally
        const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
        const FFPROBE_PATH = process.env.FFPROBE_PATH || ffprobe_static_1.default.path;
        this.audioAnalyzer = new audioAnalyzer_1.AudioAnalyzer(FFMPEG_PATH);
        this.beatSyncedVideosDirectory = beatSyncedVideosDirectory;
        this.beatSyncGenerator = new beatSyncGenerator_1.BeatSyncGenerator(FFMPEG_PATH, FFPROBE_PATH, this.beatSyncedVideosDirectory);
        this.port = port;
        this.downloadDirectory = downloadDirectory;
        this.clipDirectory = clipDirectory;
        this.randomNamesDirectory = randomNamesDirectory;
        this.tempAudioDirectory = tempAudioDirectory;
        this.app = (0, express_1.default)();
        this.server = http_1.default.createServer(this.app);
        this.io = new socket_io_1.Server(this.server);
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
        } // Configure multer
        const storage = multer_1.default.diskStorage({
            destination: (req, file, cb) => {
                cb(null, this.tempAudioDirectory);
            },
            filename: (req, file, cb) => {
                // Generate a unique filename to avoid collisions
                cb(null, `${Date.now()}-${file.originalname}`);
            }
        });
        const fileFilter = (req, file, cb) => {
            if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/wav' || file.mimetype === 'audio/x-wav') {
                cb(null, true);
            }
            else {
                cb(new Error('Invalid file type. Only MP3 and WAV are allowed.'), false);
            }
        };
        this.upload = (0, multer_1.default)({
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
    setupWebSockets() {
        this.io.on('connection', (socket) => {
            console.log('Cliente conectado');
            // Eventos personalizados aquÃ­ si son necesarios
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
            // Notificar tambiÃ©n la actualizaciÃ³n de la lista de directorios
            const downloads = this.getDirectoryContents(this.downloadDirectory);
            this.io.emit('directoriesUpdated', { type: 'downloads', contents: downloads });
        });
    }
    /**
     * Configura la aplicaciÃ³n Express
     */
    setupExpressApp() {
        // Middleware para procesar JSON
        this.app.use(express_1.default.json());
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Servir archivos estÃ¡ticos
        this.app.use(express_1.default.static(path.join(__dirname, '../public')));
        // Servir los videos y clips descargados
        this.app.use('/downloads', express_1.default.static(this.downloadDirectory));
        this.app.use('/clips', express_1.default.static(this.clipDirectory));
        this.app.use('/beat_synced_videos', express_1.default.static(this.beatSyncedVideosDirectory));
        // Endpoint para la pÃ¡gina principal
        this.app.get('/', this.handleGetHome.bind(this));
        // API para obtener informaciÃ³n de los directorios
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
    handleGetHome(req, res) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
    handleGetDownloads(req, res) {
        const downloads = this.getDirectoryContents(this.downloadDirectory);
        res.json(downloads);
    }
    handleGetClips(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const clips = (yield this.getDirectoryContentsWithDuration(this.clipDirectory))
                    .filter(item => item.type === 'video');
                res.json(clips);
            }
            catch (error) {
                console.error('Error obteniendo clips:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }
    handlePostDownload(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
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
                const videoPath = yield this.downloader.downloadVideo(url);
                // La notificaciÃ³n se manejarÃ¡ a travÃ©s de WebSockets
            }
            catch (error) {
                // Si ya se enviÃ³ la respuesta, notificar el error por WebSocket
                if (res.headersSent) {
                    this.io.emit('downloadError', { error: error.message });
                }
                else {
                    res.status(500).json({ error: error.message });
                }
            }
        });
    }
    handlePostDownloadByTags(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { tags } = req.body;
                if (!tags || !Array.isArray(tags) || tags.length === 0) {
                    res.status(400).json({ error: 'Se requieren etiquetas vÃ¡lidas' });
                    return;
                }
                console.log(`Procesando etiquetas: ${tags.join(', ')}`);
                // Responder de inmediato
                res.json({ success: true, message: 'Descarga de etiquetas iniciada' });
                // Iniciar descargas en background
                for (const tag of tags) {
                    const tagUrl = `${this.downloader['baseUrl']}/post?tags=${tag}`;
                    yield this.downloader.downloadVideosFromTag(tagUrl);
                }
                // Las notificaciones se manejarÃ¡n a travÃ©s de WebSockets
            }
            catch (error) {
                // Si ya se enviÃ³ la respuesta, notificar el error por WebSocket
                if (res.headersSent) {
                    this.io.emit('downloadError', { error: error.message });
                }
                else {
                    res.status(500).json({ error: error.message });
                }
            }
        });
    }
    parseSceneOptions(body) {
        var _a, _b, _c;
        const parseNumber = (value) => {
            if (value === null || value === undefined || value === '') {
                return undefined;
            }
            if (typeof value === 'number') {
                return Number.isFinite(value) ? value : undefined;
            }
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };
        const minDuration = Math.max(0.1, (_a = parseNumber(body === null || body === void 0 ? void 0 : body.minDuration)) !== null && _a !== void 0 ? _a : 0.8);
        const maxDurationRaw = parseNumber(body === null || body === void 0 ? void 0 : body.maxDuration);
        const maxDuration = Math.max(minDuration, maxDurationRaw !== null && maxDurationRaw !== void 0 ? maxDurationRaw : 4.0);
        const thresholdRaw = parseNumber(body === null || body === void 0 ? void 0 : body.threshold);
        const threshold = thresholdRaw !== undefined ? thresholdRaw : 8;
        const maxClipsRaw = parseNumber(body === null || body === void 0 ? void 0 : body.maxClipsPerVideo);
        const maxClips = maxClipsRaw !== undefined && maxClipsRaw > 0 ? Math.floor(maxClipsRaw) : undefined;
        const padding = Math.max(0, (_b = parseNumber(body === null || body === void 0 ? void 0 : body.scenePadding)) !== null && _b !== void 0 ? _b : 0.1);
        const gap = Math.max(0, (_c = parseNumber(body === null || body === void 0 ? void 0 : body.minGapBetweenClips)) !== null && _c !== void 0 ? _c : 0.1);
        const methodRaw = typeof (body === null || body === void 0 ? void 0 : body.detectionMethod) === 'string'
            ? body.detectionMethod.trim().toLowerCase()
            : undefined;
        let detectionMethod;
        if (methodRaw && ['auto', 'pyscenedetect', 'ffmpeg'].includes(methodRaw)) {
            detectionMethod = methodRaw;
        }
        const sceneOptions = {
            minDuration,
            maxDuration,
            threshold,
            scenePadding: padding,
            minGapBetweenClips: gap
        };
        if (maxClips !== undefined) {
            sceneOptions.maxClipsPerVideo = maxClips;
        }
        if (detectionMethod) {
            sceneOptions.detectionMethod = detectionMethod;
        }
        if ((body === null || body === void 0 ? void 0 : body.useFFmpeg) || (body === null || body === void 0 ? void 0 : body.useFFmpegDetection)) {
            sceneOptions.detectionMethod = 'ffmpeg';
            sceneOptions.useFFmpegDetection = true;
        }
        else if ((body === null || body === void 0 ? void 0 : body.useFFmpeg) === false || (body === null || body === void 0 ? void 0 : body.useFFmpegDetection) === false) {
            sceneOptions.useFFmpegDetection = false;
        }
        return sceneOptions;
    }
    handlePostGenerateClips(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { videoPath } = req.body;
                if (!videoPath || (typeof videoPath !== 'string' && typeof videoPath !== 'number')) {
                    res.status(400).json({ error: 'Se requiere la ruta del video' });
                    return;
                }
                const sanitizedVideoPath = String(videoPath).trim();
                if (!sanitizedVideoPath) {
                    res.status(400).json({ error: 'Se requiere la ruta del video' });
                    return;
                }
                const sceneOptions = this.parseSceneOptions(req.body);
                const clipPaths = yield this.clipGenerator.generateClipsForVideo(sanitizedVideoPath, sceneOptions);
                const clipInfos = yield Promise.all(clipPaths.map((p) => __awaiter(this, void 0, void 0, function* () {
                    let duration = 0;
                    try {
                        duration = yield this.getVideoDurationFFprobe(p);
                    }
                    catch (e) {
                        console.warn(`No se pudo obtener la duración de ${p}:`, e);
                    }
                    return { path: p.replace(/\\/g, '/'), duration };
                })));
                res.json({ success: true, clipPaths, clipInfos, sceneOptions });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
    handlePostGenerateClipsFromFolder(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { folderPath = '' } = req.body;
                if (folderPath === undefined) {
                    res.status(400).json({ error: 'Se requiere la ruta de la carpeta' });
                    return;
                }
                const sceneOptions = this.parseSceneOptions(req.body);
                let videosDirectory;
                if (folderPath === '') {
                    videosDirectory = this.downloadDirectory;
                }
                else {
                    videosDirectory = path.join(this.downloadDirectory, String(folderPath));
                }
                if (!fs.existsSync(videosDirectory)) {
                    res.status(404).json({ error: `La carpeta ${folderPath} no existe` });
                    return;
                }
                const results = [];
                const processDirectory = (dirPath) => __awaiter(this, void 0, void 0, function* () {
                    var _a, e_1, _b, _c;
                    const dirHandle = yield fsp.opendir(dirPath);
                    try {
                        try {
                            for (var _d = true, dirHandle_1 = __asyncValues(dirHandle), dirHandle_1_1; dirHandle_1_1 = yield dirHandle_1.next(), _a = dirHandle_1_1.done, !_a; _d = true) {
                                _c = dirHandle_1_1.value;
                                _d = false;
                                const entry = _c;
                                const fullPath = path.join(dirPath, entry.name);
                                if (entry.isDirectory()) {
                                    yield processDirectory(fullPath);
                                }
                                else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                                    try {
                                        const clipPaths = yield this.clipGenerator.generateClipsForVideo(fullPath, sceneOptions);
                                        const clipInfos = yield Promise.all(clipPaths.map((clipPath) => __awaiter(this, void 0, void 0, function* () {
                                            let duration = 0;
                                            try {
                                                duration = yield this.getVideoDurationFFprobe(clipPath);
                                            }
                                            catch (infoError) {
                                                console.warn(`No se pudo obtener la duracion de ${clipPath}:`, infoError);
                                            }
                                            return { path: clipPath.replace(/\\/g, '/'), duration };
                                        })));
                                        results.push({
                                            videoPath: fullPath.replace(/\\/g, '/'),
                                            clipPaths: clipPaths.map(p => p.replace(/\\/g, '/')),
                                            clipInfos
                                        });
                                    }
                                    catch (videoError) {
                                        console.error(`Error generando clips para ${fullPath}:`, videoError);
                                    }
                                }
                            }
                        }
                        catch (e_1_1) { e_1 = { error: e_1_1 }; }
                        finally {
                            try {
                                if (!_d && !_a && (_b = dirHandle_1.return)) yield _b.call(dirHandle_1);
                            }
                            finally { if (e_1) throw e_1.error; }
                        }
                    }
                    finally {
                        yield dirHandle.close().catch(() => undefined);
                    }
                });
                yield processDirectory(videosDirectory);
                const clips = (yield this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
                this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });
                res.json({ success: true, results, sceneOptions });
            }
            catch (error) {
                console.error('Error en la generación de clips desde carpeta:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }
    handlePostDownloadAndClip(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { url, tags } = req.body;
                if (!url && (!tags || !Array.isArray(tags) || tags.length === 0)) {
                    res.status(400).json({ error: 'Se requiere una URL o etiquetas válidas' });
                    return;
                }
                const sceneOptions = this.parseSceneOptions(req.body);
                let results;
                if (url) {
                    console.log(`Procesando URL: ${url}`);
                    if (url.includes('/post?tags=')) {
                        const tagName = new URL(url).searchParams.get('tags') || '';
                        results = yield this.downloadTagsAndGenerateClips([tagName], sceneOptions);
                    }
                    else {
                        const clipPaths = yield this.downloadAndGenerateClips(String(url), [], sceneOptions);
                        results = new Map();
                        results.set(url, clipPaths);
                    }
                }
                else {
                    console.log(`Procesando etiquetas: ${tags.join(', ')}`);
                    results = yield this.downloadTagsAndGenerateClips(tags, sceneOptions);
                }
                const resultsObject = {};
                results.forEach((clips, video) => {
                    resultsObject[video] = clips;
                });
                res.json({ success: true, results: resultsObject, sceneOptions });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
    // Handler for listing subfolders in the clip directory
    handleListClipFolders(req, res) {
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
        }
        catch (error) {
            console.error(`Error reading directory ${clipsBaseDir}:`, error);
            res.status(500).json({ error: `Failed to list folders in ${clipsBaseDir}` });
        }
    }
    handleListRandomNameFolders(req, res) {
        const baseDir = this.randomNamesDirectory;
        if (!fs.existsSync(baseDir)) {
            res.status(200).json([]);
            return;
        }
        try {
            const entries = fs.readdirSync(baseDir, { withFileTypes: true });
            const folders = entries.filter(e => e.isDirectory()).map(e => e.name);
            res.json(folders);
        }
        catch (error) {
            console.error(`Error reading directory ${baseDir}:`, error);
            res.status(500).json({ error: `Failed to list folders in ${baseDir}` });
        }
    }
    // Handler for renaming videos using the Python script
    handleRenameVideos(req, res) {
        const { selectedFolders, outputSubfolder } = req.body;
        // Ensure the output subfolder ends with '_random'
        let sanitizedSubfolder = outputSubfolder ? outputSubfolder.trim() : '';
        if (sanitizedSubfolder === '') {
            res.status(400).json({
                status: "error",
                message: "Invalid request body. 'outputSubfolder' is required and must be a non-empty string."
            });
            return;
        }
        if (!sanitizedSubfolder.endsWith('_random')) {
            sanitizedSubfolder += '_random';
        }
        if (!selectedFolders || !Array.isArray(selectedFolders) || selectedFolders.length === 0) {
            res.status(400).json({
                status: "error",
                message: "Invalid request body. 'selectedFolders' is required and must be a non-empty array."
            });
            return;
        }
        const clipsBaseDir = this.clipDirectory; // output/clips
        const inputDirs = selectedFolders.map(folder => path.join(clipsBaseDir, folder));
        const outputDir = path.join(this.randomNamesDirectory, sanitizedSubfolder);
        // Ensure output directory for the script exists, though the script should also handle this
        try {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
        }
        catch (mkdirError) {
            console.error(`Error creating output directory ${outputDir}:`, mkdirError);
            res.status(500).json({
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
        }
        const pythonScriptPath = path.resolve(__dirname, '../rename_clips.py'); // Script is at project root
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
        const pythonProcess = (0, child_process_1.spawn)('python', [pythonScriptPath, ...scriptArgs]);
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
            }
            else {
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
    handlePostDeleteClip(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { clipPath } = req.body;
                if (!clipPath) {
                    res.status(400).json({ error: 'Se requiere la ruta del clip a eliminar' });
                    return;
                }
                // Construir la ruta completa al archivo
                const fullPath = path.join(this.clipDirectory, clipPath);
                console.log(`Intentando eliminar clip: ${fullPath}`);
                // Verificar que el archivo existe y que estÃ© dentro del directorio de clips (seguridad)
                if (!fs.existsSync(fullPath)) {
                    res.status(404).json({ error: 'Clip no encontrado' });
                    return;
                }
                // Comprobar que la ruta estÃ¡ dentro del directorio de clips permitido
                const normalizedClipDir = path.normalize(this.clipDirectory);
                const normalizedFullPath = path.normalize(fullPath);
                if (!normalizedFullPath.startsWith(normalizedClipDir)) {
                    res.status(403).json({ error: 'Acceso denegado: ruta de archivo no permitida' });
                    return;
                }
                // Eliminar el archivo
                fs.unlinkSync(fullPath);
                console.log(`Clip eliminado: ${clipPath}`);
                // Verificar si la carpeta del clip estÃ¡ vacÃ­a y eliminarla si lo estÃ¡
                const clipDir = path.dirname(fullPath);
                const remainingFiles = fs.readdirSync(clipDir);
                // Check if the directory is empty and is not the main clip directory
                if (remainingFiles.length === 0 && clipDir !== this.clipDirectory) {
                    try {
                        fs.rmdirSync(clipDir);
                        console.log(`Carpeta vacÃ­a eliminada: ${clipDir}`);
                    }
                    catch (rmDirError) {
                        console.warn(`No se pudo eliminar la carpeta vacÃ­a: ${clipDir}`, rmDirError);
                    }
                }
                // Actualizar la lista de clips y notificar a los clientes
                const clips = (yield this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
                this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });
                res.json({ success: true, message: 'Clip eliminado correctamente' });
            }
            catch (error) {
                console.error('Error al eliminar clip:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }
    /**
     * Maneja la solicitud para eliminar todos los clips de un video (carpeta)
     */
    handlePostDeleteClipsFolder(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
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
                const clips = (yield this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
                this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });
                res.json({ success: true, message: 'Clips eliminados correctamente' });
            }
            catch (error) {
                console.error('Error al eliminar carpeta de clips:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }
    /**
     * Maneja la solicitud para eliminar un video descargado
     */
    handlePostDeleteVideo(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
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
                            console.log(`Carpeta vacÃ­a eliminada: ${videoDir}`);
                        }
                        catch (e) {
                            console.warn(`No se pudo eliminar la carpeta vacÃ­a: ${videoDir}`, e);
                        }
                    }
                }
                const downloads = this.getDirectoryContents(this.downloadDirectory);
                this.io.emit('directoriesUpdated', { type: 'downloads', contents: downloads });
                res.json({ success: true, message: 'Video eliminado correctamente' });
            }
            catch (error) {
                console.error('Error al eliminar video:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }
    /**
     * Obtiene todas las carpetas disponibles en el directorio de descargas
     */
    handleGetDownloadFolders(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const folders = this.getDirectoryFolders(this.downloadDirectory);
                res.json(folders);
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
    /**
     * Obtiene los videos de una carpeta especÃ­fica
     */
    handleGetFolderVideos(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
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
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
    /**
     * Inicia el servidor Express
     */
    startServer() {
        this.server.listen(this.port, () => {
            console.log(`Servidor iniciado en http://localhost:${this.port}`);
        });
    }
    /**
     * Obtiene solo las carpetas de un directorio
     */
    getDirectoryFolders(directory) {
        if (!fs.existsSync(directory)) {
            return [];
        }
        const folders = [];
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
    getDirectoryContents(directory, baseFolder = '') {
        if (!fs.existsSync(directory)) {
            return [];
        }
        const contents = [];
        const processDirectory = (dir, relativePath = '') => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                let entryRelativePath;
                if (baseFolder) {
                    // Si hay una carpeta base, la incluimos en la ruta relativa
                    entryRelativePath = path.join(baseFolder, relativePath, entry.name);
                }
                else {
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
                }
                else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
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
     * Obtiene la duraciÃ³n de un video utilizando FFprobe
     */
    getVideoDurationFFprobe(videoPath) {
        return __awaiter(this, void 0, void 0, function* () {
            const ffprobePath = process.env.FFPROBE_PATH || ffprobe_static_1.default.path;
            return ffprobeCache_1.ffprobeCache.getDuration(videoPath, ffprobePath);
        });
    }
    /**
     * Obtiene el contenido de un directorio e incluye la duraciÃ³n de los videos
     */
    getDirectoryContentsWithDuration(directory_1) {
        return __awaiter(this, arguments, void 0, function* (directory, baseFolder = '') {
            const contents = [];
            if (!fs.existsSync(directory)) {
                return contents;
            }
            const processDirectory = (dir_1, ...args_1) => __awaiter(this, [dir_1, ...args_1], void 0, function* (dir, relativePath = '') {
                var _a, e_2, _b, _c;
                const dirHandle = yield fsp.opendir(dir);
                try {
                    try {
                        for (var _d = true, dirHandle_2 = __asyncValues(dirHandle), dirHandle_2_1; dirHandle_2_1 = yield dirHandle_2.next(), _a = dirHandle_2_1.done, !_a; _d = true) {
                            _c = dirHandle_2_1.value;
                            _d = false;
                            const entry = _c;
                            const fullPath = path.join(dir, entry.name);
                            const relativeToBase = relativePath ? path.join(relativePath, entry.name) : entry.name;
                            const entryRelativePath = baseFolder ? path.join(baseFolder, relativeToBase) : relativeToBase;
                            if (entry.isDirectory()) {
                                contents.push({
                                    name: entry.name,
                                    path: entryRelativePath,
                                    type: 'directory',
                                    size: 0
                                });
                                yield processDirectory(fullPath, relativeToBase);
                            }
                            else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                                const stats = yield fsp.stat(fullPath);
                                let duration = 0;
                                try {
                                    duration = yield this.getVideoDurationFFprobe(fullPath);
                                }
                                catch (e) {
                                    console.warn(`No se pudo obtener la duracion de ${fullPath}:`, e);
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
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_d && !_a && (_b = dirHandle_2.return)) yield _b.call(dirHandle_2);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                }
                finally {
                    yield dirHandle.close().catch(() => undefined);
                }
            });
            yield processDirectory(directory);
            return contents;
        });
    }
    /**
     * Descarga un video y luego genera clips basados en segmentos de tiempo especÃ­ficos
     * @param videoUrl URL del video a descargar
     * @param timeSegments Segmentos de tiempo [inicio, fin] en segundos
     * @returns Rutas de los clips generados
     */
    downloadAndGenerateClips(videoUrl_1, timeSegments_1) {
        return __awaiter(this, arguments, void 0, function* (videoUrl, timeSegments, sceneOptions = {}) {
            try {
                console.log(`Descargando video desde: ${videoUrl}`);
                const videoPath = yield this.downloader.downloadVideo(videoUrl);
                console.log(`Generando clips del video descargado: ${videoPath}`);
                if (timeSegments.length === 0) {
                    return yield this.clipGenerator.generateClipsForVideo(videoPath, sceneOptions);
                }
                const clipPaths = yield this.clipGenerator.generateMultipleClips(videoPath, timeSegments);
                return clipPaths;
            }
            catch (error) {
                console.error('Error en el proceso de descarga y generación de clips:', error);
                throw error;
            }
        });
    }
    /**
     * Descarga videos basados en etiquetas desde Sakugabooru y genera clips automÃ¡ticamente
     * @param tags Etiquetas para buscar en Sakugabooru
     * @param sceneOptions Opciones para la detecciÃ³n de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    downloadTagsAndGenerateClips(tags_1) {
        return __awaiter(this, arguments, void 0, function* (tags, sceneOptions = {}) {
            const resultsMap = new Map();
            const normalizedOptions = Object.assign({}, sceneOptions);
            if (normalizedOptions.useFFmpegDetection && !normalizedOptions.detectionMethod) {
                normalizedOptions.detectionMethod = 'ffmpeg';
            }
            for (const tag of tags) {
                try {
                    console.log(`Procesando etiqueta: ${tag}`);
                    const tagUrl = `${this.downloader['baseUrl']}/post?tags=${tag}`;
                    const videoPaths = yield this.downloader.downloadVideosFromTag(tagUrl);
                    for (const videoPath of videoPaths) {
                        try {
                            const clipPaths = yield this.clipGenerator.generateClipsForVideo(videoPath, normalizedOptions);
                            resultsMap.set(videoPath, clipPaths);
                        }
                        catch (clipError) {
                            console.error(`Error generando clips para ${videoPath}:`, clipError);
                        }
                    }
                }
                catch (error) {
                    console.error(`Error procesando la etiqueta ${tag}:`, error);
                }
            }
            return resultsMap;
        });
    }
    processTagsFileAndGenerateClips(tagsFilePath_1) {
        return __awaiter(this, arguments, void 0, function* (tagsFilePath, sceneOptions = {}) {
            try {
                if (!fs.existsSync(tagsFilePath)) {
                    throw new Error(`Archivo de etiquetas no encontrado: ${tagsFilePath}`);
                }
                const content = fs.readFileSync(tagsFilePath, 'utf-8').trim();
                if (!content) {
                    throw new Error('El archivo de etiquetas está vacío');
                }
                const tags = content.split(';')
                    .map(tag => tag.trim())
                    .filter(tag => tag.length > 0);
                return yield this.downloadTagsAndGenerateClips(tags, sceneOptions);
            }
            catch (error) {
                console.error('Error procesando archivo de etiquetas:', error);
                throw error;
            }
        });
    }
    processVideosDirectoryAndGenerateClips(videosDirectory_1) {
        return __awaiter(this, arguments, void 0, function* (videosDirectory, sceneOptions = {}) {
            const resultsMap = new Map();
            try {
                if (!fs.existsSync(videosDirectory)) {
                    console.error(`Error: Videos directory does not exist at ${videosDirectory}`);
                    throw new Error(`El directorio de videos no existe: ${videosDirectory}`);
                }
                const normalizedOptions = Object.assign({}, sceneOptions);
                if (normalizedOptions.useFFmpegDetection && !normalizedOptions.detectionMethod) {
                    normalizedOptions.detectionMethod = 'ffmpeg';
                }
                const processDirectory = (currentDirPath) => __awaiter(this, void 0, void 0, function* () {
                    const entries = fs.readdirSync(currentDirPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(currentDirPath, entry.name);
                        if (entry.isDirectory()) {
                            console.log(`Scanning subdirectory: ${fullPath}`);
                            yield processDirectory(fullPath);
                        }
                        else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                            console.log(`Procesando video: ${fullPath}`);
                            this.io.emit('clipGenerationStatus', { video: fullPath, status: 'processing' });
                            try {
                                const clipPaths = yield this.clipGenerator.generateClipsForVideo(fullPath, normalizedOptions);
                                this.io.emit('clipGenerationStatus', { video: fullPath, status: 'completed', clips: clipPaths.length });
                                resultsMap.set(fullPath, clipPaths);
                            }
                            catch (clipError) {
                                console.error(`Error generando clips para ${fullPath}:`, clipError);
                                this.io.emit('clipGenerationError', { video: fullPath, error: clipError.message });
                            }
                        }
                    }
                });
                yield processDirectory(videosDirectory);
            }
            catch (error) {
                console.error(`Error procesando directorio de videos: ${videosDirectory}`, error);
                this.io.emit('clipGenerationError', { directory: videosDirectory, error: error.message });
                throw error;
            }
            const clips = (yield this.getDirectoryContentsWithDuration(this.clipDirectory)).filter(item => item.type === 'video');
            this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });
            return resultsMap;
        });
    }
    /**
     * Handles audio analysis requests
     */
    handlePostAudioAnalyze(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!req.file) {
                res.status(400).json({ success: false, error: 'No audio file uploaded.' });
                return;
            }
            const audioFilePath = req.file.path;
            try {
                console.log(`Analyzing audio file: ${audioFilePath}`);
                const analysisResult = yield this.audioAnalyzer.analyzeBeats(audioFilePath);
                res.json({ success: true, analysis: analysisResult, audioFileName: path.basename(audioFilePath) });
            }
            catch (error) {
                console.error(`Error analyzing audio file ${audioFilePath}:`, error);
                res.status(500).json({ success: false, error: `Failed to analyze audio: ${error.message}` });
            }
        });
    }
    /**
     * Handles beat-matched video generation requests
     */
    handlePostGenerateBeatMatchedVideo(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { beatTimestamps, // array of numbers
                audioStartTime, // number
                audioEndTime, // number
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
                const generatedVideoPath = yield this.beatSyncGenerator.generateVideoFromAudioBeats(beatTimestamps, audioStartTime, audioEndTime, sourceClipFolderPaths, sanitizedOutputVideoName, this.randomNamesDirectory, audioFilePath);
                // Make path relative to the server's static serving for client access
                const relativeVideoPath = path.join('beat_synced_videos', sanitizedOutputVideoName).replace(/\\/g, '/');
                res.json({ success: true, videoPath: relativeVideoPath, absoluteVideoPath: generatedVideoPath });
                fs.unlink(audioFilePath, (err) => {
                    if (err) {
                        console.error(`Failed to delete temporary audio file ${audioFilePath}:`, err);
                    }
                });
            }
            catch (error) {
                console.error('Error generating beat-matched video:', error);
                res.status(500).json({ success: false, error: `Failed to generate beat-matched video: ${error.message}` });
            }
        });
    }
}
exports.SakugaDownAndClipGen = SakugaDownAndClipGen;
exports.default = SakugaDownAndClipGen;
