import * as fs from 'fs';
const fsp = fs.promises;
import * as path from 'path';
import { parse as urlParse } from 'url';
import * as cheerio from 'cheerio';
import { RateLimitedHttpClient } from '../utils/httpClient';
import { EventEmitter } from 'events';
import { logger } from '../utils';


export class Downloader extends EventEmitter {
    private baseUrl: string;
    private outputDirectory: string;
    private headers: Record<string, string>;
    private videoCounter: number;
    private downloadQueue: { url: string; tag: string; status: string }[];
    private isProcessing: boolean;
    private httpClient: RateLimitedHttpClient;
    private httpSessionPrimed = false;

    constructor(baseUrl: string = 'https://www.sakugabooru.com', outputDirectory: string = 'output/downloads') {
        super();
        this.baseUrl = baseUrl;
        this.outputDirectory = outputDirectory;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: `${baseUrl}/`,
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache'
        };
        this.videoCounter = 1;
        this.downloadQueue = [];
        this.isProcessing = false;

        const minDelayMs = Number(process.env.SAKUGA_HTTP_MIN_DELAY_MS || '1200');
        const jitterMs = Number(process.env.SAKUGA_HTTP_JITTER_MS || '350');
        const maxRetries = Number(process.env.SAKUGA_HTTP_MAX_RETRIES || '4');
        const backoffFactor = Number(process.env.SAKUGA_HTTP_BACKOFF_FACTOR || '1.8');
        const maxBackoffMs = Number(process.env.SAKUGA_HTTP_MAX_BACKOFF_MS || '20000');
        const timeoutMs = Number(process.env.SAKUGA_HTTP_TIMEOUT_MS || '15000');
        const playwrightWaitMs = Number(process.env.SAKUGA_PLAYWRIGHT_WAIT_MS || '4500');
        const playwrightNavTimeoutMs = Number(process.env.SAKUGA_PLAYWRIGHT_NAV_TIMEOUT_MS || '30000');
        const usePlaywright = process.env.SAKUGA_USE_PLAYWRIGHT === 'true';
        const cookieUrl = process.env.SAKUGA_COOKIE_URL || `${baseUrl}`;

        this.httpClient = new RateLimitedHttpClient({
            baseURL: baseUrl,
            headers: this.headers,
            minDelayMs,
            randomJitterMs: jitterMs,
            maxRetries,
            backoffFactor,
            maxBackoffMs,
            requestTimeoutMs: timeoutMs,
            usePlaywright,
            cookieRefreshUrl: cookieUrl,
            playwrightWaitMs,
            playwrightNavigationTimeoutMs: playwrightNavTimeoutMs,
            logger: (message) => logger.debug(`[DownloaderHttp] ${message}`)
        });

        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory, { recursive: true });
        }

        if (usePlaywright) {
            this.httpClient.primeSession()
                .then(() => { this.httpSessionPrimed = true; })
                .catch(err => {
                    logger.warn('Unable to prime HTTP session via Playwright:', err?.message || err);
                    this.httpSessionPrimed = false;
                });
        }
    }

    private async ensureHttpSession(): Promise<void> {
        if (this.httpSessionPrimed) {
            return;
        }
        this.httpSessionPrimed = true;
        try {
            await this.httpClient.primeSession();
        } catch (err: any) {
            this.httpSessionPrimed = false;
            logger.warn('Failed to prepare HTTP session:', err?.message || err);
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

    private async createDirectorySafely(dirPath: string): Promise<void> {
        try {
            logger.debug(`Creating directory: ${dirPath}`);
            await fsp.mkdir(dirPath, { recursive: true });
            logger.debug(`Directory ensured: ${dirPath}`);
        } catch (error: any) {
            logger.error(`Error creating directory ${dirPath}:`, error);

            const safeDirName = this.sanitizeDirectoryName(path.basename(dirPath));
            const fallbackPath = path.join(path.dirname(dirPath), safeDirName);

            if (fallbackPath !== dirPath) {
                logger.info(`Attempting fallback directory: ${fallbackPath}`);
                try {
                    await fsp.mkdir(fallbackPath, { recursive: true });
                    logger.info(`Fallback directory created: ${fallbackPath}`);
                    return;
                } catch (fallbackError) {
                    logger.error(`Fallback directory creation also failed:`, fallbackError);
                }
            }

            throw new Error(`Failed to create directory: ${dirPath}. ${error.message}`);
        }
    }

    private validatePath(filePath: string): boolean {
        try {
            // Verificar que la ruta no exceda los límites de Windows
            if (filePath.length > 260) {
                logger.warn(`Path too long (${filePath.length} chars): ${filePath}`);
                return false;
            }

            // Verificar que no contenga caracteres inválidos
            const invalidChars = /[<>:"|?*]/;
            if (invalidChars.test(filePath)) {
                logger.warn(`Invalid characters in path: ${filePath}`);
                return false;
            }

            return true;
        } catch (error) {
            logger.error(`Error validating path: ${filePath}`, error);
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

            logger.info(`Fetching posts from ${url}...`);

            await this.ensureHttpSession();

            const response = await this.httpClient.request<string>({
                url,
                method: 'GET',
                responseType: 'text'
            });

            // Make sure we have data before parsing
            if (!response.data) {
                logger.warn(`No data returned from ${url}`);
                return [];
            }

            // Safely parse with cheerio
            let $;
            try {
                $ = cheerio.load(response.data);
            } catch (error) {
                logger.error(`Failed to parse HTML from ${url}:`, error);
                return [];
            }

            if (!$) {
                logger.error(`Failed to initialize Cheerio for ${url}`);
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
                logger.error(`Error finding post links in ${url}:`, error);
            }

            logger.info(`Found ${posts.length} posts on ${url}`);
            return posts;
        } catch (error) {
            logger.error(`Error getting posts from page ${url}:`, error);
            return [];
        }
    }

    async getVideoUrlFromPost(postUrl: string): Promise<string | null> {
        try {
            if (!this.validateUrl(postUrl)) {
                throw new Error('Invalid URL');
            }

            logger.info(`Fetching video URL from ${postUrl}...`);

            await this.ensureHttpSession();

            const response = await this.httpClient.request<string>({
                url: postUrl,
                method: 'GET',
                responseType: 'text'
            });

            // Make sure we have data before parsing
            if (!response.data) {
                logger.warn(`No data returned from ${postUrl}`);
                return null;
            }

            // Safely parse with cheerio
            let $;
            try {
                $ = cheerio.load(response.data);
            } catch (error) {
                logger.error(`Failed to parse HTML from ${postUrl}:`, error);
                return null;
            }

            if (!$) {
                logger.error(`Failed to initialize Cheerio for ${postUrl}`);
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
                logger.error(`Error finding video source in ${postUrl}:`, error);
            }

            return videoUrl;
        } catch (error) {
            logger.error(`Error getting video URL from post ${postUrl}:`, error);
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
            await this.createDirectorySafely(tagDir);

            // Obtener extensión del archivo original
            const originalFilename = path.basename(videoUrl);
            const originalExt = path.extname(originalFilename).toLowerCase();
            // Usar mp4 como formato por defecto, pero respetar la extensión original si es un formato de video
            const extension = ['.mp4', '.webm', '.mkv'].includes(originalExt) ? originalExt : '.mp4';

            // Crear nombre de archivo siguiendo el formato tag_número
            const newFilename = `${tag}_${this.videoCounter}${extension}`;
            const finalPath = path.join(tagDir, newFilename);

            // Verificar si el archivo ya existe
            try {
                const existingStats = await fsp.stat(finalPath);
                logger.info(`File already exists: ${newFilename}`);
                this.videoCounter += 1;

                // Emitir evento de descarga completada (para archivos que ya existen)
                this.emit('downloadComplete', {
                    url: videoUrl,
                    tag,
                    status: 'complete',
                    message: `Archivo ya existe: ${newFilename}`,
                    filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                    fileSize: existingStats.size,
                    fileName: newFilename
                });

                return finalPath;
            } catch (statError: any) {
                if (statError.code !== 'ENOENT') {
                    throw statError;
                }
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

            await this.ensureHttpSession();

            const response = await this.httpClient.request({
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
                writer.on('finish', async () => {
                    try {
                        logger.info(`Saved as: ${newFilename}`);
                        this.videoCounter += 1;
                        const savedStats = await fsp.stat(finalPath);

                        // Emitir evento de descarga completada
                        this.emit('downloadComplete', {
                            url: videoUrl,
                            tag,
                            status: 'complete',
                            message: `Guardado como: ${newFilename}`,
                            filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                            fileSize: savedStats.size,
                            fileName: newFilename
                        });

                        resolve(finalPath);
                    } catch (statError) {
                        reject(statError);
                    }
                });
                writer.on('error', (err) => {
                    logger.error('Error downloading video:', err);

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
            logger.error(`Error downloading video ${url}:`, error);

            // Emitir evento de error
            this.emit('downloadError', {
                url,
                status: 'error',
                message: `Error en la descarga: ${error.message}`
            });

            throw error;
        }
    }

    private async downloadPost(postUrl: string, tag: string, outputDir: string): Promise<string | undefined> {
        try {
            const videoUrl = await this.getVideoUrlFromPost(postUrl);
            if (!videoUrl) return;

            const tagDir = path.join(outputDir, tag);
            await this.createDirectorySafely(tagDir);

            const originalFilename = path.basename(videoUrl);
            const originalExt = path.extname(originalFilename).toLowerCase();
            const extension = ['.mp4', '.webm', '.mkv'].includes(originalExt) ? originalExt : '.mp4';

            const fileNumber = this.videoCounter++;
            const newFilename = `${tag}_${fileNumber}${extension}`;
            const finalPath = path.join(tagDir, newFilename);

            try {
                const existingStats = await fsp.stat(finalPath);
                logger.info(`File already exists: ${newFilename}`);
                this.emit('downloadComplete', {
                    url: videoUrl,
                    tag,
                    status: 'complete',
                    message: `Archivo ya existe: ${newFilename}`,
                    filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                    fileSize: existingStats.size,
                    fileName: newFilename
                });
                return finalPath;
            } catch (statError: any) {
                if (statError.code !== 'ENOENT') {
                    throw statError;
                }
            }

            this.emit('downloadProgress', {
                url: videoUrl,
                tag,
                status: 'downloading',
                message: `Descargando: ${originalFilename} como ${newFilename}`
            });

            await this.ensureHttpSession();

            const response = await this.httpClient.request({
                method: 'GET',
                url: videoUrl,
                responseType: 'stream',
                headers: this.headers
            });

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;
            let lastProgress = 0;

            const writer = fs.createWriteStream(finalPath);

            response.data.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
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

            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            const savedStats = await fsp.stat(finalPath);

            this.emit('downloadComplete', {
                url: videoUrl,
                tag,
                status: 'complete',
                message: `Guardado como: ${newFilename}`,
                filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                fileSize: savedStats.size,
                fileName: newFilename
            });

            return finalPath;
        } catch (err: any) {
            logger.error(`Error processing post ${postUrl}:`, err);
            this.emit('downloadError', {
                url: postUrl,
                tag,
                status: 'error',
                message: `Error procesando post: ${err.message}`
            });
        }
    }

    async downloadVideosFromTag(tagUrl: string, outputDir: string = this.outputDirectory, concurrency: number = 3): Promise<string[]> {
        this.videoCounter = 1;  // Reset counter for new tag
        const tag = this.getTagFromUrl(tagUrl);
        let page = 1;
        const downloadedPaths: string[] = [];

        logger.info(`\n===== Processing: ${tag} =====`);
        // Emitir evento de inicio de procesamiento de etiqueta
        this.emit('tagProcessingStarted', { tag, message: `Iniciando procesamiento de etiqueta: ${tag}` });

        try {
            while (true) {
                const currentUrl = `${tagUrl}&page=${page}`;

                const postUrls = await this.getVideoPostsFromPage(currentUrl);
                if (!postUrls.length) {
                    break;
                }

                logger.info(`Processing page ${page}...`);

                // Emitir evento de progreso solo si hay resultados
                this.emit('downloadProgress', {
                    url: tagUrl,
                    tag,
                    status: 'searching',
                    message: `Procesando página ${page}...`
                });

                // Emitir evento con los posts encontrados
                this.emit('postsFound', {
                    tag,
                    count: postUrls.length,
                    message: `Encontrados ${postUrls.length} posts en página ${page}`
                });

                const batches: string[][] = [];
                for (let i = 0; i < postUrls.length; i += concurrency) {
                    batches.push(postUrls.slice(i, i + concurrency));
                }

                for (const batch of batches) {
                    const results = await Promise.all(batch.map(p => this.downloadPost(p, tag, outputDir)));
                    for (const p of results) {
                        if (p) downloadedPaths.push(p);
                    }
                    await this.sleep(100);
                }

                page += 1;
                await this.sleep(200);  // Short pause between pages
            }

            // Emitir evento de finalización de procesamiento de etiqueta
            this.emit('tagProcessingComplete', {
                tag,
                count: downloadedPaths.length,
                message: `Completado procesamiento de etiqueta: ${tag}. ${downloadedPaths.length} videos descargados.`
            });

        } catch (error: any) {
            logger.error(`Error processing tag ${tag}:`, error);
            this.emit('downloadError', {
                tag,
                status: 'error',
                message: `Error procesando etiqueta ${tag}: ${error.message}`
            });
        }

        return downloadedPaths;
    }

    async processTagsFromFile(tagsFilePath: string, outputDir: string = this.outputDirectory, concurrency: number = 3): Promise<string[]> {
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
                const downloadedPaths = await this.downloadVideosFromTag(tagUrl, outputDir, concurrency);
                allDownloadedPaths.push(...downloadedPaths);
            }

            return allDownloadedPaths;
        } catch (error) {
            logger.error(`Error processing tags file:`, error);
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default Downloader;