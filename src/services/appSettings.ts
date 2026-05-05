import type { ReferenceDisplayMode } from "../types";
import { localStorageAdapter } from "./storage";

const APP_SETTINGS_KEY = "loom-ai-app-settings-v1";

export interface AppSettings {
  referenceDisplayMode: ReferenceDisplayMode;
}

export const defaultAppSettings: AppSettings = {
  referenceDisplayMode: "title",
};

function normalizeReferenceDisplayMode(value: unknown): ReferenceDisplayMode {
  return value === "code" ? "code" : "title";
}

export function readAppSettings(): AppSettings {
  const stored = localStorageAdapter.get<Partial<AppSettings>>(
    APP_SETTINGS_KEY,
    defaultAppSettings
  );
  return {
    referenceDisplayMode: normalizeReferenceDisplayMode(stored.referenceDisplayMode),
  };
}

export function writeAppSettings(settings: AppSettings) {
  localStorageAdapter.set(APP_SETTINGS_KEY, {
    referenceDisplayMode: normalizeReferenceDisplayMode(settings.referenceDisplayMode),
  });
}
