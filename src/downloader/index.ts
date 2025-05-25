import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { parse as urlParse } from 'url';
import * as cheerio from 'cheerio';
import { EventEmitter } from 'events';

export class Downloader extends EventEmitter {
    private baseUrl: string;
    private outputDirectory: string;
    private headers: Record<string, string>;
    private videoCounter: number;
    private downloadQueue: { url: string; tag: string; status: string }[];
    private isProcessing: boolean;

    constructor(baseUrl: string = 'https://www.sakugabooru.com', outputDirectory: string = 'output/downloads') {
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

    private getTagFromUrl(url: string): string {
        const parsed = urlParse(url, true);
        const tags = decodeURIComponent(parsed.query.tags as string || 'unknown');
        return this.sanitizeDirectoryName(tags.replace(/\s+/g, '_'));
    }

    private sanitizeDirectoryName(name: string): string {
        // Caracteres inválidos en Windows: < > : " | ? * \ /
        // También sanitizamos algunos otros caracteres problemáticos
        return name
            .replace(/[<>:"|?*\\\/]/g, '_')  // Reemplazar caracteres inválidos con underscore
            .replace(/[^\w\-_.]/g, '_')      // Reemplazar cualquier otro carácter no alfanumérico
            .replace(/_{2,}/g, '_')          // Reemplazar múltiples underscores consecutivos con uno solo
            .replace(/^_+|_+$/g, '')         // Remover underscores al inicio y final
            .substring(0, 100);              // Limitar longitud (Windows tiene límite de 260 caracteres para rutas completas)
    }

    private validateDirectoryName(name: string): boolean {
        // Verificar que el nombre no esté vacío y no contenga caracteres inválidos
        if (!name || name.trim() === '') {
            return false;
        }

        // Verificar caracteres inválidos de Windows
        const invalidChars = /[<>:"|?*\\\/]/;
        return !invalidChars.test(name);
    }

    private createDirectorySafely(dirPath: string): void {
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
            } else {
                console.log(`Directory already exists: ${dirPath}`);
            }
        } catch (error: any) {
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
                } catch (fallbackError) {
                    console.error(`Fallback directory creation also failed:`, fallbackError);
                }
            }

            throw new Error(`Failed to create directory: ${dirPath}. ${error.message}`);
        }
    }

    private validatePath(filePath: string): boolean {
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
        } catch (error) {
            console.error(`Error validating path: ${filePath}`, error);
            return false;
        }
    }

    private validateUrl(url: string): boolean {
        try {
            // Use the URL constructor to validate instead of complex regex
            new URL(url);
            return true;
        } catch (err) {
            return false;
        }
    }

    async getVideoPostsFromPage(url: string): Promise<string[]> {
        try {
            if (!this.validateUrl(url)) {
                throw new Error('Invalid URL');
            }

            console.log(`Fetching posts from ${url}...`);

            const response = await axios.get(url, {
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
            } catch (error) {
                console.error(`Failed to parse HTML from ${url}:`, error);
                return [];
            }

            if (!$) {
                console.error(`Failed to initialize Cheerio for ${url}`);
                return [];
            }

            // Find all post links
            const posts: string[] = [];
            try {
                $('#post-list-posts li a[href*="/post/show/"]').each((_, element) => {
                    const href = $(element).attr('href');
                    if (href) {
                        posts.push(new URL(href, this.baseUrl).toString());
                    }
                });
            } catch (error) {
                console.error(`Error finding post links in ${url}:`, error);
            }

            console.log(`Found ${posts.length} posts on ${url}`);
            return posts;
        } catch (error) {
            console.error(`Error getting posts from page ${url}:`, error);
            return [];
        }
    }

    async getVideoUrlFromPost(postUrl: string): Promise<string | null> {
        try {
            if (!this.validateUrl(postUrl)) {
                throw new Error('Invalid URL');
            }

            console.log(`Fetching video URL from ${postUrl}...`);

            const response = await axios.get(postUrl, {
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
            } catch (error) {
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
                    videoUrl = new URL(source.attr('src') as string, this.baseUrl).toString();
                }
            } catch (error) {
                console.error(`Error finding video source in ${postUrl}:`, error);
            }

            return videoUrl;
        } catch (error) {
            console.error(`Error getting video URL from post ${postUrl}:`, error);
            return null;
        }
    }

    async downloadVideo(url: string, customOutputDir?: string): Promise<string> {
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

                        const postUrls = await this.getVideoPostsFromPage(url);
                        if (postUrls.length === 0) {
                            throw new Error('No posts found');
                        }
                        const postUrl = postUrls[0]; // Tomar el primer video

                        this.emit('downloadProgress', { url, tag, status: 'searching', message: `Obteniendo enlace de video desde post: ${postUrl}` });

                        const fetchedVideoUrl = await this.getVideoUrlFromPost(postUrl);
                        if (!fetchedVideoUrl) {
                            throw new Error('No video found in post');
                        }
                        videoUrl = fetchedVideoUrl;
                    } else {
                        // Es un post específico
                        const postId = url.split('/post/show/')[1]?.split('/')[0] || 'unknown';
                        tag = this.sanitizeDirectoryName(`post_${postId}`);

                        // Emitir evento de inicio de descarga
                        this.emit('downloadStarted', { url, tag, status: 'starting', message: `Iniciando descarga para post: ${tag}` });

                        this.emit('downloadProgress', { url, tag, status: 'searching', message: `Obteniendo enlace de video desde post` });

                        const fetchedVideoUrl = await this.getVideoUrlFromPost(url);
                        if (!fetchedVideoUrl) {
                            throw new Error('No video found in post');
                        }
                        videoUrl = fetchedVideoUrl;
                    }
                }
            } else {
                // URL directa de video, intentar extraer un nombre del dominio
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.replace(/^www\./, '').split('.')[0] || 'video';
                tag = this.sanitizeDirectoryName(hostname);

                // Emitir evento de inicio de descarga
                this.emit('downloadStarted', { url: videoUrl, tag, status: 'starting', message: `Iniciando descarga directa` });
            }            // Crear directorio específico para el tag de forma segura
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

            const response = await axios({
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
            response.data.on('data', (chunk: Buffer) => {
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
        } catch (error: any) {
            console.error(`Error downloading video ${url}:`, error);

            // Emitir evento de error
            this.emit('downloadError', {
                url,
                status: 'error',
                message: `Error en la descarga: ${error.message}`
            });

            throw error;
        }
    }

    async downloadVideosFromTag(tagUrl: string, outputDir: string = this.outputDirectory): Promise<string[]> {
        this.videoCounter = 1;  // Reset counter for new tag
        const tag = this.getTagFromUrl(tagUrl);
        let page = 1;
        const downloadedPaths: string[] = [];

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

                const postUrls = await this.getVideoPostsFromPage(currentUrl);
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
                        const videoUrl = await this.getVideoUrlFromPost(postUrl);
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

                            const response = await axios({
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
                            response.data.on('data', (chunk: Buffer) => {
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
                            await new Promise<void>((resolve, reject) => {
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
                            await this.sleep(1000);  // Be nice to the server
                        }
                    } catch (postError: any) {
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
                await this.sleep(2000);  // Be nice to the server between pages
            }

            // Emitir evento de finalización de procesamiento de etiqueta
            this.emit('tagProcessingComplete', {
                tag,
                count: downloadedPaths.length,
                message: `Completado procesamiento de etiqueta: ${tag}. ${downloadedPaths.length} videos descargados.`
            });

        } catch (error: any) {
            console.error(`Error processing tag ${tag}:`, error);
            this.emit('downloadError', {
                tag,
                status: 'error',
                message: `Error procesando etiqueta ${tag}: ${error.message}`
            });
        }

        return downloadedPaths;
    }

    async processTagsFromFile(tagsFilePath: string, outputDir: string = this.outputDirectory): Promise<string[]> {
        try {
            if (!fs.existsSync(tagsFilePath)) {
                throw new Error(`Tags file '${tagsFilePath}' not found.`);
            }

            const content = fs.readFileSync(tagsFilePath, 'utf-8').trim();

            if (!content) {
                throw new Error("Tags file is empty.");
            }

            const tags = content.split(';');
            const allDownloadedPaths: string[] = [];

            for (const tag of tags) {
                const trimmedTag = tag.trim();
                if (!trimmedTag) {
                    continue;
                }

                const tagUrl = `${this.baseUrl}/post?tags=${trimmedTag}`;
                const downloadedPaths = await this.downloadVideosFromTag(tagUrl, outputDir);
                allDownloadedPaths.push(...downloadedPaths);
            }

            return allDownloadedPaths;
        } catch (error) {
            console.error(`Error processing tags file:`, error);
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default Downloader;