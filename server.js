
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { llmRequest } = require('./lib/lalamove');
const { channel } = require('./lib/bus');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_PATH = path.join(__dirname, 'data', 'orders.json');
function loadDB() { try { return JSON.parse(fs.readFileSync(DATA_PATH,'utf8') || '{}'); } catch(e){ return {}; } }
function saveDB(db) { fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2)); }
const db = loadDB();

// Health
app.get('/api/health', (_req,res)=>res.json({ok:true, time: new Date().toISOString()}));

// Get a quotation
app.post('/api/quote', async (req, res) => {
  try {
    const { pickup, dropoff, serviceType='MOTORCYCLE', language='en_PH', item } = req.body;
    const body = {
      data: {
        serviceType, language, isRouteOptimized: false,
        stops: [
          { coordinates: { lat: String(pickup.lat), lng: String(pickup.lng) }, address: pickup.address || 'Pickup' },
          { coordinates: { lat: String(dropoff.lat), lng: String(dropoff.lng) }, address: dropoff.address || 'Dropoff' }
        ],
        item: item || { quantity: "1", weight: "UNSPECIFIED", categories: [] }
      }
    };
    if (process.env.MOCK_MODE === '1') {
      const quotationId = uuidv4().replace(/-/g,'');
      return res.json({ data: {
        quotationId,
        priceBreakdown: { total: "120", currency: "PHP" },
        stops: [
          { stopId: "s1", ...body.data.stops[0] },
          { stopId: "s2", ...body.data.stops[1] }
        ]
      }});
    }
    const data = await llmRequest('POST', '/v3/quotations', body);
    res.json(data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: true, message: err.response?.data || err.message });
  }
});

// Place order
app.post('/api/order', async (req, res) => {
  try {
    const { quotationId, sender, recipient, isPODEnabled=true, metadata } = req.body;
    if (!quotationId) return res.status(400).json({ error: 'quotationId required' });
    if (process.env.MOCK_MODE === '1') {
      const orderId = String(Date.now());
      const shareLink = `https://share.lalamock.com/${orderId}`;
      db[orderId] = { quotationId, driverId: 'D-MOCK', status: 'ON_GOING', shareLink, history: [], mock: true };
      saveDB(db);
      return res.json({ data: { orderId, quotationId, shareLink, status: 'ON_GOING' } });
    }

    let quot;
    try { quot = await llmRequest('GET', `/v3/quotations/${quotationId}`); } catch (e) {}
    const pickupStopId = sender?.stopId || quot?.data?.stops?.[0]?.stopId;
    const dropStopId = recipient?.stopId || quot?.data?.stops?.[1]?.stopId;
    const body = {
      data: {
        quotationId,
        sender: { stopId: pickupStopId, name: sender?.name || "Yelo Spot", phone: sender?.phone || "+639000000000" },
        recipients: [{ stopId: dropStopId, name: recipient?.name || "Customer", phone: recipient?.phone || "+639000000000", remarks: recipient?.remarks || "" }],
        isPODEnabled, metadata: metadata || { brand: "Yelo Spot" }
      }
    };
    const data = await llmRequest('POST', '/v3/orders', body);
    const orderId = data?.data?.orderId || data?.data?.id || null;
    if (orderId) {
      db[orderId] = { quotationId, status: data?.data?.status || 'ASSIGNING_DRIVER', shareLink: data.data.shareLink || null, driverId: data.data.driverId || null };
      saveDB(db);
    }
    res.json(data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: true, message: err.response?.data || err.message });
  }
});

// Order details
app.get('/api/order/:id', async (req,res) => {
  const orderId = req.params.id;
  try {
    if (process.env.MOCK_MODE === '1') {
      const rec = db[orderId];
      if (!rec) return res.status(404).json({ error: 'not found' });
      return res.json({ data: { orderId, status: rec.status, driverId: rec.driverId, shareLink: rec.shareLink } });
    }
    const data = await llmRequest('GET', `/v3/orders/${orderId}`);
    if (!db[orderId]) db[orderId] = {};
    db[orderId].status = data?.data?.status || db[orderId].status;
    db[orderId].driverId = data?.data?.driverId || db[orderId].driverId;
    db[orderId].shareLink = data?.data?.shareLink || db[orderId].shareLink;
    saveDB(db);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.response?.data || err.message });
  }
});

// Track endpoint remains for manual refresh if ever needed (not used by frontend)
app.get('/api/track/:orderId', async (req, res) => {
  const orderId = req.params.orderId;
  try {
    if (process.env.MOCK_MODE === '1') {
      const rec = db[orderId]; if (!rec) return res.status(404).json({ error: 'not found' });
      const p1 = { lat: 14.5896, lng: 120.9811 };
      const p2 = { lat: 14.5547, lng: 121.0244 };
      const now = Date.now(); const t = (Math.sin(now/20000) + 1)/2;
      const lat = p1.lat + (p2.lat - p1.lat)*t; const lng = p1.lng + (p2.lng - p1.lng)*t;
      return res.json({ data: { driverId: rec.driverId, coordinates: { lat: String(lat), lng: String(lng), updatedAt: new Date().toISOString() } } });
    }
    let driverId = db[orderId]?.driverId;
    if (!driverId) {
      const od = await llmRequest('GET', `/v3/orders/${orderId}`);
      driverId = od?.data?.driverId;
      if (driverId) { db[orderId] = { ...(db[orderId]||{}), driverId }; saveDB(db); }
      else return res.json({ data: { driverId: null, coordinates: null, status: od?.data?.status || 'ASSIGNING_DRIVER' } });
    }
    const drv = await llmRequest('GET', `/v3/orders/${orderId}/drivers/${driverId}`);
    res.json(drv);
  } catch (err) {
    res.status(500).json({ error: true, message: err.response?.data || err.message });
  }
});

// SSE endpoint: clients subscribe here and get webhook-driven broadcasts
app.get('/events/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const ch = channel(orderId);
  const push = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  ch.on('update', push);
  push({ type: 'connected', orderId });
  req.on('close', () => ch.off('update', push));
});

// Webhook receiver: broadcasts events; optionally fetches one fresh location
app.post(process.env.WEBHOOK_PATH || '/webhook/lalamove', async (req,res) => {
  try {
    const payload = req.body;
    const eventType = payload?.eventType || payload?.type;
    const orderId = payload?.data?.orderId || payload?.data?.id;
    // TODO: add signature verification per developers.lalamove.com (enable when VERIFY_WEBHOOK=1)
    if (orderId) {
      db[orderId] = db[orderId] || {};
      if (payload?.data?.driverId) db[orderId].driverId = payload.data.driverId;
      if (payload?.data?.status) db[orderId].status = payload.data.status;
      saveDB(db);
      channel(orderId).emit('update', { type: 'webhook', eventType, payload });

      // On assignment or status change, pull a single fresh coordinate and push
      const shouldFetch = ['DRIVER_ASSIGNED','ORDER_STATUS_CHANGED'].includes(eventType);
      if (shouldFetch && db[orderId]?.driverId && process.env.MOCK_MODE !== '1') {
        try {
          const drv = await llmRequest('GET', `/v3/orders/${orderId}/drivers/${db[orderId].driverId}`);
          channel(orderId).emit('update', { type: 'driver', data: drv.data });
        } catch(e) { /* ignore out-of-window errors */ }
      }
    }
  } catch (e) {
    console.error("Webhook parse error", e);
  } finally {
    res.status(200).json({ ok: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Yelo Spot server at http://localhost:${PORT}`));
