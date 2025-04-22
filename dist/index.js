#!/usr/bin/env node
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIPS_DIR = exports.DOWNLOADS_DIR = exports.clipGenerator = exports.downloader = void 0;
exports.processVideosToPythonClips = processVideosToPythonClips;
exports.processDownloadedVideos = processDownloadedVideos;
const app_1 = require("./app");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const clipGenerator_1 = __importDefault(require("./clipGenerator"));
const downloader_1 = __importDefault(require("./downloader"));
// Rutas principales
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const DOWNLOADS_DIR = path.join(OUTPUT_DIR, 'downloads');
exports.DOWNLOADS_DIR = DOWNLOADS_DIR;
const CLIPS_DIR = path.join(OUTPUT_DIR, 'clips');
exports.CLIPS_DIR = CLIPS_DIR;
// Asegurarse de que los directorios existan
[OUTPUT_DIR, DOWNLOADS_DIR, CLIPS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});
// Inicializar componentes
const downloader = new downloader_1.default(DOWNLOADS_DIR);
exports.downloader = downloader;
const clipGenerator = new clipGenerator_1.default(CLIPS_DIR);
exports.clipGenerator = clipGenerator;
// Función principal que replica la funcionalidad del script Python
function processVideosToPythonClips(inputDir_1) {
    return __awaiter(this, arguments, void 0, function* (inputDir, options = { minDuration: 1.0, maxDuration: 2.99 }) {
        console.log('Iniciando procesamiento de videos al estilo Python...');
        try {
            // Usar la implementación que replica el comportamiento del script Python
            const generatedClips = yield clipGenerator.processVideosLikePython(inputDir, options);
            console.log(`Procesamiento completado. Se generaron ${generatedClips.length} clips.`);
            return generatedClips;
        }
        catch (error) {
            console.error('Error durante el procesamiento:', error);
            throw error;
        }
    });
}
// Función para ayudar al usuario a procesar videos descargados previamente
function processDownloadedVideos(category_1) {
    return __awaiter(this, arguments, void 0, function* (category, options = { minDuration: 1.0, maxDuration: 2.99 }) {
        const categoryPath = path.join(DOWNLOADS_DIR, category);
        if (!fs.existsSync(categoryPath)) {
            throw new Error(`La categoría ${category} no existe en las descargas.`);
        }
        console.log(`Procesando videos descargados en la categoría: ${category}`);
        return processVideosToPythonClips(categoryPath, options);
    });
}
// Configurar la línea de comandos con yargs
(0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .scriptName('sakuga-down-and-clip-gen')
    .usage('$0 <cmd> [args]')
    // Comando para iniciar el servidor web
    .command('server', 'Iniciar la interfaz web', (yargs) => {
    return yargs
        .option('port', {
        alias: 'p',
        describe: 'Puerto para el servidor web',
        type: 'number',
        default: 3000
    })
        .option('download-dir', {
        describe: 'Directorio para guardar los videos descargados',
        type: 'string',
        default: 'output/downloads'
    })
        .option('clips-dir', {
        describe: 'Directorio para guardar los clips generados',
        type: 'string',
        default: 'output/clips'
    });
}, (argv) => {
    try {
        const app = new app_1.SakugaDownAndClipGen(argv['download-dir'], argv['clips-dir'], argv.port);
        app.startServer();
    }
    catch (error) {
        console.error('Error al iniciar el servidor web:', error);
        process.exit(1);
    }
})
    // Comando para descargar videos de Sakugabooru
    .command('download [url]', 'Descargar videos de Sakugabooru', (yargs) => {
    return yargs
        .positional('url', {
        describe: 'URL de Sakugabooru con etiquetas o post específico',
        type: 'string'
    })
        .option('tags-file', {
        alias: 't',
        describe: 'Archivo de texto con etiquetas separadas por punto y coma',
        type: 'string'
    })
        .option('output', {
        alias: 'o',
        describe: 'Directorio de salida para los videos descargados',
        type: 'string',
        default: 'output/downloads'
    })
        .check((argv) => {
        if (!argv.url && !argv['tags-file']) {
            throw new Error('Debe proporcionar una URL o un archivo de etiquetas');
        }
        return true;
    });
}, (argv) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const app = new app_1.SakugaDownAndClipGen(argv.output);
        if (argv['tags-file']) {
            console.log(`Procesando archivo de etiquetas: ${argv['tags-file']}`);
            yield app['downloader'].processTagsFromFile(argv['tags-file']);
        }
        else if (argv.url) {
            console.log(`Descargando video desde: ${argv.url}`);
            yield app['downloader'].downloadVideo(argv.url);
        }
        console.log('Descarga completada!');
    }
    catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}))
    // Comando para generar clips a partir de videos
    .command('generate-clips [input]', 'Genera clips a partir de videos', (yargs) => {
    return yargs
        .positional('input', {
        describe: 'Ruta al video o directorio con videos',
        type: 'string',
        demandOption: true
    })
        .option('output', {
        alias: 'o',
        describe: 'Directorio de salida para los clips',
        type: 'string',
        default: 'output/clips'
    })
        .option('min-duration', {
        describe: 'Duración mínima de los clips (segundos)',
        type: 'number',
        default: 1.0
    })
        .option('max-duration', {
        describe: 'Duración máxima de los clips (segundos)',
        type: 'number',
        default: 3.0
    })
        .option('threshold', {
        describe: 'Umbral para la detección de escenas',
        type: 'number',
        default: 30
    })
        .option('ffmpeg', {
        describe: 'Usar FFmpeg para detección de escenas en lugar de PySceneDetect',
        type: 'boolean',
        default: false
    });
}, (argv) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const app = new app_1.SakugaDownAndClipGen('output/downloads', argv.output);
        const inputPath = argv.input;
        const sceneOptions = {
            minDuration: argv['min-duration'],
            maxDuration: argv['max-duration'],
            threshold: argv.threshold,
            useFFmpegDetection: argv.ffmpeg
        };
        if (fs.existsSync(inputPath)) {
            const stats = fs.statSync(inputPath);
            if (stats.isFile()) {
                // Procesar un solo archivo
                console.log(`Procesando video: ${inputPath}`);
                let clipPaths;
                if (sceneOptions.useFFmpegDetection) {
                    clipPaths = yield app['clipGenerator'].detectScenesWithFFmpegAndGenerateClips(inputPath, sceneOptions);
                }
                else {
                    clipPaths = yield app['clipGenerator'].detectScenesAndGenerateClips(inputPath, sceneOptions);
                }
                console.log(`Se generaron ${clipPaths.length} clips del video.`);
            }
            else if (stats.isDirectory()) {
                // Procesar un directorio
                console.log(`Procesando directorio: ${inputPath}`);
                const results = yield app.processVideosDirectoryAndGenerateClips(inputPath, sceneOptions);
                let totalClips = 0;
                results.forEach((clips) => {
                    totalClips += clips.length;
                });
                console.log(`Se procesaron ${results.size} videos y se generaron ${totalClips} clips.`);
            }
        }
        else {
            console.error(`Error: La ruta ${inputPath} no existe.`);
            process.exit(1);
        }
        console.log('Proceso de generación de clips completado!');
    }
    catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}))
    // Comando para descargar y generar clips en un solo paso
    .command('download-and-clip', 'Descargar videos y generar clips en un solo paso', (yargs) => {
    return yargs
        .option('url', {
        alias: 'u',
        describe: 'URL de Sakugabooru con etiquetas o post específico',
        type: 'string'
    })
        .option('tags-file', {
        alias: 't',
        describe: 'Archivo de texto con etiquetas separadas por punto y coma',
        type: 'string'
    })
        .option('download-dir', {
        describe: 'Directorio para guardar los videos descargados',
        type: 'string',
        default: 'output/downloads'
    })
        .option('clips-dir', {
        describe: 'Directorio para guardar los clips generados',
        type: 'string',
        default: 'output/clips'
    })
        .option('min-duration', {
        describe: 'Duración mínima de los clips (segundos)',
        type: 'number',
        default: 1.0
    })
        .option('max-duration', {
        describe: 'Duración máxima de los clips (segundos)',
        type: 'number',
        default: 3.0
    })
        .option('threshold', {
        describe: 'Umbral para la detección de escenas',
        type: 'number',
        default: 30
    })
        .option('ffmpeg', {
        describe: 'Usar FFmpeg para detección de escenas en lugar de PySceneDetect',
        type: 'boolean',
        default: false
    })
        .check((argv) => {
        if (!argv.url && !argv['tags-file']) {
            throw new Error('Debe proporcionar una URL o un archivo de etiquetas');
        }
        return true;
    });
}, (argv) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const app = new app_1.SakugaDownAndClipGen(argv['download-dir'], argv['clips-dir']);
        const sceneOptions = {
            minDuration: argv['min-duration'],
            maxDuration: argv['max-duration'],
            threshold: argv.threshold,
            useFFmpegDetection: argv.ffmpeg
        };
        let results = new Map();
        if (argv['tags-file']) {
            console.log(`Procesando archivo de etiquetas: ${argv['tags-file']}`);
            results = yield app.processTagsFileAndGenerateClips(argv['tags-file'], sceneOptions);
        }
        else if (argv.url) {
            console.log(`Procesando URL: ${argv.url}`);
            // Si es una URL de etiquetas
            if (argv.url.includes('/post?tags=')) {
                const tagName = new URL(argv.url).searchParams.get('tags') || '';
                results = yield app.downloadTagsAndGenerateClips([tagName], sceneOptions);
            }
            else {
                // Si es una URL directa a un video o post
                const clipPaths = yield app.downloadAndGenerateClips(argv.url, []);
                results.set(argv.url, clipPaths);
            }
        }
        // Mostrar resumen
        let totalVideos = 0;
        let totalClips = 0;
        results.forEach((clips, video) => {
            totalVideos++;
            totalClips += clips.length;
        });
        console.log(`\nResumen del proceso:`);
        console.log(`- Videos descargados: ${totalVideos}`);
        console.log(`- Clips generados: ${totalClips}`);
        console.log('Proceso completado!');
    }
    catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}))
    // Configuración general de yargs
    .demandCommand(1, 'Debe especificar un comando')
    .strict()
    .alias('h', 'help')
    .alias('v', 'version')
    .epilog('Para más información visita https://github.com/tu-usuario/sakuga-down-and-clip-gen')
    .argv;
// Punto de entrada principal (para uso en línea de comandos)
if (require.main === module) {
    // Si se ejecuta directamente desde la línea de comandos
    const args = process.argv.slice(2);
    const command = (_a = args[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (command === 'process') {
        const category = args[1];
        if (!category) {
            console.error('Debe especificar una categoría para procesar');
            process.exit(1);
        }
        processDownloadedVideos(category)
            .then(clips => {
            console.log(`Proceso completado. Se generaron ${clips.length} clips.`);
        })
            .catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
    }
    else {
        console.log('Uso: node index.js process <categoria>');
    }
}
