# MQTT Mobile WebApp (GitHub Pages Ready)

Folder:
`/Users/vsundarraj/Documents/Arduino/mqtt-mobile-webapp`

## What this app does
- Mobile-first UI (iPhone + Android)
- Relay selector (R1..R16)
- ON/OFF control
- Schedule set with days + time range
- Fetch status on demand
- Reflects selected relay state/schedule from ESP32 status topic
- Uses public broker over WebSocket (`wss://...`)

## GitHub Web upload (no terminal needed)

### Option A (Recommended): put these files at repo root
1. Create a new GitHub repo (public).
2. Upload all files from `mqtt-mobile-webapp` into the root of repo.
3. GitHub repo -> Settings -> Pages.
4. Source: `Deploy from a branch`.
5. Branch: `main` and folder `/ (root)`.
6. Save and wait for publish.
7. Open your Pages URL:
   `https://<username>.github.io/<repo>/`

### Option B: keep files inside `/mqtt-mobile-webapp` folder in repo
1. Upload folder as `mqtt-mobile-webapp`.
2. In Settings -> Pages, set folder to `/mqtt-mobile-webapp` (if available in your Pages UI).
3. Open:
   `https://<username>.github.io/<repo>/mqtt-mobile-webapp/`

If your Pages UI only supports `/root` or `/docs`, use Option A, or move folder content into `/docs`.

## Runtime setup
- Broker URL: `wss://broker.hivemq.com:8884/mqtt`
- Default topics already match your ESP32 sketch:
  - `babu/esp32/cmd`
  - `babu/esp32/schedule`
  - `babu/esp32/status`
  - `babu/esp32/statusreq`

## Install on phone
- iPhone (Safari): Share -> Add to Home Screen
- Android (Chrome): Install app / Add to Home screen

## Important
- The app must be opened via HTTPS (GitHub Pages gives this).
- ESP32 and phone can be on different networks; both only need internet access to the same public broker and topics.
