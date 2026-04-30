#!/usr/bin/env zx

import { Octokit } from '@octokit/rest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ora from 'ora';

$.verbose = false;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
cd(ROOT);

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

const version = argv._[0];
const isPreRelease = argv['pre-release'] === true || argv.p === true;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    isPreRelease
      ? 'Usage: task prerelease -- <version>   (e.g. task prerelease -- 0.1.0)'
      : 'Usage: task release -- <version>   (e.g. task release -- 1.0.0)',
  );
  console.error('Note: VS Code Marketplace only supports major.minor.patch versions.');
  process.exit(1);
}

// Tag always uses plain major.minor.patch; the pre-release flag is passed as a
// workflow input so CI can distinguish pre-release from stable without needing
// a version suffix.
const tag = `v${version}`;

// ---------------------------------------------------------------------------
// Rollback state
//   commitLocal  — release commit exists locally but has not been pushed
//   commitPushed — release commit has been pushed to origin/main
//   releaseDone  — release CI workflow succeeded; nothing to undo
// ---------------------------------------------------------------------------

let commitLocal = false;
let commitPushed = false;
let releaseDone = false;
let gitCmd = 'git';

function runGit(args, options = {}) {
  const result = spawnSync(gitCmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const details = stderr || stdout || `git ${args.join(' ')} failed with exit code ${result.status}`;
    throw new Error(details);
  }

  return result;
}

function resolveGitExecutable() {
  const direct = spawnSync('git', ['--version'], { stdio: 'ignore', shell: false });
  if (direct.status === 0) {
    return 'git';
  }

  const locatorCommand = process.platform === 'win32' ? 'where' : 'which';
  const located = spawnSync(locatorCommand, ['git'], { encoding: 'utf8', shell: false });
  if (located.status === 0) {
    const candidate = located.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function rollback() {
  if (releaseDone) {
    return;
  }
  $.verbose = false;
  try {
    if (commitPushed) {
      console.log('\n⚠️  Reverting release commit on origin/main...');
      try {
        runGit(['revert', '--no-edit', 'HEAD']);
        runGit(['push', 'origin', 'main']);
        console.log('↩️  Release commit reverted and pushed. Working tree is clean.');
      } catch {
        console.error('❌ Automatic revert failed. Manually run:');
        console.error('   git revert HEAD && git push origin main');
      }
    } else if (commitLocal) {
      console.log('\n⚠️  Release aborted before push. Resetting local release commit...');
      try {
        runGit(['reset', '--hard', 'HEAD~1']);
        console.log('↩️  Local release commit removed. Working tree restored.');
      } catch {
        console.error('❌ Reset failed. Manually run: git reset --hard HEAD~1');
      }
    }
  } catch {
    /* best effort */
  }
}

process.on('SIGINT', async () => {
  await rollback();
  process.exit(130);
});
process.on('SIGTERM', async () => {
  await rollback();
  process.exit(143);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureTagDoesNotExist(octokit, owner, repo, tag) {
  try {
    await octokit.git.getRef({ owner, repo, ref: `tags/${tag}` });
    console.error(`❌ Remote tag ${tag} already exists.`);
    process.exit(1);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
    // 404 = tag does not exist; that's what we want.
  }
}

function resolvePreviousTag(tagsResp, tag) {
  const parseVersion = v => v.replace(/^v/, '').split('.').map(Number);
  return (
    tagsResp
      .map(r => r.ref.replace('refs/tags/', ''))
      .filter(t => t !== tag)
      .sort((a, b) => {
        const [aMaj, aMin, aPatch] = parseVersion(a);
        const [bMaj, bMin, bPatch] = parseVersion(b);
        return aMaj - bMaj || aMin - bMin || aPatch - bPatch;
      })
      .at(-1) ?? ''
  );
}

function updateChangelogFile(changelogPath, heading, section) {
  let original;
  try {
    original = readFileSync(changelogPath, 'utf8');
  } catch {
    original = '# Change Log\n\n## [Unreleased]\n';
  }

  if (!original.includes(heading)) {
    const marker = '## [Unreleased]';
    const idx = original.indexOf(marker);
    const firstVersionIdx = original.search(/^## \[/m);
    const updated =
      idx >= 0
        ? `${original.slice(0, idx + marker.length)}\n${section}${original.slice(idx + marker.length)}`
        : firstVersionIdx >= 0
          ? `${original.slice(0, firstVersionIdx)}${section}\n${original.slice(firstVersionIdx)}`
          : `${original}\n${section}`;
    writeFileSync(changelogPath, updated);
  } else {
    console.log('ℹ️  CHANGELOG already contains this release heading; skipping.');
  }
}

// ---------------------------------------------------------------------------
// Main — wrapped so any unhandled error triggers rollback
// ---------------------------------------------------------------------------

async function main() {
  // --- Prerequisites -------------------------------------------------------

  const resolvedGit = resolveGitExecutable();
  if (!resolvedGit) {
    console.error("❌ 'git' is required but not found in PATH.");
    process.exit(1);
  }
  gitCmd = resolvedGit;

  // Resolve GitHub auth token: prefer env vars, then ask the gh CLI.
  let githubToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (!githubToken) {
    try {
      githubToken = (await $`gh auth token`).stdout.trim();
    } catch {
      console.error('❌ No GitHub token found. Set GH_TOKEN/GITHUB_TOKEN or run: gh auth login');
      process.exit(1);
    }
  }

  const octokit = new Octokit({ auth: githubToken });

  // --- Precondition checks --------------------------------------------------

  const dirty = runGit(['status', '--porcelain']).stdout.trim();
  if (dirty) {
    console.error('❌ Working tree is not clean. Commit or stash changes first.');
    process.exit(1);
  }

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  if (branch !== 'main') {
    console.error(`❌ Must run from 'main'. Current branch: ${branch}`);
    process.exit(1);
  }

  console.log('🔄 Fetching latest refs...');
  runGit(['fetch', 'origin', 'main']);
  runGit(['pull', '--ff-only', 'origin', 'main']);

  // Derive owner/repo from the git remote URL.
  const remoteUrl = runGit(['remote', 'get-url', 'origin']).stdout.trim();
  const repoMatch = remoteUrl.match(/[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!repoMatch) {
    console.error(`❌ Cannot parse owner/repo from remote URL: ${remoteUrl}`);
    process.exit(1);
  }
  const [, owner, repo] = repoMatch;

  // Check for existing remote tag via the API.
  await ensureTagDoesNotExist(octokit, owner, repo, tag);

  // --- Previous tag (for release notes diff) --------------------------------

  const tagsResp = await octokit.paginate(octokit.git.listMatchingRefs, {
    owner,
    repo,
    ref: 'tags/v',
    per_page: 100,
  });

  const previousTag = resolvePreviousTag(tagsResp, tag);

  // --- Release notes --------------------------------------------------------

  console.log(`📝 Generating release notes for ${tag}...`);

  const notesResp = await octokit.repos.generateReleaseNotes({
    owner,
    repo,
    tag_name: tag,
    target_commitish: 'main',
    ...(previousTag ? { previous_tag_name: previousTag } : {}),
  });
  const releaseNotes = notesResp.data.body?.trim() || '- No notable changes.';

  // --- Update package.json --------------------------------------------------

  console.log(`🧩 Updating package.json to ${version}...`);
  const pkgPath = resolve(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // --- Update CHANGELOG.md --------------------------------------------------

  console.log('🧩 Updating CHANGELOG.md...');
  const changelogPath = resolve(ROOT, 'CHANGELOG.md');
  const date = new Date().toISOString().slice(0, 10);
  const heading = `## [${version}] - ${date}`;
  const sourceLine = previousTag ? `\n\n_Source: changes from ${previousTag} to ${tag}._` : '';
  const section = `\n${heading}\n\n${releaseNotes}${sourceLine}\n`;
  updateChangelogFile(changelogPath, heading, section);

  // --- Commit + push --------------------------------------------------------

  const hasChanges = runGit(['diff', '--name-only', '--', 'package.json', 'CHANGELOG.md']).stdout.trim();
  if (hasChanges) {
    console.log('📦 Committing release metadata changes...');
    runGit(['add', 'package.json', 'CHANGELOG.md']);
    runGit(['commit', '-m', `chore(release): update version and changelog for ${tag}`]);
    commitLocal = true;
  } else {
    console.log('ℹ️  No version/changelog changes detected; nothing to commit.');
  }

  console.log('🚀 Pushing main...');
  runGit(['push', 'origin', 'main']);
  commitPushed = true;
  commitLocal = false;

  const headSha = runGit(['rev-parse', 'HEAD']).stdout.trim();

  // --- Wait for required workflows (sequential to avoid concurrent-spinner visual corruption) ------

  const shortSha = headSha.slice(0, 7);
  console.log(`🔎 Waiting for required workflows on ${shortSha}...`);
  // Give GitHub a moment to register the push before we start polling.
  await sleep(10_000);

  const spinner = ora({ text: 'Tests: queued' }).start();
  for (const name of ['Tests']) {
    spinner.text = `${name}: queued`;
    spinner.start();
    await waitForWorkflow(octokit, name, owner, repo, headSha, spinner);
  }

  // --- Dispatch release CI workflow ----------------------------------------

  console.log(`🚀 Dispatching release CI workflow for version ${version}${isPreRelease ? ' (pre-release)' : ''}...`);

  const workflowsResp = await octokit.actions.listRepoWorkflows({ owner, repo, per_page: 100 });
  const releaseWorkflow = workflowsResp.data.workflows.find(w => w.name === 'Release');
  if (!releaseWorkflow) {
    throw new Error(`Release workflow not found in ${owner}/${repo}`);
  }

  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: releaseWorkflow.id,
    ref: 'main',
    inputs: {
      version,
      pre_release: isPreRelease,
    },
  });

  // --- Watch the release workflow ------------------------------------------

  // Give GitHub a moment to register the dispatch before we start polling.
  await sleep(10_000);

  spinner.text = 'Release: waiting for workflow to trigger...';
  spinner.start();
  await waitForWorkflow(octokit, 'Release', owner, repo, headSha, spinner, {
    autoDispatch: false,
    branch: null,
  });

  releaseDone = true;
  console.log(`✅ Release CI workflow completed: ${tag}`);
}

// ---------------------------------------------------------------------------
// Workflow polling
// ---------------------------------------------------------------------------

async function waitForWorkflow(
  octokit,
  name,
  owner,
  repo,
  headSha,
  spinner,
  { timeoutMs = 3_600_000, pollMs = 15_000, autoDispatch = true, branch = 'main' } = {},
) {
  // Resolve the workflow ID by name.
  const workflowsResp = await octokit.actions.listRepoWorkflows({ owner, repo, per_page: 100 });
  const workflow = workflowsResp.data.workflows.find(w => w.name === name);
  if (!workflow) {
    spinner.fail(`${name}: workflow not found in ${owner}/${repo}`);
    throw new Error(`[${name}] workflow not found in ${owner}/${repo}`);
  }

  const deadline = Date.now() + timeoutMs;
  let triggered = false;
  // Track cancelled run IDs so we skip them on subsequent polls and don't
  // mistake them for the new run that was re-dispatched.
  const cancelledRunIds = new Set();

  while (Date.now() < deadline) {
    const runsResp = await octokit.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflow.id,
      ...(branch ? { branch } : {}),
      head_sha: headSha,
      per_page: 10,
    });

    // Find the latest run that isn't one we already marked as cancelled.
    const run = runsResp.data.workflow_runs.find(r => !cancelledRunIds.has(r.id));

    if (!run) {
      if (autoDispatch && !triggered) {
        spinner.text = `${name}: no run found — triggering workflow_dispatch...`;
        await octokit.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflow.id, ref: 'main' });
        triggered = true;
        spinner.text = `${name}: waiting for run to appear...`;
      } else {
        spinner.text = `${name}: waiting for run to appear...`;
      }
    } else if (run.status !== 'completed') {
      const elapsed = Math.round((Date.now() - new Date(run.created_at).getTime()) / 1000);
      spinner.text = `${name}: ${run.status} (${elapsed}s elapsed)`;
    } else if (run.conclusion === 'success') {
      spinner.succeed(`${name}: passed`);
      return;
    } else if (run.conclusion === 'cancelled') {
      // Cancelled runs are often caused by a concurrent push racing with CI startup.
      // Record this run so we skip it on future polls, then re-dispatch.
      cancelledRunIds.add(run.id);
      spinner.text = `${name}: run was cancelled — re-dispatching...`;
      triggered = false;
    } else {
      spinner.fail(`${name}: ${run.conclusion}`);
      throw new Error(`[${name}] conclusion=${run.conclusion}\n   Run: ${run.html_url}`);
    }

    await sleep(pollMs);
  }

  spinner.fail(`${name}: timed out`);
  throw new Error(`[${name}] timed out after ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch(async err => {
  const msg = err?.message ?? String(err);
  // ProcessOutput errors from zx already printed the command output; only
  // print extra context for our own thrown errors.
  if (!(err instanceof ProcessOutput)) {
    console.error(`❌ ${msg}`);
  }
  await rollback();
  process.exit(err?.exitCode ?? 1);
});
