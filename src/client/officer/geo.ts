"use client";

export type GpsReading = { status: "ok" | "denied" | "unavailable" | "timeout"; lat?: number; lng?: number; accuracy?: number };

/** One location reading. Never blocks logging: a failed reading is saved as its reason. */
export function readLocation(timeoutMs = 8000): Promise<GpsReading> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve({ status: "unavailable" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: "ok", lat: round(p.coords.latitude), lng: round(p.coords.longitude), accuracy: Math.round(p.coords.accuracy) }),
      (err) => resolve({ status: err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
