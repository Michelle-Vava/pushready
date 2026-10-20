# Roadmap

pushready is a **local, zero-setup checker** for mistakes people make before pushing or open-sourcing a repo. It reads files and git metadata on your own machine only: no accounts, no uploads, no network calls, and it never prints file contents.

## Done (v0.1)

- [x] CLI: `pushready [path]`, `--help`, `--version`, exit code 1 on failure
- [x] README present and not empty
- [x] LICENSE present, with the type detected (MIT, Apache-2.0, GPL, ISC, BSD)
- [x] .gitignore present and covering `.env` / `node_modules`
- [x] Committed `.env` files (templates like `.env.example` are allowed)
- [x] Committed `node_modules`
- [x] `.env` files deleted but still in git history
- [x] Tests with throwaway git repos
- [x] `npm run demo`: builds a repo full of mistakes and checks it
- [x] CI on Windows, macOS and Linux (Node 20 and 24)

## Next: prevent and fix (what sets pushready apart)

- [ ] Pre-push git hook installer (`pushready install-hook`) that blocks a push when a check fails
- [ ] `pushready fix`: safe automatic fixes (add a `.gitignore` template, untrack `node_modules` / `.env`, create a `.env.example` with key names only), always asking first
- [ ] Step-by-step guide for removing a secret from git history when one is found

## Next: more checks

- [ ] Large files committed (e.g. over 5 MB) and in history
- [ ] Build output committed (`dist/`, `build/`, `.next/`, `bin/`, `obj/`)
- [ ] OS and editor junk (`.DS_Store`, `Thumbs.db`, `.vs/`, `.idea/`)
- [ ] Other secret-looking files: `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `*.sqlite3`/`*.db` files
- [ ] `.env.example` missing when code reads environment variables
- [ ] Placeholder README text left from templates (e.g. "TODO: Give a short introduction")
- [ ] `package.json` basics: `license` field matches LICENSE, `repository` set, `private` flag
- [ ] Lockfile present when `package.json` exists
- [ ] Hint to run a dedicated secret scanner (gitleaks) when risky files are found

## Next: output and usability

- [ ] `--json` output for scripts and editors
- [ ] `--quiet` (only failures) and `--strict` (warnings fail too)
- [ ] Score / summary line ("ready to make public: no, 2 blockers")
- [ ] Group results by "must fix before public" and "nice to have"

## Later

- [ ] Config file to turn checks off or add ignore paths
- [ ] GitHub Action that runs it on pull requests
- [ ] Checks for Python, .NET and other ecosystems (`venv/`, `__pycache__/`, `bin/obj`)
- [ ] Publish to npm so `npx pushready` works
- [ ] Plugin API so others can add checks

## Out of scope

- Scanning file contents for every kind of secret: gitleaks and trufflehog already do this well
- Anything that needs a GitHub account, token or network access
- Collecting or storing any user data
