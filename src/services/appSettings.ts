import type { ReferenceDisplayMode } from "../types";
import { localStorageAdapter } from "./storage";

const APP_SETTINGS_KEY = "loom-ai-app-settings-v1";
export const DEFAULT_PROFILE_NAME = "Local user";
export const DEFAULT_WORKSPACE_NAME = "Personal Loom";
export const DEFAULT_AVATAR_INITIAL = "L";

export type WeftOpenBehavior = "adaptive" | "split-when-possible" | "always-full";
export type AppFontSize = "very-small" | "small" | "medium" | "large" | "very-large";
export type AppLanguage = "system" | "en" | "tr" | "el";
export type AppTheme = "dark" | "light" | "solarized-light" | "system";
export type ModelResponseMode = "auto" | "instant" | "thinking";

export interface NotificationSettings {
  responseComplete: boolean;
  longRunningTaskComplete: boolean;
  modelDownloadComplete: boolean;
  runtimeUnavailable: boolean;
}

export interface StartupSettings {
  launchAtLogin: boolean;
  reopenLastLooms: boolean;
  continueFromLastLoom: boolean;
  runtimeCheckOnLaunch: boolean;
  showNewLoomIfNoSession: boolean;
}

export interface AccessibilitySettings {
  reduceMotion: boolean;
  increaseContrast: boolean;
  largerClickTargets: boolean;
  alwaysShowIconLabels: boolean;
  keyboardNavigationHints: boolean;
}

export interface MemorySettings {
  enabled: boolean;
  referenceRecentLooms: boolean;
  referenceSavedMemories: boolean;
  nickname: string;
  occupation: string;
  stylePreferences: string;
  moreAboutYou: string;
}

export interface AppSettings {
  referenceDisplayMode: ReferenceDisplayMode;
  weftOpenBehavior: WeftOpenBehavior;
  modelResponseMode: ModelResponseMode;
  fontSize: AppFontSize;
  language: AppLanguage;
  theme: AppTheme;
  notifications: NotificationSettings;
  startup: StartupSettings;
  accessibility: AccessibilitySettings;
  memory: MemorySettings;
  showGenerationDebug: boolean;
  mockDataEnabled: boolean;
  hasSeenFirstBookmarkFeedback: boolean;
  growthEventCount: number;
  shownGrowthMilestones: number[];
}

export const defaultAppSettings: AppSettings = {
  referenceDisplayMode: "title",
  weftOpenBehavior: "adaptive",
  modelResponseMode: "auto",
  fontSize: "medium",
  language: "system",
  theme: "dark",
  notifications: {
    responseComplete: false,
    longRunningTaskComplete: false,
    modelDownloadComplete: false,
    runtimeUnavailable: false,
  },
  startup: {
    launchAtLogin: false,
    reopenLastLooms: false,
    continueFromLastLoom: false,
    runtimeCheckOnLaunch: true,
    showNewLoomIfNoSession: true,
  },
  accessibility: {
    reduceMotion: false,
    increaseContrast: false,
    largerClickTargets: false,
    alwaysShowIconLabels: false,
    keyboardNavigationHints: false,
  },
  memory: {
    enabled: true,
    referenceRecentLooms: true,
    referenceSavedMemories: false,
    nickname: "",
    occupation: "",
    stylePreferences: "",
    moreAboutYou: "",
  },
  showGenerationDebug: false,
  mockDataEnabled: false,
  hasSeenFirstBookmarkFeedback: false,
  growthEventCount: 0,
  shownGrowthMilestones: [],
};

function viteEnv() {
  return (import.meta as ImportMeta & {
    env?: {
      VITE_ENABLE_MOCK_DATA?: string;
    };
  }).env;
}

export function isMockDataForced() {
  return viteEnv()?.VITE_ENABLE_MOCK_DATA === "true";
}

export function isMockDataEnabled(settings: Pick<AppSettings, "mockDataEnabled">) {
  return isMockDataForced() || Boolean(settings.mockDataEnabled);
}

export function getDisplayProfileName(settings: Pick<AppSettings, "memory">) {
  const nickname = settings.memory.nickname.trim();
  return nickname.length > 0 ? nickname : DEFAULT_PROFILE_NAME;
}

export function getDisplayWorkspaceName(settings: Pick<AppSettings, "memory">) {
  const occupation = settings.memory.occupation.trim();
  return occupation.length > 0 ? occupation : DEFAULT_WORKSPACE_NAME;
}

export function getAvatarInitial(profileName: string) {
  const firstLetter = Array.from(profileName.trim()).find((character) =>
    /\p{L}|\p{N}/u.test(character)
  );
  return firstLetter ? firstLetter.toLocaleUpperCase() : DEFAULT_AVATAR_INITIAL;
}

function normalizeReferenceDisplayMode(value: unknown): ReferenceDisplayMode {
  return value === "code" ? "code" : "title";
}

function normalizeWeftOpenBehavior(value: unknown): WeftOpenBehavior {
  if (value === "split-when-possible" || value === "always-full") return value;
  return "adaptive";
}

function normalizeModelResponseMode(value: unknown): ModelResponseMode {
  if (value === "instant" || value === "thinking") return value;
  return "auto";
}

function normalizeFontSize(value: unknown): AppFontSize {
  if (
    value === "very-small" ||
    value === "small" ||
    value === "large" ||
    value === "very-large"
  ) {
    return value;
  }
  return "medium";
}

function normalizeLanguage(value: unknown): AppLanguage {
  if (value === "en" || value === "tr" || value === "el") return value;
  return "system";
}

function normalizeTheme(value: unknown): AppTheme {
  if (value === "light" || value === "solarized-light" || value === "system") return value;
  return "dark";
}

function normalizeNotificationSettings(value: unknown): NotificationSettings {
  const stored = typeof value === "object" && value ? value : {};
  const settings = stored as Partial<NotificationSettings>;
  return {
    responseComplete: Boolean(settings.responseComplete),
    longRunningTaskComplete: Boolean(settings.longRunningTaskComplete),
    modelDownloadComplete: Boolean(settings.modelDownloadComplete),
    runtimeUnavailable: Boolean(settings.runtimeUnavailable),
  };
}

function normalizeStartupSettings(value: unknown): StartupSettings {
  const stored = typeof value === "object" && value ? value : {};
  const settings = stored as Partial<StartupSettings>;
  return {
    launchAtLogin: Boolean(settings.launchAtLogin),
    continueFromLastLoom:
      typeof settings.continueFromLastLoom === "boolean"
        ? settings.continueFromLastLoom
        : defaultAppSettings.startup.continueFromLastLoom,
    reopenLastLooms:
      typeof settings.reopenLastLooms === "boolean"
        ? settings.reopenLastLooms
        : defaultAppSettings.startup.reopenLastLooms,
    runtimeCheckOnLaunch:
      typeof settings.runtimeCheckOnLaunch === "boolean"
        ? settings.runtimeCheckOnLaunch
        : defaultAppSettings.startup.runtimeCheckOnLaunch,
    showNewLoomIfNoSession:
      typeof settings.showNewLoomIfNoSession === "boolean"
        ? settings.showNewLoomIfNoSession
        : defaultAppSettings.startup.showNewLoomIfNoSession,
  };
}

function normalizeAccessibilitySettings(value: unknown): AccessibilitySettings {
  const stored = typeof value === "object" && value ? value : {};
  const settings = stored as Partial<AccessibilitySettings>;
  return {
    reduceMotion: Boolean(settings.reduceMotion),
    increaseContrast: Boolean(settings.increaseContrast),
    largerClickTargets: Boolean(settings.largerClickTargets),
    alwaysShowIconLabels: Boolean(settings.alwaysShowIconLabels),
    keyboardNavigationHints: Boolean(settings.keyboardNavigationHints),
  };
}

function normalizeMemoryText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLength);
}

function normalizeMemorySettings(value: unknown): MemorySettings {
  const stored = typeof value === "object" && value ? value : {};
  const settings = stored as Partial<MemorySettings>;
  return {
    enabled:
      typeof settings.enabled === "boolean"
        ? settings.enabled
        : defaultAppSettings.memory.enabled,
    referenceRecentLooms:
      typeof settings.referenceRecentLooms === "boolean"
        ? settings.referenceRecentLooms
        : defaultAppSettings.memory.referenceRecentLooms,
    referenceSavedMemories:
      typeof settings.referenceSavedMemories === "boolean"
        ? settings.referenceSavedMemories
        : defaultAppSettings.memory.referenceSavedMemories,
    nickname: normalizeMemoryText(settings.nickname, 120),
    occupation: normalizeMemoryText(settings.occupation, 160),
    stylePreferences: normalizeMemoryText(settings.stylePreferences, 800),
    moreAboutYou: normalizeMemoryText(settings.moreAboutYou, 1200),
  };
}

export function readAppSettings(): AppSettings {
  const stored = localStorageAdapter.get<Partial<AppSettings>>(
    APP_SETTINGS_KEY,
    defaultAppSettings
  );
  return {
    referenceDisplayMode: normalizeReferenceDisplayMode(stored.referenceDisplayMode),
    weftOpenBehavior: normalizeWeftOpenBehavior(stored.weftOpenBehavior),
    modelResponseMode: normalizeModelResponseMode(stored.modelResponseMode),
    fontSize: normalizeFontSize(stored.fontSize),
    language: normalizeLanguage(stored.language),
    theme: normalizeTheme(stored.theme),
    notifications: normalizeNotificationSettings(stored.notifications),
    startup: normalizeStartupSettings(stored.startup),
    accessibility: normalizeAccessibilitySettings(stored.accessibility),
    memory: normalizeMemorySettings(stored.memory),
    showGenerationDebug: false,
    mockDataEnabled:
      stored.mockDataEnabled === undefined
        ? defaultAppSettings.mockDataEnabled
        : Boolean(stored.mockDataEnabled),
    hasSeenFirstBookmarkFeedback: Boolean(stored.hasSeenFirstBookmarkFeedback),
    growthEventCount:
      typeof stored.growthEventCount === "number" && Number.isFinite(stored.growthEventCount)
        ? Math.max(0, Math.floor(stored.growthEventCount))
        : 0,
    shownGrowthMilestones: Array.isArray(stored.shownGrowthMilestones)
      ? stored.shownGrowthMilestones.filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value)
        )
      : [],
  };
}

export function writeAppSettings(settings: AppSettings) {
  localStorageAdapter.set(APP_SETTINGS_KEY, {
    referenceDisplayMode: normalizeReferenceDisplayMode(settings.referenceDisplayMode),
    weftOpenBehavior: normalizeWeftOpenBehavior(settings.weftOpenBehavior),
    modelResponseMode: normalizeModelResponseMode(settings.modelResponseMode),
    fontSize: normalizeFontSize(settings.fontSize),
    language: normalizeLanguage(settings.language),
    theme: normalizeTheme(settings.theme),
    notifications: normalizeNotificationSettings(settings.notifications),
    startup: normalizeStartupSettings(settings.startup),
    accessibility: normalizeAccessibilitySettings(settings.accessibility),
    memory: normalizeMemorySettings(settings.memory),
    showGenerationDebug: false,
    mockDataEnabled: Boolean(settings.mockDataEnabled),
    hasSeenFirstBookmarkFeedback: Boolean(settings.hasSeenFirstBookmarkFeedback),
    growthEventCount: Math.max(0, Math.floor(settings.growthEventCount)),
    shownGrowthMilestones: settings.shownGrowthMilestones.filter(
      (value) => Number.isFinite(value)
    ),
  });
}
