# Watchtower (replica)

A CEP panel for **Premiere Pro 2020+** and **After Effects 2020+** (macOS and Windows) that keeps project bins in step with folders on disk. Designate watch folders; whenever a new file lands in one, it is imported into the matching bin, mirroring the folder structure one for one. The sync is one way (disk → project) and matches files by path only.

This is an independent build written from a functional specification of Knights of the Editing Table's Watchtower. It is not their code and carries its own extension ID (`watchtower.replica`), so it can sit next to the original without colliding. Every implementation decision the specification left open is recorded in [docs/BUILD_NOTES.md](docs/BUILD_NOTES.md).

## Set up from GitHub

Easiest: download **Watchtower.zip** from this repo's [Releases](https://github.com/vishaal2218/watchtower/releases) page and follow "How to install.txt" inside it.

From source (needs [Node.js](https://nodejs.org) 16+ for the tests):

```bash
git clone https://github.com/vishaal2218/watchtower.git
cd watchtower
./scripts/install-mac.sh --user
```

Building a signed package (`scripts/build-release.sh`) needs your own `signing/` folder (Adobe's `ZXPSignCmd`, a certificate and its password). It is deliberately not in this repo.

## Install

macOS:

```bash
./scripts/install-mac.sh
```

(system-wide, asks for your password; add `--user` to install for your account only)

Windows (PowerShell as administrator; add `-User` for a per-user install):

```powershell
.\scripts\install-win.ps1
```

The build is unsigned, so both scripts switch on CEP's `PlayerDebugMode` for CSXS 9–12. Restart the host, then open **Window › Extensions › Watchtower**.

Install locations (as specified):

| OS | Folder |
| --- | --- |
| macOS | `/Library/Application Support/Adobe/CEP/extensions/watchtower.replica` |
| Windows | `C:\Program Files\Common Files\Adobe\CEP\extensions\watchtower.replica` |

## Share with someone (macOS)

```bash
./scripts/build-release.sh
```

This produces `dist/Watchtower.zip`: the signed `watchtower.replica` folder plus "How to install.txt". The recipient drags the folder into `~/Library/Application Support/Adobe/CEP/extensions/`. Because it is signed, it loads without debug mode, Terminal commands or an installer. The same signed package is also written as `dist/watchtower.replica.zxp` for people who use a ZXP installer.

Signing uses Adobe's `ZXPSignCmd` and a self-signed certificate in `signing/` (valid until 2036). **Keep `signing/` private and never share it**: the certificate plus `cert-password.txt` let anyone sign files as you. Re-run the build after every change, because a signed folder stops loading if any file in it is edited.

## Use

- **Watch / Unwatch**: auto-sync on or off for the current project. Once on, the panel can be closed and syncing continues in the background.
- **Sync**: one-off import of everything new, whatever the auto-sync state.
- **Folders**: the watch-folders manager. Add folders with the button, by dropping them on the manager or on the panel, or by dragging existing bins onto the panel to link them.
- **☰ / right-click → Settings**: import behaviour, allowed extensions, ignored folder names.

Per-folder options in the manager: **SUB** (include subfolders), **REL** (store the path relative to the project file), **SEQ** (numbered stills as image sequences), **FLT** (flatten subfolders into one bin), **LABEL** (colour label for the bin and its imports). Changing a folder re-applies the change to every folder beneath it.

Workflow guidance (ingest and proxies, Media Encoder, template projects) is in [docs/HELP.md](docs/HELP.md).

## Automation

The four commands can be triggered from any CEP extension or controller by dispatching an application event named `watchtower.command` whose data is one of:

`Show Watchtower` · `Open watch folders manager` · `Sync watch folders` · `Toggle auto-sync`

## Develop

```bash
npm test          # 120+ unit/integration tests (node:test, no dependencies)
npm run coverage  # with coverage
npm run check     # syntax + runtime-compatibility check for CEP 9 / ExtendScript
```

Install with `--debug` (`-Debug` on Windows) to expose Chrome DevTools for each page on `localhost:8088`–`8095` (see `.debug`). The engine writes a log to `~/Library/Application Support/WatchtowerReplica/engine.log` (`%APPDATA%\WatchtowerReplica\engine.log` on Windows).

### Layout

| Path | What it is |
| --- | --- |
| `CSXS/manifest.xml` | Four extensions: panel, manager (modeless), settings (modal), engine (hidden, starts with the host) |
| `client/engine/` | Background page: runs the sync loop, serves the other pages over CEP events |
| `client/panel/`, `client/manager/`, `client/settings/` | The three visible windows |
| `client/shared/` | CEP wrapper, DOM helpers, design tokens |
| `lib/` | Host-independent logic (Node, runs in CEP): planner, diff, stability, tree, detection, stores |
| `host/` | ExtendScript for Premiere Pro (`ppro.jsx`) and After Effects (`aeft.jsx`) |
| `tests/` | Tests, including the `.jsx` files run against mock host object models |
