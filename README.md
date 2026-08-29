# LeMatic Inspect PWA

Standalone Progressive Web App for LeMatic bakery equipment inspections and field service visit reports.

Works as a home-screen app on iPhone (Safari → **Add to Home Screen**). Data stays in the device `localStorage`. PDF export uses jsPDF from a CDN (needs network the first time).

## Samples for testing

On Home:

- **Load example inspection** — BBU Orangeburg Line 1 checklist with Good / Fair / Poor picks and notes.
- **+ Visit Report → Load example** — sample visit letter, repair cards, completed / order lists, and photos.

## Repo layout

```
lx8-inspect-pwa/
  index.html
  manifest.webmanifest
  sw.js
  icons/
    icon-180.png
    icon-192.png
    icon-512.png
    icon-maskable-512.png
  .nojekyll
```

## Publish on GitHub Pages

1. Create a GitHub repo.
2. Upload this folder to the repo root.
3. Settings → Pages → Deploy from a branch → `main` / `(root)`.
4. Open `https://<your-user>.github.io/<repo>/`

HTTPS is required for the service worker and Add to Home Screen.

## Install on iPhone

1. Open the Pages URL in Safari.
2. Share → Add to Home Screen.
3. The LeMatic globe icon should appear on the home screen.

Cache name for this build: `lematic-inspect-v7`.
