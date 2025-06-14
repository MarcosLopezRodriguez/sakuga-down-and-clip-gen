import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface SceneDetectionOptions {
  threshold?: number;
}

export class ClipGenerator {
  constructor(private outputDirectory: string = 'output/clips') {
    if (!fs.existsSync(this.outputDirectory)) {
      fs.mkdirSync(this.outputDirectory, { recursive: true });
    }
  }

  async detectScenesAndGenerateClips(videoPath: string, options: SceneDetectionOptions = {}): Promise<string[]> {
    const threshold = options.threshold || 30;
    const videoBase = path.basename(videoPath, path.extname(videoPath));
    const outputDir = path.join(this.outputDirectory, videoBase);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      '-m', 'scenedetect',
      '--input', videoPath,
      'detect-content',
      '--threshold', threshold.toString(),
      'split-video',
      '--output', outputDir,
      '--filename-format', `${videoBase}_Scene-$SCENE_NUMBER.mp4`
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('python', args);
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`PySceneDetect exited with code ${code}`));
      });
      proc.on('error', err => reject(err));
    });

    return fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => path.join(outputDir, f));
  }
}

export default ClipGenerator;
