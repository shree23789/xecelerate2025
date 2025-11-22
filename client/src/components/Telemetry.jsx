import React, { useEffect, useState } from "react";
import { subscribeTelemetry } from "../api.js";

export default function Telemetry({ latest, history }) {
  const [data, setData] = useState({
    temperature: null,
    humidity: null,
    soil: null,
    ldrAnalog: null,
    ldrDigital: null,
  });

  useEffect(() => {
    if (latest && typeof latest === "object") {
      setData((prev) => ({ ...prev, ...latest }));
    }
  }, [latest]);

  useEffect(() => {
    const off = subscribeTelemetry((t) => {
      if (!t || typeof t !== "object") return;
      setData({
        temperature: t.temperature ?? null,
        humidity: t.humidity ?? null,
        soil: t.soil ?? null,
        ldrAnalog: t.ldrAnalog ?? null,
        ldrDigital: t.ldrDigital ?? null,
      });
    });
    return () => off();
  }, []);

  return (
    <div>
      <ul>
        <li>🌡 Temperature: {data.temperature ?? "--"} °C</li>
        <li>💧 Humidity: {data.humidity ?? "--"} %</li>
        <li>🌱 Soil Moisture (ADC): {data.soil ?? "--"}</li>
        <li>🔆 LDR (Analog): {data.ldrAnalog ?? "--"}</li>
        <li>
          🌗 LDR (Digital):{" "}
          {data.ldrDigital === undefined || data.ldrDigital === null
            ? "--"
            : data.ldrDigital === 1
            ? "Bright"
            : "Dark"}
        </li>
      </ul>
    </div>
  );
}
