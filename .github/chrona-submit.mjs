#!/usr/bin/env node
// Mirror this repository's working tree into a fresh Chrona branch, upload a
// preview build and submit it for review. Publishing stays a human action in
// the Chrona Studio (Accept & publish). Runs in GitHub Actions and locally.
//
// Env: CHRONA_CLI   absolute path to chrona.mjs (chrona-game plugin >= 0.3.1)
//      CHRONA_WORLD World link, e.g. https://chrona.world/studio/?world=<id>
//      CHRONA_CONFIG_DIR  directory holding clients.json (a remembered connection)
//      GIT_SHA / GIT_SUBJECT  optional labels; derived from git when absent
//      CHRONA_SUBMIT_STOP_AT  "preview" to stop before submit (local testing)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const need = name => { const v = process.env[name]; if (!v) throw new Error(`Missing env ${name}`); return v; };
const CLI = resolve(need('CHRONA_CLI')), WORLD = need('CHRONA_WORLD');
const repo = process.cwd();
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const sha = (process.env.GIT_SHA || git(['rev-parse', 'HEAD'])).slice(0, 7);
const subject = (process.env.GIT_SUBJECT || git(['log', '-1', '--pretty=%s'])).slice(0, 120);
const stopAt = process.env.CHRONA_SUBMIT_STOP_AT || '';
const site = new URL(WORLD).origin;
const EXCLUDE = new Set(['.git', '.github', '.chrona', 'node_modules', 'dist', 'dist-local', '.DS_Store']);

const chrona = (args, cwd) => {
  const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 });
  const start = out.indexOf('{'); // some commands print a status line before the JSON
  return start < 0 ? {} : JSON.parse(out.slice(start));
};
const step = (title, fn) => { console.log(`\n== ${title}`); const r = fn(); return r; };

const ws = mkdtempSync(join(tmpdir(), 'chrona-submit-'));
const branchName = `GitHub ${sha}: ${subject}`;
try {
  const checkout = step(`checkout ${WORLD} -> ${ws}`, () =>
    chrona(['checkout', '--world', WORLD, '--dir', ws, '--name', branchName, '--client', 'GitHub Actions'], repo));
  console.log(`branch ${checkout.branch} from commit ${String(checkout.commit).slice(0, 12)}`);

  step('mirror working tree into the workspace', () => {
    for (const entry of readdirSync(ws)) if (entry !== '.chrona') rmSync(join(ws, entry), { recursive: true, force: true });
    for (const entry of readdirSync(repo)) if (!EXCLUDE.has(entry)) cpSync(join(repo, entry), join(ws, entry), { recursive: true });
  });

  const diff = step('diff', () => chrona(['diff', '--dir', ws], ws));
  const changes = diff.local || {};
  if (!changes.files?.length && !changes.assets?.length && !changes.delivery) {
    console.log('Chrona main already matches this commit; nothing to submit.');
    summary(`Chrona: main already matches \`${sha}\`; nothing submitted.`);
    process.exit(0);
  }
  console.log(`changed files: ${changes.files.length}, assets: ${changes.assets.length}, delivery: ${changes.delivery}`);

  const pushed = step('push', () => chrona(['push', '--dir', ws, '--summary', `${subject} (GitHub ${sha})`], ws));
  console.log(`pushed head ${String(pushed.branch?.head).slice(0, 12)}`);

  step('npm run build (hosted build -> dist/)', () => execFileSync('npm', ['run', 'build'], { cwd: ws, stdio: 'inherit' }));
  if (!existsSync(join(ws, 'dist', 'index.html'))) throw new Error('Build produced no dist/index.html');

  const preview = step('preview', () => chrona(['preview', '--dir', ws, '--dist', 'dist'], ws));
  const previewUrl = preview.previewUrl ? site + preview.previewUrl : (preview.url ? site + preview.url : '(no preview url in output)');
  console.log(`preview: ${previewUrl}`);

  if (stopAt === 'preview') {
    console.log('CHRONA_SUBMIT_STOP_AT=preview: stopping before submit.');
    summary(`Chrona branch \`${checkout.branch}\` pushed and previewed (no submission).\n\nPreview: ${previewUrl}`);
    process.exit(0);
  }

  const submission = step('submit', () => chrona(['submit', '--dir', ws, '--title', `${subject} (GitHub ${sha})`], ws));
  const collab = `${site}/studio/collaboration/?world=${new URL(WORLD).searchParams.get('world')}`;
  console.log(`submitted ${submission.id} (${submission.status}) -> review at ${collab}`);
  summary([
    `### Chrona submission ready for review`,
    ``,
    `| | |`, `|---|---|`,
    `| Commit | \`${sha}\` ${subject} |`,
    `| Chrona branch | \`${checkout.branch}\` |`,
    `| Submission | \`${submission.id}\` (${submission.status}) |`,
    `| Preview | ${previewUrl} |`,
    `| Accept & publish | ${collab} |`,
  ].join('\n'));
} finally {
  rmSync(ws, { recursive: true, force: true });
}

function summary(md) { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); }
