# Build notes

Decisions made where the specification (and the documentation it was written from) is silent. None of the values below come from Knights of the Editing Table; each is a choice made for this build.

## Deliberate deviations from the specification

| Specification | This build | Why |
| --- | --- | --- |
| Extension folder `knights_of_the_editing_table.watchtower` | `watchtower.replica` | Using the original's bundle ID would impersonate it and collide with a real install. Change `BUNDLE_ID` / manifest IDs if you need otherwise. |
| Licence activation on two machines | No activation client. Settings shows licence status and a working "Deactivate on this machine" that removes the local activation record. | The licence server's protocol is not public. `lib/license.js` is the place to plug a real provider in. |
| Spell Book integration | The four commands are accepted through a CEP application event `watchtower.command` (data = command name, verbatim). | Spell Book's registration protocol is not published. Any controller, including Spell Book once its API is known, can dispatch the event. |
| "Analyze imported media with Jumper" | When enabled, the engine dispatches `watchtower.replica.jumper.analyze` with `{ paths: [...] }` after each import. | Jumper's API is not public; this event is the integration point and does nothing until something listens for it. |

## Open implementation decisions (spec "Gaps" section)

### Sync timing and "finished writing" detection
- **Polling**, every **4 s** (`SCAN_INTERVAL_MS`). No file-system events are used: polling behaves the same on APFS, exFAT (v1.5.2 issue), SMB/AFP shares and Windows junctions.
- A file is **stable** when its size and modification time are unchanged across observations at least **3 s** apart (`STABLE_MS`). Modification time alone is not trusted because Finder and `cp -p` preserve the source time.
- Files that are **empty**, or whose creation date is Finder's in-progress marker (**1984-01-24**), are never considered stable.
- A forced Sync waits **3.25 s** once (`FORCE_SYNC_SETTLE_MS`) so files already sitting on disk import in one click; files still growing are reported as "still being written" and picked up later by auto-sync.
- The project's list of media paths is cached and refreshed at least every **30 s**, and always immediately before an import (so manual imports are never duplicated).
- An import the host silently refuses is not retried for **5 minutes** (a forced Sync retries immediately).
- At most **500** files per host call.

### Storage of watch-folder configuration
- **Premiere Pro**: each watched root's configuration (its whole subtree and settings) is stored inside the project, as `wt1:` + URL-encoded JSON in a custom project-metadata field **`WatchtowerConfig`** on the bin it syncs into. It travels with the project file (Save As, templates, other machines) and the link survives renaming the bin. Adding the field makes a "Watchtower" column available in Metadata Display.
- **After Effects**: the whole configuration is stored in the project's XMP packet (`app.project.xmpPacket`), namespace `http://ns.watchtower-replica.local/1.0/`, property `wtr:config`.
- **Local fallback**: every save also writes `<user data>/WatchtowerReplica/projects/<sha1 of project path>.json`. It is used when the host cannot store metadata, or when the embedded copy comes back empty while the local one is not.
- Deleting a root bin in Premiere removes that watch folder's embedded record; the engine then recreates the bin on the next import and stores the record on the new bin.
- Settings are global per user: `<user data>/WatchtowerReplica/settings.json`, written atomically.

### Team Projects
- Handled locally, with no server component. A cloud project has no local path, so **REL is unavailable** and the configuration relies on the same bin metadata (or the local fallback keyed by the project's document ID).

### Notifications
- Premiere Pro: `app.setSDKEventMessage(…, 'info')` (Events panel). After Effects: the Info panel (`writeLn`).
- Text: "Watchtower: imported N item(s) into M bin(s)." plus, when relevant, pending, offline, refreshed-sequence and error counts. Auto-sync notifies only when something was imported or refreshed; a manual Sync always reports, including "everything is up to date".

### Telemetry, crash reporting, update checks
- None. Nothing leaves the machine. Errors go to `engine.log` in the user data folder (rotated at 1 MB).

### UI dimensions, typography, palette
- Panel 300×160 (min 230×120); manager 980×560 (min 760×360); settings 600×540.
- System UI font stack (plus Hiragino/Yu Gothic for Japanese), 12 px base.
- Palette follows the host: the panel background comes from the host skin, and the light theme switches on automatically when that background is bright (v1.5.3). Tokens are in `client/shared/theme.css`. Label swatch colours approximate each host's default label colours.

## Other decisions

- **Default allowed extensions**: everything Premiere Pro or After Effects imports natively, **except project containers** (`.prproj`, `.aep`, `.aepx`, `.xml`, `.edl`). A watch folder often contains the project's Auto-Save folder, and auto-importing project files pulls whole projects in. They can be added back in Settings. A file must also be importable by the *current* host (e.g. `.svg` is After Effects only).
- **Hidden entries** (names starting with `.`, `Thumbs.db`, `desktop.ini`, `$RECYCLE.BIN`) are never mirrored or imported.
- **Empty subfolders** get bins, which is part of the one-for-one mirror and why "New folder"/"untitled folder" are in the default ignore list.
- **SUB off** ignores subfolders entirely, including FLT. **FLT + SEQ** imports one sequence per folder into the flattened bin (a host sequence cannot span folders).
- **Sequence grouping** once SEQ is on: still images whose names end in digits group by prefix and extension, with any number of digits. So a hand-ticked `sframe_00…99` works, while auto-detection still requires 3+ digits and at least two frames. A single numbered frame already counts as a sequence, so later frames extend it instead of importing as stills.
- **Sequence refresh**: Premiere uses `ProjectItem.refreshMedia()` when the number of stable frames grows. In After Effects, `FileSource.reload()` speeds up what After Effects does natively.
- **Auto-detection when a folder is added**: each folder in the new tree is checked; SEQ and FLT can only be switched on by detection, never off. Subfolders discovered later by the engine inherit their parent's settings and are also checked (so a camera card copied into a watched "Cards" folder is flattened).
- **Camera structures** (closed list, case-insensitive): what marks each one, and which files are imported when flattened:

  | Structure | Recognised by | Imported |
  | --- | --- | --- |
  | ARRIRAW | `.ari`/`.arx` frames in clip folders (depth ≥ 2) | `.ari`/`.arx` (as sequences), `.mxf`, `.wav` |
  | RED | a `.RDM`/`.RDC` folder (or the folder itself) | first segment `*_001.R3D`, `.wav` sidecars |
  | AVCHD | `[PRIVATE/][AVCHD/]BDMV/STREAM` | `STREAM/*.MTS|M2TS` (subject to Allowed Files) |
  | Canon XF | `CONTENTS/CLIPS###` | `.MXF` under the clips folder |
  | Panasonic P2 | `CONTENTS/VIDEO` + `CONTENTS/CLIP` | `CONTENTS/VIDEO/*.MXF`, each file on its own (no spanning) |
  | XDCAM-EX | `BPAV/CLPR` | `BPAV/CLPR/*/*.MP4` |
  | XDCAM-HD | `Clip/` + `MEDIAPRO.XML` or `DISCMETA.XML` | `Clip/*.MXF` |
  | Sony HDV | an `HDV`/`HVR` folder of `.m2t` files | `.m2t`. Best effort: the exact recorder layout isn't documented. |
  | Sony a7S | `PRIVATE/M4ROOT/CLIP` | `CLIP/*.MP4` |
  | Sony FS/XAVC | `[PRIVATE/]XDROOT/Clip` | `Clip/*.MXF` |
  | DCIM | a `DCIM` folder (or the folder itself) | every file one level inside `DCIM/*/` |

- **Windows mapped drives** are resolved to UNC paths through `net use` (cached for 60 s), both when folders are added and when comparing the project's media paths.
- **Path comparison** folds separators, case and Unicode normalisation (NFC), which fixes the NFD/NFC mismatch behind the Korean-filename duplicates (v1.2.0).
- **Relative paths** are stored with `/` separators and resolved per OS, so a project moved between macOS and Windows keeps working (v1.6.0). REL is refused, with a message, for folders on a different drive from the project, and for unsaved projects.
- **Relinking**: relinking a root moves every child without its own path. Relinking a child gives it its own path, and relinking it back to where its parent implies clears that path again.
- **Force Sync scope**: the current project. Auto-sync covers every open project with auto-sync on.
- **"Sync a folder into an existing bin"**: dropping bins on the panel links them. The suggested folder is the folder of the first media file found, walked up one level per sub-bin between the dropped bin and that file. If a bin holds no media, a folder picker opens.
- **Photoshop/Illustrator with "Show import options"** (Premiere): those files import with `suppressUI = false`; everything else imports silently. This applies to auto-sync too, as specified, so a PSD landing while nobody is at the machine waits on Premiere's dialog. Syncing (for every project) resumes once the dialog is answered.
- **Which stored configuration wins**: the in-project copy and the local copy both carry a `savedAt` time and the newer one is used. A save the host failed to store therefore cannot bring back watch folders that were removed.
- **Comparison keys**: disk paths and project media paths go through the same function (mapped-drive → UNC resolution, then normalisation), so a project on a mapped drive using relative paths cannot fall into a re-import loop.
- **Import Date**: custom project-metadata field `WatchtowerImportDate`, labelled "Import Date", with a sortable local timestamp `YYYY-MM-DD HH:MM:SS`.

## Verified vs. unverified

- Verified by automated tests: all of `lib/` (unit and integration tests with real temporary folders and a fake host), and the `.jsx` host scripts run in a Node VM against mock Premiere and After Effects object models.
- **Not yet verified in the real hosts**: the Premiere/After Effects API calls themselves. The ones most worth checking first in a live session are: project metadata on *bins* (`get/setProjectMetadata`), `setColorLabel` on bins, `refreshMedia`, `getCurrentProjectViewSelection` during a drag, the engine's `StartOn` auto-start, and file paths from drag-and-drop in CEP. Each has a fallback or a clear error path if it behaves differently.
