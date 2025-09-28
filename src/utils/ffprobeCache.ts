import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const fsp = fs.promises;

interface CacheEntry {
    mtimeMs: number;
    size: number;
    duration: number;
}

export class FFprobeCache {
    private cache = new Map<string, CacheEntry>();
    private inFlight = new Map<string, Promise<number>>();

    async getDuration(filePath: string, ffprobePath: string): Promise<number> {
        const absolutePath = path.resolve(filePath);
        const stats = await fsp.stat(absolutePath);
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
    }

    invalidate(filePath: string): void {
        const absolutePath = path.resolve(filePath);
        this.cache.delete(absolutePath);
    }

    clear(): void {
        this.cache.clear();
        this.inFlight.clear();
    }

    private async runFFprobe(filePath: string, ffprobePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const args = [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                filePath
            ];

            const ffprobeProcess = spawn(ffprobePath, args);

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
                    } else {
                        reject(new Error(`Could not parse video duration for ${filePath}`));
                    }
                } else {
                    reject(new Error(`FFprobe exited with code ${code} for ${filePath}. stderr: ${stderrData}`));
                }
            });

            ffprobeProcess.on('error', (err) => {
                reject(new Error(`Failed to start FFprobe process for ${filePath}: ${err.message}`));
            });
        });
    }
}

export const ffprobeCache = new FFprobeCache();
