# LeMatic Field Service PWA

Flat static package for GitHub Pages - every file lives at the repo root
(no subfolders), so `start_url`/`scope` can stay `./` regardless of where
the repo is served from.

## Folder

```
index.html
app.css
app.js
templates.js
exceljs.min.js
jspdf.umd.min.js
jspdf.plugin.autotable.min.js
manifest.webmanifest
sw.js
icon-192.png
icon-512.png
icon-512-maskable.png
apple-touch-icon.png
```

`exceljs.min.js` and `jspdf*.min.js` are not loaded on startup - they're
fetched on demand (with a CDN fallback) the first time someone exports a
PDF or Excel file, and then cached by the service worker for next time.

## Add to GitHub

### New repo
1. Create an empty GitHub repo (no README).
2. On your computer:

```bash
cd pwa
git init
git add .
git commit -m "LeMatic field service PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

3. Repo → **Settings** → **Pages**
4. Source: **Deploy from a branch**
5. Branch: `main` / folder: `/ (root)`
6. Save. Wait a minute.

Site URL:

`https://YOUR_USER.github.io/YOUR_REPO/`

### Existing repo
Copy everything inside `pwa/` into the repo root (or into `/docs` and set Pages to `/docs`). Commit and push. Then enable Pages as above.

## Test on phone
1. Open the Pages URL in Safari or Chrome.
2. iPhone: Share → Add to Home Screen.
3. Android: Install app / Add to Home Screen.

Needs HTTPS (Pages provides that). Do not open as a `file://` page.

## Local test
From the `pwa` folder:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`

## Note
If the app is not at the domain root (`/YOUR_REPO/`), keep `start_url` and `scope` as `./` in `manifest.webmanifest`. That already matches a project-site URL.
