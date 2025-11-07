// --------- helpers & dom refs ----------
const $ = (s) => document.querySelector(s);
const serviceTypeEl = $('#serviceType');

const pickupEl = $('#pickup');      // hidden lat,lng
const dropoffEl = $('#dropoff');    // hidden lat,lng
const pickupAddr = $('#pickupAddr');
const dropAddr   = $('#dropAddr');
const pickupSuggest = $('#pickupSuggest');
const dropSuggest   = $('#dropSuggest');
const pickupNote = $('#pickupNote');
const dropNote   = $('#dropNote');

const quoteBox = $('#quoteBox');
const btnQuote = $('#btnQuote');
const btnOrder = $('#btnOrder');
const orderMsg = $('#orderMsg');
const trackCard = $('#trackingCard');
const trackMsg = $('#trackMsg');
const routeInfo = $('#routeInfo');

let currentQuotation = null;
let currentOrderId = null;
let evt = null;

// --------- maps ----------
const map = L.map('map').setView([14.5995, 120.9842], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
let markers = [];         // 0: pickup, 1: drop

const tmap = L.map('trackMap', { zoomControl: true }).setView([14.5995, 120.9842], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(tmap);
const driverMarker = L.marker([14.5995,120.9842]).addTo(tmap);

// route layer / ETA
let routeLayer = null;
function formatKm(m){ const km=m/1000; return km<10?km.toFixed(1):Math.round(km).toString(); }
function formatMin(s){ const m=Math.round(s/60); if(m<60) return `${m} min`; const h=Math.floor(m/60), mm=m%60; return `${h}h ${mm}m`; }

async function drawRouteIfReady(){
  if(!markers[0] || !markers[1]){
    routeInfo.style.display = 'none';
    if(routeLayer){ map.removeLayer(routeLayer); try{ tmap.removeLayer(routeLayer);}catch(e){} routeLayer=null; }
    return;
  }
  const a = markers[0].getLatLng(), b = markers[1].getLatLng();
  try{
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url); const data = await res.json();
    const route = data?.routes?.[0]; if(!route){ routeInfo.style.display='none'; return; }
    if(routeLayer){ map.removeLayer(routeLayer); try{ tmap.removeLayer(routeLayer);}catch(e){} }
    routeLayer = L.geoJSON(route.geometry, { weight: 5, opacity: .9 });
    routeLayer.addTo(map); try{ routeLayer.addTo(tmap); }catch(e){}
    const coords = route.geometry.coordinates.map(([lng,lat]) => [lat,lng]);
    const bounds = L.latLngBounds(coords); map.fitBounds(bounds, { padding:[20,20] });
    const km = formatKm(route.distance);
    const etaAdj = Math.max(1, route.duration * 1.15); // +15% buffer
    const eta = formatMin(etaAdj);
    routeInfo.textContent = `Estimated distance: ${km} km • ETA: ${eta}`;
    routeInfo.style.display = 'block';
  }catch(e){ routeInfo.style.display='none'; }
}

// --------- geocode & reverse ----------
async function doGeocode(q){
  try{
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if(!r.ok) return { features:[] };
    return r.json();
  }catch{ return { features:[] }; }
}
async function rev(lat,lng){
  try{
    const r = await fetch(`/api/revgeocode?lat=${lat}&lng=${lng}`);
    if(!r.ok) return null; return r.json();
  }catch{ return null; }
}
function bindSearch(elInput, box, which){
  let debounce;
  elInput.addEventListener('input', ()=>{
    clearTimeout(debounce);
    const q = elInput.value.trim();
    if(!q){ box.style.display='none'; return; }
    debounce = setTimeout(async ()=>{
      const data = await doGeocode(q);
      box.innerHTML = '';
      (data.features||[]).forEach(f=>{
        const lat = f.geometry.coordinates[1], lng = f.geometry.coordinates[0];
        const p = f.properties;
        const line = [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', ');
        const div = document.createElement('div');
        div.textContent = line || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        div.onclick = ()=>{
          elInput.value = div.textContent; box.style.display='none';
          if(which==='pickup'){
            if(!markers[0]) setMarker({lat,lng}); else markers[0].setLatLng([lat,lng]);
            pickupEl.value = `${lat},${lng}`; pickupNote.textContent = div.textContent;
          }else{
            if(!markers[1]) setMarker({lat,lng}); else markers[1].setLatLng([lat,lng]);
            dropoffEl.value = `${lat},${lng}`; dropNote.textContent = div.textContent;
          }
          map.setView([lat,lng], 15);
          drawRouteIfReady();
        };
        box.appendChild(div);
      });
      box.style.display = box.children.length ? 'block' : 'none';
    }, 250);
  });
}
bindSearch(pickupAddr, pickupSuggest, 'pickup');
bindSearch(dropAddr, dropSuggest, 'drop');

// --------- map interactions ----------
function setMarker(latlng){
  const m = L.marker(latlng, { draggable:true }).addTo(map);
  m.on('dragend', async ()=>{ await syncInputs(); drawRouteIfReady(); });
  markers.push(m);
  syncInputs();
  drawRouteIfReady();
}

async function syncInputs(){
  if(markers[0]){
    const a = markers[0].getLatLng();
    pickupEl.value = `${a.lat},${a.lng}`;
    try{ const r = await rev(a.lat,a.lng); if(r?.display_name){ pickupAddr.value = r.display_name; pickupNote.textContent = r.display_name; } }catch{}
  }
  if(markers[1]){
    const b = markers[1].getLatLng();
    dropoffEl.value = `${b.lat},${b.lng}`;
    try{ const r = await rev(b.lat,b.lng); if(r?.display_name){ dropAddr.value = r.display_name; dropNote.textContent = r.display_name; } }catch{}
  }
}
map.on('click', (e)=>{ if(markers.length<2) setMarker(e.latlng); });

// --------- quotation & order ----------
async function getQuote(){
  quoteBox.textContent = '...';
  const [plat,plng] = (pickupEl.value||'').split(',').map(parseFloat);
  const [dlat,dlng] = (dropoffEl.value||'').split(',').map(parseFloat);
  if([plat,plng,dlat,dlng].some(Number.isNaN)){
    quoteBox.textContent = 'Set pickup & drop-off first (search or tap map)';
    return;
  }
  const body = { pickup:{lat:plat,lng:plng}, dropoff:{lat:dlat,lng:dlng}, serviceType: serviceTypeEl.value };
  const res = await fetch('/api/quote',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if(!res.ok){ quoteBox.textContent = data.message || 'Failed to quote'; return; }
  currentQuotation = data.data;
  const price = data.data?.priceBreakdown?.total, currency = data.data?.priceBreakdown?.currency || 'PHP';
  if(price){ quoteBox.textContent = `${currency} ${price}`; } else { quoteBox.textContent = 'Quoted.'; }
  btnOrder.disabled = false;
}

async function placeOrder(){
  btnOrder.disabled = true;
  orderMsg.textContent = 'Placing order...';
  const body = {
    quotationId: currentQuotation.quotationId,
    sender: { name:'Yelo Spot', phone:'+639000000000', stopId: currentQuotation.stops?.[0]?.stopId },
    recipient: { name:'Customer', phone:'+639000000000', stopId: currentQuotation.stops?.[1]?.stopId },
    isPODEnabled:true
  };
  const res = await fetch('/api/order',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if(!res.ok){ orderMsg.textContent = data.message || 'Order failed'; return; }
  currentOrderId = data?.data?.orderId || data?.data?.id;
  if(!currentOrderId){ orderMsg.textContent = 'Order created (no ID?)'; return; }
  orderMsg.textContent = `Order ${currentOrderId} created. Waiting for driver...`;
  trackCard.style.display = 'block';

  if(evt){ evt.close(); evt=null; }
  evt = new EventSource(`/events/${currentOrderId}`);
  evt.onmessage = (m)=>{
    try{
      const ev = JSON.parse(m.data);
      if(ev.type==='connected') return;
      if(ev.type==='webhook'){
        const st = ev.payload?.data?.status;
        const did = ev.payload?.data?.driverId;
        if(st) orderMsg.textContent = `Status: ${st}`;
        if(did) orderMsg.textContent += ` • Driver: ${did}`;
      }
      if(ev.type==='driver' && ev.data?.coordinates){
        const c = ev.data.coordinates;
        const lat = parseFloat(c.lat), lng = parseFloat(c.lng);
        driverMarker.setLatLng([lat,lng]); tmap.setView([lat,lng]);
        trackMsg.textContent = `Last update: ${c.updatedAt}`;
      }
    }catch{}
  };
}

btnQuote.addEventListener('click', getQuote);
btnOrder.addEventListener('click', placeOrder);
