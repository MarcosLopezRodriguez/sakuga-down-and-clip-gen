import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export class BeatSyncGenerator {
    private ffmpegPath: string;
    private ffprobePath: string;
    private outputDirectory: string;
    private tempSegmentDirectory: string;

    constructor(
        ffmpegPath: string = 'ffmpeg',
        ffprobePath: string = 'ffprobe',
        outputDirectory: string = 'output/beat_synced_videos'
    ) {
        this.ffmpegPath = ffmpegPath;
        this.ffprobePath = ffprobePath;
        this.outputDirectory = path.resolve(outputDirectory);
        this.tempSegmentDirectory = path.resolve(this.outputDirectory, 'temp_beat_segments');

        if (!fs.existsSync(this.outputDirectory)) {
            fs.mkdirSync(this.outputDirectory, { recursive: true });
        }
        if (!fs.existsSync(this.tempSegmentDirectory)) {
            fs.mkdirSync(this.tempSegmentDirectory, { recursive: true });
        }
    }

    private async _getVideoDuration(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const ffprobe = spawn(this.ffprobePath, [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                filePath
            ]);

            let duration = '';
            ffprobe.stdout.on('data', (data) => {
                duration += data.toString();
            });

            ffprobe.stderr.on('data', (data) => {
                console.error(`ffprobe stderr: ${data}`);
                // Do not reject here, as ffprobe sometimes outputs warnings to stderr
            });

            ffprobe.on('close', (code) => {
                if (code === 0) {
                    const parsedDuration = parseFloat(duration);
                    if (isNaN(parsedDuration)) {
                        reject(new Error(`Failed to parse duration from ffprobe output: ${duration}`));
                    } else {
                        resolve(parsedDuration);
                    }
                } else {
                    reject(new Error(`ffprobe exited with code ${code} for file ${filePath}. Output: ${duration}`));
                }
            });

            ffprobe.on('error', (err) => {
                reject(new Error(`Failed to start ffprobe process for ${filePath}: ${err.message}`));
            });
        });
    }

    private _listSourceVideos(sourceClipFolderPaths: string[], baseClipDirectory: string): string[] {
        const videoFiles: string[] = [];
        const validExtensions = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.flv'];

        for (const relativeFolderPath of sourceClipFolderPaths) {
            const absoluteFolderPath = path.resolve(baseClipDirectory, relativeFolderPath);
            if (!fs.existsSync(absoluteFolderPath) || !fs.statSync(absoluteFolderPath).isDirectory()) {
                console.warn(`Source folder path ${absoluteFolderPath} does not exist or is not a directory. Skipping.`);
                continue;
            }

            const entries = fs.readdirSync(absoluteFolderPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullEntryPath = path.join(absoluteFolderPath, entry.name);
                if (entry.isFile() && validExtensions.includes(path.extname(entry.name).toLowerCase())) {
                    videoFiles.push(fullEntryPath);
                } else if (entry.isDirectory()) {
                    // Recursively list videos in subdirectories, adjusting the relative path
                    videoFiles.push(...this._listSourceVideos([path.join(relativeFolderPath, entry.name)], baseClipDirectory));
                }
            }
        }
        // Remove duplicates that might arise from recursive calls with overlapping paths
        return [...new Set(videoFiles)];
    }

    public async generateVideoFromAudioBeats(
        beatTimestamps: number[],
        audioStartTime: number,
        audioEndTime: number,
        sourceClipFolderPaths: string[],
        outputVideoName: string,
        baseClipDirectory: string
    ): Promise<string> {
        const sourceVideos = this._listSourceVideos(sourceClipFolderPaths, baseClipDirectory);
        if (sourceVideos.length === 0) {
            throw new Error('No source video clips found in the specified folders.');
        }

        const actualAudioDuration = audioEndTime - audioStartTime;
        if (actualAudioDuration <= 0) {
            throw new Error('Audio end time must be greater than audio start time.');
        }

        const relativeBeatTimestamps = beatTimestamps
            .map(ts => ts - audioStartTime)
            .filter(ts => ts >= 0 && ts < actualAudioDuration) // Ensure beats are within the audio segment
            .sort((a, b) => a - b); // Ensure they are sorted

        if (relativeBeatTimestamps.length === 0) {
            throw new Error('No beat timestamps fall within the specified audio start and end times after adjustment.');
        }

        // Add the end of the audio segment as a final "beat" to ensure the last segment is created
        const effectiveBeatTimestamps = [...relativeBeatTimestamps];
        if (effectiveBeatTimestamps[effectiveBeatTimestamps.length -1] < actualAudioDuration) {
            effectiveBeatTimestamps.push(actualAudioDuration);
        }


        const tempSegmentPaths: string[] = [];
        const concatFilePath = path.join(this.tempSegmentDirectory, 'concat_list.txt');
        const finalOutputVideoPath = path.join(this.outputDirectory, outputVideoName);

        try {
            for (let i = 0; i < effectiveBeatTimestamps.length - 1; i++) {
                const segmentStartTime = effectiveBeatTimestamps[i];
                const segmentEndTime = effectiveBeatTimestamps[i+1];
                let segmentDuration = segmentEndTime - segmentStartTime;

                if (segmentDuration <= 0.01) { // Avoid zero or tiny durations
                    console.warn(`Skipping segment ${i} due to very short duration: ${segmentDuration}`);
                    continue;
                }
                // Ensure duration is positive and reasonable
                segmentDuration = Math.max(0.02, segmentDuration);


                const randomVideoIndex = Math.floor(Math.random() * sourceVideos.length);
                const selectedSourceVideo = sourceVideos[randomVideoIndex];

                const sourceVideoDuration = await this._getVideoDuration(selectedSourceVideo);

                let sourceStartTimeForCut = 0;
                // If source video is shorter than segment, use full source video
                if (sourceVideoDuration <= segmentDuration) {
                    segmentDuration = sourceVideoDuration; // Adjust segment duration to source video's length
                } else {
                     // Max start time to ensure the cut segment fits within the source video
                    const maxRandomSourceStartTime = sourceVideoDuration - segmentDuration;
                    sourceStartTimeForCut = Math.random() * maxRandomSourceStartTime;
                }
                // Round to 3 decimal places to avoid issues with ffmpeg
                sourceStartTimeForCut = parseFloat(sourceStartTimeForCut.toFixed(3));
                segmentDuration = parseFloat(segmentDuration.toFixed(3));


                const tempSegmentPath = path.join(this.tempSegmentDirectory, `segment_${i}_${Date.now()}.mp4`);

                const ffmpegArgs = [
                    '-i', selectedSourceVideo,
                    '-ss', sourceStartTimeForCut.toString(),
                    '-t', segmentDuration.toString(),
                    '-an', // No audio
                    '-c:v', 'libx264', // Re-encode to ensure compatibility
                    '-preset', 'medium', // Balance between speed and quality
                    '-crf', '23', // Constant Rate Factor (quality, lower is better)
                    '-pix_fmt', 'yuv420p', // Common pixel format
                    '-y', // Overwrite output files without asking
                    tempSegmentPath
                ];

                console.log(`Executing ffmpeg: ${this.ffmpegPath} ${ffmpegArgs.join(' ')}`);

                await new Promise<void>((resolve, reject) => {
                    const process = spawn(this.ffmpegPath, ffmpegArgs);
                    let ffmpegStderr = '';
                    process.stderr.on('data', (data) => ffmpegStderr += data.toString());
                    process.on('close', (code) => {
                        if (code === 0) {
                            tempSegmentPaths.push(tempSegmentPath);
                            resolve();
                        } else {
                            console.error(`FFmpeg stderr (segment ${i}): ${ffmpegStderr}`);
                            reject(new Error(`FFmpeg (segment creation) exited with code ${code}. Error: ${ffmpegStderr}`));
                        }
                    });
                    process.on('error', (err) => {
                         console.error(`FFmpeg process error (segment ${i}): ${err.message}`);
                        reject(new Error(`Failed to start FFmpeg process for segment ${i}: ${err.message}`));
                    });
                });
            }

            if (tempSegmentPaths.length === 0) {
                throw new Error('No video segments were created. Check beat timestamps and source videos.');
            }

            // Create concat_list.txt
            // Paths in concat_list.txt should be relative to the file itself if -cwd is not used,
            // or absolute. Using absolute paths stored in tempSegmentPaths for simplicity here.
            // For ffmpeg -f concat, paths need to be escaped if they contain special characters.
            // However, since we generate simple names, this might not be an issue.
            // Using 'file' directive with relative paths from the location of concat_list.txt is safer.
            const concatFileContent = tempSegmentPaths
                .map(p => `file '${path.relative(this.tempSegmentDirectory, p).replace(/\\/g, '/')}'`)
                .join('\n');
            fs.writeFileSync(concatFilePath, concatFileContent);

            console.log(`Concatenation list created at: ${concatFilePath}`);
            console.log(`Concatenation list content:\n${concatFileContent}`);


            const concatFfmpegArgs = [
                '-f', 'concat',
                '-safe', '0', // Necessary if paths are absolute or outside the CWD
                '-i', concatFilePath,
                '-c:v', 'libx264', // Re-encode during concat for safety
                '-preset', 'medium',
                '-crf', '23',
                '-pix_fmt', 'yuv420p',
                '-y', // Overwrite output
                finalOutputVideoPath
            ];

            console.log(`Executing ffmpeg concat: ${this.ffmpegPath} ${concatFfmpegArgs.join(' ')}`);

            await new Promise<void>((resolve, reject) => {
                const process = spawn(this.ffmpegPath, concatFfmpegArgs, { cwd: this.tempSegmentDirectory });
                let ffmpegConcatStderr = '';
                process.stderr.on('data', (data) => ffmpegConcatStderr += data.toString());
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        console.error(`FFmpeg concat stderr: ${ffmpegConcatStderr}`);
                        reject(new Error(`FFmpeg (concatenation) exited with code ${code}. Error: ${ffmpegConcatStderr}`));
                    }
                });
                 process.on('error', (err) => {
                    console.error(`FFmpeg concat process error: ${err.message}`);
                    reject(new Error(`Failed to start FFmpeg concat process: ${err.message}`));
                });
            });

            return finalOutputVideoPath;

        } finally {
            // Cleanup temporary files
            for (const tempPath of tempSegmentPaths) {
                if (fs.existsSync(tempPath)) {
                    try {
                        fs.unlinkSync(tempPath);
                    } catch (e: any) {
                        console.warn(`Failed to delete temporary segment ${tempPath}: ${e.message}`);
                    }
                }
            }
            if (fs.existsSync(concatFilePath)) {
                try {
                    fs.unlinkSync(concatFilePath);
                } catch (e: any) {
                     console.warn(`Failed to delete concat list ${concatFilePath}: ${e.message}`);
                }
            }
            // Optionally, try to remove the temp_beat_segments directory if empty
            try {
                if (fs.existsSync(this.tempSegmentDirectory) && fs.readdirSync(this.tempSegmentDirectory).length === 0) {
                    fs.rmdirSync(this.tempSegmentDirectory);
                }
            } catch (e: any) {
                console.warn(`Failed to remove temporary segment directory ${this.tempSegmentDirectory}: ${e.message}`);
            }
        }
    }
}
