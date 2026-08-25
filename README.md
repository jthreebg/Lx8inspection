# LeMatic LX-8 Inspection (PWA)

Progressive Web App for baking equipment inspections on LeMatic LX-8 machines.

Works offline after first load, installable on phone/desktop, and can be hosted on **GitHub Pages**.

## Features

- Mobile-first inspection workflow
- Draft / complete inspections (saved in browser storage)
- Findings, photos, severity, PDF export
- Liquid Glass–style dark UI
- Installable PWA with offline cache

## Host on GitHub Pages

1. Create a new GitHub repository (public or private).
2. Upload everything in this folder to the **root** of the repo (or a `/docs` folder).
3. In the repo: **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: `main` (or `master`)
   - Folder: `/ (root)` — or `/docs` if you put files there
4. Save. After a minute, open:

   `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

### Important for PWA

- Must be served over **HTTPS** (GitHub Pages does this automatically).
- Open the site in Chrome / Safari / Edge, then use **Install app** / **Add to Home Screen**.
- Service worker path is relative (`./sw.js`), so hosting in a subpath also works.

## Local test

```bash
# From this folder — any static server works
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` and check Application → Manifest / Service Workers in DevTools.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App UI + logic |
| `manifest.webmanifest` | PWA name, icons, display mode |
| `sw.js` | Offline cache |
| `icons/` | App icons (192, 512, Apple touch) |

## Notes

- Inspection data stays in the device’s **localStorage** (not on a server).
- PDF export needs network the first time to load jsPDF from CDN; after that it can work from cache.
- To force an update after you change the app, bump `CACHE_NAME` in `sw.js` (e.g. `lx8-inspection-v2`).
