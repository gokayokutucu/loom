export class TimeoutSignalError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutSignalError";
  }
}

export class ParentSignalAbortError extends Error {
  constructor() {
    super("Operation was aborted");
    this.name = "ParentSignalAbortError";
  }
}

export async function runWithTimeoutSignal<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let rejectFromTimeout: (() => void) | undefined;
  let rejectFromParent: (() => void) | undefined;
  const parentAbortListener = () => {
    controller.abort();
    rejectFromParent?.();
  };

  const parentAbortPromise = new Promise<never>((_, reject) => {
    rejectFromParent = () => reject(new ParentSignalAbortError());
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectFromTimeout = () => {
      controller.abort();
      reject(new TimeoutSignalError(timeoutMs));
    };
    timeoutHandle = setTimeout(() => rejectFromTimeout?.(), timeoutMs);
  });

  if (parentSignal?.aborted) {
    controller.abort();
    throw new ParentSignalAbortError();
  }
  parentSignal?.addEventListener("abort", parentAbortListener, { once: true });

  const taskPromise = run(controller.signal);
  taskPromise.catch(() => undefined);

  try {
    return await Promise.race([taskPromise, timeoutPromise, parentAbortPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    parentSignal?.removeEventListener("abort", parentAbortListener);
  }
}
