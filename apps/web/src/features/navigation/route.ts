"use client";

import { useSyncExternalStore } from "react";

export function parseRoute(hash: string) {
  const route = hash.replace(/^#/, "") || "home";
  return /^(home|archive|projects|agents|library|settings(?:\/(machines|connections|skills|mcp|environment|appearance|keyboard))?|task\/[^/]+|project\/[^/]+(?:\/prs)?)$/.test(
    route,
  )
    ? route
    : "home";
}

function subscribe(notify: () => void) {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}
const snapshot = () => parseRoute(window.location.hash);
const serverSnapshot = () => "home";

export function useRoute() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function navigate(route: string) {
  window.location.hash = parseRoute(route);
}
