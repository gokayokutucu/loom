import { describe, expect, it } from "vitest";
import type { ProviderProfileRuntimeConfig, ProviderSecretStatus } from "../engine";
import {
  canEnableProviderProfile,
  isRemoteProviderProfile,
  providerProfileBadges,
  providerSecretStatusLabel,
} from "./providerProfiles";

function profile(
  overrides: Partial<ProviderProfileRuntimeConfig> = {}
): ProviderProfileRuntimeConfig {
  return {
    id: "ollama-local",
    providerKind: "ollama",
    transportKind: "ollama",
    vendor: "ollama",
    displayName: "Ollama Local",
    enabled: true,
    experimental: false,
    baseUrl: "http://127.0.0.1:11434",
    defaultModel: "qwen",
    requiresSecret: false,
    secretRef: null,
    modelDiscovery: { enabled: true, endpointPath: "/api/tags", refreshIntervalSeconds: 300 },
    requestDefaults: { think: false, stream: true },
    security: {
      localOnlyRequired: true,
      allowRemoteEndpoint: false,
      allowInsecureHttpRemote: false,
      allowUnsafeModelManagement: false,
    },
    capabilities: {
      supportsStreaming: true,
      supportsCancellation: true,
      supportsModelListing: true,
      supportsThinking: true,
      supportsSystemPrompt: true,
      supportsJsonMode: false,
    },
    ...overrides,
  };
}

function secretStatus(overrides: Partial<ProviderSecretStatus> = {}): ProviderSecretStatus {
  return {
    providerProfileId: "nvidia",
    secretRef: "env:NVIDIA_API_KEY",
    present: false,
    status: "missing",
    ...overrides,
  };
}

describe("provider profile Settings helpers", () => {
  it("classifies local Ollama separately from remote profiles", () => {
    expect(isRemoteProviderProfile(profile())).toBe(false);
    expect(
      isRemoteProviderProfile(
        profile({
          id: "nvidia",
          providerKind: "openai_compatible",
          transportKind: "native_openai_compatible",
          vendor: "nvidia",
          security: {
            localOnlyRequired: false,
            allowRemoteEndpoint: true,
            allowInsecureHttpRemote: false,
            allowUnsafeModelManagement: false,
          },
        })
      )
    ).toBe(true);
  });

  it("shows missing key status for remote profiles that require secrets", () => {
    const nvidia = profile({ id: "nvidia", requiresSecret: true });

    expect(providerSecretStatusLabel(nvidia, secretStatus())).toBe("Missing");
    expect(
      providerSecretStatusLabel(
        nvidia,
        secretStatus({ present: true, status: "saved" })
      )
    ).toBe("Saved");
    expect(providerSecretStatusLabel(profile(), undefined)).toBe("Not required");
  });

  it("marks experimental Rig profiles with explicit badges", () => {
    expect(
      providerProfileBadges(
        profile({
          experimental: true,
          transportKind: "rig_openai_compatible",
        })
      )
    ).toEqual(["Remote", "Experimental", "Rig"]);
  });

  it("requires privacy acknowledgement before enabling remote profiles", () => {
    const remote = profile({
      id: "nvidia",
      providerKind: "openai_compatible",
      transportKind: "native_openai_compatible",
      requiresSecret: true,
      security: {
        localOnlyRequired: false,
        allowRemoteEndpoint: true,
        allowInsecureHttpRemote: false,
        allowUnsafeModelManagement: false,
      },
    });

    expect(
      canEnableProviderProfile(remote, secretStatus({ present: true, status: "saved" }), false)
    ).toMatchObject({ allowed: false });
    expect(canEnableProviderProfile(remote, secretStatus(), true)).toMatchObject({
      allowed: false,
    });
    expect(
      canEnableProviderProfile(remote, secretStatus({ present: true, status: "saved" }), true)
    ).toEqual({ allowed: true });
  });
});
