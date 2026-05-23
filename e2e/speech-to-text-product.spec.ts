import { expect, test, type Page } from "@playwright/test";
import { createServiceTestHarness, type ServiceTestHarness } from "./helpers/serviceTestHarness";

type FakeAudioMode = "speech" | "silence" | "oversized";

interface FakeSpeechRecorderOptions {
  mode: FakeAudioMode;
}

const productTranscript = "Product microphone transcript";

async function configureDeterministicSpeech(scenario: ServiceTestHarness) {
  await scenario.fetchJson<unknown>("/config", {
    method: "PATCH",
    body: JSON.stringify({
      speech: {
        enabled: true,
        defaultProviderKind: "local_command",
        localCommandPath: "/bin/sh",
        localCommandArgs: [
          "-c",
          `printf '%s' '${productTranscript}' > "$1.txt"`,
          "loom-stt-product-e2e",
          "{output}",
        ],
        localCommandTimeoutMs: 10_000,
        localCommandOutputMode: "file",
        localCommandTranscriptFileExtension: "txt",
      },
    }),
  });
}

async function configureMissingSpeechProvider(scenario: ServiceTestHarness) {
  await scenario.fetchJson<unknown>("/config", {
    method: "PATCH",
    body: JSON.stringify({
      speech: {
        enabled: true,
        defaultProviderKind: "local_command",
        localCommandPath: null,
        localCommandArgs: ["-c", "printf '%s' 'unused' > \"$1.txt\"", "loom-stt-product-e2e", "{output}"],
        localCommandTimeoutMs: 10_000,
        localCommandOutputMode: "file",
        localCommandTranscriptFileExtension: "txt",
      },
    }),
  });
}

async function installFakeSpeechRecorder(page: Page, options: FakeSpeechRecorderOptions) {
  await page.addInitScript(({ mode }) => {
    const sampleRate = 16_000;
    const sampleCount =
      mode === "oversized"
        ? Math.ceil((10 * 1024 * 1024 - 44) / 2) + sampleRate
        : mode === "silence"
          ? sampleRate * 6
          : sampleRate * 2;

    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported(mimeType: string) {
        return mimeType === "audio/webm" || mimeType === "audio/wav";
      }

      readonly mimeType = "audio/webm";
      state: RecordingState = "inactive";

      start() {
        this.state = "recording";
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        window.setTimeout(() => {
          const dataEvent = new Event("dataavailable");
          Object.defineProperty(dataEvent, "data", {
            value: new Blob(["loom-product-stt-e2e"], { type: "audio/webm" }),
          });
          this.dispatchEvent(dataEvent);
          this.dispatchEvent(new Event("stop"));
        }, 0);
      }
    }

    class FakeAudioContext {
      readonly sampleRate = sampleRate;

      createAnalyser() {
        return {
          fftSize: 64,
          smoothingTimeConstant: 0.78,
          frequencyBinCount: 32,
          connect() {},
          disconnect() {},
          getByteFrequencyData(data: Uint8Array) {
            data.fill(mode === "silence" ? 0 : 96);
          },
        };
      }

      createMediaStreamSource() {
        return {
          connect() {},
          disconnect() {},
        };
      }

      async decodeAudioData() {
        return {
          sampleRate,
          numberOfChannels: 1,
          length: sampleCount,
          duration: sampleCount / sampleRate,
          getChannelData: () => {
            const samples = new Float32Array(sampleCount);
            if (mode !== "silence") {
              for (let index = 0; index < samples.length; index += 1) {
                samples[index] = Math.sin(index / 5) * 0.18;
              }
            }
            return samples;
          },
        };
      }

      async close() {}
    }

    const fakeStream = {
      getTracks: () => [{ stop() {} }],
    };

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream,
      },
    });
  }, options);
}

async function openProductApp(page: Page, scenario: ServiceTestHarness) {
  if (!scenario.appUrl) throw new Error("Product app URL was not started.");
  await page.goto(scenario.appUrl);
  await expect(page.getByTestId("prompt-composer")).toBeVisible();
}

async function recordFromComposer(page: Page) {
  await page.getByRole("textbox", { name: "Prompt" }).first().click();
  await page.getByRole("button", { name: "Voice input" }).click();
  await expect(page.getByRole("status", { name: /Listening/i })).toBeVisible();
  await page.getByRole("button", { name: "Stop and transcribe voice input" }).click();
}

test.describe("[product-service-backed] speech-to-text composer flow", () => {
  let scenario: ServiceTestHarness | undefined;

  test.afterEach(async () => {
    if (scenario) {
      await scenario.cleanup();
      scenario = undefined;
    }
  });

  test("inserts microphone transcript into the composer without auto-sending or persisting it", async ({
    page,
  }) => {
    scenario = await createServiceTestHarness({ startApp: true });
    await configureDeterministicSpeech(scenario);
    await installFakeSpeechRecorder(page, { mode: "speech" });
    await openProductApp(page, scenario);

    await recordFromComposer(page);

    const editor = page.getByRole("textbox", { name: "Prompt" }).first();
    await expect(editor).toHaveText(productTranscript);
    await editor.pressSequentially(" edited");
    await expect(editor).toHaveText(`${productTranscript} edited`);
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByText(productTranscript, { exact: true })).toHaveCount(0);

    const history = await scenario.fetchJson<unknown>("/history");
    expect(JSON.stringify(history)).not.toContain(productTranscript);
  });

  test("shows no_speech_detected friendly copy for silent composer recordings", async ({ page }) => {
    scenario = await createServiceTestHarness({ startApp: true });
    await configureDeterministicSpeech(scenario);
    await installFakeSpeechRecorder(page, { mode: "silence" });
    await openProductApp(page, scenario);

    await recordFromComposer(page);

    await expect(
      page.getByRole("status", {
        name: "No speech was detected. Try speaking a little louder or longer.",
      })
    ).toBeVisible();
    await expect(page.getByText("loom-service request failed for /speech/transcribe")).toHaveCount(0);
  });

  test("shows payload_too_large friendly copy before uploading oversized composer audio", async ({
    page,
  }) => {
    scenario = await createServiceTestHarness({ startApp: true });
    await configureDeterministicSpeech(scenario);
    await installFakeSpeechRecorder(page, { mode: "oversized" });
    await openProductApp(page, scenario);

    await recordFromComposer(page);

    await expect(
      page.getByRole("status", { name: "Recording is too long. Try a shorter recording." })
    ).toBeVisible();
    await expect(page.getByText("loom-service request failed for /speech/transcribe")).toHaveCount(0);
  });

  test("shows setup guidance when the local speech provider is unavailable", async ({ page }) => {
    scenario = await createServiceTestHarness({ startApp: true });
    await configureMissingSpeechProvider(scenario);
    await installFakeSpeechRecorder(page, { mode: "speech" });
    await openProductApp(page, scenario);

    await recordFromComposer(page);

    await expect(
      page.getByRole("status", { name: /Speech-to-Text|Local speech engine|local command/i })
    ).toBeVisible();
    await expect(page.getByText("loom-service request failed for /speech/transcribe")).toHaveCount(0);
  });

  test("shows service guidance when loom-service is unavailable during transcription", async ({
    page,
  }) => {
    scenario = await createServiceTestHarness({ startApp: true });
    await configureDeterministicSpeech(scenario);
    await installFakeSpeechRecorder(page, { mode: "speech" });
    await page.route("**/speech/transcribe", (route) => route.abort("connectionrefused"));
    await openProductApp(page, scenario);

    await recordFromComposer(page);

    await expect(
      page.getByRole("status", {
        name: "Loom service is not reachable. Restart the app or check service status.",
      })
    ).toBeVisible();
    await expect(page.getByText("loom-service request failed for /speech/transcribe")).toHaveCount(0);
  });
});
