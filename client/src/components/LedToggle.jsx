import React, { useEffect, useState } from "react";
import { setLed, subscribeLed } from "../api.js";

export default function LedToggle({ current = 0 }) {
  const [on, setOn] = useState(Boolean(current));

  useEffect(() => {
    const off = subscribeLed((s) => {
      if (s && typeof s.value !== "undefined") setOn(Boolean(s.value));
    });
    return () => off();
  }, []);

  const toggleLed = () => {
    const newState = !on;
    setOn(newState);
    setLed(newState ? "ON" : "OFF");
  };

  return (
    <button onClick={toggleLed} className={on ? "active" : ""}>
      {on ? "LED: ON" : "LED: OFF"}
    </button>
  );
}
