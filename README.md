# LeMatic Field Service PWA

Split static package for GitHub Pages.

## Folder

```
pwa/
  index.html
  css/app.css
  js/app.js
  js/templates.js
  js/pdf-fallback.js
  vendor/exceljs.min.js
  vendor/jspdf.umd.min.js
  vendor/jspdf.plugin.autotable.min.js
  icons/
  manifest.webmanifest
  sw.js
  apple-touch-icon.png
```

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
