# Watchtower help

## How detection works

A watch folder is checked continuously for content that is not yet in the project. The only thing compared is the **file path**: a file whose path does not match any item already in the project is new and gets imported. That has consequences worth knowing:

- Sync is **one way**. Renaming, moving or deleting items in the Project panel never touches files on disk.
- **Renaming or moving a file on disk** makes it a new file: it is imported again, and the old item goes offline.
- **Deleting an imported item** from the project brings it back on the next sync, because its file is still in the watch folder. Move the file out of the folder (or into an ignored folder) instead.
- Files are imported only once they have **finished writing** to disk.

## Ignored folders

Settings › Ignored Folders lists folder names that are never imported.

- A plain entry matches a whole folder name, ignoring case: `proxies` matches `Proxies` and `PROXIES`.
- An entry between slashes is a regular expression, also case-insensitive, matched anywhere in the name unless anchored:

| Entry | Matches |
| --- | --- |
| `/_ame/` | `project_ame`, `south_America`, `_amethyst` |
| `/_ame$/` | names ending in `_ame`, e.g. `project_AME` |
| `/^_ame/` | names starting with `_ame`, e.g. `_amethyst` |
| `/\d/` | any name containing a digit |

Media Encoder names its output folders `Project_1_AME`, `Project_2_AME`, and so on; one entry, `/_AME$/`, covers them all.

A new folder that has not been renamed yet ("New folder", "untitled folder") would otherwise be imported straight away. Those names are in the list by default; add your system's own name for it if it is in another language.

## Ingest and proxies (Premiere Pro)

Premiere's Ingest Settings can Copy, Transcode, Create Proxies, or Copy and Create Proxies on import. Because Watchtower detects by path, only **Create Proxies** works together with it: Copy and Transcode write the media to a new path, which Watchtower sees as a new file and imports again, over and over. Use these setups instead.

**Copy**
1. Turn Premiere's ingest off.
2. Create the destination folder yourself.
3. Add the **destination** folder (not the source) as a watch folder.
4. Copy the files you need into it. Watchtower imports them automatically, or when you press Sync.

**Transcode**
Same as Copy, except step 4 is exporting through Media Encoder into the destination folder.
*Double watch folder:* point a Media Encoder watch folder at your Watchtower watch folder's input, so files dropped in by anyone are transcoded by Media Encoder and then imported by Watchtower with no manual step.

**Copy and Create Proxies**
1. Turn ingest on and set it to **Create Proxies**.
2. Create the destination folder and add it as a watch folder.
3. Copy the source files into it. Watchtower imports them and Premiere builds and attaches proxies.

## Image sequences that keep growing

Premiere does not refresh an image-sequence clip when new frames are added (After Effects does). With auto-sync on, Watchtower refreshes the clip as new frames finish writing, so renders in progress stay current in Premiere too.

Folders whose images end in three or more digits (`cleanup_000`, `page_00000`) are detected as sequences automatically. For shorter numbering (`sframe_00`) tick **SEQ** yourself.

## Template projects (with Post Haste)

Make every new project sync its bins with its own folder structure, with no setup and without opening the panel:

1. Reveal your template's folder structure in Finder/Explorer and copy it to a scratch location.
2. Open a fresh project saved inside that copy.
3. Add the template's folders as watch folders with **REL** ticked on every one, and switch auto-sync on (Watch).
4. Save the project over the template's original project file.

Every project Post Haste creates from the template now syncs its bins with its own folders. A folder that lives **outside** the template (a shared music library, your Downloads folder) must use an absolute path (REL off), because a relative path only makes sense for folders that travel with the project.

## Camera cards

Folders that match a known camera card structure get **FLT** automatically, so each card's clips land in one bin instead of mirroring the card's nested folders: ARRIRAW, RED (including .wav sidecars), AVCHD, Canon XF, Panasonic P2 (spanned clips are not supported), XDCAM-EX, XDCAM-HD, Sony HDV, Sony a7S, Sony FS/XAVC, DCIM. The list cannot be extended from the panel.

## Offline watch folders

If a drive is disconnected, its watch folders show a red dot in the manager. Click the **PATH** of the top folder and choose its new location; every folder beneath it is relinked with it.
