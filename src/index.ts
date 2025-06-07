#!/usr/bin/env node

import { SakugaDownAndClipGen } from './app';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import ClipGenerator from './clipGenerator';
import Downloader from './downloader';

// Rutas principales
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const DOWNLOADS_DIR = path.join(OUTPUT_DIR, 'downloads');
const CLIPS_DIR = path.join(OUTPUT_DIR, 'clips');

// Asegurarse de que los directorios existan
[OUTPUT_DIR, DOWNLOADS_DIR, CLIPS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Inicializar componentes
const downloader = new Downloader(DOWNLOADS_DIR);
const clipGenerator = new ClipGenerator(CLIPS_DIR);

// Exportar funcionalidades principales
export {
    downloader,
    clipGenerator,
    DOWNLOADS_DIR,
    CLIPS_DIR
};

// Función principal que replica la funcionalidad del script Python
export async function processVideosToPythonClips(
    inputDir: string,
    options = { minDuration: 1.0, maxDuration: 2.99 }
) {
    console.log('Iniciando procesamiento de videos al estilo Python...');

    try {
        // Usar la implementación que replica el comportamiento del script Python
        const generatedClips = await clipGenerator.processVideosLikePython(inputDir, options);
        console.log(`Procesamiento completado. Se generaron ${generatedClips.length} clips.`);
        return generatedClips;
    } catch (error) {
        console.error('Error durante el procesamiento:', error);
        throw error;
    }
}

// Función para ayudar al usuario a procesar videos descargados previamente
export async function processDownloadedVideos(
    category: string,
    options = { minDuration: 1.0, maxDuration: 2.99 }
) {
    const categoryPath = path.join(DOWNLOADS_DIR, category);

    if (!fs.existsSync(categoryPath)) {
        throw new Error(`La categoría ${category} no existe en las descargas.`);
    }

    console.log(`Procesando videos descargados en la categoría: ${category}`);
    return processVideosToPythonClips(categoryPath, options);
}

// Configurar la línea de comandos con yargs
yargs(hideBin(process.argv))
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
            const app = new SakugaDownAndClipGen(
                argv['download-dir'] as string,
                argv['clips-dir'] as string,
                'output/temp_audio',  // tempAudioDirectory (using default)
                'output/beat_synced_videos',  // beatSyncedVideosDirectory (using default)
                argv.port as number
            );
            app.startServer();
        } catch (error) {
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
    }, async (argv) => {
        try {
            const app = new SakugaDownAndClipGen(argv.output as string);

            if (argv['tags-file']) {
                console.log(`Procesando archivo de etiquetas: ${argv['tags-file']}`);
                await app['downloader'].processTagsFromFile(argv['tags-file'] as string);
            } else if (argv.url) {
                console.log(`Descargando video desde: ${argv.url}`);
                await app['downloader'].downloadVideo(argv.url as string);
            }

            console.log('Descarga completada!');
        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    })

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
    }, async (argv) => {
        try {
            const app = new SakugaDownAndClipGen(
                'output/downloads',
                argv.output as string
            );

            const inputPath = argv.input as string;
            const sceneOptions = {
                minDuration: argv['min-duration'] as number,
                maxDuration: argv['max-duration'] as number,
                threshold: argv.threshold as number,
                useFFmpegDetection: argv.ffmpeg as boolean
            };

            if (fs.existsSync(inputPath)) {
                const stats = fs.statSync(inputPath);

                if (stats.isFile()) {
                    // Procesar un solo archivo
                    console.log(`Procesando video: ${inputPath}`);
                    let clipPaths: string[];

                    if (sceneOptions.useFFmpegDetection) {
                        clipPaths = await app['clipGenerator'].detectScenesWithFFmpegAndGenerateClips(
                            inputPath,
                            sceneOptions
                        );
                    } else {
                        clipPaths = await app['clipGenerator'].detectScenesAndGenerateClips(
                            inputPath,
                            sceneOptions
                        );
                    }

                    console.log(`Se generaron ${clipPaths.length} clips del video.`);
                } else if (stats.isDirectory()) {
                    // Procesar un directorio
                    console.log(`Procesando directorio: ${inputPath}`);
                    const results = await app.processVideosDirectoryAndGenerateClips(inputPath, sceneOptions);

                    let totalClips = 0;
                    results.forEach((clips) => {
                        totalClips += clips.length;
                    });

                    console.log(`Se procesaron ${results.size} videos y se generaron ${totalClips} clips.`);
                }
            } else {
                console.error(`Error: La ruta ${inputPath} no existe.`);
                process.exit(1);
            }

            console.log('Proceso de generación de clips completado!');
        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    })

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
    }, async (argv) => {
        try {
            const app = new SakugaDownAndClipGen(
                argv['download-dir'] as string,
                argv['clips-dir'] as string
            );

            const sceneOptions = {
                minDuration: argv['min-duration'] as number,
                maxDuration: argv['max-duration'] as number,
                threshold: argv.threshold as number,
                useFFmpegDetection: argv.ffmpeg as boolean
            };

            let results: Map<string, string[]> = new Map();

            if (argv['tags-file']) {
                console.log(`Procesando archivo de etiquetas: ${argv['tags-file']}`);
                results = await app.processTagsFileAndGenerateClips(argv['tags-file'] as string, sceneOptions);
            } else if (argv.url) {
                console.log(`Procesando URL: ${argv.url}`);
                // Si es una URL de etiquetas
                if (argv.url.includes('/post?tags=')) {
                    const tagName = new URL(argv.url).searchParams.get('tags') || '';
                    results = await app.downloadTagsAndGenerateClips([tagName], sceneOptions);
                } else {
                    // Si es una URL directa a un video o post
                    const clipPaths = await app.downloadAndGenerateClips(argv.url as string, []);
                    results.set(argv.url as string, clipPaths);
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
        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    })

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
    const command = args[0]?.toLowerCase();

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
    } else {
        console.log('Uso: node index.js process <categoria>');
    }
}