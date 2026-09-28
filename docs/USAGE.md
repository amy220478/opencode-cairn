# Usage — opencode-cairn

## First run

1. Install (see README), restart the TUI.
2. The sidebar shows **Project Explorer** + your project root, folders pre-expanded one level.
3. Click a `▸` folder (or `/cairn pick`) to drill in. Click a file to open it.

## Going further

- `/cairn src 2` — focus on `src/`, two levels deep
- `/cairn all collapse` then expand only what you need — best on huge repos
- `/cairn reset` — back to a clean default state any time
- Hide it for a session: `/cairn` with no arguments toggles visibility off; run again to restore

## Screenshots

`assets/explorer-open.png` + `assets/explorer-collapsed.png` are real TUI
captures, referenced by the README. To refresh them, capture the sidebar with
`Win+Shift+S` and overwrite the files (keep the names).

## Publishing checklist (maintainer)

- [x] Real screenshots in `assets/` (README links already point at them)
- [ ] `package.json` version bumped
- [ ] `git init`, first commit, push to `github.com/amy220478/opencode-cairn`
- [ ] GitHub repo topics: `opencode`, `opencode-plugin`, `tui`, `file-explorer`
- [ ] Release `v0.1.0` with the two screenshots attached
