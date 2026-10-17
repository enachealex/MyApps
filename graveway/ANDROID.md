# Graveway on your Android phone

Two ways to get the game onto a phone. The cloud build needs nothing
installed. The local build is faster to repeat once it's set up, and installs
straight onto a phone plugged in over USB.

## Option A: cloud build (no setup)

1. On GitHub, open **Actions → Build Android APK → Run workflow**.
2. Pick the branch, set **app_folder** to `graveway` and **version_name** to
   something like `0.2`, then run it. It takes about 3 minutes.
3. Open **Releases** on your phone. Find **Graveway 0.2 (build N)** (it's
   marked *Pre-release*) and tap `graveway-0.2.apk`.
4. Allow installs from your browser when Android asks, then **Install**.

Later cloud builds install over earlier ones and keep your progress. They're
signed with the same cached key, as long as one ran in the past week from
the same branch.

## Option B: build on your computer and install over USB

### One-time setup

- [ ] **Node.js 20 or newer**: <https://nodejs.org>. Check with `node -v`.
- [ ] **JDK 21**: Temurin 21 from <https://adoptium.net>. Check with
      `java -version`.
- [ ] **Android SDK**. The easiest way is to install
      [Android Studio](https://developer.android.com/studio), open it once
      and let it download the SDK. Then, in its SDK Manager, make sure these
      are installed: *Android SDK Platform 35*, *Android SDK Build-Tools* and
      *Android SDK Platform-Tools* (that's `adb`).
- [ ] **ANDROID_HOME** pointing at the SDK. The script also looks in Android
      Studio's default places, so this is often already fine:
      - Windows: `%LOCALAPPDATA%\Android\Sdk`
      - macOS: `~/Library/Android/sdk`
      - Linux: `~/Android/Sdk`
- [ ] **adb** on your PATH (it's in `<sdk>/platform-tools`). The script finds
      it in the SDK even if it isn't.

### On the phone (once)

- [ ] **Settings → About phone →** tap **Build number** 7 times to turn on
      Developer options.
- [ ] **Settings → System → Developer options →** turn on **USB debugging**.
- [ ] Plug the phone in, unlock it, and tap **Allow** on the "Allow USB
      debugging?" prompt (tick *Always allow from this computer*).
- [ ] Check it's seen with `adb devices`. You should see one line ending in
      `device`. `unauthorized` means the prompt on the phone wasn't accepted
      yet.

### Every build

From the repo's root folder:

```bash
# 1. Connect the phone (USB debugging on, screen unlocked).
# 2. Build, install and open it:
node tools/android/build-apk.mjs graveway --install --launch

# Or build only, and install yourself:
node tools/android/build-apk.mjs graveway --version 0.2
adb install -r dist-android/graveway-0.2.apk
```

The APK ends up in `dist-android/`. The Android project the script
generates is in `.android-build/graveway/android/`, and you can open that
folder in Android Studio if you want to poke at it. Both folders are
git-ignored. The first build downloads Gradle and its dependencies, which
takes a few minutes. After that, builds take well under a minute.

Script options: `--version 0.2` (versionName), `--install`, `--launch`,
`--clean` (rebuild the Android project from scratch), `--no-gradle` (check
the setup without building).

### Wireless instead of a cable (Android 11+)

**Developer options → Wireless debugging → Pair device with pairing code**,
then on the computer:

```bash
adb pair <ip>:<pairing-port>     # enter the code shown on the phone
adb connect <ip>:<port>          # the port shown on the Wireless debugging screen
```

After that, `--install` works the same as over USB.

## Testing tips

- **Leave notes while you play.** Pause, then tap **Leave a note**. Each
  note saves where you were, your survivor, gun, health and frame rate. A
  gold badge on the menu's settings button counts the notes not yet sent.
- **Send them to Claude:** **Settings → Playtest notes → Send to Claude**
  opens a GitHub issue on this repo with the notes filled in. Tap
  **Submit**, and Claude can read them in any session (they're the issues
  titled "Playtest notes"). The notes are also copied to the clipboard, in
  case the page opens with an empty form. **Copy all** still works for
  pasting straight into a chat.
- **Settings → Playtest tools**: free coins, start runs at 200, 500 or
  1000 m, invincibility, and a frame-rate readout.
- **Debug the game's WebView from a computer**: with the phone plugged in,
  open `chrome://inspect` in desktop Chrome and pick Graveway. You get the
  console, the DOM, and `graveway.game` / `graveway.save`.
- **Even quicker, with no APK**: run `npx serve .` from the repo root and
  open `http://<your-computer's-ip>:3000/graveway/` in Chrome on the phone,
  on the same Wi-Fi. Edit a file, reload, done. (Vibration and the back
  button only behave like the app inside the APK.)

## When it goes wrong

| Message | Fix |
| --- | --- |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` / "App not installed" | The phone has a copy signed with a different key: a cloud build vs a local one, or two different computers. Copy your notes out, then run `adb uninstall com.thejumpvault.graveway` (or uninstall it on the phone) and install again. |
| `SDK location not found` | Set `ANDROID_HOME`, or create `.android-build/graveway/android/local.properties` containing `sdk.dir=/path/to/Android/Sdk`. |
| `Unsupported class file major version` / Gradle complains about Java | Gradle is using the wrong JDK. Point `JAVA_HOME` at JDK 21. |
| `adb: no devices/emulators found` | Cable, USB debugging, unlocked screen, accepted prompt. Some cables only charge. |
| Builds but the old version still shows | Close the app fully (swipe it away) and reopen it. |
