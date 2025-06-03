import { spawn } from 'child_process';

export interface AudioAnalysisResult {
  beats: number[];
  bpm?: number;
}

export class AudioAnalyzer {
  // Constructor can be used to accept configuration, like aubio path
  constructor() {}

  async analyzeBeats(audioFilePath: string): Promise<AudioAnalysisResult> {
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
              .filter(beat => !isNaN(beat)); // Ensure only valid numbers are included
            resolve({ beats });
          } catch (parseError: any) {
            reject(new Error(`Failed to parse aubioonset output: ${parseError.message}. Output was: ${stdoutData}`));
          }
        }
      });
    });
  }
}
