# LeMatic Inspect PWA

Standalone Progressive Web App for LeMatic bakery equipment inspections.

Works as a home-screen app on iPhone (Safari → **Add to Home Screen**). Inspection data stays in the device’s `localStorage`. PDF reports use jsPDF from a CDN (needs network the first time a report is generated).

## Repo layout

```
lx8-inspect-pwa/
  index.html                 # full app
  manifest.webmanifest       # install metadata
  sw.js                      # offline cache
  icons/
    icon-180.png             # Apple touch icon
    icon-192.png
    icon-512.png
    icon-maskable-512.png
  .nojekyll                  # required for GitHub Pages
```

## Publish on GitHub Pages

1. Create a new GitHub repo (example name: `lx8-inspect`).
2. Upload this folder to the repo root (or `git push` it).
3. Repo **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` (or `master`), folder: `/ (root)`
4. Open:

   `https://<your-user>.github.io/lx8-inspect/`

   HTTPS is required for the service worker and “Add to Home Screen”.

### If the repo is a user site

Repo named `<user>.github.io` publishes at `https://<user>.github.io/`.  
Put these files in that repo’s root.

## Install on iPhone

1. Open the Pages URL in **Safari** (not Chrome).
2. Share → **Add to Home Screen**.
3. Launch from the LeMatic Inspect icon. It runs fullscreen (standalone).

Android: Chrome → menu → **Install app**.

## Update the live app

1. Edit `index.html` (or replace it with a new export).
2. Bump the cache name in `sw.js`:

   ```js
   const CACHE = 'lematic-inspect-v5';
   ```

3. Commit and push. Hard-refresh once, or close and reopen the home-screen app.

## Local test

GitHub Pages is the intended host. To test locally you still need a static server (service workers do not run from `file://`):

```bash
npx serve .
```

Then visit the printed localhost URL.

## Notes

- Do not rename `index.html` — Pages and the service worker both expect it.
- Paths are relative (`./`) so the app works at a project URL like `/lx8-inspect/`.
- Inspection records are per-browser / per-device. They are not synced to GitHub.
