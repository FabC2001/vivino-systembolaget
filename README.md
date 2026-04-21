# vivino-systembolaget

Chrome extension that shows Vivino scores on Systembolaget product tiles.

Updated for 2026: Manifest V3, service worker background, modern `fetch` +
esbuild bundling, defensive selectors for the current Systembolaget and
Vivino markup.

## Build

1. Install Node 18+ (e.g. `brew install node`).
2. From the repo root:
   ```
   npm install
   npm run build
   ```
   Output is written to `public/` (`contentScript.js`, `bgScript.js`,
   `manifest.json`).

For development: `npm start` watches sources and rebuilds on change.

## Install in Chrome

1. Build the extension (see above) so `public/` contains `manifest.json`,
   `bgScript.js`, and `contentScript.js`.
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select the `public/` folder.
5. Visit `https://www.systembolaget.se/sortiment/vin/` — product tiles
   should get a red "★ score (reviews)" badge linking to Vivino.

### Updating after a rebuild

Click the refresh icon on the extension card on `chrome://extensions/` so
Chrome reloads the service worker and the updated content script.

### Troubleshooting

- If badges don't appear, open DevTools on the Systembolaget page and check
  the console for content-script errors.
- To debug the background service worker, click **service worker** on the
  extension's card at `chrome://extensions/`.
- Results are cached in `chrome.storage.local` for 6 hours to reduce load
  on Vivino.
