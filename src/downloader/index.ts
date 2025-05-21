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
    private concurrentDownloadsLimit: number;

    constructor(baseUrl: string = 'https://www.sakugabooru.com', outputDirectory: string = 'output/downloads', concurrentDownloadsLimit: number = 3) {
        super();
        this.baseUrl = baseUrl;
        this.outputDirectory = outputDirectory;
        this.concurrentDownloadsLimit = concurrentDownloadsLimit;
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
        const tags = parsed.query.tags as string || 'unknown';
        return tags.replace(/\s+/g, '_');
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
                // No need to return here, posts will be empty, and we'll handle it below
            }

            // Analyze Next Page Link
            // Common selectors for next page: 'a[rel="next"]', '.pagination .next a', '#pagination-next-link'
            // For Sakugabooru, it seems to be 'a[rel="next"]' or '.paginator a.next_page'
            // Let's try a more specific selector for Sakugabooru if the generic one fails.
            let nextPageLink = $('a[rel="next"]').attr('href');
            if (!nextPageLink) {
                nextPageLink = $('.paginator a.next_page').attr('href');
            }

            if (posts.length > 0) {
                console.log(`Found ${posts.length} posts on ${url}.`);
                if (nextPageLink) {
                    console.log(`A 'next page' link was found: ${nextPageLink}`);
                } else {
                    console.log(`No 'next page' link found. This might be the last page of posts.`);
                }
            } else {
                // No posts found
                if (nextPageLink) {
                    console.warn(`No posts found on ${url}, but a 'next page' link exists (${nextPageLink}). This could indicate an empty page within pagination or a selector issue.`);
                } else {
                    console.log(`No posts found on ${url} and no 'next page' link. This is likely the end of pagination.`);
                }
                // Consider if there are specific "no results" messages on the page to confirm it's not an error page
                // For example, if the page contains text like "No posts found" or "No results match your criteria"
                const siteNoResultsMessage = $('#content h1').text(); // Example selector, adjust if needed
                if (siteNoResultsMessage && siteNoResultsMessage.toLowerCase().includes("no posts found")) {
                    console.log(`Confirmed: Page content indicates 'No posts found'.`);
                }
            }
            
            return posts;
        } catch (error: any) {
            let errorMessage = `Error getting posts from page ${url}: `;
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const serverMessage = error.response?.data; // Server might send a message
                errorMessage += `HTTP error ${status || 'unknown'}. `;
                if (serverMessage) {
                    // Avoid logging full HTML, just a snippet or error message if available
                    errorMessage += `Server response snippet: ${String(serverMessage).substring(0, 200)}. `;
                }
                errorMessage += error.message;
                console.error(errorMessage);
            } else if (error.message.includes('Failed to parse HTML')) { // Assuming cheerio error might include this
                errorMessage += `Failed to parse HTML content. ${error.message}`;
                console.error(errorMessage);
            } else {
                errorMessage += error.message;
                console.error(errorMessage);
            }
            // It's crucial to return an empty array here so downloadVideosFromTag can stop.
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
                        tag = 'post_' + url.split('/post/show/')[1]?.split('/')[0] || 'unknown';

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
                tag = urlObj.hostname.replace(/^www\./, '').split('.')[0] || 'video';

                // Emitir evento de inicio de descarga
                this.emit('downloadStarted', { url: videoUrl, tag, status: 'starting', message: `Iniciando descarga directa` });
            }

            // Crear directorio específico para el tag
            const tagDir = path.join(outputDir, tag);
            if (!fs.existsSync(tagDir)) {
                fs.mkdirSync(tagDir, { recursive: true });
            }

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
        this.videoCounter = 1; // Reset counter for new tag
        const tag = this.getTagFromUrl(tagUrl);
        let page = 1;
        const allDownloadedPaths: string[] = [];
        const downloadPromises: Promise<string | null>[] = [];

        console.log(`\n===== Processing: ${tag} (Up to ${this.concurrentDownloadsLimit} concurrent downloads) =====`);
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
                
                // Check if postUrls is empty AND there's no next page indication from getVideoPostsFromPage.
                // The updated getVideoPostsFromPage now logs details about why it might be empty.
                // The decision to break should primarily be based on whether posts were found.
                // If getVideoPostsFromPage returns an empty array due to an error, it will be logged there.
                // If it's genuinely the end of pagination (no posts and no next page link), then break.
                if (postUrls.length === 0) {
                    // Additional check: getVideoPostsFromPage might have found no posts but a next page link (logged).
                    // For now, if no posts are returned, we assume it's the end or an issue handled by getVideoPostsFromPage's logging.
                    console.log(`No posts returned from ${currentUrl}. Stopping pagination for tag ${tag}.`);
                    break; 
                }

                // Emitir evento con los posts encontrados
                this.emit('postsFound', {
                    tag,
                    count: postUrls.length,
                    message: `Encontrados ${postUrls.length} posts en página ${page}`
                });

                const pageDownloadPromises: Promise<string | null>[] = [];
                let currentlyActiveDownloads: Promise<any>[] = [];

                for (const postUrl of postUrls) {
                    const videoNumberForThisPost = this.videoCounter;
                    this.videoCounter++; // Increment for the next post

                    const task = async () => {
                        const result = await this._processSinglePostForTag(postUrl, tag, outputDir, videoNumberForThisPost);
                        if (result) {
                            allDownloadedPaths.push(result);
                        }
                        // When task is done, remove it from the list of currently active downloads
                        currentlyActiveDownloads = currentlyActiveDownloads.filter(p => p !== wrappedPromise);
                        return result;
                    };
                    
                    const wrappedPromise = task()
                        .catch(error => {
                            // _processSinglePostForTag already logs and emits events
                            // Ensure it's removed from active downloads on error too
                            currentlyActiveDownloads = currentlyActiveDownloads.filter(p => p !== wrappedPromise);
                            return null; // Return null to not break Promise.all for the page
                        });

                    pageDownloadPromises.push(wrappedPromise);
                    currentlyActiveDownloads.push(wrappedPromise);
                    downloadPromises.push(wrappedPromise); // Collect all promises for the tag

                    if (currentlyActiveDownloads.length >= this.concurrentDownloadsLimit) {
                        try {
                            // Wait for any of the currently active downloads to complete
                            await Promise.race(currentlyActiveDownloads);
                        } catch (err) {
                            // Promise.race rejects if one of the raced promises rejects.
                            // The individual promise's catch block should handle its specific error.
                            // Here, we just acknowledge that one finished (possibly by failing).
                            // The `currentlyActiveDownloads` list will be updated by the individual promise's then/catch.
                        }
                    }
                }
                
                // Wait for all downloads initiated from this specific page to complete
                await Promise.all(pageDownloadPromises);

                page += 1;
                if (postUrls.length > 0) { // Only sleep if posts were processed
                    console.log(`Finished processing page ${page - 1} for tag ${tag}. Waiting ${this.sleep.length}ms before fetching next page...`);
                    await this.sleep(2000); // Be nice to the server between pages
                }
            }
            
            // This final await Promise.all(downloadPromises) ensures all downloads for the entire tag are settled.
            // While page-level Promise.all handles batches, this is a final catch-all.
            // However, with the current structure, pageDownloadPromises are added to downloadPromises,
            // so this might be slightly redundant if all page promises are managed correctly.
            // Let's ensure it captures all promises correctly.
            // The `downloadPromises` array collects all `wrappedPromise` instances across all pages for the tag.
            await Promise.all(downloadPromises); 

            // Emitir evento de finalización de procesamiento de etiqueta
            this.emit('tagProcessingComplete', {
                tag,
                count: allDownloadedPaths.length,
                message: `Completado procesamiento de etiqueta: ${tag}. ${allDownloadedPaths.length} videos descargados.`
            });

        } catch (error: any) {
            // This catch is for errors in page fetching or overall tag processing setup
            console.error(`Error processing tag ${tag}:`, error);
            this.emit('downloadError', {
                tag,
                status: 'error',
                message: `Error procesando etiqueta ${tag}: ${error.message}`
            });
        }
        return allDownloadedPaths;
    }

    // Helper method to process a single post and download its video
    private async _processSinglePostForTag(postUrl: string, tag: string, outputDir: string, videoNumber: number): Promise<string | null> {
        try {
            const videoUrl = await this.getVideoUrlFromPost(postUrl);
            if (!videoUrl) {
                // Error already logged by getVideoUrlFromPost if it fails to find a URL
                return null;
            }

            const tagDir = path.join(outputDir, tag);
            if (!fs.existsSync(tagDir)) {
                fs.mkdirSync(tagDir, { recursive: true });
            }

            const originalFilename = path.basename(videoUrl);
            const originalExt = path.extname(originalFilename).toLowerCase();
            const extension = ['.mp4', '.webm', '.mkv'].includes(originalExt) ? originalExt : '.mp4';
            const newFilename = `${tag}_${videoNumber}${extension}`;
            const finalPath = path.join(tagDir, newFilename);

            if (fs.existsSync(finalPath)) {
                console.log(`File already exists: ${newFilename} for post ${postUrl}`);
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

            console.log(`Downloading: ${originalFilename} as ${newFilename} from ${postUrl}`);
            this.emit('downloadProgress', {
                url: videoUrl,
                tag,
                postUrl,
                status: 'downloading',
                message: `Descargando: ${originalFilename} como ${newFilename}`
            });

            const response = await axios({
                method: 'GET',
                url: videoUrl,
                responseType: 'stream',
                headers: this.headers,
                timeout: 30000 // Increased timeout for individual file downloads
            });

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;
            let lastProgress = 0;
            const writer = fs.createWriteStream(finalPath);

            response.data.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
                if (totalSize > 0) {
                    const progress = Math.floor((downloadedSize / totalSize) * 100);
                    if (progress >= lastProgress + 5 && progress < 100) { // Avoid duplicate 100%
                        lastProgress = progress;
                        this.emit('downloadProgress', {
                            url: videoUrl,
                            tag,
                            postUrl,
                            status: 'downloading',
                            message: `Descargando: ${originalFilename} (${progress}%)`,
                            progress
                        });
                    }
                }
            });

            return new Promise<string | null>((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`Saved as: ${newFilename}`);
                    this.emit('downloadComplete', {
                        url: videoUrl,
                        tag,
                        postUrl,
                        status: 'complete',
                        message: `Guardado como: ${newFilename}`,
                        filePath: path.join(tag, newFilename).replace(/\\/g, '/'),
                        fileSize: fs.statSync(finalPath).size,
                        fileName: newFilename
                    });
                    resolve(finalPath);
                });
                writer.on('error', (err) => {
                    console.error(`Error downloading video ${videoUrl} for post ${postUrl}:`, err);
                    fs.unlink(finalPath, () => {}); // Attempt to delete partial file
                    this.emit('downloadError', {
                        url: videoUrl,
                        tag,
                        postUrl,
                        status: 'error',
                        message: `Error en la descarga de ${originalFilename}: ${err.message}`
                    });
                    reject(err); // This will be caught by the outer .catch of the downloadPromise
                });
            });

        } catch (postError: any) {
            console.error(`Error processing post ${postUrl} for tag ${tag}:`, postError.message);
            this.emit('downloadError', {
                url: postUrl, // This is the post URL, videoUrl might not be available
                tag,
                status: 'error',
                message: `Error procesando post ${postUrl}: ${postError.message}`
            });
            return null; // Ensure this error doesn't break Promise.all
        }
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