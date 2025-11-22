import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mqtt from 'mqtt';

// ---------------------- ENV ----------------------
const {
  PORT = 4000,
  CLIENT_ORIGIN = 'http://localhost:5173',

  // >>> set these to your broker <<<
  MQTT_HOST = '10.1.1.113',
  MQTT_PORT = '1883',
  MQTT_USER = 'esp32com',
  MQTT_PASS = 'esp32aug',

  DEVICE_ID = 'esp32-01',
} = process.env;

// ---------------------- EXPRESS/WS ----------------------
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

// ---------------------- MQTT ----------------------
const mqttUrl = `mqtt://${MQTT_HOST}:${MQTT_PORT}`;
const mqttOpts = {
  username: MQTT_USER,
  password: MQTT_PASS,
  reconnectPeriod: 2000,
  connectTimeout: 10_000,
};

const mqttClient = mqtt.connect(mqttUrl, mqttOpts);

const topicTelemetry = 'esp32/telemetry';
const topicLed       = 'esp32/led';
const topicRelay1    = 'esp32/relay1';
const topicRelay2    = 'esp32/relay2';
const topicState     = `devices/${DEVICE_ID}/state`;   // optional legacy
const topicStatus    = `devices/${DEVICE_ID}/status`;  // optional legacy

let deviceOnline = false;
let lastTelemetry = null;
let lastLedState = null;

mqttClient.on('connect', () => {
  console.log('[MQTT] Connected', mqttUrl);
  // subscribe to telemetry and any optional topics you emit
  mqttClient.subscribe(
    [topicTelemetry, topicState, topicStatus],
    { qos: 0 },
    (err) => {
      if (err) console.error('[MQTT] subscribe error:', err.message);
      else console.log('[MQTT] Subscribed:', [topicTelemetry, topicState, topicStatus].join(', '));
    }
  );
});

mqttClient.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
mqttClient.on('error', (err) => console.error('[MQTT] Error:', err.message));

mqttClient.on('message', (topic, buf) => {
  let payload = null;
  const text = buf.toString();
  try { payload = JSON.parse(text); } catch { payload = text; }

  if (topic === topicTelemetry) {
    // Expecting JSON from ESP32
    if (payload && typeof payload === 'object') {
      lastTelemetry = payload;
      io.emit('telemetry', payload);
      deviceOnline = true;
      io.emit('device_status', { online: true });
      // optional: mirror LED state if present
      if (typeof payload.led !== 'undefined') {
        lastLedState = { value: Number(Boolean(payload.led)), ts: Date.now() };
        io.emit('led_state', lastLedState);
      }
    }
  } else if (topic === topicStatus || topic === topicState) {
    // If you use status pings, set online flag here
    deviceOnline = true;
    io.emit('device_status', { online: true });
  }

  // Debug log everything we receive
  console.log(`[MQTT] RX ${topic}:`, payload);
});

// ---------------------- SOCKET.IO ----------------------
io.on('connection', (socket) => {
  console.log('[WS] client connected:', socket.id);

  // seed UI
  socket.emit('device_status', { online: deviceOnline });
  if (lastTelemetry) socket.emit('telemetry', lastTelemetry);
  if (lastLedState) socket.emit('led_state', lastLedState);

  // Generic command -> publish to MQTT
  socket.on('command', ({ topic, payload }) => {
    if (!topic) return;
    const msg = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    console.log('[WS] command -> MQTT publish', { topic, payload: msg });
    mqttClient.publish(topic, msg, { qos: 0 }, (err) => {
      if (err) console.error('[MQTT] publish error:', err.message);
      else console.log('[MQTT] TX', topic, msg);
    });

    // Optimistic acks for UI (optional)
    if (topic === topicLed) {
      const v = (msg === 'ON' || msg === '1') ? 1 : 0;
      lastLedState = { value: v, ts: Date.now() };
      io.emit('led_state', lastLedState);
    }
    if (topic === topicRelay1) io.emit('relay1_state', { value: msg === 'ON' || msg === '1', ts: Date.now() });
    if (topic === topicRelay2) io.emit('relay2_state', { value: msg === 'ON' || msg === '1', ts: Date.now() });
  });

  socket.on('disconnect', () => {
    console.log('[WS] client disconnected:', socket.id);
  });
});

// ---------------------- HTTP ----------------------
app.get('/api/last', (req, res) => {
  res.json({
    online: deviceOnline,
    telemetry: lastTelemetry,
    led: lastLedState,
  });
});

httpServer.listen(Number(PORT), () => {
  console.log(`[HTTP] http://localhost:${PORT}`);
  console.log(`[CORS] client: ${CLIENT_ORIGIN}`);
  console.log(`[MQTT] broker: ${mqttUrl}  device: ${DEVICE_ID}`);
});
