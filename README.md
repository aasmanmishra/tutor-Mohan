# My Meeting App

Browser-to-browser video class with whiteboard and PDF sharing (WebRTC via PeerJS). No server needed.

## Files
- `index.html` – the page
- `style.css` – styling
- `app.js` – app logic
- `config.js` – **your settings** (name, room, passcode hash, etc.)
- `make-passcode-hash.html` – open locally to create a new passcode hash
- `.nojekyll` – tells GitHub Pages to serve files as-is

## Deploy on GitHub Pages
1. Create a repo and upload all files to the root (drag & drop on github.com works).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
3. After ~1 minute your site is at `https://YOURNAME.github.io/REPO/`.
4. Teacher: open that link → **Teacher login** → enter passcode → **Start class**.
5. Click **Share** in the app to copy the student link (`?room=...&role=student`).

## Before you go live
- Make a new passcode: open `make-passcode-hash.html`, type it, paste the hash into `HOST_PASSCODE_HASH` in `config.js`.
- Change `ROOM` and `NAMESPACE` in `config.js` to something unique.
- Note: everything on GitHub Pages is public, so the passcode hash is a deterrent, not strong security. Use a long passcode.
