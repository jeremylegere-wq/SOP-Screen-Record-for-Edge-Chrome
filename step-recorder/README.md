# Step Recorder (Edge / Chromium, Manifest V3)

Records clicks, typing and dropdown changes in the browser and turns them into a step-by-step guide with a screenshot per step and the clicked element highlighted.

## Install in Edge
1. Unzip this folder somewhere permanent.
2. Open `edge://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the `step-recorder` folder.
4. Pin the extension from the puzzle-piece menu.

## Use
1. Open the page where the workflow starts, click the extension icon, then **Start recording**. The icon shows a red REC badge.
2. Do the workflow. Each click, typed value, dropdown choice and Enter press becomes a step.
3. Click the icon again and choose **Stop & view guide**.
4. In the guide, edit titles, add notes, reorder or delete steps, then export as a self-contained HTML file, print to PDF, copy as text, or save as JSON.

## Notes and limits
- Pages under `edge://` and the Edge Add-ons store can't be recorded (browser restriction).
- Screenshots capture the visible part of the tab only, at most about two per second (browser limit), so very rapid clicks may lag slightly.
- Password and other sensitive-looking fields are not written into step text, but screenshots show whatever is on screen. Review before sharing.
- Clicks inside cross-origin iframes are recorded but have no highlight ring.
- Typing in rich-text (contenteditable) editors is not captured as a typing step.
- Data is stored locally in the browser (`chrome.storage.local`); nothing is sent anywhere.

## Files
- `manifest.json` - extension definition
- `background.js` - recording state, screenshots, storage
- `content.js` - captures page events
- `popup.html/js` - start, pause, stop controls
- `viewer.html/js/css` - guide editor and exporter
