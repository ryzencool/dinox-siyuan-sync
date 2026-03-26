import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, "package.json");
const pluginJsonPath = path.join(repoRoot, "plugin.json");
const releaseAssetDir = path.join(repoRoot, ".release-artifacts");
const releaseAssetPath = path.join(releaseAssetDir, "package.zip");
const bumpKinds = new Set(["patch", "minor", "major"]);
const semverPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const packageJson = readJson(packageJsonPath);
    const pluginJson = readJson(pluginJsonPath);
    const currentVersion = packageJson.version;

    assertSemver(currentVersion, "package.json version");
    assertSemver(pluginJson.version, "plugin.json version");

    if (currentVersion !== pluginJson.version) {
        throw new Error(
            `package.json version (${currentVersion}) and plugin.json version (${pluginJson.version}) must match.`,
        );
    }

    if (!options.allowDirty) {
        ensureCleanWorktree();
    }

    const nextVersion = resolveNextVersion(currentVersion, options.releaseTarget);
    if (nextVersion === currentVersion) {
        throw new Error(`Next version must differ from the current version ${currentVersion}.`);
    }

    const tagName = `v${nextVersion}`;
    if (hasGitRef(`refs/tags/${tagName}`)) {
        throw new Error(`Git tag ${tagName} already exists locally.`);
    }

    console.log(`Preparing release ${currentVersion} -> ${nextVersion}`);

    if (options.dryRun) {
        printPlannedActions(nextVersion, options);
        return;
    }

    const originalPackageJson = fs.readFileSync(packageJsonPath, "utf8");
    const originalPluginJson = fs.readFileSync(pluginJsonPath, "utf8");
    let commitCreated = false;

    try {
        packageJson.version = nextVersion;
        pluginJson.version = nextVersion;
        writeJson(packageJsonPath, packageJson);
        writeJson(pluginJsonPath, pluginJson);

        if (!options.skipBuild) {
            fs.mkdirSync(releaseAssetDir, { recursive: true });
            fs.rmSync(releaseAssetPath, { force: true });
            run("pnpm", ["build"], {
                env: { ...process.env, PACKAGE_ZIP_OUT_DIR: ".release-artifacts" },
            });

            if (!fs.existsSync(releaseAssetPath)) {
                throw new Error(`Release artifact was not generated: ${releaseAssetPath}`);
            }
        }

        run("git", ["add", "package.json", "plugin.json"]);
        run("git", ["commit", "-m", `chore(release): ${tagName}`]);
        commitCreated = true;
        run("git", ["tag", "-a", tagName, "-m", tagName]);

        const branch = getCurrentBranch();
        console.log("");
        console.log(`Release ${tagName} is ready.`);
        console.log(`Next: git push origin ${branch} --follow-tags`);
        console.log("GitHub Actions will build package.zip and publish the GitHub Release from the tag.");
    } catch (error) {
        if (!options.allowDirty && !commitCreated) {
            restoreVersionFiles(originalPackageJson, originalPluginJson);
        }
        throw error;
    }
}

function parseArgs(args) {
    const options = {
        allowDirty: false,
        dryRun: false,
        help: false,
        releaseTarget: "",
        skipBuild: false,
    };

    for (const arg of args) {
        if (arg === "--allow-dirty") {
            options.allowDirty = true;
            continue;
        }
        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }
        if (arg === "--skip-build") {
            options.skipBuild = true;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            options.help = true;
            continue;
        }
        if (!options.releaseTarget) {
            options.releaseTarget = arg;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    if (!options.help && !options.releaseTarget) {
        throw new Error("Missing release target. Use patch, minor, major, or an explicit semver version.");
    }

    return options;
}

function printHelp() {
    console.log("Usage:");
    console.log("  pnpm release patch");
    console.log("  pnpm release minor");
    console.log("  pnpm release major");
    console.log("  pnpm release 1.2.3");
    console.log("");
    console.log("Options:");
    console.log("  --dry-run      Show the planned version bump without changing files");
    console.log("  --skip-build   Skip the release build validation step");
    console.log("  --allow-dirty  Bypass the clean worktree requirement");
}

function printPlannedActions(nextVersion, options) {
    console.log(`Would update package.json and plugin.json to ${nextVersion}.`);
    if (options.skipBuild) {
        console.log("Would skip build validation.");
    } else {
        console.log(`Would build and verify ${releaseAssetPath}.`);
    }
    console.log(`Would create commit: chore(release): v${nextVersion}`);
    console.log(`Would create annotated tag: v${nextVersion}`);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveNextVersion(currentVersion, releaseTarget) {
    if (bumpKinds.has(releaseTarget)) {
        return bumpVersion(currentVersion, releaseTarget);
    }
    assertSemver(releaseTarget, "release target");
    return releaseTarget;
}

function bumpVersion(currentVersion, releaseTarget) {
    const parsed = parseSemver(currentVersion);
    switch (releaseTarget) {
        case "major":
            return `${parsed.major + 1}.0.0`;
        case "minor":
            return `${parsed.major}.${parsed.minor + 1}.0`;
        case "patch":
            return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
        default:
            throw new Error(`Unsupported release target: ${releaseTarget}`);
    }
}

function parseSemver(value) {
    const match = value.match(semverPattern);
    if (!match) {
        throw new Error(`Invalid semver value: ${value}`);
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] || "",
    };
}

function assertSemver(value, label) {
    if (!semverPattern.test(value)) {
        throw new Error(`${label} must be valid semver. Received: ${value}`);
    }
}

function ensureCleanWorktree() {
    const output = execFileSync("git", ["status", "--short"], {
        cwd: repoRoot,
        encoding: "utf8",
    }).trim();

    if (output) {
        throw new Error("Git worktree must be clean before releasing. Commit or stash changes first.");
    }
}

function hasGitRef(ref) {
    try {
        execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
            cwd: repoRoot,
            stdio: "ignore",
        });
        return true;
    } catch {
        return false;
    }
}

function restoreVersionFiles(packageJsonContents, pluginJsonContents) {
    fs.writeFileSync(packageJsonPath, packageJsonContents);
    fs.writeFileSync(pluginJsonPath, pluginJsonContents);
    try {
        run("git", ["restore", "--staged", "--worktree", "--source=HEAD", "--", "package.json", "plugin.json"]);
    } catch {
        // The file contents are already restored; ignore git restore failures.
    }
}

function getCurrentBranch() {
    return execFileSync("git", ["branch", "--show-current"], {
        cwd: repoRoot,
        encoding: "utf8",
    }).trim() || "main";
}

function run(command, args, options = {}) {
    execFileSync(command, args, {
        cwd: repoRoot,
        stdio: "inherit",
        ...options,
    });
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
