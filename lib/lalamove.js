
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

function buildSignature(method, path, body, secret) {
  const time = Date.now().toString();
  const payload = body ? JSON.stringify(body) : '';
  const raw = `${time}\r\n${method}\r\n${path}\r\n\r\n${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { time, signature, payload, raw };
}

async function llmRequest(method, path, body = null) {
  const host = process.env.LALAMOVE_HOST || 'https://rest.sandbox.lalamove.com';
  const key = process.env.LALAMOVE_API_KEY;
  const secret = process.env.LALAMOVE_API_SECRET;
  const market = process.env.LALAMOVE_MARKET || 'PH';
  if (!key || !secret) {
    throw new Error("Missing Lalamove API credentials. Set LALAMOVE_API_KEY and LALAMOVE_API_SECRET");
  }
  const { time, signature, payload } = buildSignature(method, path, body, secret);
  const token = `${key}:${time}:${signature}`;
  const headers = {
    'Authorization': `hmac ${token}`,
    'Market': market,
    'Request-ID': uuidv4(),
    'Content-Type': 'application/json'
  };
  const url = `${host}${path}`;
  const res = await axios({ method, url, headers, data: payload || undefined, timeout: 20000 });
  return res.data;
}

module.exports = { llmRequest };
