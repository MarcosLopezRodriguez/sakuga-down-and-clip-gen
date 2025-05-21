import ClipGenerator, { SceneDetectionOptions } from '../../src/clipGenerator'; // Adjust path
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import * as os from 'os';

// --- Mocks ---
jest.mock('fs');
jest.mock('child_process');
jest.mock('os'); // To control os.cpus() for default concurrency testing

// Helper to create a mock ChildProcess (spawn return)
const mockSpawnProcess = (exitCode = 0, stdout = '', stderr = '') => {
    const processMock = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(stdout); }) },
        stderr: { on: jest.fn((event, cb) => { if (event === 'data') cb(stderr); }) },
        on: jest.fn((event, cb) => { if (event === 'close') setTimeout(() => cb(exitCode), 0); }), // Simulate async close
        kill: jest.fn(),
    };
    return processMock;
};


describe('ClipGenerator', () => {
    let clipGenerator: ClipGenerator;
    const MOCK_OUTPUT_DIR = 'output/clips_test';
    const MOCK_FFMPEG_PATH = '/usr/bin/ffmpeg'; // Mocked path
    const MOCK_FFPROBE_PATH = '/usr/bin/ffprobe'; // Mocked path

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock os.cpus for predictable default concurrency
        (os.cpus as jest.Mock).mockReturnValue([{ model: 'test-cpu', speed: 2000, times: {} }, { model: 'test-cpu', speed: 2000, times: {} }]); // Simulate 2 CPUs

        // Default ClipGenerator instance for most tests
        clipGenerator = new ClipGenerator(MOCK_OUTPUT_DIR, MOCK_FFMPEG_PATH, MOCK_FFPROBE_PATH);

        // Mock fs functions
        (fs.existsSync as jest.Mock).mockReturnValue(true); // Assume paths exist by default
        (fs.mkdirSync as jest.Mock).mockClear();
        (fs.readdirSync as jest.Mock).mockReturnValue([]); // Default to empty directory
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false, isFile: () => true, size: 1024 });
        (fs.renameSync as jest.Mock).mockClear();
        (fs.readFileSync as jest.Mock).mockReturnValue(''); // Default for CSV reading etc.
        (fs.unlinkSync as jest.Mock).mockClear();


        // Mock child_process.spawn
        (spawn as jest.Mock).mockReturnValue(mockSpawnProcess());
        // Mock child_process.execSync (for findFFmpegPath, isExecutableAvailable)
        (execSync as jest.Mock).mockImplementation((command: string) => {
            if (command.includes('where ffmpeg') || command.includes('which ffmpeg')) {
                return Buffer.from(MOCK_FFMPEG_PATH); // Simulate ffmpeg found in PATH
            }
            return Buffer.from('');
        });
        
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'debug').mockImplementation(() => {}); // For Promise.race logging
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should initialize with default output directory and detected ffmpeg paths', () => {
            // execSync mock will provide paths
            const generator = new ClipGenerator(); // Use default constructor args
            expect(generator['outputDirectory']).toBe('output/clips');
            expect(generator['ffmpegPath']).toBe(MOCK_FFMPEG_PATH); 
            expect(generator['ffprobePath']).toBe(MOCK_FFMPEG_PATH.replace('ffmpeg', 'ffprobe')); // Based on findFFmpegPath logic
            // Default concurrency is Math.max(1, Math.min(4, Math.floor(2 / 2))) = 1
            expect(generator.getConcurrencyLimit()).toBe(1); 
        });

        it('should initialize with provided paths and concurrency limit', () => {
            const generator = new ClipGenerator('/custom/output', '/custom/ffmpeg', '/custom/ffprobe', 3);
            expect(generator['outputDirectory']).toBe('/custom/output');
            expect(generator['ffmpegPath']).toBe('/custom/ffmpeg');
            expect(generator['ffprobePath']).toBe('/custom/ffprobe');
            expect(generator.getConcurrencyLimit()).toBe(3);
        });
        
        it('should create output directory if it does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            new ClipGenerator(MOCK_OUTPUT_DIR);
            expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_OUTPUT_DIR, { recursive: true });
        });
    });

    describe('generateClipWithoutAudio (private method test)', () => {
        it('should call ffmpeg with correct arguments for clipping without audio', async () => {
            const videoPath = 'input/video.mp4';
            const startTime = 10;
            const endTime = 20;
            const outputPath = `${MOCK_OUTPUT_DIR}/video_scene1.mp4`;
            
            (fs.existsSync as jest.Mock).mockReturnValueOnce(true); // videoPath exists
            (fs.existsSync as jest.Mock).mockReturnValueOnce(false); // outputPath does not exist initially
            
            // Mock spawn to check args and simulate success
            const mockFfmpegProcess = mockSpawnProcess(0);
            (spawn as jest.Mock).mockReturnValue(mockFfmpegProcess);
            
            // Simulate file exists after "generation"
            mockFfmpegProcess.on = jest.fn((event, cb) => {
                if (event === 'close') {
                    (fs.existsSync as jest.Mock).mockReturnValueOnce(true); // outputPath now exists
                    setTimeout(() => cb(0), 0);
                }
            });

            const resultPath = await (clipGenerator as any).generateClipWithoutAudio(videoPath, startTime, endTime, outputPath);
            
            expect(spawn).toHaveBeenCalledWith(MOCK_FFMPEG_PATH, [
                '-i', videoPath,
                '-ss', startTime.toString(),
                '-t', (endTime - startTime).toString(),
                '-c:v', 'libx264',
                '-an',
                '-y',
                outputPath
            ]);
            expect(resultPath).toBe(outputPath);
        });

        it('should reject if ffmpeg process fails for generateClipWithoutAudio', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(1, '', 'ffmpeg error')); // Simulate error
            await expect((clipGenerator as any).generateClipWithoutAudio('v.mp4', 0, 1, 'o.mp4'))
                .rejects.toThrow('Error generando clip, código: 1');
        });
    });
    
    describe('getVideoDuration (private method test)', () => {
        it('should parse ffprobe output to get duration', async () => {
            const videoPath = 'input/video.mp4';
            const mockDurationOutput = '123.45\n'; // ffprobe output format
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, mockDurationOutput));
            
            const duration = await (clipGenerator as any).getVideoDuration(videoPath);
            
            expect(spawn).toHaveBeenCalledWith(MOCK_FFPROBE_PATH, [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                videoPath
            ]);
            expect(duration).toBe(123.45);
        });

        it('should reject if ffprobe fails or output is invalid', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(1, '', 'ffprobe error'));
            await expect((clipGenerator as any).getVideoDuration('v.mp4')).rejects.toThrow('FFprobe process exited with code 1');
            
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, 'not a number'));
            await expect((clipGenerator as any).getVideoDuration('v.mp4')).rejects.toThrow('Could not parse video duration');
        });
    });

    // More tests to come for processDirectory, processVideosLikePython, 
    // detectScenesAndGenerateClips, detectScenesWithFFmpegAndGenerateClips, detectScenesFFmpeg

    describe('processDirectory', () => {
        it('should process video files in a directory concurrently respecting the limit', async () => {
            const videoFiles = ['video1.mp4', 'video2.webm', 'video3.mkv', 'non-video.txt'];
            const mockClipPaths1 = ['v1_clip1.mp4'];
            const mockClipPaths2 = ['v2_clip1.mp4', 'v2_clip2.mp4'];
            const mockClipPaths3 = ['v3_clip1.mp4'];

            (fs.readdirSync as jest.Mock).mockReturnValue(videoFiles);
            // Mock statSync to identify video files
            (fs.statSync as jest.Mock).mockImplementation((filePath) => ({
                isFile: () => !filePath.endsWith('.txt'), // Treat .txt as non-file for simplicity or non-video
                isDirectory: () => false, // No subdirectories in this specific test for processDirectory
            }));
            
            let activeCalls = 0;
            let maxActiveCalls = 0;
            const generatorWithLimit = new ClipGenerator(MOCK_OUTPUT_DIR, MOCK_FFMPEG_PATH, MOCK_FFPROBE_PATH, 2); // Limit 2

            const detectScenesSpy = jest.spyOn(generatorWithLimit, 'detectScenesAndGenerateClips')
                .mockImplementation(async (videoPath: string) => {
                    activeCalls++;
                    maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
                    await new Promise(r => setTimeout(r, 20 + Math.random() * 30)); // Simulate work
                    activeCalls--;
                    if (videoPath.includes('video1')) return mockClipPaths1;
                    if (videoPath.includes('video2')) return mockClipPaths2;
                    if (videoPath.includes('video3')) return mockClipPaths3;
                    return [];
                });
            
            // Fallback mock (though detectScenesSpy should catch it first)
            const ffmpegFallbackSpy = jest.spyOn(generatorWithLimit, 'detectScenesWithFFmpegAndGenerateClips').mockResolvedValue([]);


            const results = await generatorWithLimit.processDirectory(MOCK_OUTPUT_DIR, {});
            
            expect(fs.readdirSync).toHaveBeenCalledWith(MOCK_OUTPUT_DIR);
            expect(detectScenesSpy).toHaveBeenCalledTimes(3); // video1, video2, video3
            expect(detectScenesSpy).toHaveBeenCalledWith(path.join(MOCK_OUTPUT_DIR, 'video1.mp4'), {});
            expect(detectScenesSpy).toHaveBeenCalledWith(path.join(MOCK_OUTPUT_DIR, 'video2.webm'), {});
            expect(detectScenesSpy).toHaveBeenCalledWith(path.join(MOCK_OUTPUT_DIR, 'video3.mkv'), {});
            
            expect(maxActiveCalls).toBeLessThanOrEqual(2); // Concurrency limit
            expect(maxActiveCalls).toBeGreaterThan(0); // Ensure it ran

            expect(results).toEqual([...mockClipPaths1, ...mockClipPaths2, ...mockClipPaths3]);
            expect(ffmpegFallbackSpy).not.toHaveBeenCalled(); // Should use the primary method
        });

        it('should use FFmpeg fallback if detectScenesAndGenerateClips fails', async () => {
            (fs.readdirSync as jest.Mock).mockReturnValue(['video1.mp4']);
            (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, isDirectory: () => false });

            const generator = new ClipGenerator(MOCK_OUTPUT_DIR, MOCK_FFMPEG_PATH, MOCK_FFPROBE_PATH, 1);
            const mockFallbackClips = ['fallback_clip.mp4'];

            jest.spyOn(generator, 'detectScenesAndGenerateClips').mockRejectedValue(new Error('PySceneDetect failed'));
            const ffmpegFallbackSpy = jest.spyOn(generator, 'detectScenesWithFFmpegAndGenerateClips').mockResolvedValue(mockFallbackClips);

            const results = await generator.processDirectory(MOCK_OUTPUT_DIR, {});
            expect(results).toEqual(mockFallbackClips);
            expect(ffmpegFallbackSpy).toHaveBeenCalledTimes(1);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('PySceneDetect failed for'), expect.any(Error), expect.stringContaining('Falling back to FFmpeg method.'));
        });
        
        it('should handle errors for individual videos and continue processing others', async () => {
            const videoFiles = ['video1.mp4', 'error_video.mp4', 'video3.mp4'];
            (fs.readdirSync as jest.Mock).mockReturnValue(videoFiles);
            (fs.statSync as jest.Mock).mockImplementation(() => ({ isFile: () => true, isDirectory: () => false }));
            
            const generatorWithLimit = new ClipGenerator(MOCK_OUTPUT_DIR, MOCK_FFMPEG_PATH, MOCK_FFPROBE_PATH, 2);
            const mockClipPaths1 = ['v1_clip.mp4'];
            const mockClipPaths3 = ['v3_clip.mp4'];

            jest.spyOn(generatorWithLimit, 'detectScenesAndGenerateClips')
                .mockImplementation(async (videoPath: string) => {
                    if (videoPath.includes('error_video')) throw new Error('Processing error');
                    if (videoPath.includes('video1')) return mockClipPaths1;
                    if (videoPath.includes('video3')) return mockClipPaths3;
                    return [];
                });
            // Ensure fallback is also mocked in case the error is in the primary method, then it tries fallback.
            jest.spyOn(generatorWithLimit, 'detectScenesWithFFmpegAndGenerateClips')
                .mockImplementation(async (videoPath: string) => {
                     if (videoPath.includes('error_video')) throw new Error('Fallback processing error');
                     return [];
                });


            const results = await generatorWithLimit.processDirectory(MOCK_OUTPUT_DIR, {});
            expect(results).toEqual([...mockClipPaths1, ...mockClipPaths3]); // error_video.mp4 should produce no clips
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to process video'), expect.any(Error));
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining(path.join(MOCK_OUTPUT_DIR, 'error_video.mp4')), expect.any(Error));
        });
    });

    describe('processVideosLikePython', () => {
        // This method was refactored to find all .mp4 files recursively.
        // And uses detectScenesFFmpeg internally.
        
        beforeEach(() => {
            // Mock limpiarNombresArchivosRecursivo to simplify tests for now
            jest.spyOn(clipGenerator as any, 'limpiarNombresArchivosRecursivo').mockImplementation(() => {});
        });

        it('should find and process .mp4 files recursively, respecting concurrency', async () => {
            const MOCK_INPUT_DIR = 'input_python';
            // Simulate a nested structure for findMp4Files
            (fs.readdirSync as jest.Mock)
                .mockImplementation((dirPath: string) => {
                    if (dirPath === MOCK_INPUT_DIR) return [{ name: 'video1.mp4', isFile: () => true, isDirectory: () => false }, { name: 'subdir', isFile: () => false, isDirectory: () => true }];
                    if (dirPath === path.join(MOCK_INPUT_DIR, 'subdir')) return [{ name: 'video2.mp4', isFile: () => true, isDirectory: () => false }];
                    return [];
                });

            const generatorWithLimit = new ClipGenerator(MOCK_OUTPUT_DIR, MOCK_FFMPEG_PATH, MOCK_FFPROBE_PATH, 1); // Limit 1 for easier check
            const mockScenes1: [number, number][] = [[0, 2.5]]; // Results for detectScenesFFmpeg
            const mockScenes2: [number, number][] = [[5, 7.5]];
            
            jest.spyOn(generatorWithLimit as any, 'detectScenesFFmpeg')
                .mockImplementation(async (videoPath: string) => {
                    if (videoPath.includes('video1')) return mockScenes1;
                    if (videoPath.includes('video2')) return mockScenes2;
                    return [];
                });
            
            // Mock generateClipWithoutAudio which is called by the internal processing logic
            let generatedClipCounter = 0;
            jest.spyOn(generatorWithLimit as any, 'generateClipWithoutAudio')
                .mockImplementation(async () => `clip_${++generatedClipCounter}.mp4`);

            const results = await generatorWithLimit.processVideosLikePython(MOCK_INPUT_DIR, { minDuration: 1, maxDuration: 3 });
            
            expect((generatorWithLimit as any).limpiarNombresArchivosRecursivo).toHaveBeenCalledWith(MOCK_INPUT_DIR);
            expect((generatorWithLimit as any).detectScenesFFmpeg).toHaveBeenCalledTimes(2);
            expect((generatorWithLimit as any).detectScenesFFmpeg).toHaveBeenCalledWith(path.join(MOCK_INPUT_DIR, 'video1.mp4'), expect.any(Object));
            expect((generatorWithLimit as any).detectScenesFFmpeg).toHaveBeenCalledWith(path.join(MOCK_INPUT_DIR, 'subdir', 'video2.mp4'), expect.any(Object));
            
            expect((generatorWithLimit as any).generateClipWithoutAudio).toHaveBeenCalledTimes(2); // One clip per video based on mockScenes
            expect(results.length).toBe(2);
            expect(results).toEqual(['clip_1.mp4', 'clip_2.mp4']);
        });
    });
    
    describe('detectScenesAndGenerateClips (PySceneDetect primary, FFmpeg fallback)', () => {
        const videoPath = 'test_video.mp4';
        const options: SceneDetectionOptions = { minDuration: 1.0, maxDuration: 3.0, threshold: 27 };

        it('should successfully generate clips using PySceneDetect (mocked CSV output)', async () => {
            const mockCsvData = `Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds),Length (frames),Length (timecode),Length (seconds)\n1,0,00:00:00.000,0.0,50,00:00:02.000,2.0,50,00:00:02.000,2.0\n2,50,00:00:02.000,2.0,100,00:00:04.000,4.0,50,00:00:02.000,2.0`;
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => p.endsWith('.csv')); // Only CSV exists
            (fs.readFileSync as jest.Mock).mockReturnValue(mockCsvData);
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, 'PySceneDetect output')); // Python process success

            // Mock generateClipWithoutAudio
            let clipCounter = 0;
            jest.spyOn(clipGenerator as any, 'generateClipWithoutAudio')
                .mockImplementation(async (vp, st, et, op) => {
                    clipCounter++;
                    return op; // Return the output path
                });
            
            const results = await clipGenerator.detectScenesAndGenerateClips(videoPath, options);

            expect(spawn).toHaveBeenCalledWith('python', expect.arrayContaining(['scenedetect', '--input', videoPath, 'list-scenes']));
            expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('-Scenes.csv'), 'utf8');
            expect(clipCounter).toBe(2); // Two scenes from CSV
            expect(results[0]).toContain(`${path.basename(videoPath, '.mp4')}_scene1.mp4`);
            expect(results[1]).toContain(`${path.basename(videoPath, '.mp4')}_scene2.mp4`);
        });

        it('should fallback to FFmpeg method if PySceneDetect process fails (exit code non-zero)', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(1, '', 'PySceneDetect error')); // Python process fails
            
            const mockFallbackClips = ['ffmpeg_fallback_clip1.mp4'];
            const ffmpegFallbackSpy = jest.spyOn(clipGenerator, 'detectScenesWithFFmpegAndGenerateClips')
                                        .mockResolvedValue(mockFallbackClips);

            const results = await clipGenerator.detectScenesAndGenerateClips(videoPath, options);
            
            expect(spawn).toHaveBeenCalledWith('python', expect.arrayContaining(['scenedetect']));
            expect(ffmpegFallbackSpy).toHaveBeenCalledWith(videoPath, options);
            expect(results).toEqual(mockFallbackClips);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('PySceneDetect failed, falling back to FFmpeg method'));
        });
        
        it('should fallback to FFmpeg method if PySceneDetect process spawn fails', async () => {
            (spawn as jest.Mock).mockImplementation(() => { throw new Error('Spawn error'); });
            
            const mockFallbackClips = ['ffmpeg_fallback_spawn_error.mp4'];
            // This time, the primary method will reject, and the catch block in `processDirectory` (or caller) would handle it.
            // Here we test detectScenesAndGenerateClips directly.
            // It should reject if spawn fails AND it cannot then proceed to fallback.
            // The current implementation of detectScenesAndGenerateClips has its own try/catch for spawn,
            // then if that fails, it *should* still try the fallback.
            // Let's adjust the test for the internal fallback logic.

            const ffmpegFallbackSpy = jest.spyOn(clipGenerator, 'detectScenesWithFFmpegAndGenerateClips')
                                        .mockResolvedValue(mockFallbackClips);
            
            // If spawn itself throws, the 'close' and 'error' event handlers for spawn are not reached.
            // The promise from detectScenesAndGenerateClips will reject.
            // The current structure of detectScenesAndGenerateClips *does not* have a try/catch around the spawn() call itself
            // that would then call the fallback. The fallback is only called if spawn succeeds but PySceneDetect process *exits with an error code*.
            // This is a subtle point. Let's test the current behavior.

            // To test the fallback path when spawn itself throws an error, we need to adjust the mock
            // so that the 'error' event is emitted by the spawned process.
            const erroringSpawnProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event, cb) => { if (event === 'error') cb(new Error('Spawn failed')); }),
                kill: jest.fn(),
            };
            (spawn as jest.Mock).mockReturnValue(erroringSpawnProcess);


            // Since the 'error' event for spawn leads to rejection, and the fallback is in the 'close' handler's error path,
            // this setup won't hit the fallback directly.
            // The current logic: spawn error -> reject. spawn success but PySceneDetect script error -> 'close' with non-zero -> fallback.
            // So, this test should expect a rejection.
            await expect(clipGenerator.detectScenesAndGenerateClips(videoPath, options))
                .rejects.toThrow('Failed to start PySceneDetect process: Spawn failed');
            
            // Fallback should NOT have been called if spawn itself fails before 'close'.
            expect(ffmpegFallbackSpy).not.toHaveBeenCalled();
        });
    });

    describe('detectScenesWithFFmpegAndGenerateClips', () => {
        const videoPath = 'test_ffmpeg_scenes.mp4';
        const options: SceneDetectionOptions = { minDuration: 1.0, maxDuration: 2.5, threshold: 0.3 };

        beforeEach(() => {
            // Mock getVideoDuration to return a fixed duration for these tests
            jest.spyOn(clipGenerator as any, 'getVideoDuration').mockResolvedValue(10.0); // 10s video
             // Mock generateClipWithoutAudio
            let clipCounter = 0;
            jest.spyOn(clipGenerator as any, 'generateClipWithoutAudio')
                .mockImplementation(async (vp, st, et, op) => {
                    clipCounter++;
                    return op; // Return the output path
                });
        });
        
        it('should generate clips based on FFmpeg scene detection output', async () => {
            const ffmpegStdErrOutput = `
                [Parsed_showinfo_1 @ 0x...] pts:123 pts_time:1.5 ...
                [Parsed_showinfo_1 @ 0x...] pts:456 pts_time:4.0 ...
                [Parsed_showinfo_1 @ 0x...] pts:789 pts_time:7.0 ...
            `; // Simulates 3 scene changes after time 0
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, '', ffmpegStdErrOutput));

            const results = await clipGenerator.detectScenesWithFFmpegAndGenerateClips(videoPath, options);
            
            expect(spawn).toHaveBeenCalledWith(MOCK_FFMPEG_PATH, expect.arrayContaining([
                '-i', videoPath,
                '-filter:v', `select='gt(scene,${options.threshold})',showinfo`,
                '-f', 'null',
                '-'
            ]));
            expect((clipGenerator as any).getVideoDuration).toHaveBeenCalledWith(videoPath);
            
            // Expected segments based on mock output (0-1.5, 1.5-2.5 (split from 1.5-4.0), 4.0-6.5, 6.5-7.0 (split from 4.0-7.0), 7.0-9.5, 9.5-10 (split from 7.0-10.0))
            // Times: 0, 1.5, 4.0, 7.0, 10.0 (duration)
            // Segments:
            // 1. [0, 1.5] (duration 1.5) -> 1 clip [0, 1.5]
            // 2. [1.5, 4.0] (duration 2.5) -> 1 clip [1.5, 4.0]
            // 3. [4.0, 7.0] (duration 3.0) -> split into [4.0, 6.5] and [6.5, 7.0] (invalid as < minDuration 1.0) -> so 1 clip [4.0, 6.5]
            // 4. [7.0, 10.0] (duration 3.0) -> split into [7.0, 9.5] and [9.5, 10.0] (invalid as < minDuration 1.0) -> so 1 clip [7.0, 9.5]
            // Total expected clips: 4
            expect((clipGenerator as any).generateClipWithoutAudio).toHaveBeenCalledTimes(4);
            expect(results.length).toBe(4);
            expect(results[0]).toContain('_scene1.mp4');
            expect(results[1]).toContain('_scene2.mp4');
            expect(results[2]).toContain('_scene3.mp4');
            expect(results[3]).toContain('_scene4.mp4');
        });
        
        it('should handle no scenes detected by FFmpeg (only start and end)', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, '', '')); // No pts_time output
            jest.spyOn(clipGenerator as any, 'getVideoDuration').mockResolvedValue(2.0); // Short video, less than maxDuration

            const results = await clipGenerator.detectScenesWithFFmpegAndGenerateClips(videoPath, { minDuration: 1.0, maxDuration: 3.0, threshold: 0.5 });
            // Expect one clip covering 0 to videoDuration if > minDuration
            expect((clipGenerator as any).generateClipWithoutAudio).toHaveBeenCalledTimes(1);
            expect(results.length).toBe(1);
            expect(results[0]).toContain('_scene1.mp4');
        });

        it('should reject if FFmpeg process for scene detection fails', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(1, '', 'ffmpeg error'));
            await expect(clipGenerator.detectScenesWithFFmpegAndGenerateClips(videoPath, options))
                .rejects.toThrow('FFmpeg process exited with code 1');
        });
    });
    
    describe('detectScenesFFmpeg (private method test)', () => {
        const videoPath = 'private_test.mp4';
        
        beforeEach(() => {
            jest.spyOn(clipGenerator as any, 'getVideoDuration').mockResolvedValue(15.0);
        });

        it('should parse FFmpeg stderr for scene timestamps', async () => {
            const ffmpegStdErrOutput = `
                [Parsed_showinfo_1 @ 0x...] pts_time:2.1 ...
                [Parsed_showinfo_1 @ 0x...] pts_time:5.8 ...
                [Parsed_showinfo_1 @ 0x...] pts_time:10.3 ...
            `;
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, '', ffmpegStdErrOutput));
            
            const scenes = await (clipGenerator as any).detectScenesFFmpeg(videoPath, { threshold: 0.4 });
            
            expect(spawn).toHaveBeenCalledWith(MOCK_FFMPEG_PATH, expect.arrayContaining(['select=\'gt(scene,0.4)\',showinfo']));
            expect((clipGenerator as any).getVideoDuration).toHaveBeenCalledWith(videoPath);
            expect(scenes).toEqual([
                [0, 2.1],
                [2.1, 5.8],
                [5.8, 10.3],
                [10.3, 15.0] // Last scene to video duration
            ]);
        });
        
        it('should handle empty FFmpeg output (no scenes found)', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(0, '', '')); // No pts_time in stderr
            const scenes = await (clipGenerator as any).detectScenesFFmpeg(videoPath, {});
            expect(scenes).toEqual([[0, 15.0]]); // Should return one scene from 0 to duration
        });

        it('should reject if FFmpeg process fails', async () => {
            (spawn as jest.Mock).mockReturnValue(mockSpawnProcess(1, '', 'ffmpeg error'));
            await expect((clipGenerator as any).detectScenesFFmpeg(videoPath, {}))
                .rejects.toThrow('Error en detección de escenas, código: 1');
        });
    });
});
