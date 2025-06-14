import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import cheerio from 'cheerio';
import { EventEmitter } from 'events';

export interface ImageDownloadedEvent {
    path: string;
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

    async searchGoogleImages(query: string, limit: number = 10, start: number = 0): Promise<string[]> {
        const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&start=${start}&num=${limit}`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const urls: string[] = [];
        $('img').each((_, img) => {
            const src = $(img).attr('data-src') || $(img).attr('src');
            if (src && src.startsWith('http') && !src.includes('googlelogo')) {
                urls.push(src);
            }
        });
        return urls.slice(0, limit);
    }

    async downloadImages(query: string, limit: number = 10, start: number = 0): Promise<string[]> {
        const imageUrls = await this.searchGoogleImages(query, limit, start);
        const paths: string[] = [];
        for (const imageUrl of imageUrls) {
            const urlObj = new URL(imageUrl);
            const fileName = path.basename(urlObj.pathname.split('?')[0]);
            const finalPath = path.join(this.outputDirectory, fileName);
            const res = await axios.get(imageUrl, {
                responseType: 'stream',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const writer = fs.createWriteStream(finalPath);
            res.data.pipe(writer);
            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            paths.push(finalPath);
            this.emit('imageDownloaded', { path: finalPath } as ImageDownloadedEvent);
        }
        return paths;
    }

    async processQueries(queries: string[], limit: number = 10, start: number = 0): Promise<string[]> {
        const all: string[] = [];
        for (const q of queries) {
            const p = await this.downloadImages(q, limit, start);
            all.push(...p);
        }
        return all;
    }
}

export default ImageDownloader;
