import fs from "fs";
import path from "path";
import process from "process";
import { execFileSync } from "child_process";

function runGit(args, cwd, allowError = false) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (error) {
    if (allowError) {
      return "";
    }
    const stderr = error.stderr ? String(error.stderr) : "";
    throw new Error(`Git command failed: git ${args.join(" ")}\n${stderr}`);
  }
}

function isGitRepo(cwd) {
  try {
    const out = runGit(["rev-parse", "--is-inside-work-tree"], cwd).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function isExcluded(filePath, excludeDirs) {
  const p = normalizePath(filePath);
  for (const dir of excludeDirs) {
    const d = normalizePath(dir).replace(/\/+$/, "");
    if (!d) {
      continue;
    }
    if (p === d || p.startsWith(`${d}/`)) {
      return true;
    }
  }
  return false;
}

function matchesIncludeExt(filePath, includeExts) {
  if (!includeExts || includeExts.length === 0) {
    return true;
  }
  const lower = filePath.toLowerCase();
  return includeExts.some((ext) => lower.endsWith(ext.toLowerCase()));
}

function getMergeBase(cwd, baseBranch, targetBranch) {
  return runGit(["merge-base", baseBranch, targetBranch], cwd).trim();
}

function getCommitsOldestFirst(cwd, baseBranch, targetBranch, noMerges) {
  const mergeBase = getMergeBase(cwd, baseBranch, targetBranch);
  const args = ["rev-list", "--reverse", `${mergeBase}..${targetBranch}`];
  if (noMerges) {
    args.splice(1, 0, "--no-merges");
  }
  const commits = runGit(args, cwd)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return { mergeBase, commits };
}

function getCommitMeta(cwd, commitId) {
  const format = "%H%x1f%an%x1f%ae%x1f%cI%x1f%s";
  const out = runGit(["show", "-s", `--format=${format}`, commitId], cwd).trim();
  const parts = out.split("\x1f");
  while (parts.length < 5) {
    parts.push("");
  }
  return {
    id: parts[0],
    author: parts[1],
    email: parts[2],
    date: parts[3],
    subject: parts[4],
  };
}

function getCommitChangedFiles(cwd, commitId) {
  const out = runGit(["show", "--name-status", "--format=", "-M", commitId], cwd);
  const results = [];

  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    const status = parts[0];

    if (status.startsWith("R")) {
      if (parts.length >= 3) {
        results.push({
          status: "R",
          path: parts[2],
          oldPath: parts[1],
        });
      }
    } else if (parts.length >= 2) {
      results.push({
        status,
        path: parts[1],
        oldPath: null,
      });
    }
  }

  return results;
}

function getFileContentAtParent(cwd, commitId, filePath) {
  const out = runGit(["show", `${commitId}^:${filePath}`], cwd, true);
  return out === "" ? null : out;
}

function getFileDiffInCommit(cwd, commitId, filePath) {
  return runGit(["show", "--format=", "--unified=3", commitId, "--", filePath], cwd, true);
}

function escapeXml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdata(text) {
  const value = text ?? "";
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function indent(level) {
  return "  ".repeat(level);
}

function buildXml({ repoPath, baseBranch, targetBranch, mergeBase, commitsMeta, files }) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<branch_history repository="${escapeXml(path.resolve(repoPath))}" base_branch="${escapeXml(
      baseBranch
    )}" target_branch="${escapeXml(targetBranch)}" merge_base="${escapeXml(
      mergeBase
    )}" generated_at="${escapeXml(new Date().toISOString())}">`
  );

  lines.push(`${indent(1)}<summary>`);
  lines.push(`${indent(2)}<commit_count>${commitsMeta.length}</commit_count>`);
  lines.push(`${indent(2)}<file_count>${files.length}</file_count>`);
  lines.push(`${indent(1)}</summary>`);

  lines.push(`${indent(1)}<commits>`);
  for (const meta of commitsMeta) {
    lines.push(
      `${indent(2)}<commit id="${escapeXml(meta.id)}" author="${escapeXml(
        meta.author
      )}" email="${escapeXml(meta.email)}" date="${escapeXml(meta.date)}">`
    );
    lines.push(`${indent(3)}<subject>${escapeXml(meta.subject)}</subject>`);
    lines.push(`${indent(2)}</commit>`);
  }
  lines.push(`${indent(1)}</commits>`);

  lines.push(`${indent(1)}<files>`);
  for (const file of files) {
    const renamedFromAttr = file.renamedFrom
      ? ` renamed_from="${escapeXml(file.renamedFrom)}"`
      : "";
    lines.push(`${indent(2)}<file path="${escapeXml(file.path)}"${renamedFromAttr}>`);

    lines.push(`${indent(3)}<base_file>`);
    lines.push(`${indent(4)}${cdata(file.baseFile)}`);
    lines.push(`${indent(3)}</base_file>`);

    lines.push(`${indent(3)}<history>`);
    for (const change of file.history) {
      const oldPathAttr = change.oldPath ? ` old_path="${escapeXml(change.oldPath)}"` : "";
      lines.push(
        `${indent(4)}<change branch="${escapeXml(change.branch)}" commit_id="${escapeXml(
          change.commitId
        )}" author="${escapeXml(change.author)}" date="${escapeXml(
          change.date
        )}" status="${escapeXml(change.status)}"${oldPathAttr}>`
      );
      lines.push(`${indent(5)}<subject>${escapeXml(change.subject)}</subject>`);
      lines.push(`${indent(5)}<diff>`);
      lines.push(`${indent(6)}${cdata(change.diff)}`);
      lines.push(`${indent(5)}</diff>`);
      lines.push(`${indent(4)}</change>`);
    }
    lines.push(`${indent(3)}</history>`);

    lines.push(`${indent(2)}</file>`);
  }
  lines.push(`${indent(1)}</files>`);
  lines.push(`</branch_history>`);

  return `${lines.join("\n")}\n`;
}

function createProgressReporter(enabled) {
  if (!enabled) {
    return () => {};
  }

  return (message) => {
    process.stderr.write(`[gitrailxml] ${message}\n`);
  };
}

function buildHistoryXml({
  repoPath,
  baseBranch,
  targetBranch,
  includeExts,
  excludeDirs,
  noMerges,
  progress,
}) {
  const reportProgress = createProgressReporter(progress);
  reportProgress(`Resolving merge base for ${baseBranch}..${targetBranch}`);

  const { mergeBase, commits } = getCommitsOldestFirst(
    repoPath,
    baseBranch,
    targetBranch,
    noMerges
  );

  reportProgress(`Found ${commits.length} commits to process`);

  const commitsMeta = [];
  const filesMap = new Map();

  for (const [index, commitId] of commits.entries()) {
    const commitNumber = index + 1;
    const meta = getCommitMeta(repoPath, commitId);
    commitsMeta.push(meta);

    reportProgress(
      `Processing commit ${commitNumber}/${commits.length}: ${meta.id.slice(0, 7)} ${meta.subject}`
    );

    const changedFiles = getCommitChangedFiles(repoPath, commitId);

    for (const item of changedFiles) {
      const status = item.status;
      const filePath = item.path;
      const oldPath = item.oldPath;

      const candidatePaths = [filePath, oldPath].filter(Boolean);
      if (
        candidatePaths.length > 0 &&
        candidatePaths.every((candidate) => isExcluded(candidate, excludeDirs))
      ) {
        continue;
      }

      if (
        includeExts.length > 0 &&
        !candidatePaths.some((candidate) => matchesIncludeExt(candidate, includeExts))
      ) {
        continue;
      }

      const logicalKey = filePath;

      if (status === "R" && oldPath && filesMap.has(oldPath) && !filesMap.has(filePath)) {
        const existing = filesMap.get(oldPath);
        filesMap.delete(oldPath);
        existing.path = filePath;
        existing.renamedFrom = oldPath;
        filesMap.set(filePath, existing);
      }

      if (!filesMap.has(logicalKey)) {
        let baseFile = "";

        if (status === "A") {
          baseFile = "";
        } else if (status === "R" && oldPath) {
          baseFile = getFileContentAtParent(repoPath, commitId, oldPath) ?? "";
        } else {
          baseFile = getFileContentAtParent(repoPath, commitId, filePath) ?? "";
        }

        filesMap.set(logicalKey, {
          path: filePath,
          renamedFrom: null,
          baseFile,
          history: [],
        });
      }

      const record = filesMap.get(logicalKey);
      record.history.push({
        branch: targetBranch,
        commitId: meta.id,
        author: meta.author,
        date: meta.date,
        status,
        oldPath,
        subject: meta.subject,
        diff: getFileDiffInCommit(repoPath, commitId, filePath) ?? "",
      });
    }
  }

  const files = Array.from(filesMap.values());
  reportProgress(`Collected ${files.length} files. Building XML output`);
  return buildXml({
    repoPath,
    baseBranch,
    targetBranch,
    mergeBase,
    commitsMeta,
    files,
  });
}

function parseArgs(argv) {
  const options = {
    baseBranch: null,
    targetBranch: null,
    output: "branch_history.xml",
    includeExt: "",
    excludeDirs: ".git,node_modules,build,dist,__pycache__,.dart_tool,.idea",
    noMerges: false,
    progress: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--base-branch") {
      options.baseBranch = argv[++i];
    } else if (arg === "--target-branch") {
      options.targetBranch = argv[++i];
    } else if (arg === "--output") {
      options.output = argv[++i];
    } else if (arg === "--include-ext") {
      options.includeExt = argv[++i];
    } else if (arg === "--exclude-dirs") {
      options.excludeDirs = argv[++i];
    } else if (arg === "--no-merges") {
      options.noMerges = true;
    } else if (arg === "--progress") {
      options.progress = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  gitrailxml --base-branch Master --target-branch work

Options:
  --base-branch   Base branch name
  --target-branch Target branch name
  --output        Output XML file name (default: branch_history.xml)
  --include-ext   Comma-separated file extensions to include
  --exclude-dirs  Comma-separated directories to exclude
  --no-merges     Exclude merge commits
  --progress      Show progress while generating XML
  -h, --help      Show help
`);
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.baseBranch || !options.targetBranch) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const repoPath = process.cwd();
  if (!isGitRepo(repoPath)) {
    throw new Error("The current directory is not a Git repository.");
  }

  const includeExts = parseCsv(options.includeExt);
  const excludeDirs = parseCsv(options.excludeDirs);

  const xml = buildHistoryXml({
    repoPath,
    baseBranch: options.baseBranch,
    targetBranch: options.targetBranch,
    includeExts,
    excludeDirs,
    noMerges: options.noMerges,
    progress: options.progress,
  });

  fs.writeFileSync(path.resolve(repoPath, options.output), xml, "utf8");
  console.log(`XML written: ${options.output}`);
}
