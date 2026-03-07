#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../coverage/coverage-final.json'), 'utf8'));

const srcRoot = path.join(__dirname, '../src');

for (const [filePath, info] of Object.entries(data)) {
  const shortPath = path
    .relative(srcRoot, filePath)
    .split(path.sep)
    .join('/');
  if (shortPath.includes('vscode.mock')) continue;

  const uncoveredLines = Object.entries(info.s)
    .filter(([, count]) => count === 0)
    .map(([key]) => info.statementMap[key] && info.statementMap[key].start.line)
    .filter(Boolean)
    .sort((a, b) => a - b);

  const uncoveredFns = Object.entries(info.f)
    .filter(([, count]) => count === 0)
    .map(([key]) => {
      const fn = info.fnMap[key];
      return fn ? fn.name + ':L' + fn.loc.start.line : null;
    })
    .filter(Boolean);

  const uncoveredBranches = Object.entries(info.b)
    .filter(([, counts]) => counts.some(c => c === 0))
    .map(([key]) => {
      const branch = info.branchMap[key];
      return branch ? 'L' + branch.loc.start.line + '(' + branch.type + ')' : null;
    })
    .filter(Boolean);

  if (uncoveredLines.length > 0 || uncoveredFns.length > 0) {
    console.log('\n=== ' + shortPath + ' ===');
    console.log('Uncovered lines:', uncoveredLines.slice(0, 60).join(', '));
    console.log('Uncovered fns:', uncoveredFns.slice(0, 30).join(', '));
    console.log('Uncovered branches:', uncoveredBranches.slice(0, 30).join(', '));
  }
}
