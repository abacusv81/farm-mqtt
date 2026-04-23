# Push Server (MQTT -> Web Push)

This service listens to the MQTT status topic and sends a push notification whenever any relay changes state.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and fill values.
3. Generate VAPID keys:
   ```bash
   npx web-push generate-vapid-keys
   ```
4. Start server:
   ```bash
   npm start
   ```

## Endpoints
- `POST /subscribe` body: `{ "subscription": <PushSubscription> }`
- `POST /unsubscribe` body: `{ "subscription": <PushSubscription> }`

If `API_KEY` is set, send it in `x-api-key` header.
