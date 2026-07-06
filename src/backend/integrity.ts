import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { VCS_DIR, readHEAD, readGitObject, logMessage } from './storage';

// Find all branch tips and tag pointers to define root elements for reachability
export function findActiveHeads(): string[] {
  const heads = new Set<string>();
  
  // 1. HEAD pointer
  const head = readHEAD();
  if (head) {
    if (head.type === 'commit') {
      heads.add(head.value);
    }
  }

  // 2. All branches
  const branchesDir = path.join(VCS_DIR, 'branches');
  if (fs.existsSync(branchesDir)) {
    const branches = fs.readdirSync(branchesDir);
    for (const b of branches) {
      const bPath = path.join(branchesDir, b);
      if (fs.statSync(bPath).isFile()) {
        const commitId = fs.readFileSync(bPath, 'utf-8').trim();
        if (commitId) heads.add(commitId);
      }
    }
  }

  // 3. All tags
  const tagsDir = path.join(VCS_DIR, 'tags');
  if (fs.existsSync(tagsDir)) {
    const tags = fs.readdirSync(tagsDir);
    for (const t of tags) {
      const tPath = path.join(tagsDir, t);
      if (fs.statSync(tPath).isFile()) {
        const commitId = fs.readFileSync(tPath, 'utf-8').trim();
        if (commitId) heads.add(commitId);
      }
    }
  }

  return Array.from(heads);
}

// Walks commit references recursively to construct a set of reachable objects (Requirement 3)
export function getReachableObjects(): Set<string> {
  const reachable = new Set<string>();
  const activeHeads = findActiveHeads();
  const visitedCommits = new Set<string>();

  const traverseTree = (treeHash: string) => {
    if (reachable.has(treeHash)) return;
    reachable.add(treeHash);

    const obj = readGitObject(treeHash);
    if (!obj || obj.type !== 'tree') return;

    try {
      const entries = JSON.parse(obj.content);
      for (const entry of entries) {
        if (entry.type === 'blob') {
          reachable.add(entry.hash);
        } else if (entry.type === 'tree') {
          traverseTree(entry.hash);
        }
      }
    } catch {
      // ignore parsing glitches
    }
  };

  const traverseCommit = (commitId: string) => {
    if (visitedCommits.has(commitId)) return;
    visitedCommits.add(commitId);
    reachable.add(commitId);

    const obj = readGitObject(commitId);
    if (!obj || obj.type !== 'commit') return;

    try {
      const commitData = JSON.parse(obj.content);
      if (commitData.tree) {
        traverseTree(commitData.tree);
      }
      if (commitData.parent) {
        traverseCommit(commitData.parent);
      }
      if (commitData.parent2) {
        traverseCommit(commitData.parent2);
      }
    } catch {
      // ignore
    }
  };

  for (const head of activeHeads) {
    traverseCommit(head);
  }

  return reachable;
}

export function runGarbageCollection(dryRun: boolean = false): { success: boolean; message: string; deleted: string[] } {
  try {
    const reachable = getReachableObjects();
    const objectsDir = path.join(VCS_DIR, 'objects');
    if (!fs.existsSync(objectsDir)) {
      return { success: true, message: 'No objects found.', deleted: [] };
    }

    const allObjects = fs.readdirSync(objectsDir);
    const deleted: string[] = [];

    for (const objFile of allObjects) {
      if (!reachable.has(objFile)) {
        deleted.push(objFile);
        if (!dryRun) {
          fs.unlinkSync(path.join(objectsDir, objFile));
        }
      }
    }

    const modeStr = dryRun ? 'Dry run' : 'Successfully executed GC';
    logMessage('INFO', `${modeStr}: removed ${deleted.length} orphaned objects`);
    return {
      success: true,
      message: `${modeStr}: identified ${deleted.length} orphaned object(s) for removal out of ${allObjects.length} total.`,
      deleted
    };
  } catch (error: any) {
    logMessage('ERROR', `GC failed: ${error.message}`);
    return { success: false, message: `GC failed: ${error.message}`, deleted: [] };
  }
}

export interface IntegrityReport {
  success: boolean;
  corruptedObjects: string[];
  danglingReferences: { from: string; to: string; type: string }[];
  orphanedObjects: string[];
  totalObjectsCount: number;
}

export function checkIntegrity(): IntegrityReport {
  const corruptedObjects: string[] = [];
  const danglingReferences: { from: string; to: string; type: string }[] = [];
  const objectsDir = path.join(VCS_DIR, 'objects');
  
  if (!fs.existsSync(objectsDir)) {
    return {
      success: true,
      corruptedObjects: [],
      danglingReferences: [],
      orphanedObjects: [],
      totalObjectsCount: 0
    };
  }

  const allObjects = fs.readdirSync(objectsDir);
  const existingObjects = new Set(allObjects);

  // 1. Verify decompression and SHA-1 checksum match for EVERY object (Requirement 2)
  for (const objHash of allObjects) {
    const objPath = path.join(objectsDir, objHash);
    try {
      const fileBuffer = fs.readFileSync(objPath);
      let decompressed: Buffer;
      try {
        decompressed = zlib.inflateSync(fileBuffer);
      } catch {
        // Fallback: raw format check
        const rawContent = fileBuffer.toString('utf-8');
        const computed = crypto.createHash('sha1').update(rawContent, 'utf-8').digest('hex');
        if (computed !== objHash) {
          corruptedObjects.push(objHash);
        }
        continue;
      }

      // Check header format
      const nullIndex = decompressed.indexOf(0);
      let computed: string;
      if (nullIndex !== -1) {
        const header = decompressed.toString('utf-8', 0, nullIndex);
        const parts = header.split(' ');
        if (parts.length === 2 && (parts[0] === 'blob' || parts[0] === 'tree' || parts[0] === 'commit')) {
          computed = crypto.createHash('sha1').update(decompressed).digest('hex');
        } else {
          computed = crypto.createHash('sha1').update(decompressed.toString('utf-8'), 'utf-8').digest('hex');
        }
      } else {
        computed = crypto.createHash('sha1').update(decompressed.toString('utf-8'), 'utf-8').digest('hex');
      }

      if (computed !== objHash) {
        corruptedObjects.push(objHash);
      }
    } catch {
      corruptedObjects.push(objHash);
    }
  }

  // 2. Check for dangling references (Requirement 2)
  for (const objHash of allObjects) {
    if (corruptedObjects.includes(objHash)) continue;

    const gitObj = readGitObject(objHash);
    if (!gitObj) continue;

    try {
      if (gitObj.type === 'commit') {
        const data = JSON.parse(gitObj.content);
        if (data.parent && !existingObjects.has(data.parent)) {
          danglingReferences.push({ from: objHash, to: data.parent, type: 'commit-parent' });
        }
        if (data.parent2 && !existingObjects.has(data.parent2)) {
          danglingReferences.push({ from: objHash, to: data.parent2, type: 'commit-parent2' });
        }
        if (data.tree && !existingObjects.has(data.tree)) {
          danglingReferences.push({ from: objHash, to: data.tree, type: 'commit-tree' });
        }
      } else if (gitObj.type === 'tree') {
        const entries = JSON.parse(gitObj.content);
        for (const entry of entries) {
          if (!existingObjects.has(entry.hash)) {
            danglingReferences.push({ from: objHash, to: entry.hash, type: `tree-${entry.type}` });
          }
        }
      }
    } catch {
      // ignore parsing exceptions
    }
  }

  // 3. Find orphaned objects (any existing object not in reachable set) (Requirement 2)
  const reachable = getReachableObjects();
  const orphanedObjects: string[] = [];
  for (const objHash of allObjects) {
    if (!reachable.has(objHash)) {
      orphanedObjects.push(objHash);
    }
  }

  const success = corruptedObjects.length === 0 && danglingReferences.length === 0;
  logMessage('INFO', `Integrity check completed: success=${success}, corrupted=${corruptedObjects.length}, dangling=${danglingReferences.length}`);

  return {
    success,
    corruptedObjects,
    danglingReferences,
    orphanedObjects,
    totalObjectsCount: allObjects.length
  };
}
