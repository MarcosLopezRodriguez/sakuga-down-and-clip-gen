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
class ImageDownloader {
    constructor(outputDir = 'output/images', apiKey = process.env.UNSPLASH_ACCESS_KEY || '') {
        this.outputDir = outputDir;
        this.apiKey = apiKey;
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }
    searchUnsplash(query, count) {
        return __awaiter(this, void 0, void 0, function* () {
            const perPage = Math.min(count, 30);
            const pages = Math.ceil(count / perPage);
            const urls = [];
            for (let page = 1; page <= pages; page++) {
                const response = yield axios_1.default.get('https://api.unsplash.com/search/photos', {
                    params: {
                        query,
                        page,
                        per_page: perPage,
                        client_id: this.apiKey
                    }
                });
                response.data.results.forEach((photo) => {
                    if (photo.urls && photo.urls.regular) {
                        urls.push(photo.urls.regular);
                    }
                });
            }
            return urls.slice(0, count);
        });
    }
    downloadImage(url, filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield axios_1.default.get(url, { responseType: 'stream' });
            yield new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(filePath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        });
    }
    downloadImagesForQuery(query_1) {
        return __awaiter(this, arguments, void 0, function* (query, count = 10) {
            const urls = yield this.searchUnsplash(query, count);
            const sanitized = query.replace(/\s+/g, '_');
            const downloaded = [];
            for (let i = 0; i < urls.length; i++) {
                const fileName = `${sanitized}_${i + 1}.jpg`;
                const filePath = path.join(this.outputDir, fileName);
                yield this.downloadImage(urls[i], filePath);
                downloaded.push(filePath);
            }
            return downloaded;
        });
    }
    downloadFromQueries(queries_1) {
        return __awaiter(this, arguments, void 0, function* (queries, countPerQuery = 10) {
            const results = new Map();
            for (const q of queries) {
                const trimmed = q.trim();
                if (!trimmed)
                    continue;
                const images = yield this.downloadImagesForQuery(trimmed, countPerQuery);
                results.set(trimmed, images);
            }
            return results;
        });
    }
}
exports.ImageDownloader = ImageDownloader;
exports.default = ImageDownloader;
