LeMatic Field Service — PWA package
===================================

Contents
  index.html              App (inspections + punchlist)
  manifest.webmanifest    Add to Home Screen / install metadata
  sw.js                   Offline cache
  icons/                  App icons
  vendor/                 jsPDF, SheetJS, ExcelJS (offline export)

Install / run
  1. Put this folder on a local or HTTPS host.
     Examples:
       - Python:  python3 -m http.server 8080
       - Any static host (Netlify, GitHub Pages, IIS, nginx)
  2. Open the folder URL in Safari (iPhone) or Chrome (Android).
  3. iPhone: Share → Add to Home Screen
     Android: Chrome menu → Install app / Add to Home Screen
  4. After first load the app works offline.

Notes
  - file:// will not register the service worker. Use a web server.
  - Data stays in the device browser (IndexedDB). Backup / Restore is on Home.
  - Punchlist Excel export uses the bundled ExcelJS + template in the app.
