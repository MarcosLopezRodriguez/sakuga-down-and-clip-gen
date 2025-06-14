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
    constructor(outputDirectory = 'output/images', baseUrl = 'https://www.sakugabooru.com') {
        this.baseUrl = baseUrl;
        this.outputDirectory = outputDirectory;
        if (!fs.existsSync(this.outputDirectory)) {
            fs.mkdirSync(this.outputDirectory, { recursive: true });
        }
    }
    downloadImages(query) {
        return __awaiter(this, void 0, void 0, function* () {
            const apiUrl = `${this.baseUrl}/post.json?tags=${encodeURIComponent(query)}`;
            const response = yield axios_1.default.get(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const posts = Array.isArray(response.data) ? response.data : [];
            const paths = [];
            for (const post of posts) {
                const imageUrl = post.file_url || post.sample_url;
                if (!imageUrl)
                    continue;
                const fileName = path.basename(new URL(imageUrl).pathname);
                const finalPath = path.join(this.outputDirectory, fileName);
                const res = yield axios_1.default.get(imageUrl, { responseType: 'stream' });
                const writer = fs.createWriteStream(finalPath);
                res.data.pipe(writer);
                yield new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                paths.push(finalPath);
            }
            return paths;
        });
    }
    processQueries(queries) {
        return __awaiter(this, void 0, void 0, function* () {
            const all = [];
            for (const q of queries) {
                const p = yield this.downloadImages(q);
                all.push(...p);
            }
            return all;
        });
    }
}
exports.ImageDownloader = ImageDownloader;
exports.default = ImageDownloader;
