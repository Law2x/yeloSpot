const $ = (s)=>document.querySelector(s);
const serviceTypeEl = $('#serviceType');
const pickupEl = $('#pickup');
const dropoffEl = $('#dropoff');
const quoteBox = $('#quoteBox');
const btnQuote = $('#btnQuote');
const btnOrder = $('#btnOrder');
const orderMsg = $('#orderMsg');
const trackCard = $('#trackingCard');
const trackMsg = $('#trackMsg');

// Map to pick points
const map = L.map('map').setView([14.5995, 120.9842], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
let markers = [];
function setMarker(latlng){ const m = L.marker(latlng, {draggable:true}).addTo(map); m.on('dragend', syncInputs); markers.push(m); syncInputs(); }
function syncInputs(){
  if (markers[0]) pickupEl.value = markers[0].getLatLng().lat.toFixed(6)+','+markers[0].getLatLng().lng.toFixed(6);
  if (markers[1]) dropoffEl.value = markers[1].getLatLng().lat.toFixed(6)+','+markers[1].getLatLng().lng.toFixed(6);
}
map.on('click', (e)=>{ if (markers.length < 2) setMarker(e.latlng); });

// Tracking map
const tmap = L.map('trackMap').setView([14.5995, 120.9842], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(tmap);
const driverMarker = L.marker([14.5995,120.9842]).addTo(tmap);

let currentQuotation = null;
let currentOrderId = null;
let evt = null;

async function getQuote(){
  quoteBox.textContent = '...';
  const [plat, plng] = pickupEl.value.split(',').map(parseFloat);
  const [dlat, dlng] = dropoffEl.value.split(',').map(parseFloat);
  const body = { pickup: {lat: plat, lng: plng}, dropoff: {lat: dlat, lng: dlng}, serviceType: serviceTypeEl.value };
  const res = await fetch('/api/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok){ quoteBox.textContent = data.message || 'Failed to quote'; return; }
  currentQuotation = data.data;
  const price = data.data?.priceBreakdown?.total, currency = data.data?.priceBreakdown?.currency || '';
  if (price){ quoteBox.textContent = `${currency} ${price}`; btnOrder.disabled = false; } else { quoteBox.textContent = 'Quoted.'; btnOrder.disabled = false; }
}

async function placeOrder(){
  btnOrder.disabled = true;
  orderMsg.textContent = 'Placing order...';
  const body = {
    quotationId: currentQuotation.quotationId,
    sender: { name: 'Yelo Spot', phone: '+639000000000', stopId: currentQuotation.stops?.[0]?.stopId },
    recipient: { name: 'Customer', phone: '+639000000000', stopId: currentQuotation.stops?.[1]?.stopId },
    isPODEnabled: true
  };
  const res = await fetch('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok){ orderMsg.textContent = data.message || 'Order failed'; return; }
  currentOrderId = data?.data?.orderId || data?.data?.id;
  if (!currentOrderId){ orderMsg.textContent = 'Order created (no ID?)'; return; }
  orderMsg.textContent = `Order ${currentOrderId} created. Waiting for driver...`;
  trackCard.style.display = 'block';

  if (evt) { evt.close(); evt = null; }
  evt = new EventSource(`/events/${currentOrderId}`);
  evt.onmessage = (m)=>{
    try {
      const ev = JSON.parse(m.data);
      if (ev.type === 'connected') return;
      if (ev.type === 'webhook') {
        const st = ev.payload?.data?.status;
        const did = ev.payload?.data?.driverId;
        if (st) orderMsg.textContent = `Status: ${st}`;
        if (did) orderMsg.textContent += ` • Driver: ${did}`;
      }
      if (ev.type === 'driver' && ev.data?.coordinates){
        const c = ev.data.coordinates;
        const lat = parseFloat(c.lat), lng = parseFloat(c.lng);
        driverMarker.setLatLng([lat,lng]); tmap.setView([lat,lng]);
        trackMsg.textContent = `Last update: ${c.updatedAt}`;
      }
    } catch(e) {}
  };
}

btnQuote.addEventListener('click', getQuote);
btnOrder.addEventListener('click', placeOrder);
