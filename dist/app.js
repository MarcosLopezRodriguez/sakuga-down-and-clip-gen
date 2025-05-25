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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SakugaDownAndClipGen = void 0;
const express_1 = __importDefault(require("express"));
const downloader_1 = require("./downloader");
const clipGenerator_1 = require("./clipGenerator");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
class SakugaDownAndClipGen {
    constructor(downloadDirectory = 'output/downloads', clipDirectory = 'output/clips', port = 3000) {
        this.downloader = new downloader_1.Downloader('https://www.sakugabooru.com', downloadDirectory);
        this.clipGenerator = new clipGenerator_1.ClipGenerator(clipDirectory);
        this.port = port;
        this.downloadDirectory = downloadDirectory;
        this.clipDirectory = clipDirectory;
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
        this.setupExpressApp();
    }
    /**
     * Configura los eventos de WebSockets
     */
    setupWebSockets() {
        this.io.on('connection', (socket) => {
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
    setupExpressApp() {
        // Middleware para procesar JSON
        this.app.use(express_1.default.json());
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Servir archivos estáticos
        this.app.use(express_1.default.static(path.join(__dirname, '../public')));
        // Servir los videos y clips descargados
        this.app.use('/downloads', express_1.default.static(this.downloadDirectory));
        this.app.use('/clips', express_1.default.static(this.clipDirectory));
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
        const clips = this.getDirectoryContents(this.clipDirectory);
        res.json(clips);
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
                // La notificación se manejará a través de WebSockets
            }
            catch (error) {
                // Si ya se envió la respuesta, notificar el error por WebSocket
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
                    res.status(400).json({ error: 'Se requieren etiquetas válidas' });
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
                // Las notificaciones se manejarán a través de WebSockets
            }
            catch (error) {
                // Si ya se envió la respuesta, notificar el error por WebSocket
                if (res.headersSent) {
                    this.io.emit('downloadError', { error: error.message });
                }
                else {
                    res.status(500).json({ error: error.message });
                }
            }
        });
    }
    handlePostGenerateClips(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
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
                const clipPaths = yield this.clipGenerator.detectScenesAndGenerateClips(videoPath, sceneOptions);
                res.json({ success: true, clipPaths });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
    handlePostGenerateClipsFromFolder(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { folderPath, minDuration, maxDuration, threshold, useFFmpeg } = req.body;
                if (!folderPath) {
                    res.status(400).json({ error: 'Se requiere la ruta de la carpeta' });
                    return;
                }
                // Determinar la ruta completa del directorio
                let videosDirectory;
                if (folderPath === '') {
                    // Si no se especifica una carpeta, usar el directorio de descargas completo
                    videosDirectory = this.downloadDirectory;
                }
                else {
                    // Si se especifica una carpeta, construir la ruta
                    videosDirectory = path.join(this.downloadDirectory, folderPath);
                }
                if (!fs.existsSync(videosDirectory)) {
                    res.status(404).json({ error: `La carpeta ${folderPath} no existe` });
                    return;
                }
                // Crear un mock request y response para reutilizar handlePostGenerateClips
                const results = [];
                const processDirectory = (dirPath) => __awaiter(this, void 0, void 0, function* () {
                    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dirPath, entry.name);
                        if (entry.isDirectory()) {
                            // Procesar subdirectorios recursivamente
                            yield processDirectory(fullPath);
                        }
                        else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                            // Crear un mock request para cada video
                            const mockReq = {
                                body: {
                                    videoPath: fullPath,
                                    minDuration,
                                    maxDuration,
                                    threshold,
                                    useFFmpeg
                                }
                            };
                            // Crear un mock response para capturar el resultado
                            let responseData;
                            const mockRes = {
                                json: (data) => {
                                    responseData = data;
                                    return mockRes;
                                },
                                status: (code) => mockRes
                            };
                            // Procesar el video usando handlePostGenerateClips
                            yield this.handlePostGenerateClips(mockReq, mockRes);
                            if (responseData && responseData.success) {
                                results.push({
                                    videoPath: fullPath.replace(/\\/g, '/'),
                                    clipPaths: responseData.clipPaths.map((p) => p.replace(/\\/g, '/'))
                                });
                            }
                        }
                    }
                });
                yield processDirectory(videosDirectory);
                // Notificar la actualización de la lista de clips
                const clips = this.getDirectoryContents(this.clipDirectory);
                this.io.emit('directoriesUpdated', { type: 'clips', contents: clips });
                res.json({ success: true, results });
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
                let results;
                if (url) {
                    console.log(`Procesando URL: ${url}`);
                    if (url.includes('/post?tags=')) {
                        const tagName = new URL(url).searchParams.get('tags') || '';
                        results = yield this.downloadTagsAndGenerateClips([tagName], sceneOptions);
                    }
                    else {
                        const clipPaths = yield this.downloadAndGenerateClips(url, []);
                        results = new Map();
                        results.set(url, clipPaths);
                    }
                }
                else {
                    console.log(`Procesando etiquetas: ${tags.join(', ')}`);
                    results = yield this.downloadTagsAndGenerateClips(tags, sceneOptions);
                }
                // Convertir el Map a un objeto para la respuesta JSON
                const resultsObject = {};
                results.forEach((clips, video) => {
                    resultsObject[video] = clips;
                });
                res.json({ success: true, results: resultsObject });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
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
                    }
                    catch (rmDirError) {
                        console.warn(`No se pudo eliminar la carpeta vacía: ${clipDir}`, rmDirError);
                    }
                }
                // Actualizar la lista de clips y notificar a los clientes
                const clips = this.getDirectoryContents(this.clipDirectory);
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
     * Obtiene los videos de una carpeta específica
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
     * Descarga un video y luego genera clips basados en segmentos de tiempo específicos
     * @param videoUrl URL del video a descargar
     * @param timeSegments Segmentos de tiempo [inicio, fin] en segundos
     * @returns Rutas de los clips generados
     */
    downloadAndGenerateClips(videoUrl, timeSegments) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // 1. Descargar el video
                console.log(`Descargando video desde: ${videoUrl}`);
                const videoPath = yield this.downloader.downloadVideo(videoUrl);
                // 2. Generar clips del video descargado
                console.log(`Generando clips del video descargado: ${videoPath}`);
                // Si no se proporcionan segmentos, detectar escenas automáticamente
                if (timeSegments.length === 0) {
                    return yield this.clipGenerator.detectScenesAndGenerateClips(videoPath);
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
     * Descarga videos basados en etiquetas desde Sakugabooru y genera clips automáticamente
     * @param tags Etiquetas para buscar en Sakugabooru
     * @param sceneOptions Opciones para la detección de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    downloadTagsAndGenerateClips(tags_1) {
        return __awaiter(this, arguments, void 0, function* (tags, sceneOptions = {}) {
            const resultsMap = new Map();
            for (const tag of tags) {
                try {
                    console.log(`Procesando etiqueta: ${tag}`);
                    const tagUrl = `${this.downloader['baseUrl']}/post?tags=${tag}`;
                    // Descargar videos para esta etiqueta
                    const videoPaths = yield this.downloader.downloadVideosFromTag(tagUrl);
                    // Para cada video descargado, generar clips
                    for (const videoPath of videoPaths) {
                        let clipPaths;
                        if (sceneOptions.useFFmpegDetection) {
                            // Usar FFmpeg para detección de escenas
                            clipPaths = yield this.clipGenerator.detectScenesWithFFmpegAndGenerateClips(videoPath, sceneOptions);
                        }
                        else {
                            // Usar PySceneDetect para detección de escenas
                            clipPaths = yield this.clipGenerator.detectScenesAndGenerateClips(videoPath, sceneOptions);
                        }
                        resultsMap.set(videoPath, clipPaths);
                    }
                }
                catch (error) {
                    console.error(`Error procesando la etiqueta ${tag}:`, error);
                }
            }
            return resultsMap;
        });
    }
    /**
     * Procesa un archivo de etiquetas para descargar videos y generar clips
     * @param tagsFilePath Ruta al archivo de etiquetas (separadas por punto y coma)
     * @param sceneOptions Opciones para la detección de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    processTagsFileAndGenerateClips(tagsFilePath_1) {
        return __awaiter(this, arguments, void 0, function* (tagsFilePath, sceneOptions = {}) {
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
                return yield this.downloadTagsAndGenerateClips(tags, sceneOptions);
            }
            catch (error) {
                console.error(`Error procesando archivo de etiquetas:`, error);
                throw error;
            }
        });
    }
    /**
     * Procesa videos ya descargados y genera clips
     * @param videosDirectory Directorio que contiene videos ya descargados
     * @param sceneOptions Opciones para la detección de escenas
     * @returns Mapa de rutas de video a rutas de clips generados
     */
    processVideosDirectoryAndGenerateClips(videosDirectory_1) {
        return __awaiter(this, arguments, void 0, function* (videosDirectory, sceneOptions = {}) {
            const resultsMap = new Map();
            try {
                if (!fs.existsSync(videosDirectory)) {
                    throw new Error(`El directorio de videos no existe: ${videosDirectory}`);
                }
                // Leer todos los archivos del directorio
                const processDirectory = (dirPath) => __awaiter(this, void 0, void 0, function* () {
                    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dirPath, entry.name);
                        if (entry.isDirectory()) {
                            // Procesar subdirectorios recursivamente
                            yield processDirectory(fullPath);
                        }
                        else if (entry.isFile() && /\.(mp4|webm|mkv)$/i.test(entry.name)) {
                            // Procesar archivos de video
                            console.log(`Procesando video: ${fullPath}`);
                            let clipPaths;
                            if (sceneOptions.useFFmpegDetection) {
                                // Usar FFmpeg para detección de escenas
                                clipPaths = yield this.clipGenerator.detectScenesWithFFmpegAndGenerateClips(fullPath, sceneOptions);
                            }
                            else {
                                // Usar PySceneDetect para detección de escenas
                                clipPaths = yield this.clipGenerator.detectScenesAndGenerateClips(fullPath, sceneOptions);
                            }
                            resultsMap.set(fullPath, clipPaths);
                        }
                    }
                });
                yield processDirectory(videosDirectory);
            }
            catch (error) {
                console.error(`Error procesando directorio de videos:`, error);
                throw error;
            }
            return resultsMap;
        });
    }
}
exports.SakugaDownAndClipGen = SakugaDownAndClipGen;
exports.default = SakugaDownAndClipGen;
