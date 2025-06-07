"use strict";
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
exports.AudioAnalyzer = void 0;
const child_process_1 = require("child_process");
class AudioAnalyzer {
    constructor(ffmpegPath = 'ffmpeg') {
        this.ffmpegPath = ffmpegPath;
    }
    analyzeBeats(audioFilePath) {
        return __awaiter(this, void 0, void 0, function* () {
            // Try Aubio first, fallback to FFmpeg-based analysis
            try {
                return yield this.analyzeBeatsWithAubio(audioFilePath);
            }
            catch (aubioError) {
                console.warn('Aubio not available, falling back to FFmpeg-based analysis:', aubioError.message);
                return yield this.analyzeBeatsWithFFmpeg(audioFilePath);
            }
        });
    }
    analyzeBeatsWithAubio(audioFilePath) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const aubioProcess = (0, child_process_1.spawn)('aubioonset', [audioFilePath]);
                let stdoutData = '';
                let stderrData = '';
                aubioProcess.stdout.on('data', (data) => {
                    stdoutData += data.toString();
                });
                aubioProcess.stderr.on('data', (data) => {
                    stderrData += data.toString();
                });
                aubioProcess.on('error', (error) => {
                    reject(new Error(`Failed to start aubioonset process: ${error.message}. Ensure Aubio is installed and in PATH.`));
                });
                aubioProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`aubioonset process exited with code ${code}: ${stderrData}`));
                    }
                    else {
                        try {
                            const beats = stdoutData
                                .trim()
                                .split('\n')
                                .map(line => parseFloat(line))
                                .filter(beat => !isNaN(beat));
                            resolve({ beats });
                        }
                        catch (parseError) {
                            reject(new Error(`Failed to parse aubioonset output: ${parseError.message}. Output was: ${stdoutData}`));
                        }
                    }
                });
            });
        });
    }
    analyzeBeatsWithFFmpeg(audioFilePath) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                // Use FFmpeg to detect silences and estimate beat positions
                // This is a simplified approach - in a real scenario you might want to use more sophisticated analysis
                const args = [
                    '-i', audioFilePath,
                    '-af', 'silencedetect=noise=-30dB:duration=0.1',
                    '-f', 'null',
                    '-'
                ];
                const ffmpegProcess = (0, child_process_1.spawn)(this.ffmpegPath, args);
                let stderrData = '';
                ffmpegProcess.stderr.on('data', (data) => {
                    stderrData += data.toString();
                });
                ffmpegProcess.on('error', (error) => {
                    reject(new Error(`Failed to start FFmpeg process: ${error.message}. Ensure FFmpeg is installed and in PATH.`));
                });
                ffmpegProcess.on('close', (code) => {
                    try {
                        // Parse silence detection output to estimate beat positions
                        const beats = this.parseFFmpegSilenceOutput(stderrData);
                        resolve({ beats });
                    }
                    catch (parseError) {
                        // If parsing fails, generate a simple beat pattern
                        console.warn('Could not parse FFmpeg output, generating simple beat pattern');
                        const simpleBeatPattern = this.generateSimpleBeatPattern();
                        resolve({ beats: simpleBeatPattern });
                    }
                });
            });
        });
    }
    parseFFmpegSilenceOutput(output) {
        const beats = [];
        const silenceEndRegex = /silence_end: (\d+\.?\d*)/g;
        let match;
        while ((match = silenceEndRegex.exec(output)) !== null) {
            const time = parseFloat(match[1]);
            if (!isNaN(time)) {
                beats.push(time);
            }
        }
        // If no silences found, create a regular beat pattern
        if (beats.length === 0) {
            return this.generateSimpleBeatPattern();
        }
        return beats.sort((a, b) => a - b);
    }
    generateSimpleBeatPattern() {
        // Generate a simple beat pattern at 120 BPM for 30 seconds
        const bpm = 120;
        const duration = 30; // seconds
        const beatInterval = 60 / bpm; // seconds per beat
        const beats = [];
        for (let time = 0; time < duration; time += beatInterval) {
            beats.push(time);
        }
        return beats;
    }
    // Method to get audio duration using FFmpeg
    getAudioDuration(audioFilePath) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const args = [
                    '-i', audioFilePath,
                    '-f', 'null',
                    '-'
                ];
                const ffmpegProcess = (0, child_process_1.spawn)(this.ffmpegPath, args);
                let stderrData = '';
                ffmpegProcess.stderr.on('data', (data) => {
                    stderrData += data.toString();
                });
                ffmpegProcess.on('close', (code) => {
                    try {
                        // Parse duration from FFmpeg output
                        const durationMatch = stderrData.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
                        if (durationMatch) {
                            const hours = parseInt(durationMatch[1]);
                            const minutes = parseInt(durationMatch[2]);
                            const seconds = parseFloat(durationMatch[3]);
                            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                            resolve(totalSeconds);
                        }
                        else {
                            resolve(30); // Default to 30 seconds if can't parse
                        }
                    }
                    catch (error) {
                        resolve(30); // Default to 30 seconds on error
                    }
                });
                ffmpegProcess.on('error', (error) => {
                    resolve(30); // Default to 30 seconds on error
                });
            });
        });
    }
}
exports.AudioAnalyzer = AudioAnalyzer;
