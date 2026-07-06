#!/usr/bin/env npx tsx
import { isRepoInit, readHEAD, getBranchCommitId, readConfig, writeConfig, listBranches } from './src/backend/storage';
import { initRepo } from './src/backend/init';
import { getRepoStatus } from './src/backend/status';
import { trackFiles, commitChanges, getHistory } from './src/backend/commit';
import { createBranch, removeBranch } from './src/backend/branch';
import { checkoutTarget } from './src/backend/checkout';
import { attemptMerge, completeMerge } from './src/backend/merge';
import { listTags, createTag, deleteTag, checkoutTag } from './src/backend/tags';
import { readStashes, saveStash, applyStash, dropStash } from './src/backend/stash';
import { readReflog, resetToCommit } from './src/backend/reflog';
import { getFileBlame } from './src/backend/blame';
import { cherryPick, rebaseBranch } from './src/backend/cherry_pick';
import { checkIntegrity, runGarbageCollection } from './src/backend/integrity';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mGitClone Command-Line Interface (CLI)\x1b[0m
Exposes the advanced, production-grade GitClone VCS features directly to your terminal.

\x1b[1mUsage:\x1b[0m
  npx tsx cli.ts <command> [arguments]

\x1b[1mCore Commands:\x1b[0m
  \x1b[32minit\x1b[0m                       Initialize a brand new GitClone repository
  \x1b[32mstatus\x1b[0m                     Show tracked, modified, and untracked files in the sandbox
  \x1b[32madd <path>\x1b[0m                 Stage file changes for commit (leave empty or use '.' to stage all)
  \x1b[32mcommit -m "<message>"\x1b[0m      Record staged snapshots to a compressed, typed Git Object commit
  \x1b[32mbranch\x1b[0m                     List all local branches
  \x1b[32mbranch <name>\x1b[0m              Create a new branch pointing at current HEAD
  \x1b[32mbranch -d <name>\x1b[0m           Delete a branch
  \x1b[32mcheckout <target>\x1b[0m          Switch branches or detach HEAD to a specific commit ID
  \x1b[32mcheckout -f <target>\x1b[0m       Force switch branches and discard uncommitted changes

\x1b[1mCollaboration & Advanced Flow:\x1b[0m
  \x1b[32mmerge <target-branch>\x1b[0m      Three-way merge with automatic fast-forwards and conflict markers
  \x1b[32mcherry-pick <commit-id>\x1b[0m    Apply changes of a single commit onto current HEAD
  \x1b[32mrebase <src> <target>\x1b[0m      Replay unique commits from source branch onto target branch tip
  \x1b[32mblame <path>\x1b[0m               Perform line-by-line history attribution using an LCS diff walk
  \x1b[32mhistory\x1b[0m                    View paginated commit logs on the active branch
  \x1b[32mreflog\x1b[0m                     Show append-only transaction history of HEAD pointer changes
  \x1b[32mreset <commit-id>\x1b[0m          Reset HEAD pointer and working files back to a previous commit

\x1b[1mOrganizers & Utilities:\x1b[0m
  \x1b[32mtag\x1b[0m                        List all named permanent lightweight tags
  \x1b[32mtag <name> <commit-id>\x1b[0m     Create a tag pointing to a specific commit
  \x1b[32mtag -d <name>\x1b[0m              Delete an existing tag
  \x1b[32mstash save "<message>"\x1b[0m    Save uncommitted changes into a compressed workspace stash
  \x1b[32mstash list\x1b[0m                 List all active stashes
  \x1b[32mstash apply <id>\x1b[0m           Apply stashed changes back into workspace and staging index
  \x1b[32mstash drop <id>\x1b[0m            Delete a stash entry

\x1b[1mMaintenance & Settings:\x1b[0m
  \x1b[32mconfig\x1b[0m                     Display current repository configurations and ignore rules
  \x1b[32mconfig set <name> <email>\x1b[0m  Configure default commit author name and email
  \x1b[32mfsck\x1b[0m                       Perform SHA-1 hash integrity audit and list orphaned objects
  \x1b[32mgc\x1b[0m                         Run garbage collection and safely delete unreachable object files
`);
}

function checkInit(): boolean {
  if (!isRepoInit()) {
    console.error('\x1b[31mError: Not a GitClone repository. Run "cli.ts init" to begin.\x1b[0m');
    return false;
  }
  return true;
}

switch (command) {
  case 'help':
  case '-h':
  case '--help':
  case undefined:
    printHelp();
    break;

  case 'init':
    console.log('Initializing GitClone repository...');
    const initRes = initRepo();
    if (initRes.success) {
      console.log(`\x1b[32m${initRes.message}\x1b[0m`);
    } else {
      console.error(`\x1b[31m${initRes.message}\x1b[0m`);
    }
    break;

  case 'status':
    if (!checkInit()) break;
    const status = getRepoStatus();
    console.log(`On branch: \x1b[36m${status.currentBranch || (status.isDetached ? 'Detached HEAD' : 'main')}\x1b[0m\n`);
    if (status.files.length === 0) {
      console.log('Working directory clean, nothing to commit.');
      break;
    }
    console.log('Staged files (to be committed):');
    const staged = status.files.filter(f => f.status === 'staged_new' || f.status === 'modified_staged' || f.status === 'staged_deleted');
    if (staged.length === 0) {
      console.log('  \x1b[90m(None)\x1b[0m');
    } else {
      staged.forEach(f => console.log(`  \x1b[32m${f.status.padEnd(16)}: ${f.path}\x1b[0m`));
    }

    console.log('\nUnstaged files (modified or deleted but not tracked):');
    const unstaged = status.files.filter(f => f.status === 'modified_unstaged' || f.status === 'deleted_unstaged');
    if (unstaged.length === 0) {
      console.log('  \x1b[90m(None)\x1b[0m');
    } else {
      unstaged.forEach(f => console.log(`  \x1b[31m${f.status.padEnd(16)}: ${f.path}\x1b[0m`));
    }

    console.log('\nUntracked files:');
    const untracked = status.files.filter(f => f.status === 'untracked');
    if (untracked.length === 0) {
      console.log('  \x1b[90m(None)\x1b[0m');
    } else {
      untracked.forEach(f => console.log(`  \x1b[33m${f.path}\x1b[0m`));
    }
    break;

  case 'add':
    if (!checkInit()) break;
    const addPath = args[1];
    const addRes = trackFiles(addPath === '.' || addPath === undefined ? undefined : addPath);
    if (addRes.success) {
      console.log(`\x1b[32m${addRes.message}\x1b[0m`);
      addRes.tracked.forEach(t => console.log(`  Added: \x1b[36m${t.path}\x1b[0m -> ${t.hash.substring(0, 10)}...`));
    } else {
      console.error(`\x1b[31m${addRes.message}\x1b[0m`);
    }
    break;

  case 'commit':
    if (!checkInit()) break;
    const mFlagIdx = args.indexOf('-m');
    let message = '';
    if (mFlagIdx !== -1 && args[mFlagIdx + 1]) {
      message = args[mFlagIdx + 1];
    } else {
      console.error('\x1b[31mError: Commit message required. Use commit -m "<message>"\x1b[0m');
      break;
    }
    const configObj = readConfig();
    const commitRes = commitChanges(message, `${configObj.authorName} <${configObj.authorEmail}>`);
    if (commitRes.success && commitRes.commit) {
      console.log(`\x1b[32m${commitRes.message}\x1b[0m`);
      console.log(`Author: ${commitRes.commit.author}`);
      console.log(`Tree:   ${(commitRes.commit as any).tree || 'Tree Hash'}`);
    } else {
      console.error(`\x1b[31m${commitRes.message}\x1b[0m`);
    }
    break;

  case 'branch':
    if (!checkInit()) break;
    const subArg = args[1];
    if (!subArg) {
      // List branches
      const branches = listBranches();
      const head = readHEAD();
      branches.forEach(b => {
        const isCurrent = head?.type === 'branch' && head.value === b;
        const prefix = isCurrent ? '* \x1b[32m' : '  ';
        const suffix = isCurrent ? '\x1b[0m' : '';
        const commitId = getBranchCommitId(b);
        console.log(`${prefix}${b.padEnd(20)} [${commitId?.substring(0, 7) || 'no commit'}]${suffix}`);
      });
    } else if (subArg === '-d') {
      const delName = args[2];
      if (!delName) {
        console.error('\x1b[31mError: Specify branch name to delete.\x1b[0m');
        break;
      }
      const delRes = removeBranch(delName);
      if (delRes.success) {
        console.log(`\x1b[32m${delRes.message}\x1b[0m`);
      } else {
        console.error(`\x1b[31m${delRes.message}\x1b[0m`);
      }
    } else {
      const bRes = createBranch(subArg);
      if (bRes.success) {
        console.log(`\x1b[32mBranch "${subArg}" created successfully.\x1b[0m`);
      } else {
        console.error(`\x1b[31m${bRes.message}\x1b[0m`);
      }
    }
    break;

  case 'checkout':
    if (!checkInit()) break;
    let target = args[1];
    let force = false;
    if (target === '-f') {
      force = true;
      target = args[2];
    }
    if (!target) {
      console.error('\x1b[31mError: Specify target branch, tag, or commit ID to checkout.\x1b[0m');
      break;
    }
    const checkoutRes = checkoutTarget(target, force);
    if (checkoutRes.success) {
      console.log(`\x1b[32m${checkoutRes.message}\x1b[0m`);
    } else {
      console.error(`\x1b[31m${checkoutRes.message}\x1b[0m`);
    }
    break;

  case 'merge':
    if (!checkInit()) break;
    const mergeBranch = args[1];
    if (!mergeBranch) {
      console.error('\x1b[31mError: Specify target branch to merge.\x1b[0m');
      break;
    }
    const mergeRes = attemptMerge(mergeBranch);
    if (mergeRes.success) {
      console.log(`\x1b[32m${mergeRes.message}\x1b[0m`);
    } else if (mergeRes.conflict) {
      console.log(`\x1b[33mMerge Conflict Detected in ${mergeRes.conflicts?.length} file(s)!\x1b[0m`);
      console.log('In-file conflict markers written. Resolve conflicts and commit the files.');
      mergeRes.conflicts?.forEach(c => {
        console.log(`  - \x1b[31mConflict in file:\x1b[0m ${c.path}`);
      });
    } else {
      console.error(`\x1b[31m${mergeRes.message}\x1b[0m`);
    }
    break;

  case 'cherry-pick':
    if (!checkInit()) break;
    const cpCommit = args[1];
    if (!cpCommit) {
      console.error('\x1b[31mError: Specify a commit ID to cherry-pick.\x1b[0m');
      break;
    }
    const cpRes = cherryPick(cpCommit);
    if (cpRes.success) {
      console.log(`\x1b[32m${cpRes.message}\x1b[0m`);
    } else {
      console.error(`\x1b[31m${cpRes.message}\x1b[0m`);
    }
    break;

  case 'rebase':
    if (!checkInit()) break;
    const rSrc = args[1];
    const rTgt = args[2];
    if (!rSrc || !rTgt) {
      console.error('\x1b[31mError: Specify both source-branch and target-branch. Usage: rebase <src> <target>\x1b[0m');
      break;
    }
    const rebaseRes = rebaseBranch(rSrc, rTgt);
    if (rebaseRes.success) {
      console.log(`\x1b[32m${rebaseRes.message}\x1b[0m`);
    } else {
      console.error(`\x1b[31m${rebaseRes.message}\x1b[0m`);
    }
    break;

  case 'blame':
    if (!checkInit()) break;
    const blamePath = args[1];
    if (!blamePath) {
      console.error('\x1b[31mError: Specify file path to blame.\x1b[0m');
      break;
    }
    const headInfo = readHEAD();
    if (!headInfo) break;
    let bCommitId: string | null = null;
    if (headInfo.type === 'branch') {
      bCommitId = getBranchCommitId(headInfo.value);
    } else {
      bCommitId = headInfo.value;
    }
    if (!bCommitId) {
      console.error('\x1b[31mError: No commits yet.\x1b[0m');
      break;
    }
    const blameLines = getFileBlame(blamePath, bCommitId);
    if (!blameLines) {
      console.error(`\x1b[31mError: Could not retrieve blame history for "${blamePath}".\x1b[0m`);
      break;
    }
    console.log(`\x1b[1mLine attribution for: ${blamePath} starting at HEAD (${bCommitId.substring(0, 7)})\x1b[0m\n`);
    blameLines.forEach(l => {
      const shortCId = l.commitId.substring(0, 7);
      const shortAuthor = l.author.split('<')[0].trim().substring(0, 15);
      const lineNumStr = l.lineNumber.toString().padStart(4);
      console.log(`\x1b[36m${shortCId}\x1b[0m (\x1b[33m${shortAuthor.padEnd(15)}\x1b[0m) ${lineNumStr} | ${l.content}`);
    });
    break;

  case 'history':
    if (!checkInit()) break;
    const hHead = readHEAD();
    if (!hHead) break;
    let hCommitId = hHead.type === 'branch' ? getBranchCommitId(hHead.value) : hHead.value;
    if (!hCommitId) {
      console.log('No commit history yet.');
      break;
    }
    const historyList = getHistory(hCommitId);
    console.log(`Commit logs on branch/HEAD: \x1b[36m${hHead.value}\x1b[0m (Total: ${historyList.length})\n`);
    historyList.forEach(c => {
      console.log(`\x1b[33mcommit ${c.id}\x1b[0m`);
      if (c.parent2) console.log(`Merge:  ${c.parent?.substring(0, 7)} ${c.parent2.substring(0, 7)}`);
      console.log(`Author: ${c.author}`);
      console.log(`Date:   ${new Date(c.timestamp).toLocaleString()}`);
      console.log(`\n    ${c.message}\n`);
    });
    break;

  case 'reflog':
    if (!checkInit()) break;
    const reflogs = readReflog();
    if (reflogs.length === 0) {
      console.log('Reflog is empty.');
      break;
    }
    console.log('\x1b[1mChronological Pointer Transaction History (Reflog):\x1b[0m\n');
    reflogs.forEach(r => {
      console.log(`  \x1b[36m${new Date(r.timestamp).toLocaleTimeString()}\x1b[0m  [${r.action}]  ${r.message}`);
    });
    break;

  case 'reset':
    if (!checkInit()) break;
    const resetTarget = args[1];
    if (!resetTarget) {
      console.error('\x1b[31mError: Specify a commit ID to reset HEAD back to.\x1b[0m');
      break;
    }
    const resetRes = resetToCommit(resetTarget);
    if (resetRes.success) {
      console.log(`\x1b[32m${resetRes.message}\x1b[0m`);
    } else {
      console.error(`\x1b[31m${resetRes.message}\x1b[0m`);
    }
    break;

  case 'tag':
    if (!checkInit()) break;
    const tagSub = args[1];
    if (!tagSub) {
      const tags = listTags();
      if (tags.length === 0) {
        console.log('No tags found.');
      } else {
        tags.forEach(t => console.log(`  \x1b[32m${t.name.padEnd(20)}\x1b[0m -> ${t.commitId}`));
      }
    } else if (tagSub === '-d') {
      const tagName = args[2];
      if (!tagName) {
        console.error('\x1b[31mError: Specify tag name to delete.\x1b[0m');
        break;
      }
      const tDelRes = deleteTag(tagName);
      if (tDelRes.success) {
        console.log(`\x1b[32m${tDelRes.message}\x1b[0m`);
      } else {
        console.error(`\x1b[31m${tDelRes.message}\x1b[0m`);
      }
    } else {
      const tagCId = args[2];
      if (!tagCId) {
        console.error('\x1b[31mError: Specify commit ID for tag. Usage: tag <name> <commit-id>\x1b[0m');
        break;
      }
      const tRes = createTag(tagSub, tagCId);
      if (tRes.success) {
        console.log(`\x1b[32m${tRes.message}\x1b[0m`);
      } else {
        console.error(`\x1b[31m${tRes.message}\x1b[0m`);
      }
    }
    break;

  case 'stash':
    if (!checkInit()) break;
    const stashSub = args[1];
    if (stashSub === 'save') {
      const stashMsg = args[2] || '';
      const sRes = saveStash(stashMsg);
      if (sRes.success) {
        console.log(`\x1b[32m${sRes.message}\x1b[0m`);
      } else {
        console.error(`\x1b[31m${sRes.message}\x1b[0m`);
      }
    } else if (stashSub === 'list' || stashSub === undefined) {
      const stashes = readStashes();
      if (stashes.length === 0) {
        console.log('No stashes found.');
      } else {
        stashes.forEach(s => {
          console.log(`  \x1b[35m${s.id}\x1b[0m [HEAD: ${s.headCommitId.substring(0, 7)}] at ${new Date(s.timestamp).toLocaleTimeString()}: ${s.message}`);
        });
      }
    } else if (stashSub === 'apply') {
      const stashId = args[2];
      if (!stashId) {
        console.error('\x1b[31mError: Specify stash ID to apply. Usage: stash apply <id>\x1b[0m');
        break;
      }
      const sAppRes = applyStash(stashId);
      if (sAppRes.success) {
        console.log(`\x1b[32m${sAppRes.message}\x1b[0m`);
      } else {
        console.error(`\x1b[31m${sAppRes.message}\x1b[0m`);
      }
    } else if (stashSub === 'drop') {
      const stashId = args[2];
      if (!stashId) {
        console.error('\x1b[31mError: Specify stash ID to drop. Usage: stash drop <id>\x1b[0m');
        break;
      }
      const sDropRes = dropStash(stashId);
      if (sDropRes.success) {
        console.log(`\x1b[32m${sDropRes.message}\x1b[0m`);
      } else {
        console.error(`\x1b[31m${sDropRes.message}\x1b[0m`);
      }
    } else {
      console.error('\x1b[31mError: Unknown stash command. Options: save, list, apply, drop\x1b[0m');
    }
    break;

  case 'config':
    if (!checkInit()) break;
    const confSub = args[1];
    if (confSub === 'set') {
      const cName = args[2];
      const cEmail = args[3];
      if (!cName || !cEmail) {
        console.error('\x1b[31mError: Specify author name and email. Usage: config set <name> <email>\x1b[0m');
        break;
      }
      writeConfig({
        authorName: cName,
        authorEmail: cEmail,
        ignorePatterns: readConfig().ignorePatterns
      });
      console.log(`\x1b[32mSuccessfully updated local author profile to: ${cName} <${cEmail}>\x1b[0m`);
    } else {
      const repoConf = readConfig();
      console.log('\x1b[1mRepository Configuration:\x1b[0m');
      console.log(`  Commit Author Name:  \x1b[36m${repoConf.authorName}\x1b[0m`);
      console.log(`  Commit Author Email: \x1b[36m${repoConf.authorEmail}\x1b[0m`);
      console.log('\n\x1b[1mIgnore Rules (ignorePatterns):\x1b[0m');
      repoConf.ignorePatterns.forEach(pat => console.log(`  - ${pat}`));
    }
    break;

  case 'fsck':
    if (!checkInit()) break;
    console.log('Initiating SHA-1 block check and reference integrity audit...');
    const scan = checkIntegrity();
    console.log(`\nAudit completed in ${scan.totalObjectsCount} objects.\n`);
    
    if (scan.corruptedObjects.length > 0) {
      console.error(`\x1b[31m[CRITICAL] Corrupted Objects: ${scan.corruptedObjects.length}\x1b[0m`);
      scan.corruptedObjects.forEach(hash => console.error(`  - \x1b[31m${hash}\x1b[0m: Corrupted data or invalid checksum`));
    } else {
      console.log('\x1b[32m✓ All object SHA-1 checksums matched compressed headers.\x1b[0m');
    }

    if (scan.danglingReferences.length > 0) {
      console.warn(`\x1b[33m[WARNING] Dangling References: ${scan.danglingReferences.length}\x1b[0m`);
      scan.danglingReferences.forEach(item => console.warn(`  - Object \x1b[33m"${item.from}"\x1b[0m has a dangling ref of type "${item.type}" pointing to missing target "${item.to}"`));
    } else {
      console.log('\x1b[32m✓ All references point to valid addressable commits.\x1b[0m');
    }

    if (scan.orphanedObjects.length > 0) {
      console.log(`\x1b[35m[INFO] Unreachable/Orphaned Objects: ${scan.orphanedObjects.length}\x1b[0m`);
      console.log('  Run "cli.ts gc" to safely reclaim storage space.');
    } else {
      console.log('\x1b[32m✓ Repository has zero orphaned objects.\x1b[0m');
    }
    break;

  case 'gc':
    if (!checkInit()) break;
    console.log('Running object reachability scan for Garbage Collection...');
    const gcRes = runGarbageCollection(false);
    if (gcRes.success) {
      console.log(`\n\x1b[32m✓ Safety scan and garbage collection completed!\x1b[0m`);
      console.log(`  Orphaned objects removed: ${gcRes.deleted.length}`);
      console.log(`  Status message:           ${gcRes.message}`);
    } else {
      console.error(`\x1b[31mGC Error: ${gcRes.message}\x1b[0m`);
    }
    break;

  default:
    console.error(`\x1b[31mUnknown command "${command}". Type "cli.ts help" to list options.\x1b[0m`);
    break;
}
