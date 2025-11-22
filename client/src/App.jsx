// client/src/App.jsx
import React, { useEffect, useState } from "react";
import LedToggle from "./components/LedToggle.jsx";
import RelayToggle from "./components/RelayToggle.jsx";
import Telemetry from "./components/Telemetry.jsx";
import { subscribeStatus, subscribeLed, subscribeRelay, subscribeTelemetry, getSocket } from "./api.js";

export default function App() {
  const [online, setOnline] = useState(false);
  const [ledState, setLedState] = useState(null);
  const [relay1State, setRelay1State] = useState(null);
  const [relay2State, setRelay2State] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    // optional: log all events for debugging once
    const sock = getSocket();
    sock.onAny((ev, payload) => {
      // console.debug("[SOCKET EVENT]", ev, payload);
    });

    const offStatus = subscribeStatus((s) => setOnline(Boolean(s?.online)));
    const offLed = subscribeLed((s) => setLedState(s));
    const offRelay1 = subscribeRelay(1, (s) => setRelay1State(s));
    const offRelay2 = subscribeRelay(2, (s) => setRelay2State(s));
    const offTelemetry = subscribeTelemetry((t) => {
      setTelemetry(t);
      setHistory((prev) => {
        const next = [...prev, t].slice(-50);
        return next;
      });
    });

    // cleanup
    return () => {
      offStatus();
      offLed();
      offRelay1();
      offRelay2();
      offTelemetry();
      // leave socket open across navigation; do not disconnect here
    };
  }, []);

  return (
    <div className="wrap">
      <header className="card header">
        <h1>ESP32 Dashboard</h1>
        <div className={`badge ${online ? "ok" : "bad"}`}>
          {online ? "ONLINE" : "OFFLINE"}
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h2>LED Control</h2>
          <p className="muted">PIN 2 (GPIO2)</p>
          <LedToggle current={ledState?.value ?? 0} />
          {ledState && (
            <p className="muted tiny">
              acknowledged at {new Date(ledState.ts).toLocaleTimeString()}
            </p>
          )}
        </section>

        <section className="card">
          <h2>Relay Control</h2>
          <p className="muted">Relay 1 (GPIO18)</p>
          <RelayToggle relay={1} current={relay1State?.value ?? 0} />
          {relay1State && (
            <p className="muted tiny">
              acknowledged at {new Date(relay1State.ts).toLocaleTimeString()}
            </p>
          )}

          <p className="muted">Relay 2 (GPIO5)</p>
          <RelayToggle relay={2} current={relay2State?.value ?? 0} />
          {relay2State && (
            <p className="muted tiny">
              acknowledged at {new Date(relay2State.ts).toLocaleTimeString()}
            </p>
          )}
        </section>

        <section className="card">
          <h2>Live Telemetry</h2>
          <Telemetry latest={telemetry} history={history} />
        </section>
      </div>

      <footer className="muted tiny">
        Topics: <code>esp32/telemetry</code> • <code>esp32/led</code> •{" "}
        <code>esp32/relay1</code> • <code>esp32/relay2</code>
      </footer>
    </div>
  );
}
