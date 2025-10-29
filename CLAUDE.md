---
description: InsForge SDK Publishing Guidelines
globs:
alwaysApply: true
---

# InsForge SDK Publishing Rules

## 🔴 Publishing Workflow

### For Dev/Testing (Safe - Won't Affect Main Users)

**Option 1: Auto-increment dev version**
```bash
npm run publish:dev
```
- Auto-bumps version: `0.0.56` → `0.0.56-dev.0` → `0.0.56-dev.1` etc.
- Publishes with `--tag dev` (not `latest`)
- Regular users unaffected

**Option 2: Manual dev version (full control)**
```bash
# Set exact version you want
npm version 0.0.60-dev.5 --no-git-tag-version

# Build and publish with dev tag
npm run build
npm publish --tag dev
```
- Choose any version number manually
- MUST use `npm publish --tag dev` to avoid affecting production users
- `--no-git-tag-version` prevents auto git commit

### Installing Dev Versions
```bash
# Specific dev version
npm install @insforge/sdk@0.0.60-dev.5

# Latest dev version
npm install @insforge/sdk@dev

# Regular install (unaffected by dev versions)
npm install @insforge/sdk  # Gets latest stable
```

### For Production Release
```bash
npm version patch  # or minor, major
npm run publish:stable
```
- Updates version following semver
- Publishes with `--tag latest` (default)
- All users get this version by default

## Semver Rules
- **Patch** (0.0.X): Bug fixes, no API changes
- **Minor** (0.X.0): New features, backward compatible
- **Major** (X.0.0): Breaking changes

## Pre-Publish Checklist
- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No uncommitted changes

Use `npm run publish:dev` for testing, `npm run publish:stable` for production.
