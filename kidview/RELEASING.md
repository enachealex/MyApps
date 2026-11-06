# Releasing a new version

Families are only told about a new version when **you publish it**. Building it, uploading it and
trying it reach nobody. So you can work in small steps and ship one complete, tested version.

Everything happens on your PC and your website.

## One-time setup

1. **Back up the signing key.** `android/signing/` holds the key that signs both apps. Android only
   installs an update signed with the same key. If the key is lost, every family has to uninstall and
   reinstall, which loses each device's setup and saved videos. Copy the folder to a password
   manager or a USB drive, and never share it.
2. **The downloads site.** KidView lives in the `kidview/` folder of the MyApps repo. Its `downloads/`
   folder is what families get: the MyApps site workflow (`.github/workflows/pages.yml`) publishes it at
   https://myapps.thejumpvault.com/kidview/. The release scripts copy files into `downloads/`, commit
   them and push, so you need to be able to push to the repo from this PC. Nothing else to set up.

   `scripts/site.json` holds the address and the upload method. **Don't change `url` after the first
   release**: installed apps keep checking the address they were built with. Other upload methods
   (`folder`, `scp`, `none`) are described in `scripts/site.ps1`.

## Each release

1. **Write the notes.** Add a `## 1.1.0` section at the top of [RELEASE_NOTES.md](RELEASE_NOTES.md).
   Parents see it in the update prompt and on the download page, so say what changed for them.
2. **Build the draft:**
   ```
   .\scripts\release.ps1 1.1.0
   ```
   This sets the version, builds and signs both apps, packages the Windows and Docker servers, and
   uploads them to `<your site>/kidview/1.1.0/`. Nothing points there yet, so no family is told.
   (For the very first release, use the version already in the code: `.\scripts\release.ps1 1.0.0`.)
3. **Try the draft.** Install the APKs from the links it prints, over your current apps, and run the new
   server (Windows: the zip's `Install KidView.cmd`). Found a problem? Fix it and run `release.ps1`
   with the same version again. The links it prints always get the new files; other links to a rebuilt
   draft (like the kid setup page) can get the previous build for up to 10 minutes, while the site's
   cache catches up. Published versions never change, so this only affects drafts.
4. **Publish:**
   ```
   .\scripts\publish.ps1 1.1.0
   ```
   This updates `latest.json`, the download page and the Docker installer on your site. From then on:
   - the apps quietly notice within a few hours and ask "A new version of KidView is ready" with your
     notes. **Update** downloads and installs it inside the app, and the app closes to finish. (Android asks
     once to allow installs from KidView. Play Protect may ask to scan it, because it's not from the Play Store.)
   - the dashboard and the parent app show "KidView 1.1.0 is ready" with **Update now**. That updates the
     server in place, on Windows and Docker alike, and it restarts by itself.
   - **Check for updates** (parent app Settings, the kids' app's grown-up setup, the bottom of the dashboard)
     checks right away instead of waiting.

If a published version has a problem, publish the previous version again. Nobody is moved backwards,
but nobody else is offered the bad one. Then release a fixed, higher version.

## What's on the website

`downloads/`, published at https://myapps.thejumpvault.com/kidview/:

```
index.html             the download page and setup guide (site/index.html, filled in)
latest.json            what the apps and servers check. Only publish.ps1 changes it.
install.sh             the Docker installer/updater
server-latest.txt      which server package install.sh downloads, and its checksum
setup.html             where a child's phone lands from the kid setup QR code: download KidView, then open it set up
1.0.0/  1.1.0/  ...    every version's files: both APKs, the Windows zip, the Docker server
```

Each release adds about 5 MB to the repo. Old version folders can be deleted once nobody needs them,
but never the one `latest.json` points to.

## Versions

Use `major.minor.patch`, and make each release higher than the last. `release.ps1` checks this, and
raises the Android build number that Android needs to allow the upgrade.
