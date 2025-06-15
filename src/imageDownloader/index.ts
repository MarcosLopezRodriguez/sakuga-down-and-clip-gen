import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { EventEmitter } from 'events';

export interface ImageDownloadedEvent {
    path: string;
    url: string;
    page?: string;
}

export interface ImageSearchResult {
    image: string;
    page?: string;
}

export interface ImageDownloadResult {
    path: string;
    url: string;
    page?: string;
}

export class ImageDownloader extends EventEmitter {
    private outputDirectory: string;

    constructor(outputDirectory: string = 'output/images') {
        super();
        this.outputDirectory = outputDirectory;
        if (!fs.existsSync(this.outputDirectory)) {
            fs.mkdirSync(this.outputDirectory, { recursive: true });
        }
    }

    async searchGoogleImages(query: string, limit: number = 10, start: number = 0): Promise<ImageSearchResult[]> {
        const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&start=${start}&num=${limit}`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const results: ImageSearchResult[] = [];
        const seen = new Set<string>();

        // Intenta obtener el enlace directo desde los anchors con /imgres?imgurl=
        $('a[href^="/imgres"]').each((_, link) => {
            const href = $(link).attr('href');
            if (!href) return;
            const params = new URLSearchParams(href.split('?')[1]);
            const imgurl = params.get('imgurl');
            if (!imgurl) return;
            const page = params.get('imgrefurl');
            const decoded = decodeURIComponent(imgurl);
            if (decoded.startsWith('http') && !seen.has(decoded)) {
                results.push({ image: decoded, page: page ? decodeURIComponent(page) : undefined });
                seen.add(decoded);
            }
        });

        // Como respaldo, revisa las etiquetas <img>
        $('img').each((_, img) => {
            const original =
                $(img).attr('data-iurl') ||
                $(img).attr('data-src') ||
                $(img).attr('src');

            if (original && original.startsWith('http') && !original.includes('googlelogo') && !seen.has(original)) {
                results.push({ image: original });
                seen.add(original);
            }
        });

        return results.slice(0, limit);
    }

    private async resolveOriginalUrl(result: ImageSearchResult): Promise<string> {
        if (result.page) {
            try {
                const page = await axios.get(result.page, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $ = cheerio.load(page.data);
                const meta =
                    $('meta[property="og:image"]').attr('content') ||
                    $('meta[name="twitter:image"]').attr('content') ||
                    $('link[rel="image_src"]').attr('href');
                if (meta && meta.startsWith('http')) {
                    return meta;
                }
                const firstImg = $('img').map((_, img) => $(img).attr('src')).get().find(src => src && src.startsWith('http'));
                if (firstImg) {
                    return firstImg;
                }
            } catch (_) {
                // ignorar errores y usar la url proporcionada
            }
        }
        return result.image;
    }

    async downloadImages(query: string, limit: number = 10, start: number = 0): Promise<ImageDownloadResult[]> {
        const results = await this.searchGoogleImages(query, limit, start);
        const downloaded: ImageDownloadResult[] = [];
        for (const result of results) {
            const imageUrl = await this.resolveOriginalUrl(result);
            const urlObj = new URL(imageUrl);
            let fileName = path.basename(urlObj.pathname.split('?')[0]);
            const res = await axios.get(imageUrl, {
                responseType: 'stream',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            let ext = path.extname(fileName);
            if (!ext) {
                ext = '.jpg';
            }
            const base = path.basename(fileName, path.extname(fileName)) || 'image';
            fileName = `${base}-${Date.now()}${ext}`;
            const finalPath = path.join(this.outputDirectory, fileName);
            const writer = fs.createWriteStream(finalPath);
            res.data.pipe(writer);
            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            downloaded.push({ path: finalPath, url: imageUrl, page: result.page });
            this.emit('imageDownloaded', { path: finalPath, url: imageUrl, page: result.page } as ImageDownloadedEvent);
        }
        return downloaded;
    }

    async processQueries(queries: string[], limit: number = 10, start: number = 0): Promise<ImageDownloadResult[]> {
        const all: ImageDownloadResult[] = [];
        for (const q of queries) {
            const p = await this.downloadImages(q, limit, start);
            all.push(...p);
        }
        return all;
    }
}

export default ImageDownloader;
