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
const clipGenerator_1 = require("./clipGenerator");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Crear un stream de archivo para los logs
        const logFile = fs.createWriteStream('clip-test-log.txt', { flags: 'a' });
        const log = (message) => {
            const timestamp = new Date().toISOString();
            const logMessage = `${timestamp}: ${message}`;
            logFile.write(logMessage + '\n');
            console.log(logMessage);
        };
        try {
            log('Iniciando prueba de generación de clip...');
            const clipGenerator = new clipGenerator_1.ClipGenerator();
            const videoPath = path.resolve('output/downloads/devil_may_cry/devil_may_cry_1.mp4');
            log(`Ruta completa del video: ${videoPath}`);
            log(`¿Existe el video? ${fs.existsSync(videoPath) ? 'Sí' : 'No'}`);
            // Verificar si FFmpeg está disponible
            try {
                const ffmpegCheck = require('child_process').spawnSync('ffmpeg', ['-version']);
                log(`FFmpeg está disponible: ${ffmpegCheck.status === 0 ? 'Sí' : 'No'}`);
                if (ffmpegCheck.status === 0) {
                    log(`Versión de FFmpeg: ${ffmpegCheck.stdout.toString().split('\n')[0]}`);
                }
                else {
                    log(`Error al verificar FFmpeg: ${ffmpegCheck.stderr.toString()}`);
                }
            }
            catch (error) {
                log(`Error al verificar FFmpeg: ${error.message}`);
            }
            // Crear directorio de clips si no existe
            const outputDir = path.resolve('output/clips');
            if (!fs.existsSync(outputDir)) {
                log(`Creando directorio de salida: ${outputDir}`);
                fs.mkdirSync(outputDir, { recursive: true });
            }
            else {
                log(`El directorio de salida ya existe: ${outputDir}`);
            }
            // Generar un clip simple de 3 segundos con un nombre único para evitar problemas de sobrescritura
            const uniqueFileName = `test_clip_${Date.now()}.mp4`;
            log(`Generando clip de prueba con nombre: ${uniqueFileName}`);
            // Generar el clip directamente con FFmpeg para evitar problemas con la clase ClipGenerator
            const outputPath = path.join(outputDir, uniqueFileName);
            log(`Ruta de salida del clip: ${outputPath}`);
            const { spawn } = require('child_process');
            const ffmpegProcess = spawn('ffmpeg', [
                '-i', videoPath,
                '-ss', '0',
                '-t', '3',
                '-c:v', 'libx264',
                '-an',
                '-y',
                outputPath
            ]);
            log('Proceso FFmpeg iniciado');
            // Capturar la salida de FFmpeg
            ffmpegProcess.stdout.on('data', (data) => {
                log(`FFmpeg stdout: ${data}`);
            });
            ffmpegProcess.stderr.on('data', (data) => {
                log(`FFmpeg stderr: ${data}`);
            });
            // Manejar la finalización del proceso
            yield new Promise((resolve, reject) => {
                ffmpegProcess.on('close', (code) => {
                    if (code === 0) {
                        log(`Proceso FFmpeg completado con éxito (código ${code})`);
                        log(`¿Se creó el archivo de salida? ${fs.existsSync(outputPath) ? 'Sí' : 'No'}`);
                        if (fs.existsSync(outputPath)) {
                            const stats = fs.statSync(outputPath);
                            log(`Tamaño del archivo generado: ${stats.size} bytes`);
                        }
                        resolve();
                    }
                    else {
                        log(`Proceso FFmpeg falló con código de salida ${code}`);
                        reject(new Error(`FFmpeg process exited with code ${code}`));
                    }
                });
                ffmpegProcess.on('error', (err) => {
                    log(`Error al iniciar el proceso FFmpeg: ${err.message}`);
                    reject(err);
                });
            });
            log('¡Prueba completada!');
        }
        catch (error) {
            log(`Error durante la prueba: ${error.message}`);
            if (error.stack) {
                log(`Stack trace: ${error.stack}`);
            }
        }
        finally {
            // Cerrar el archivo de log
            logFile.end();
        }
    });
}
main();
