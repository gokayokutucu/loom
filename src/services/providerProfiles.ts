import type {
  ProviderProfileRuntimeConfig,
  ProviderSecretStatus,
} from "../engine";

export type ProviderAccessKind = "local" | "remote";

export function isRemoteProviderProfile(profile: ProviderProfileRuntimeConfig): boolean {
  return (
    profile.providerKind !== "ollama" ||
    profile.transportKind !== "ollama" ||
    !profile.security.localOnlyRequired ||
    profile.security.allowRemoteEndpoint
  );
}

export function providerProfileAccessKind(
  profile: ProviderProfileRuntimeConfig
): ProviderAccessKind {
  return isRemoteProviderProfile(profile) ? "remote" : "local";
}

export function providerProfileAccessLabel(profile: ProviderProfileRuntimeConfig): string {
  return providerProfileAccessKind(profile) === "remote" ? "Remote" : "Local";
}

export function providerProfileBadges(profile: ProviderProfileRuntimeConfig): string[] {
  const badges = [providerProfileAccessLabel(profile)];
  if (profile.experimental || profile.transportKind === "rig_openai_compatible") {
    badges.push("Experimental");
  }
  if (profile.transportKind === "rig_openai_compatible") {
    badges.push("Rig");
  }
  return badges;
}

export function providerSecretStatusLabel(
  profile: ProviderProfileRuntimeConfig,
  status?: ProviderSecretStatus
): string {
  if (!profile.requiresSecret) return "Not required";
  if (!status) return "Unavailable";
  if (status.status === "saved" && status.present) return "Saved";
  if (status.status === "missing" || !status.present) return "Missing";
  if (status.status === "invalid") return "Invalid";
  return "Unavailable";
}

export function providerSecretIsPresent(status?: ProviderSecretStatus): boolean {
  return Boolean(status?.present && status.status === "saved");
}

export function canEnableProviderProfile(
  profile: ProviderProfileRuntimeConfig,
  status: ProviderSecretStatus | undefined,
  privacyAcknowledged: boolean
): { allowed: boolean; reason?: string } {
  if (!isRemoteProviderProfile(profile)) {
    return { allowed: true };
  }
  if (!privacyAcknowledged) {
    return {
      allowed: false,
      reason: "Acknowledge the remote provider privacy notice first.",
    };
  }
  if (profile.requiresSecret && !providerSecretIsPresent(status)) {
    return {
      allowed: false,
      reason: "Save an API key before enabling this provider.",
    };
  }
  return { allowed: true };
}
