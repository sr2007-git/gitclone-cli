import fs from 'fs';
import path from 'path';
import { VCS_DIR, isRepoInit, writeHEAD, writeIndex, ensureSandboxExists } from './storage';

export function initRepo(): { success: boolean; message: string } {
  // Ensure the sandbox folder exists so they have a working directory
  ensureSandboxExists();

  if (isRepoInit()) {
    return {
      success: false,
      message: 'Repository already exists. Detected existing GitClone repository.'
    };
  }

  try {
    fs.mkdirSync(VCS_DIR, { recursive: true });
    fs.mkdirSync(path.join(VCS_DIR, 'commits'), { recursive: true });
    fs.mkdirSync(path.join(VCS_DIR, 'objects'), { recursive: true });
    fs.mkdirSync(path.join(VCS_DIR, 'branches'), { recursive: true });

    // Initialize an empty staging index
    writeIndex({});

    // Point HEAD to the default branch "main"
    writeHEAD('branch', 'main');

    return {
      success: true,
      message: 'Initialized empty GitClone repository in sandbox/.gitclone/'
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to initialize repository: ${error.message}`
    };
  }
}
