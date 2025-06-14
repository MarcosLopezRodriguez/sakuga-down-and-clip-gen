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
const cheerio_1 = __importDefault(require("cheerio"));
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
            const $ = cheerio_1.default.load(response.data);
            const urls = [];
            $('img').each((_, img) => {
                const src = $(img).attr('data-src') || $(img).attr('src');
                if (src && src.startsWith('http') && !src.includes('googlelogo')) {
                    urls.push(src);
                }
            });
            return urls.slice(0, limit);
        });
    }
    downloadImages(query_1) {
        return __awaiter(this, arguments, void 0, function* (query, limit = 10, start = 0) {
            const imageUrls = yield this.searchGoogleImages(query, limit, start);
            const paths = [];
            for (const imageUrl of imageUrls) {
                const urlObj = new URL(imageUrl);
                const fileName = path.basename(urlObj.pathname.split('?')[0]);
                const finalPath = path.join(this.outputDirectory, fileName);
                const res = yield axios_1.default.get(imageUrl, {
                    responseType: 'stream',
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const writer = fs.createWriteStream(finalPath);
                res.data.pipe(writer);
                yield new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                paths.push(finalPath);
                this.emit('imageDownloaded', { path: finalPath });
            }
            return paths;
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
