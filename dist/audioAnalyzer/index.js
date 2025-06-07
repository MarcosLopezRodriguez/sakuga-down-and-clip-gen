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
    // Constructor can be used to accept configuration, like aubio path
    constructor() { }
    analyzeBeats(audioFilePath) {
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
                                .filter(beat => !isNaN(beat)); // Ensure only valid numbers are included
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
}
exports.AudioAnalyzer = AudioAnalyzer;
