// client/src/api.js
import { io } from "socket.io-client";

const WS_URL = "http://localhost:4000"; // backend server
// single socket used by whole app
const socket = io(WS_URL, { transports: ["websocket"] });

// --- Generic publisher ---
export function publishMessage(topic, payload) {
  socket.emit("command", { topic, payload });
}

// --- Specific device actions ---
export function setLed(value) {
  publishMessage("esp32/led", value); // value = "ON" / "OFF"
}

export function setRelay(relay, value) {
  publishMessage(`esp32/relay${relay}`, value); // relay = 1 / 2
}

// --- Subscriptions (all pass objects) ---
export function subscribeTelemetry(cb) {
  socket.on("telemetry", cb);
  return () => socket.off("telemetry", cb);
}

export function subscribeLed(cb) {
  socket.on("led_state", cb);
  return () => socket.off("led_state", cb);
}

export function subscribeRelay(relay, cb) {
  const ev = `relay${relay}_state`;
  socket.on(ev, cb);
  return () => socket.off(ev, cb);
}

export function subscribeStatus(cb) {
  socket.on("device_status", cb);
  return () => socket.off("device_status", cb);
}

// expose socket for debugging if needed
export function getSocket() {
  return socket;
}
