# Prism Pick

A compact macOS and Windows color picker with a global shortcut, a live eyedropper, an instant result popup, and a local palette.

## Use

1. Install an app from `release/`, or run `npm install` and `npm start` for development.
2. Press the displayed shortcut (initially **Cmd/Ctrl + Shift + P**) or click **Pick from screen**.
3. Move the arrow to a color and click. A live zoom bubble shows the pixels beside the arrow. Press **Escape** (or right click) to cancel. The popup opens in the center of that display.
4. In the popup, click a light-to-dark shade to show that shade's **HEX**, **HEXA**, **RGB**, **HSLA**, and **CMYK** codes. Click any code to copy it; its icon briefly turns into a green check, without a copied toast. Save the selected shade if you want to keep it.
5. Under **Settings**, click the shortcut field, press a key combination such as **Option+C** or a single key such as **F8**, and click **Save**. Use **Reset to default** to restore the original shortcut.

Screen colors are opaque, so HEXA ends in `FF` and HSLA has alpha `1`. The requested HSA format is shown as the standard **HSLA** form (hue, saturation, lightness, alpha). CMYK is a calculated screen-color approximation; print workflows should use a printer profile for final output.

The custom picker uses a live screen stream, so you pick from the current screen rather than a frozen screenshot. macOS needs **Screen Recording** permission for this zoom preview; the app opens the relevant System Settings page from its permission notice. Until permission is available, the system eyedropper remains usable. The temporary picker windows close when you pick, cancel, or after one minute. Prism Pick remains available through the menu bar or system tray after its main window is closed. Colors and the shortcut are stored locally in the app's user data directory.

## Build the app
 
Install dependencies once from the project folder:

```sh
npm install
```

After changing either SVG icon, regenerate the macOS, Windows, and tray assets:

```sh
npm run icons
```

### macOS

```sh
npm run pack:mac        # Apple Silicon (arm64): DMG and ZIP
npm run pack:mac:intel  # Intel (x64): DMG and ZIP
```

### Windows

```sh
npm run pack:win            # x64 ZIP containing Prism Pick.exe
npm run pack:win:small      # x64, smaller 7z archive
npm run pack:win:installer  # x64 installer and portable EXE
```

The Windows installer command is best run on Windows; on an Apple Silicon Mac it requires Rosetta. All build files appear in `release/`. For public distribution, configure the appropriate macOS signing and notarization or Windows code signing.

## Project layout

- `src/main.cjs`: Electron windows, global shortcut, picker lifecycle, persistence, tray, IPC.
- `src/picker.html`, `src/picker.js`: live screen picker, arrow, and zoom bubble.
- `src/native-picker.html`, `src/cursor.html`: system eyedropper fallback when live capture is unavailable.
- `src/popup.*`: instant result and copy actions.
- `src/index.html`, `src/app.js`, `src/styles.css`: main workspace.
- `assets/color_picker_icon.svg`: cropped app icon artwork used in the app and for packaged icons.
- `assets/dropper-outline.svg`: cropped dropper artwork used by the pick button and tray.
- `scripts/generate-icons.cjs`: renders the SVGs into macOS, Windows, and tray assets.
