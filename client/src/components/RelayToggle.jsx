import React, { useEffect, useState } from "react";
import { setRelay, subscribeRelay } from "../api.js";

export default function RelayToggle({ relay, current = 0 }) {
  const [on, setOn] = useState(Boolean(current));

  useEffect(() => {
    const off = subscribeRelay(relay, (s) => {
      if (s && typeof s.value !== "undefined") setOn(Boolean(s.value));
    });
    return () => off();
  }, [relay]);

  const toggleRelay = () => {
    const newState = !on;
    setOn(newState);
    setRelay(relay, newState ? "ON" : "OFF");
  };

  return (
    <button onClick={toggleRelay} className={on ? "active" : ""}>
      {on ? `Relay ${relay}: ON` : `Relay ${relay}: OFF`}
    </button>
  );
}
