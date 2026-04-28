const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

function runGit(rootDir, args) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null,
    args
  };
}

function ensureGitIgnore(rootDir, trackFiles) {
  const lines = trackFiles
    ? ["tmp/", ".transfer-state.json"]
    : ["files/", "tmp/", ".transfer-state.json"];

  fs.writeFileSync(path.join(rootDir, ".gitignore"), `${lines.join("\n")}\n`, "utf8");
}

function createMigrationRepository(rootDir, options = {}) {
  const trackFiles = Boolean(options.trackFiles);
  ensureGitIgnore(rootDir, trackFiles);

  const steps = [];
  steps.push(runGit(rootDir, ["init"]));
  steps.push(runGit(rootDir, ["config", "user.name", "OneShot Phone Transfer"]));
  steps.push(runGit(rootDir, ["config", "user.email", "oneshot-transfer@local.invalid"]));
  steps.push(runGit(rootDir, ["add", "."]));
  steps.push(runGit(rootDir, ["commit", "-m", "Create verified phone migration backup"]));

  const failed = steps.find((step) => !step.ok);

  if (!failed) {
    return {
      ok: true,
      method: "git-cli",
      trackFiles,
      steps,
      error: null
    };
  }

  const fallback = createRepositoryWithoutGitCli(rootDir, { trackFiles });
  return {
    ok: fallback.ok,
    method: fallback.ok ? "builtin-git-writer" : "failed",
    trackFiles,
    steps,
    commit: fallback.commit,
    error: fallback.ok
      ? null
      : `${failed.args.join(" ")} failed: ${failed.error || failed.stderr || failed.stdout}; fallback failed: ${fallback.error}`
  };
}

function createRepositoryWithoutGitCli(rootDir, options = {}) {
  try {
    const gitDir = path.join(rootDir, ".git");
    fs.mkdirSync(path.join(gitDir, "objects"), { recursive: true });
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.mkdirSync(path.join(gitDir, "info"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf8");
    fs.writeFileSync(path.join(gitDir, "description"), "OneShot Phone Transfer backup repository\n", "utf8");
    fs.writeFileSync(path.join(gitDir, "info", "exclude"), "\n", "utf8");
    fs.writeFileSync(path.join(gitDir, "config"), [
      "[core]",
      "\trepositoryformatversion = 0",
      "\tfilemode = false",
      "\tbare = false",
      "\tlogallrefupdates = true",
      "\tsymlinks = false",
      "\tignorecase = true",
      ""
    ].join("\n"), "utf8");

    const files = collectTrackedFiles(rootDir, Boolean(options.trackFiles));
    const treeSha = writeTree(gitDir, rootDir, files);
    const commitSha = writeCommit(gitDir, treeSha);
    fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), `${commitSha}\n`, "utf8");

    return {
      ok: true,
      commit: commitSha
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

function collectTrackedFiles(rootDir, trackFiles) {
  if (!trackFiles) {
    return [
      ".gitignore",
      "README.md",
      "manifest.json",
      "host-path-map.json",
      "transfer-report.json"
    ].filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)));
  }

  const files = [];

  function visit(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = path.join(currentDir, entry.name);
      const relative = toPosixPath(path.relative(rootDir, absolute));

      if (entry.name === ".git" || relative === "tmp" || relative.startsWith("tmp/")) {
        continue;
      }

      if (relative === ".transfer-state.json") {
        continue;
      }

      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  visit(rootDir);
  return files.sort();
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function writeGitObject(gitDir, type, body) {
  const header = Buffer.from(`${type} ${body.length}\0`, "utf8");
  const store = Buffer.concat([header, body]);
  const sha = crypto.createHash("sha1").update(store).digest("hex");
  const dir = path.join(gitDir, "objects", sha.slice(0, 2));
  const file = path.join(dir, sha.slice(2));

  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, zlib.deflateSync(store));
  }

  return sha;
}

function buildTreeNode(rootDir, files) {
  const node = {
    files: new Map(),
    dirs: new Map()
  };

  for (const relativePath of files) {
    const parts = relativePath.split("/");
    let cursor = node;

    for (const part of parts.slice(0, -1)) {
      if (!cursor.dirs.has(part)) {
        cursor.dirs.set(part, { files: new Map(), dirs: new Map() });
      }
      cursor = cursor.dirs.get(part);
    }

    cursor.files.set(parts[parts.length - 1], path.join(rootDir, ...parts));
  }

  return node;
}

function writeTree(gitDir, rootDir, files) {
  const root = buildTreeNode(rootDir, files);

  function writeNode(node) {
    const entries = [];

    for (const [name, absolutePath] of node.files) {
      const blobSha = writeGitObject(gitDir, "blob", fs.readFileSync(absolutePath));
      entries.push({
        name,
        mode: "100644",
        sha: blobSha
      });
    }

    for (const [name, child] of node.dirs) {
      entries.push({
        name,
        mode: "40000",
        sha: writeNode(child)
      });
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    const body = Buffer.concat(entries.flatMap((entry) => [
      Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"),
      Buffer.from(entry.sha, "hex")
    ]));

    return writeGitObject(gitDir, "tree", body);
  }

  return writeNode(root);
}

function writeCommit(gitDir, treeSha) {
  const timestamp = Math.floor(Date.now() / 1000);
  const identity = `OneShot Phone Transfer <oneshot-transfer@local.invalid> ${timestamp} +0000`;
  const body = Buffer.from([
    `tree ${treeSha}`,
    `author ${identity}`,
    `committer ${identity}`,
    "",
    "Create verified phone migration backup",
    ""
  ].join("\n"), "utf8");

  return writeGitObject(gitDir, "commit", body);
}

module.exports = {
  createMigrationRepository
};
