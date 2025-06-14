import { spawn } from 'child_process';

export interface AudioAnalysisResult {
  beats: number[];
  bpm?: number;
}

export class AudioAnalyzer {
  constructor() {}
  async analyzeBeats(audioFilePath: string): Promise<AudioAnalysisResult> {
    return await this.analyzeBeatsWithAubio(audioFilePath);
  }

  private async analyzeBeatsWithAubio(audioFilePath: string): Promise<AudioAnalysisResult> {
    return new Promise((resolve, reject) => {
      const aubioProcess = spawn('aubioonset', [audioFilePath]);
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
        } else {
          try {
            const beats = stdoutData
              .trim()
              .split('\n')
              .map(line => parseFloat(line))
              .filter(beat => !isNaN(beat));
            resolve({ beats });
          } catch (parseError: any) {
            reject(new Error(`Failed to parse aubioonset output: ${parseError.message}. Output was: ${stdoutData}`));
          }
        }
      });
    });
  }

  private generateSimpleBeatPattern(): number[] {
    // Generate a simple beat pattern at 120 BPM for 30 seconds
    const bpm = 120;
    const duration = 30; // seconds
    const beatInterval = 60 / bpm; // seconds per beat
    const beats: number[] = [];

    for (let time = 0; time < duration; time += beatInterval) {
      beats.push(time);
    }

    return beats;
  }

  // Method to get audio duration (returns 30 seconds by default)
  async getAudioDuration(audioFilePath: string): Promise<number> {
    return 30;
  }
}
