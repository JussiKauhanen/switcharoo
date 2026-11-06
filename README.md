# switcharoo

Move passwords, notes and small files between devices with QR codes.
No server, no account, nothing leaves the two devices. It's a static page that runs on GitHub Pages.

- **Send**: type or paste text, or drop or pick a file. One QR if it fits, otherwise rotating QRs.
- **Receive**: point the camera at the other screen. The bar fills and the item lands in history.
- **History**: each item has copy (paste it anywhere), download, show-as-QR again, and delete. Text is masked until you tap it.
- Data is deflate-compressed before sending (native `CompressionStream`) and decompressed on receive.
- **Landing page** (`index.html`): a QR code and link to the app. Open it on your laptop, scan with your phone, and the app opens there.
- **Dark mode** follows the system. The moon/sun button overrides it, and the choice is remembered.

## Run locally

The camera needs a secure context, which `localhost` counts as:

```sh
python3 -m http.server 8000
# open http://localhost:8000          landing page
# open http://localhost:8000/app.html the app itself
```

To test with a phone, use the GitHub Pages URL (HTTPS). A plain LAN IP won't get camera access.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Go to **Settings → Pages → Build and deployment**, choose *Deploy from a branch*, then `main` and `/ (root)`.
3. Open `https://jussikauhanen.github.io/switcharoo/`. The landing page's QR points to `…/<repo>/app.html`.

No build step. All paths are relative, so it works from a sub-path.

## Structure

```
index.html        landing page: QR + link that opens the app on another device
app.html          the app
css/style.css     all styles (light/dark tokens, desktop + mobile)
js/theme.js       light/dark toggle, loaded in <head> on both pages
js/landing.js     draws the landing QR from the current URL
js/app.js         UI wiring: tabs, send, receive, history list
js/codec.js       compress, base45, split into frames, reassemble
js/qr.js          draw a QR to canvas, rotate through frames
js/scanner.js     camera + decoding (BarcodeDetector, falls back to jsQR)
js/history.js     localStorage history
vendor/           qrcode-generator 1.4.4 (MIT), jsQR 1.4.0 (Apache-2.0)
```

## How the transfer works

```
item → [meta line + bytes] → deflate (only if smaller) → base45 → frames
frame = "SW1:<id>:<index>:<total>:<chunk>"
```

- Base45 stays inside the QR *alphanumeric* charset, which packs about 30% more data per code than base64.
- Payloads up to 680 characters are one static code (ECC M). Larger payloads are split into 300-character frames (ECC L) that loop at 2, 4 or 8 per second. Tap the speed pill to change the rate.
- The receiver collects frames in any order. A missed frame comes back on the next loop.
- Limits: 2 MB input and about 80 KB after compression. It's meant for secrets and notes, not photos.
- Scanning alternates a sharp pass and a downscaled pass, which keeps noisy desktop webcams working.

## Browser support

Recent Chrome, Edge, Safari (iOS 16.4+) and Firefox, on both desktop and mobile.
Chrome and Android use the native `BarcodeDetector`. Safari and Firefox lazy-load `vendor/jsQR.js`.

## Privacy note

History lives in this browser's `localStorage`, including received passwords. Use **Clear all** or the trash icon when you're done, especially on shared machines.
