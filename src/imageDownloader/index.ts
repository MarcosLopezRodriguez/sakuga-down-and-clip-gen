import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export class ImageDownloader {
    private baseUrl: string;
    private outputDirectory: string;

    constructor(outputDirectory: string = 'output/images', baseUrl: string = 'https://www.sakugabooru.com') {
        this.baseUrl = baseUrl;
        this.outputDirectory = outputDirectory;
        if (!fs.existsSync(this.outputDirectory)) {
            fs.mkdirSync(this.outputDirectory, { recursive: true });
        }
    }

    async downloadImages(query: string): Promise<string[]> {
        const apiUrl = `${this.baseUrl}/post.json?tags=${encodeURIComponent(query)}`;
        const response = await axios.get(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const posts = Array.isArray(response.data) ? response.data : [];
        const paths: string[] = [];
        for (const post of posts) {
            const imageUrl: string | undefined = post.file_url || post.sample_url;
            if (!imageUrl) continue;
            const fileName = path.basename(new URL(imageUrl).pathname);
            const finalPath = path.join(this.outputDirectory, fileName);
            const res = await axios.get(imageUrl, { responseType: 'stream' });
            const writer = fs.createWriteStream(finalPath);
            res.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            paths.push(finalPath);
        }
        return paths;
    }

    async processQueries(queries: string[]): Promise<string[]> {
        const all: string[] = [];
        for (const q of queries) {
            const p = await this.downloadImages(q);
            all.push(...p);
        }
        return all;
    }
}

export default ImageDownloader;
