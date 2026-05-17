import type { EngineResponseEvent } from "./LoomEngineTypes";

export function isJsonCompatibleEngineResponseEvent(event: EngineResponseEvent) {
  try {
    JSON.stringify(event);
    return true;
  } catch {
    return false;
  }
}
