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
exports.ImageDownloader = void 0;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cheerio = __importStar(require("cheerio"));
const events_1 = require("events");
class ImageDownloader extends events_1.EventEmitter {
    constructor(outputDirectory = 'output/images') {
        super();
        this.outputDirectory = outputDirectory;
        if (!fs.existsSync(this.outputDirectory)) {
            fs.mkdirSync(this.outputDirectory, { recursive: true });
        }
    }
    searchGoogleImages(query_1) {
        return __awaiter(this, arguments, void 0, function* (query, limit = 10, start = 0) {
            const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&start=${start}&num=${limit}`;
            const response = yield axios_1.default.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data);
            const results = [];
            const seen = new Set();
            // Intenta obtener el enlace directo desde los anchors con /imgres?imgurl=
            $('a[href^="/imgres"]').each((_, link) => {
                const href = $(link).attr('href');
                if (!href)
                    return;
                const params = new URLSearchParams(href.split('?')[1]);
                const imgurl = params.get('imgurl');
                if (!imgurl)
                    return;
                const page = params.get('imgrefurl');
                const decoded = decodeURIComponent(imgurl);
                if (decoded.startsWith('http') && !seen.has(decoded)) {
                    results.push({ image: decoded, page: page ? decodeURIComponent(page) : undefined });
                    seen.add(decoded);
                }
            });
            // Como respaldo, revisa las etiquetas <img>
            $('img').each((_, img) => {
                const original = $(img).attr('data-iurl') ||
                    $(img).attr('data-src') ||
                    $(img).attr('src');
                if (original && original.startsWith('http') && !original.includes('googlelogo') && !seen.has(original)) {
                    results.push({ image: original });
                    seen.add(original);
                }
            });
            return results.slice(0, limit);
        });
    }
    resolveOriginalUrl(result) {
        return __awaiter(this, void 0, void 0, function* () {
            if (result.image.startsWith('http') &&
                !result.image.startsWith('data:') &&
                !result.image.includes('gstatic.com')) {
                return result.image;
            }
            if (result.page) {
                try {
                    const page = yield axios_1.default.get(result.page, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const $ = cheerio.load(page.data);
                    const meta = $('meta[property="og:image"]').attr('content') ||
                        $('meta[name="twitter:image"]').attr('content') ||
                        $('link[rel="image_src"]').attr('href');
                    if (meta && meta.startsWith('http')) {
                        return meta;
                    }
                    const candidates = [];
                    $('img').each((_, img) => {
                        let src = $(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-original');
                        if (src && src.startsWith('http')) {
                            const w = parseInt($(img).attr('width') || '0', 10);
                            const h = parseInt($(img).attr('height') || '0', 10);
                            candidates.push({ url: src, size: w * h });
                        }
                        const srcset = $(img).attr('srcset');
                        if (srcset) {
                            srcset.split(',').forEach(part => {
                                const [u, size] = part.trim().split(' ');
                                if (u && u.startsWith('http')) {
                                    const parsed = parseInt(size || '0', 10);
                                    candidates.push({ url: u, size: parsed || 0 });
                                }
                            });
                        }
                    });
                    if (candidates.length) {
                        candidates.sort((a, b) => b.size - a.size);
                        return candidates[0].url;
                    }
                }
                catch (_) {
                    // ignorar errores y usar la url proporcionada
                }
            }
            return result.image;
        });
    }
    downloadImages(query_1) {
        return __awaiter(this, arguments, void 0, function* (query, limit = 10, start = 0) {
            const results = yield this.searchGoogleImages(query, limit, start);
            const downloaded = [];
            for (const result of results) {
                const imageUrl = yield this.resolveOriginalUrl(result);
                const urlObj = new URL(imageUrl);
                let fileName = path.basename(urlObj.pathname.split('?')[0]);
                const res = yield axios_1.default.get(imageUrl, {
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
                yield new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                downloaded.push({ path: finalPath, url: imageUrl, page: result.page });
                this.emit('imageDownloaded', { path: finalPath, url: imageUrl, page: result.page });
            }
            return downloaded;
        });
    }
    processQueries(queries_1) {
        return __awaiter(this, arguments, void 0, function* (queries, limit = 10, start = 0) {
            const all = [];
            for (const q of queries) {
                const p = yield this.downloadImages(q, limit, start);
                all.push(...p);
            }
            return all;
        });
    }
}
exports.ImageDownloader = ImageDownloader;
exports.default = ImageDownloader;
