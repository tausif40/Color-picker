# Color Picker

A compact macOS and Windows color picker with a global shortcut, a live screen picker, an instant result popup, and a local palette.

## Use

1. Install an app from `release/`, or run `npm install` and `npm start` for development.
2. Press the displayed shortcut (initially **Cmd/Ctrl + Shift + P**) or click **Pick color from screen**.
3. The picker opens instantly with a plus-shaped pinpoint cursor. Put its centre on a color and click (or press **Enter**); that exact pixel is picked. A round magnifier beside the cursor shows the pixels around it with a grid and the target pixel outlined, and moves to the other side near screen edges so it never covers the target. Clicking before the magnifier appears still picks the pixel under the cursor.
   - **Arrow keys** move one screen pixel (**Shift + arrow** moves ten).
   - **Scroll** or **+ / −** zooms the loupe in and out.
   - **Escape** or right click cancels. The popup opens in the center of that display.
4. In the popup, click a light-to-dark shade to show that shade's **HEX**, **HEXA**, **RGB**, **HSLA**, and **CMYK** codes. Selecting a shade does not change the clipboard. Click any code, or the copy button next to **Save**, to copy it; its icon briefly turns into a check, without a copied toast. Save the selected shade if you want to keep it.
5. Under **Settings**, click the shortcut field, press a key combination such as **Option+C** or a single key such as **F8**, and click **Save**. Use **Reset to default** to restore the original shortcut.
6. Under **Palette** (third tab), build a color palette of **2 to 8** flat colors shown as equal-width blocks that always fill the full width. **Add color** creates a new color related to the last one (the next step around the color wheel, same saturation, balanced lightness). Hover a block to change it (✎, opens the color panel) or remove it (×); drag blocks to reorder them, or use **Reverse** / **Shuffle**. Click a block to copy its HEX straight to the clipboard. **Copy** copies the whole palette as a HEX list, CSS variables, or JSON. **Save** keeps the palette under **Saved palettes** (up to 100) — click one to open it again, drag it by its handle to reorder the list, or copy/delete it. After deleting, **Undo** in the toast restores it for 5 seconds.
7. Under **Settings**, choose the appearance (**System**, the default, follows your Mac; or **Light** / **Dark**, which also applies to the result popup), and turn on:
   - **Open at login** to start Color Picker automatically after you log in or restart. It registers the installed app, so turn it on from the copy in `/Applications`.
   - **Start in menu bar** to skip opening the window at launch (use the shortcut or the menu bar icon).
   - **Show menu bar icon** to bring the icon back after hiding it with **Hide Menu Bar Icon** in the icon's own menu.

Up to **250** colors can be saved; when the list is full, remove one before saving another. **Save current** on the Saved page saves the color shown on the Picker page (the button shows that color). The app remembers your last **24** picks and shows the latest **12** under Recent picks. **Settings → About** shows the app's details (version, platform, shortcut, limits) a **Support** card (**Buy me a coffee** opens the developer's Buy Me a Coffee page), and, at the end, the developer's contact details.

The main window has a fixed size with the **Picker**, **Saved**, **Palette**, and **Settings** tabs at the bottom; everything fits without scrolling (only a long list of saved colors scrolls inside its grid). On macOS it uses the native close and minimize buttons; zoom/full screen is disabled.

Screen colors are opaque, so HEXA ends in `FF` and HSLA has alpha `1`. The requested HSA format is shown as the standard **HSLA** form (hue, saturation, lightness, alpha). CMYK is a calculated screen-color approximation; print workflows should use a printer profile for final output.

The picker uses a live screen stream, so you pick from the current screen rather than a frozen screenshot. macOS needs **Screen Recording** permission to read screen colors. Until it is granted, the main window shows a notice with **Open Settings** (turn on Color Picker under Screen & System Audio Recording) and **Restart app**, because macOS applies the permission only after a restart. The picker overlays are prepared in the background when the app starts, so the shortcut only has to start the screen stream; the stream (and the macOS recording indicator) stops as soon as you pick or cancel, or after one minute. Color Picker remains available through the menu bar or system tray after its main window is closed. Colors and the shortcut are stored locally in the app's user data directory. Colors saved by the earlier **Prism Pick** version are imported automatically on first launch. Because the app ID changed, macOS asks for **Screen Recording** permission again for **Color Picker**.

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
npm run pack:win            # x64 ZIP containing Color Picker.exe
npm run pack:win:small      # x64, smaller 7z archive
npm run pack:win:installer  # x64 installer and portable EXE
```

The Windows installer command is best run on Windows; on an Apple Silicon Mac it requires Rosetta. All build files appear in `release/`. For public distribution, configure the appropriate macOS signing and notarization or Windows code signing.

## Project layout

- `src/main.cjs`: Electron windows, global shortcut, picker lifecycle, persistence, tray, IPC.
- `src/picker.html`, `src/picker.js`: live screen picker with the plus cursor and round magnifier (windows are kept ready between picks).
- `src/popup.*`: instant result and copy actions.
- `src/index.html`, `src/app.js`, `src/styles.css`: main workspace.
- `assets/color_picker_icon.svg`: cropped app icon artwork used in the app and for packaged icons.
- `assets/dropper-outline.svg`: cropped dropper artwork used by the pick button and tray.
- `scripts/generate-icons.cjs`: renders the SVGs into macOS, Windows, and tray assets (`trayTemplate.png` and `@2x` for the 18 pt macOS menu bar icon).
