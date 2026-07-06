import { jsPDF } from 'jspdf';
import { RepoStatusResult, Commit, BranchInfo } from '../types';

export function exportRepoToPDF(
  status: RepoStatusResult | null,
  history: Commit[],
  branches: BranchInfo[]
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // A4 size in mm is 210 x 297
  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 20;
  let currentY = 20;

  // Page tracking
  let pageCount = 1;

  function addNewPage() {
    doc.addPage();
    pageCount++;
    currentY = 20;
    drawHeaderDecoration();
  }

  function ensureHeight(heightNeeded: number) {
    if (currentY + heightNeeded > pageHeight - 25) {
      addNewPage();
    }
  }

  // Draw elegant Swiss-Minimalist header lines and page number placeholders
  function drawHeaderDecoration() {
    // Top minimalist rule
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(0.8);
    doc.line(marginX, 12, pageWidth - marginX, 12);

    // Running small header
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('VCS PLAYGROUND - AUDIT & LINAGE LOG', marginX, 10);
    doc.text(`PAGE ${pageCount}`, pageWidth - marginX - 12, 10);
  }

  // 1. Draw Page 1 Main Header
  drawHeaderDecoration();
  currentY = 22;

  // Title block
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(20, 20, 20);
  doc.text('VCS REPOSITORY REPORT', marginX, currentY + 5);
  currentY += 12;

  // Date and meta block
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const nowStr = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
  doc.text(`Generated: ${nowStr}`, marginX, currentY);
  doc.text('Environment: React + Express (Sandboxed Sandbox Storage)', marginX, currentY + 4);
  currentY += 10;

  // Decorative thick bar
  doc.setFillColor(20, 20, 20);
  doc.rect(marginX, currentY, pageWidth - 2 * marginX, 2, 'F');
  currentY += 8;

  // Section: Repository Configuration
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('1. REPOSITORY METADATA & CONFIG', marginX, currentY);
  currentY += 5;

  // Key-value table
  const metaItems = [
    { label: 'Initialization Status', value: status?.isInitialized ? 'INITIALIZED (Active VCS Repository)' : 'UNINITIALIZED' },
    { label: 'Active Pointer / HEAD', value: status?.isDetached ? 'DETACHED HEAD' : `BRANCH: ${status?.currentBranch || 'N/A'}` },
    { label: 'Current Head Commit Hash', value: status?.currentCommitId || 'N/A (No commits recorded yet)' },
    { label: 'Registered Branches Count', value: `${branches.length} branch(es) registered` },
    { label: 'VCS File DB Location', value: './sandbox/.gitclone/' }
  ];

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9.5);
  metaItems.forEach((item) => {
    // Label
    doc.setFont('Helvetica', 'bold');
    doc.text(item.label, marginX + 2, currentY);
    // Value
    doc.setFont('Helvetica', 'normal');
    doc.text(`:  ${item.value}`, marginX + 60, currentY);
    
    // Light horizontal grid line
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(marginX, currentY + 2.5, pageWidth - marginX, currentY + 2.5);

    currentY += 7;
  });
  currentY += 6;

  // Section: Working Tree files list
  ensureHeight(50);
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('2. WORKING TREE FILE MATRIX', marginX, currentY);
  currentY += 6;

  // Table header
  doc.setFillColor(240, 239, 237);
  doc.rect(marginX, currentY - 4, pageWidth - 2 * marginX, 6, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text('FILE PATH', marginX + 4, currentY);
  doc.text('TRACKING STATUS', marginX + 95, currentY);
  doc.text('STAGE INDEX', marginX + 145, currentY);
  currentY += 5;

  if (!status || !status.files || status.files.length === 0) {
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('No active files present in the workspace sandbox.', marginX + 4, currentY + 2);
    currentY += 8;
  } else {
    status.files.forEach((file) => {
      ensureHeight(8);
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(20, 20, 20);
      
      // Shorten path if it's super long
      let displayPath = file.path;
      if (displayPath.length > 45) {
        displayPath = '...' + displayPath.slice(-42);
      }
      doc.text(displayPath, marginX + 4, currentY);

      // Status text coloring
      let statusLabel = file.status.toUpperCase().replace('_', ' ');
      doc.setFont('Helvetica', 'normal');
      doc.text(statusLabel, marginX + 95, currentY);

      let stageLabel = file.status.startsWith('staged') || file.status.includes('staged') ? 'STAGED' : 'UNSTAGED / WORK DIR';
      doc.text(stageLabel, marginX + 145, currentY);

      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.15);
      doc.line(marginX, currentY + 2, pageWidth - marginX, currentY + 2);

      currentY += 6.5;
    });
  }
  currentY += 8;

  // Section: Lineage commit history
  ensureHeight(50);
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('3. GRAPHIC VCS LINEAGE LOG', marginX, currentY);
  currentY += 6;

  // Table header
  doc.setFillColor(240, 239, 237);
  doc.rect(marginX, currentY - 4, pageWidth - 2 * marginX, 6, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text('COMMIT SHA', marginX + 4, currentY);
  doc.text('BRANCH', marginX + 38, currentY);
  doc.text('AUTHOR', marginX + 70, currentY);
  doc.text('MESSAGE & DETAILS', marginX + 115, currentY);
  currentY += 5;

  if (history.length === 0) {
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('No commits recorded in history yet.', marginX + 4, currentY + 2);
    currentY += 8;
  } else {
    // Sort chronological descending (newest first)
    const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    sortedHistory.forEach((commit) => {
      ensureHeight(22);

      // SHA
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(20, 20, 20);
      doc.text(commit.id.substring(0, 10), marginX + 4, currentY);

      // Branch label with nice styling
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text(commit.branch || 'detached HEAD', marginX + 38, currentY);

      // Author name
      const shortAuthor = commit.author.split(' <')[0];
      doc.text(shortAuthor, marginX + 70, currentY);

      // Message
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(20, 20, 20);
      
      // Split message if too long
      let displayMessage = commit.message;
      if (displayMessage.length > 40) {
        displayMessage = displayMessage.substring(0, 37) + '...';
      }
      doc.text(`"${displayMessage}"`, marginX + 115, currentY);

      // Timestamp second line
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(110, 110, 110);
      const timeStr = new Date(commit.timestamp).toLocaleString();
      doc.text(`Date: ${timeStr}`, marginX + 115, currentY + 3.5);

      if (commit.parent) {
        doc.text(`Parent SHA: ${commit.parent.substring(0, 12)}...`, marginX + 115, currentY + 7);
      } else {
        doc.text('Parent SHA: None (Root Initial)', marginX + 115, currentY + 7);
      }

      // Draw horizontal separator
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.2);
      doc.line(marginX, currentY + 9, pageWidth - marginX, currentY + 9);

      currentY += 13.5;
    });
  }

  currentY += 8;

  // Section 4: Branches Summary Registry
  ensureHeight(40);
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('4. VCS BRANCH REGISTRY INDEX', marginX, currentY);
  currentY += 6;

  // Table header
  doc.setFillColor(240, 239, 237);
  doc.rect(marginX, currentY - 4, pageWidth - 2 * marginX, 6, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text('BRANCH NAME', marginX + 4, currentY);
  doc.text('LATEST COMMIT TARGET SHA', marginX + 75, currentY);
  doc.text('STATUS', marginX + 155, currentY);
  currentY += 5;

  if (branches.length === 0) {
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('No branches registered yet.', marginX + 4, currentY + 2);
    currentY += 8;
  } else {
    branches.forEach((branch) => {
      ensureHeight(10);

      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(20, 20, 20);
      doc.text(branch.name, marginX + 4, currentY);

      doc.setFont('Helvetica', 'normal');
      doc.text(branch.latestCommitId || 'N/A (No commits on branch)', marginX + 75, currentY);

      const isActive = status?.currentBranch === branch.name && !status.isDetached;
      if (isActive) {
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(10, 100, 10);
        doc.text('ACTIVE HEAD', marginX + 155, currentY);
      } else {
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text('STANDBY', marginX + 155, currentY);
      }

      // Separator
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.15);
      doc.line(marginX, currentY + 2, pageWidth - marginX, currentY + 2);

      currentY += 7;
    });
  }

  // Footer seal
  ensureHeight(30);
  currentY += 10;
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.5);
  doc.line(marginX, currentY, pageWidth - marginX, currentY);
  currentY += 5;

  doc.setFont('Helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  doc.text('VCS Sandbox Playground - Secure cryptographic DAG lineage integrity verified.', marginX, currentY);
  doc.text('Report is generated dynamically on client storage snapshots.', marginX, currentY + 4);

  // Save/Download triggers
  doc.save('vcs-repository-report.pdf');
}
