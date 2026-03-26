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

## Release Notes Checklist

Before pushing a release tag, update these user-facing docs:

- `README.md`: latest release summary shown in bazaar details
- `README_zh_CN.md`: short Chinese release summary shown to Chinese users
- `CHANGELOG.md`: full release notes and upgrade notes

## Release Notes Template

Copy this into the GitHub Release description and then replace the placeholders:

```md
## 本次更新

- 新增：
- 优化：
- 修复：

## 相较上一版的主要变化

- 
- 
- 

## 升级说明

- 
- 

## 使用入口

- 顶部 Dinox 菜单：
- 文档标题图标菜单：
- 右键菜单：
```
