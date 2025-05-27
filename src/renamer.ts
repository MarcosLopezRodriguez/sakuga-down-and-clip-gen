import * as fs from 'fs/promises';
import * as path from 'path';

interface RenameResult {
    oldName: string;
    newName: string;
    status: 'Renamed' | 'Error' | 'Skipped';
    originalPath: string; // Relative path within inputDir, e.g., "subdir/video.mp4"
    newPath: string;      // Full absolute path to the new file in outputDir
    error?: string;
}

export class Renamer {
    constructor() {
        // Optional: Initialize any properties if needed
    }

    private async createDirectories(inputPath: string, outputPath: string): Promise<void> {
        try {
            await fs.access(inputPath);
        } catch {
            console.log(`Input directory ${inputPath} does not exist. It will be used as is if valid, or fail if not accessible during scan.`);
            // No creation here, rely on the initial check in renameVideoFiles for inputDir
        }

        try {
            await fs.access(outputPath);
        } catch {
            console.log(`Output directory ${outputPath} does not exist. Creating it.`);
            await fs.mkdir(outputPath, { recursive: true });
        }
    }

    private generateRandomName(length: number = 20): string {
        return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
    }

    public async renameVideoFiles(inputDir: string, outputDir: string): Promise<RenameResult[]> {
        const results: RenameResult[] = [];

        try {
            await fs.access(inputDir);
        } catch (error) {
            const errorMessage = `Input directory ${inputDir} not found or not accessible.`;
            console.error(errorMessage);
            return [{
                oldName: '', newName: '', status: 'Error',
                originalPath: inputDir, newPath: '',
                error: errorMessage
            }];
        }

        // Ensure output directory exists before starting the walk
        await this.createDirectories(inputDir, outputDir);

        const walkDir = async (currentRelativePath: string): Promise<void> => {
            const absoluteCurrentPath = path.join(inputDir, currentRelativePath);
            let entries;
            try {
                entries = await fs.readdir(absoluteCurrentPath, { withFileTypes: true });
            } catch (err: any) {
                console.error(`Error reading directory ${absoluteCurrentPath}: ${err.message}`);
                results.push({
                    oldName: '', newName: '', status: 'Error',
                    originalPath: currentRelativePath, newPath: '',
                    error: `Failed to read directory ${absoluteCurrentPath}: ${err.message}`
                });
                return;
            }

            for (const entry of entries) {
                const entryRelativePath = path.join(currentRelativePath, entry.name);
                const sourceFilePath = path.join(inputDir, entryRelativePath); // Absolute path to source

                if (entry.isDirectory()) {
                    await walkDir(entryRelativePath);
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
                    const originalFileName = entry.name;
                    let randomFileStem = this.generateRandomName();
                    let newFileName = `${randomFileStem}.mp4`;
                    let targetPath = path.join(outputDir, newFileName);
                    let attempts = 0;
                    const maxAttempts = 100;

                    while (attempts < maxAttempts) {
                        try {
                            await fs.access(targetPath); // Check if file exists
                            // File exists, generate a new name
                            randomFileStem = this.generateRandomName();
                            newFileName = `${randomFileStem}.mp4`;
                            targetPath = path.join(outputDir, newFileName);
                            attempts++;
                        } catch {
                            // File does not exist, name is unique
                            break;
                        }
                    }

                    if (attempts >= maxAttempts) {
                        const errorMessage = `Failed to generate a unique name for ${originalFileName} after ${maxAttempts} attempts.`;
                        console.error(errorMessage);
                        results.push({
                            oldName: originalFileName, newName: '', status: 'Error',
                            originalPath: entryRelativePath, newPath: '',
                            error: errorMessage
                        });
                        continue; // Skip to the next file
                    }

                    try {
                        await fs.copyFile(sourceFilePath, targetPath);
                        results.push({
                            oldName: originalFileName,
                            newName: newFileName,
                            status: 'Renamed',
                            originalPath: entryRelativePath, // This is relative to inputDir
                            newPath: targetPath              // This is absolute
                        });
                        console.log(`Copied and renamed: ${entryRelativePath} -> ${newFileName} (in ${outputDir})`);
                    } catch (err: any) {
                        console.error(`Error copying file ${originalFileName}: ${err.message}`);
                        results.push({
                            oldName: originalFileName, newName: '', status: 'Error',
                            originalPath: entryRelativePath, newPath: '',
                            error: `Error copying: ${err.message}`
                        });
                    }
                }
            }
        };

        console.log(`Starting video renaming process. Input: '${inputDir}', Output: '${outputDir}'`);
        await walkDir(''); // Start with an empty relative path

        if (results.filter(r => r.status === 'Renamed').length === 0 && results.filter(r => r.status === 'Error').length === 0) {
            console.log("No MP4 files found in the input directory.");
            // Optionally add a specific result message for no files found if desired by frontend
        }
        
        return results;
    }
}
