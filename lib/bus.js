
const { EventEmitter } = require('events');
const channels = new Map(); // orderId -> EventEmitter
function channel(orderId) {
  if (!channels.has(orderId)) channels.set(orderId, new EventEmitter());
  return channels.get(orderId);
}
module.exports = { channel };
