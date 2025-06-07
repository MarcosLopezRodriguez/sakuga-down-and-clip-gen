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
exports.Downloader = void 0;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const url_1 = require("url");
const cheerio = __importStar(require("cheerio"));
const events_1 = require("events");
class Downloader extends events_1.EventEmitter {
    constructor(baseUrl = 'https://www.sakugabooru.com', outputDirectory = 'output/downloads') {
        super();
        this.baseUrl = baseUrl;
        this.outputDirectory = outputDirectory;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };
        this.videoCounter = 1;
        this.downloadQueue = [];
        this.isProcessing = false;
        // Crear directorio de salida si no existe
        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory, { recursive: true });
        }
    }
    getTagFromUrl(url) {
        const parsed = (0, url_1.parse)(url, true);
        const tags = decodeURIComponent(parsed.query.tags || 'unknown');
        return this.sanitizeDirectoryName(tags.replace(/\s+/g, '_'));
    }
    sanitizeDirectoryName(name) {
        // Caracteres inválidos en Windows: < > : " | ? * \ /
        // También sanitizamos algunos otros caracteres problemáticos
        return name
            .replace(/[<>:"|?*\\\/]/g, '_') // Reemplazar caracteres inválidos con underscore
            .replace(/[^\w\-_.]/g, '_') // Reemplazar cualquier otro carácter no alfanumérico
            .replace(/_{2,}/g, '_') // Reemplazar múltiples underscores consecutivos con uno solo
            .replace(/^_+|_+$/g, '') // Remover underscores al inicio y final
            .substring(0, 100); // Limitar longitud (Windows tiene límite de 260 caracteres para rutas completas)
    }
    validateDirectoryName(name) {
        // Verificar que el nombre no esté vacío y no contenga caracteres inválidos
        if (!name || name.trim() === '') {
            return false;
        }
        // Verificar caracteres inválidos de Windows
        const invalidChars = /[<>:"|?*\\\/]/;
        return !invalidChars.test(name);
    }
    createDirectorySafely(dirPath) {
        try {
            console.log(`Creating directory: ${dirPath}`);
            // Verificar que el directorio padre existe
            const parentDir = path.dirname(dirPath);
            if (!fs.existsSync(parentDir)) {
                console.log(`Creating parent directory: ${parentDir}`);
                fs.mkdirSync(parentDir, { recursive: true });
            }
            // Crear el directorio si no existe
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`Directory created successfully: ${dirPath}`);
            }
            else {
                console.log(`Directory already exists: ${dirPath}`);
            }
        }
        catch (error) {
            console.error(`Error creating directory ${dirPath}:`, error);
            // Intentar con un nombre alternativo si el original falla
            const safeDirName = this.sanitizeDirectoryName(path.basename(dirPath));
            const fallbackPath = path.join(path.dirname(dirPath), safeDirName);
            if (fallbackPath !== dirPath) {
                console.log(`Attempting fallback directory: ${fallbackPath}`);
                try {
                    if (!fs.existsSync(fallbackPath)) {
                        fs.mkdirSync(fallbackPath, { recursive: true });
                        console.log(`Fallback directory created: ${fallbackPath}`);
                    }
                    return;
                }
                catch (fallbackError) {
                    console.error(`Fallback directory creation also failed:`, fallbackError);
                }
            }
            throw new Error(`Failed to create directory: ${dirPath}. ${error.message}`);
        }
    }
    validatePath(filePath) {
        try {
            // Verificar que la ruta no exceda los límites de Windows
            if (filePath.length > 260) {
                console.warn(`Path too long (${filePath.length} chars): ${filePath}`);
                return false;
            }
            // Verificar que no contenga caracteres inválidos
            const invalidChars = /[<>:"|?*]/;
            if (invalidChars.test(filePath)) {
                console.warn(`Invalid characters in path: ${filePath}`);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error(`Error validating path: ${filePath}`, error);
            return false;
        }
    }
    validateUrl(url) {
        try {
            // Use the URL constructor to validate instead of complex regex
            new URL(url);
            return true;
        }
        catch (err) {
            return false;
        }
    }
    getVideoPostsFromPage(url) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.validateUrl(url)) {
                    throw new Error('Invalid URL');
                }
                console.log(`Fetching posts from ${url}...`);
                const response = yield axios_1.default.get(url, {
                    headers: this.headers,
                    responseType: 'text', // Force response as text
                    timeout: 15000
                });
                // Make sure we have data before parsing
                if (!response.data) {
                    console.log(`No data returned from ${url}`);
                    return [];
                }
                // Safely parse with cheerio
                let $;
                try {
                    $ = cheerio.load(response.data);
                }
                catch (error) {
                    console.error(`Failed to parse HTML from ${url}:`, error);
                    return [];
                }
                if (!$) {
                    console.error(`Failed to initialize Cheerio for ${url}`);
                    return [];
                }
                // Find all post links
                const posts = [];
                try {
                    $('#post-list-posts li a[href*="/post/show/"]').each((_, element) => {
                        const href = $(element).attr('href');
                        if (href) {
                            posts.push(new URL(href, this.baseUrl).toString());
                        }
                    });
                }
                catch (error) {
                    console.error(`Error finding post links in ${url}:`, error);
                }
                console.log(`Found ${posts.length} posts on ${url}`);
                return posts;
            }
            catch (error) {
                console.error(`Error getting posts from page ${url}:`, error);
                return [];
            }
        });
    }
    getVideoUrlFromPost(postUrl) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.validateUrl(postUrl)) {
                    throw new Error('Invalid URL');
                }
                console.log(`Fetching video URL from ${postUrl}...`);
                const response = yield axios_1.default.get(postUrl, {
                    headers: this.headers,
                    responseType: 'text', // Force response as text
                    timeout: 15000
                });
                // Make sure we have data before parsing
                if (!response.data) {
                    console.log(`No data returned from ${postUrl}`);
                    return null;
                }
                // Safely parse with cheerio
                let $;
                try {
                    $ = cheerio.load(response.data);
                }
                catch (error) {
                    console.error(`Failed to parse HTML from ${postUrl}:`, error);
                    return null;
                }
                if (!$) {
                    console.error(`Failed to initialize Cheerio for ${postUrl}`);
                    return null;
                }
                // Find the video source
                let videoUrl = null;
                try {
                    const source = $('video source').first();
                    if (source.length && source.attr('src')) {
                        videoUrl = new URL(source.attr('src'), this.baseUrl).toString();
                    }
                }
                catch (error) {
                    console.error(`Error finding video source in ${postUrl}:`, error);
                }
                return videoUrl;
            }
            catch (error) {
                console.error(`Error getting video URL from post ${postUrl}:`, error);
                return null;
            }
        });
    }
    downloadVideo(url, customOutputDir) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                if (!this.validateUrl(url)) {
                    throw new Error('Invalid URL');
                }
                const outputDir = customOutputDir || this.outputDirectory;
                // Determinar si es una URL de Sakuga o una URL directa de video
                let videoUrl = url;
                let tag = 'custom';
                if (url.includes('sakugabooru.com')) {
                    if (url.includes('/post?tags=') || url.includes('/post/show/')) {
                        // Es una URL de búsqueda de tags o de un post específico
                        if (url.includes('/post?tags=')) {
                            tag = this.getTagFromUrl(url);
                            // Emitir evento de inicio de descarga
                            this.emit('downloadStarted', { url, tag, status: 'starting', message: `Iniciando descarga para etiqueta: ${tag}` });
                            const postUrls = yield this.getVideoPostsFromPage(url);
                            if (postUrls.length === 0) {
                                throw new Error('No posts found');
                            }
                            const postUrl = postUrls[0]; // Tomar el primer video
                            this.emit('downloadProgress', { url, tag, status: 'searching', message: `Obteniendo enlace de video desde post: ${postUrl}` });
                            const fetchedVideoUrl = yield this.getVideoUrlFromPost(postUrl);
                            if (!fetchedVideoUrl) {
                                throw new Error('No video found in post');
                            }
                            videoUrl = fetchedVideoUrl;
                        }
                        else {
                            // Es un post específico
                            const postId = ((_a = url.split('/post/show/')[1]) === null || _a === void 0 ? void 0 : _a.split('/')[0]) || 'unknown';
                            tag = this.sanitizeDirectoryName(`post_${postId}`);
                            // Emitir evento de inicio de descarga
                            this.emit('downloadStarted', { url, tag, status: 'starting', message: `Iniciando descarga para post: ${tag}` });
                            this.emit('downloadProgress', { url, tag, status: 'searching', message: `Obteniendo enlace de video desde post` });
                            const fetchedVideoUrl = yield this.getVideoUrlFromPost(url);
                            if (!fetchedVideoUrl) {
                                throw new Error('No video found in post');
                            }
                            videoUrl = fetchedVideoUrl;
                        }
                    }
                }
                else {
                    // URL directa de video, intentar extraer un nombre del dominio
                    const urlObj = new URL(url);
                    const hostname = urlObj.hostname.replace(/^www\./, '').split('.')[0] || 'video';
                    tag = this.sanitizeDirectoryName(hostname);
                    // Emitir evento de inicio de descarga
                    this.emit('downloadStarted', { url: videoUrl, tag, status: 'starting', message: `Iniciando descarga directa` });
                } // Crear directorio específico para el tag de forma segura
                const tagDir = path.join(outputDir, tag);
                this.createDirectorySafely(tagDir);
                // Obtener extensión del archivo original
                const originalFilename = path.basename(videoUrl);
                const originalExt = path.extname(originalFilename).toLowerCase();
                // Usar mp4 como formato por defecto, pero respetar la extensión original si es un formato de video
                const extension = ['.mp4', '.webm', '.mkv'].includes(originalExt) ? originalExt : '.mp4';
                // Crear nombre de archivo siguiendo el formato tag_número
                const newFilename = `${tag}_${this.videoCounter}${extension}`;
                const finalPath = path.join(tagDir, newFilename);
                // Verificar si el archivo ya existe
                if (fs.existsSync(finalPath)) {
                    console.log(`File already exists: ${newFilename}`);
                    this.videoCounter += 1;
                    // Emitir evento de descarga completada (para archivos que ya existen)
                    this.emit('downloadComplete', {
                        url: videoUrl,
                        tag,
                        status: 'complete',
                        message: `Archivo ya existe: ${newFilename}`,
                        filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                        fileSize: fs.statSync(finalPath).size,
                        fileName: newFilename
                    });
                    return finalPath;
                }
                // Descargar el archivo
                console.log(`Downloading: ${originalFilename} as ${newFilename}`);
                // Emitir evento de descarga en progreso
                this.emit('downloadProgress', {
                    url: videoUrl,
                    tag,
                    status: 'downloading',
                    message: `Descargando: ${originalFilename} como ${newFilename}`
                });
                const response = yield (0, axios_1.default)({
                    method: 'GET',
                    url: videoUrl,
                    responseType: 'stream',
                    headers: this.headers
                });
                // Obtener el tamaño total del archivo (si está disponible)
                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                let downloadedSize = 0;
                let lastProgress = 0;
                const writer = fs.createWriteStream(finalPath);
                // Monitorizar el progreso de la descarga
                response.data.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    // Reportar progreso cada 5%
                    if (totalSize > 0) {
                        const progress = Math.floor((downloadedSize / totalSize) * 100);
                        if (progress >= lastProgress + 5) {
                            lastProgress = progress;
                            this.emit('downloadProgress', {
                                url: videoUrl,
                                tag,
                                status: 'downloading',
                                message: `Descargando: ${originalFilename} (${progress}%)`,
                                progress
                            });
                        }
                    }
                });
                response.data.pipe(writer);
                return new Promise((resolve, reject) => {
                    writer.on('finish', () => {
                        console.log(`Saved as: ${newFilename}`);
                        this.videoCounter += 1;
                        // Emitir evento de descarga completada
                        this.emit('downloadComplete', {
                            url: videoUrl,
                            tag,
                            status: 'complete',
                            message: `Guardado como: ${newFilename}`,
                            filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                            fileSize: fs.statSync(finalPath).size,
                            fileName: newFilename
                        });
                        resolve(finalPath);
                    });
                    writer.on('error', (err) => {
                        console.error('Error downloading video:', err);
                        // Emitir evento de error
                        this.emit('downloadError', {
                            url: videoUrl,
                            tag,
                            status: 'error',
                            message: `Error en la descarga: ${err.message}`
                        });
                        reject(err);
                    });
                });
            }
            catch (error) {
                console.error(`Error downloading video ${url}:`, error);
                // Emitir evento de error
                this.emit('downloadError', {
                    url,
                    status: 'error',
                    message: `Error en la descarga: ${error.message}`
                });
                throw error;
            }
        });
    }
    downloadVideosFromTag(tagUrl_1) {
        return __awaiter(this, arguments, void 0, function* (tagUrl, outputDir = this.outputDirectory) {
            this.videoCounter = 1; // Reset counter for new tag
            const tag = this.getTagFromUrl(tagUrl);
            let page = 1;
            const downloadedPaths = [];
            console.log(`\n===== Processing: ${tag} =====`);
            // Emitir evento de inicio de procesamiento de etiqueta
            this.emit('tagProcessingStarted', { tag, message: `Iniciando procesamiento de etiqueta: ${tag}` });
            try {
                while (true) {
                    const currentUrl = `${tagUrl}&page=${page}`;
                    console.log(`Processing page ${page}...`);
                    // Emitir evento de progreso
                    this.emit('downloadProgress', {
                        url: tagUrl,
                        tag,
                        status: 'searching',
                        message: `Procesando página ${page}...`
                    });
                    const postUrls = yield this.getVideoPostsFromPage(currentUrl);
                    if (!postUrls.length) {
                        break;
                    }
                    // Emitir evento con los posts encontrados
                    this.emit('postsFound', {
                        tag,
                        count: postUrls.length,
                        message: `Encontrados ${postUrls.length} posts en página ${page}`
                    });
                    for (const postUrl of postUrls) {
                        try {
                            const videoUrl = yield this.getVideoUrlFromPost(postUrl);
                            if (videoUrl) {
                                // Crear directorio específico para el tag de forma segura
                                const tagDir = path.join(outputDir, tag);
                                this.createDirectorySafely(tagDir);
                                // Obtener extensión del archivo original
                                const originalFilename = path.basename(videoUrl);
                                const originalExt = path.extname(originalFilename).toLowerCase();
                                // Usar mp4 como formato por defecto, pero respetar la extensión original si es un formato de video
                                const extension = ['.mp4', '.webm', '.mkv'].includes(originalExt) ? originalExt : '.mp4';
                                // Crear nombre de archivo siguiendo el formato tag_número
                                const newFilename = `${tag}_${this.videoCounter}${extension}`;
                                const finalPath = path.join(tagDir, newFilename);
                                // Verificar si el archivo ya existe
                                if (fs.existsSync(finalPath)) {
                                    console.log(`File already exists: ${newFilename}`);
                                    this.videoCounter += 1;
                                    // Emitir evento de descarga completada (para archivos que ya existen)
                                    this.emit('downloadComplete', {
                                        url: videoUrl,
                                        tag,
                                        status: 'complete',
                                        message: `Archivo ya existe: ${newFilename}`,
                                        filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                                        fileSize: fs.statSync(finalPath).size,
                                        fileName: newFilename
                                    });
                                    downloadedPaths.push(finalPath);
                                    continue;
                                }
                                // Descargar el archivo
                                console.log(`Downloading: ${originalFilename} as ${newFilename}`);
                                // Emitir evento de descarga en progreso
                                this.emit('downloadProgress', {
                                    url: videoUrl,
                                    tag,
                                    status: 'downloading',
                                    message: `Descargando: ${originalFilename} como ${newFilename}`
                                });
                                const response = yield (0, axios_1.default)({
                                    method: 'GET',
                                    url: videoUrl,
                                    responseType: 'stream',
                                    headers: this.headers
                                });
                                // Obtener el tamaño total del archivo (si está disponible)
                                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                                let downloadedSize = 0;
                                let lastProgress = 0;
                                const writer = fs.createWriteStream(finalPath);
                                // Monitorizar el progreso de la descarga
                                response.data.on('data', (chunk) => {
                                    downloadedSize += chunk.length;
                                    // Reportar progreso cada 5%
                                    if (totalSize > 0) {
                                        const progress = Math.floor((downloadedSize / totalSize) * 100);
                                        if (progress >= lastProgress + 5) {
                                            lastProgress = progress;
                                            this.emit('downloadProgress', {
                                                url: videoUrl,
                                                tag,
                                                status: 'downloading',
                                                message: `Descargando: ${originalFilename} (${progress}%)`,
                                                progress
                                            });
                                        }
                                    }
                                });
                                response.data.pipe(writer);
                                // Esperar a que termine la descarga
                                yield new Promise((resolve, reject) => {
                                    writer.on('finish', () => {
                                        console.log(`Saved as: ${newFilename}`);
                                        this.videoCounter += 1;
                                        // Emitir evento de descarga completada
                                        this.emit('downloadComplete', {
                                            url: videoUrl,
                                            tag,
                                            status: 'complete',
                                            message: `Guardado como: ${newFilename}`,
                                            filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                                            fileSize: fs.statSync(finalPath).size,
                                            fileName: newFilename
                                        });
                                        resolve();
                                    });
                                    writer.on('error', (err) => {
                                        console.error('Error downloading video:', err);
                                        // Emitir evento de error
                                        this.emit('downloadError', {
                                            url: videoUrl,
                                            tag,
                                            status: 'error',
                                            message: `Error en la descarga: ${err.message}`
                                        });
                                        reject(err);
                                    });
                                });
                                downloadedPaths.push(finalPath);
                                yield this.sleep(100); // Short pause between downloads
                            }
                        }
                        catch (postError) {
                            console.error(`Error processing post ${postUrl}:`, postError);
                            this.emit('downloadError', {
                                url: postUrl,
                                tag,
                                status: 'error',
                                message: `Error procesando post: ${postError.message}`
                            });
                        }
                    }
                    page += 1;
                    yield this.sleep(200); // Short pause between pages
                }
                // Emitir evento de finalización de procesamiento de etiqueta
                this.emit('tagProcessingComplete', {
                    tag,
                    count: downloadedPaths.length,
                    message: `Completado procesamiento de etiqueta: ${tag}. ${downloadedPaths.length} videos descargados.`
                });
            }
            catch (error) {
                console.error(`Error processing tag ${tag}:`, error);
                this.emit('downloadError', {
                    tag,
                    status: 'error',
                    message: `Error procesando etiqueta ${tag}: ${error.message}`
                });
            }
            return downloadedPaths;
        });
    }
    processTagsFromFile(tagsFilePath_1) {
        return __awaiter(this, arguments, void 0, function* (tagsFilePath, outputDir = this.outputDirectory) {
            try {
                if (!fs.existsSync(tagsFilePath)) {
                    throw new Error(`Tags file '${tagsFilePath}' not found.`);
                }
                const content = fs.readFileSync(tagsFilePath, 'utf-8').trim();
                if (!content) {
                    throw new Error("Tags file is empty.");
                }
                const tags = content.split(';');
                const allDownloadedPaths = [];
                for (const tag of tags) {
                    const trimmedTag = tag.trim();
                    if (!trimmedTag) {
                        continue;
                    }
                    const tagUrl = `${this.baseUrl}/post?tags=${trimmedTag}`;
                    const downloadedPaths = yield this.downloadVideosFromTag(tagUrl, outputDir);
                    allDownloadedPaths.push(...downloadedPaths);
                }
                return allDownloadedPaths;
            }
            catch (error) {
                console.error(`Error processing tags file:`, error);
                throw error;
            }
        });
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.Downloader = Downloader;
exports.default = Downloader;
