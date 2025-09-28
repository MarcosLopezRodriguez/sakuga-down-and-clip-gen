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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ffprobeCache = exports.FFprobeCache = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fsp = fs.promises;
class FFprobeCache {
    constructor() {
        this.cache = new Map();
        this.inFlight = new Map();
    }
    getDuration(filePath, ffprobePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const absolutePath = path.resolve(filePath);
            const stats = yield fsp.stat(absolutePath);
            const cached = this.cache.get(absolutePath);
            if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
                return cached.duration;
            }
            const inflightKey = `${absolutePath}:${stats.mtimeMs}:${stats.size}`;
            const existingPromise = this.inFlight.get(inflightKey);
            if (existingPromise) {
                return existingPromise;
            }
            const probePromise = this.runFFprobe(absolutePath, ffprobePath)
                .then((duration) => {
                this.cache.set(absolutePath, {
                    mtimeMs: stats.mtimeMs,
                    size: stats.size,
                    duration
                });
                this.inFlight.delete(inflightKey);
                return duration;
            })
                .catch((err) => {
                this.inFlight.delete(inflightKey);
                throw err;
            });
            this.inFlight.set(inflightKey, probePromise);
            return probePromise;
        });
    }
    invalidate(filePath) {
        const absolutePath = path.resolve(filePath);
        this.cache.delete(absolutePath);
    }
    clear() {
        this.cache.clear();
        this.inFlight.clear();
    }
    runFFprobe(filePath, ffprobePath) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const args = [
                    '-v', 'error',
                    '-show_entries', 'format=duration',
                    '-of', 'default=noprint_wrappers=1:nokey=1',
                    filePath
                ];
                const ffprobeProcess = (0, child_process_1.spawn)(ffprobePath, args);
                let stdoutData = '';
                let stderrData = '';
                ffprobeProcess.stdout.on('data', (data) => {
                    stdoutData += data.toString();
                });
                ffprobeProcess.stderr.on('data', (data) => {
                    stderrData += data.toString();
                });
                ffprobeProcess.on('close', (code) => {
                    if (code === 0) {
                        const duration = parseFloat(stdoutData.trim());
                        if (!Number.isNaN(duration)) {
                            resolve(duration);
                        }
                        else {
                            reject(new Error(`Could not parse video duration for ${filePath}`));
                        }
                    }
                    else {
                        reject(new Error(`FFprobe exited with code ${code} for ${filePath}. stderr: ${stderrData}`));
                    }
                });
                ffprobeProcess.on('error', (err) => {
                    reject(new Error(`Failed to start FFprobe process for ${filePath}: ${err.message}`));
                });
            });
        });
    }
}
exports.FFprobeCache = FFprobeCache;
exports.ffprobeCache = new FFprobeCache();
