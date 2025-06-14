import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface UnsplashPhoto {
    urls: { raw: string; full: string; regular: string; small: string; thumb: string };
}

export class ImageDownloader {
    private outputDir: string;
    private apiKey: string;

    constructor(outputDir: string = 'output/images', apiKey: string = process.env.UNSPLASH_ACCESS_KEY || '') {
        this.outputDir = outputDir;
        this.apiKey = apiKey;

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    private async searchUnsplash(query: string, count: number): Promise<string[]> {
        const perPage = Math.min(count, 30);
        const pages = Math.ceil(count / perPage);
        const urls: string[] = [];

        for (let page = 1; page <= pages; page++) {
            const response = await axios.get('https://api.unsplash.com/search/photos', {
                params: {
                    query,
                    page,
                    per_page: perPage,
                    client_id: this.apiKey
                }
            });

            response.data.results.forEach((photo: UnsplashPhoto) => {
                if (photo.urls && photo.urls.regular) {
                    urls.push(photo.urls.regular);
                }
            });
        }

        return urls.slice(0, count);
    }

    private async downloadImage(url: string, filePath: string): Promise<void> {
        const response = await axios.get(url, { responseType: 'stream' });
        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    async downloadImagesForQuery(query: string, count: number = 10): Promise<string[]> {
        const urls = await this.searchUnsplash(query, count);
        const sanitized = query.replace(/\s+/g, '_');
        const downloaded: string[] = [];

        for (let i = 0; i < urls.length; i++) {
            const fileName = `${sanitized}_${i + 1}.jpg`;
            const filePath = path.join(this.outputDir, fileName);
            await this.downloadImage(urls[i], filePath);
            downloaded.push(filePath);
        }

        return downloaded;
    }

    async downloadFromQueries(queries: string[], countPerQuery: number = 10): Promise<Map<string, string[]>> {
        const results = new Map<string, string[]>();

        for (const q of queries) {
            const trimmed = q.trim();
            if (!trimmed) continue;
            const images = await this.downloadImagesForQuery(trimmed, countPerQuery);
            results.set(trimmed, images);
        }

        return results;
    }
}

export default ImageDownloader;
