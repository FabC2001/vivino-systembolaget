# vivino-systembolaget

Chrome extension that shows Vivino scores on Systembolaget product tiles.

Works with the 2026 Systembolaget site (Manifest V3, service worker, Vivino
Algolia search). Badges show on category pages, search results, and any
other tile list.

## Install (no coding required)

1. **Download the extension.**
   On this GitHub page, click the green **Code** button → **Download ZIP**.
   Unzip it somewhere you'll remember (e.g. `Documents/vivino-systembolaget`).

2. **Open Chrome extensions.**
   In Chrome, go to `chrome://extensions/`.

3. **Turn on Developer mode.**
   Top-right corner — flip the toggle on. This is needed because the
   extension isn't on the Chrome Web Store yet; it's required every time
   you load an extension from a folder.

4. **Load the extension.**
   Click **Load unpacked** (top-left), then select the `public` folder
   inside the folder you unzipped. *Not* the top-level folder — the
   `public` subfolder.

5. **Try it.**
   Visit <https://www.systembolaget.se/sortiment/vin/> — each wine tile
   should get a red `★ 3.9 (1234)` badge linking to Vivino. Grey badges
   with a `?` mean the Vivino match is uncertain — click to verify.

### Updating to a new version

Download the latest ZIP, replace the folder, then click the **refresh
icon** on the extension card at `chrome://extensions/`.

## Build from source (developers)

Requires Node 18+.

```
npm install
npm run build
```

Output goes to `public/`. For live-rebuild during development:
`npm start`.

## Troubleshooting

- **No badges showing** — reload the page, and check DevTools console on
  the Systembolaget page for errors.
- **Old ratings sticking around** — the extension auto-clears its cache
  when you reload the extension (refresh icon at `chrome://extensions/`).
- **Debugging** — click `service worker` on the extension's card at
  `chrome://extensions/` to open background-script DevTools.

## Privacy

- Only runs on `systembolaget.se` pages.
- Only talks to Vivino's public search API.
- Caches results in `chrome.storage.local` for 6 hours to reduce load on
  Vivino. Nothing is sent anywhere else.
