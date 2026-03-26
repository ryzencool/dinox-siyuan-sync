# Releasing

This repository uses a single release path:

1. Run the local release script to bump versions, validate the build, and create the release commit and tag.
2. Push the branch and tag.
3. GitHub Actions builds `package.zip` from the tag and publishes the GitHub Release.

## Commands

```bash
pnpm release patch
pnpm release minor
pnpm release major
pnpm release 1.2.3
```

The release script will:

- Require a clean git worktree by default
- Keep `package.json` and `plugin.json` on the same version
- Build a release artifact into `.release-artifacts/package.zip`
- Create `chore(release): vX.Y.Z`
- Create an annotated tag `vX.Y.Z`

After the script succeeds, push the release:

```bash
git push origin <branch> --follow-tags
```

The tag push triggers `.github/workflows/release.yml`, which creates or updates the GitHub Release and uploads `package.zip`.
