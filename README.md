# Yelo Spot (Realtime, Webhook → SSE)

Your branded delivery page with your map UI. Uses Lalamove API on the backend and **webhooks** to push live updates to the browser via **Server‑Sent Events (SSE)** — no client polling.

## Quick start

```bash
npm i
cp .env.example .env
# Optionally: MOCK_MODE=1 to demo without keys
npm run dev
# open http://localhost:3000
```

## Configure Webhook (Sandbox/Prod)
- In the **Partner Portal → Developers → Webhook**, set your URL to:  
  `https://<your-public-domain>/webhook/lalamove`  
- Or call `PATCH /v3/webhook` with your URL. Lalamove recommends responding **HTTP 200 quickly**, then validating the signature and processing. They will retry with exponential backoff and updates may arrive out of order — sort by timestamp. See docs. 

## How realtime works
1. Lalamove sends webhook events like `DRIVER_ASSIGNED` or `ORDER_STATUS_CHANGED` to your server.  
2. The server broadcasts the event to clients listening at `/events/:orderId` (SSE).  
3. On assignment / status change, the server fetches a **single** fresh driver coordinate (`GET /v3/orders/{orderId}/drivers/{driverId}`) and pushes it immediately to the browser.  
   - Note: Lalamove webhooks do **not** stream GPS; they deliver status and assignment events. This design keeps your UI realtime **without client polling** while respecting the API’s update cadence.

## Env
- `LALAMOVE_*` — API host, market, key, secret
- `MOCK_MODE=1` — demo without Lalamove
- `WEBHOOK_PATH=/webhook/lalamove` — receiving path
- `VERIFY_WEBHOOK=0` — add signature verification before turning this on in production

## Where to brand
- `public/styles.css`, `public/index.html`, put your logo at `public/logo.png`.

---

Built for **Yelo Spot** 💛
