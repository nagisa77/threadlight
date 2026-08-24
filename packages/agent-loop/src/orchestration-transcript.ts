import type {
  AgentEvent,
  AgentTaskSnapshot,
  RunResult,
  TokenUsage,
} from "./types.js";

const MAX_TRANSCRIPT_FIELD = 20_000;

export function cloneSnapshot(snapshot: AgentTaskSnapshot): AgentTaskSnapshot {
  return {
    ...snapshot,
    ...(snapshot.usage ? { usage: { ...snapshot.usage } } : {}),
    activities: snapshot.activities.map((activity) => ({ ...activity })),
    ...(snapshot.messages
      ? { messages: snapshot.messages.map((message) => ({ ...message })) }
      : {}),
    transcript: snapshot.transcript.map((entry) => ({
      ...entry,
      ...(entry.kind === "model" && entry.usage
        ? { usage: { ...entry.usage } }
        : {}),
    })),
  };
}

export function normalizedTokenUsage(usage: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  };
}

export function modelTranscriptId(step: number): string {
  return `model:${step}`;
}

export function ensureModelTranscript(
  transcript: AgentTaskSnapshot["transcript"],
  step: number,
  startedAt: string,
): AgentTaskSnapshot["transcript"] {
  const id = modelTranscriptId(step);
  return transcript.some((entry) => entry.id === id)
    ? transcript
    : [
        ...transcript,
        {
          id,
          kind: "model",
          step,
          status: "running",
          text: "",
          startedAt,
        },
      ];
}

export function updateTranscript(
  transcript: AgentTaskSnapshot["transcript"],
  id: string,
  update: (
    entry: AgentTaskSnapshot["transcript"][number],
  ) => AgentTaskSnapshot["transcript"][number],
): AgentTaskSnapshot["transcript"] {
  return transcript.map((entry) => (entry.id === id ? update(entry) : entry));
}

function clearModelTranscriptText(
  transcript: AgentTaskSnapshot["transcript"],
  step: number,
): AgentTaskSnapshot["transcript"] {
  return updateTranscript(transcript, modelTranscriptId(step), (entry) =>
    entry.kind === "model" ? { ...entry, text: "" } : entry,
  );
}

export function modelRetryProgress(
  snapshot: AgentTaskSnapshot,
  event: Extract<AgentEvent, { type: "model.retrying" }>,
): Partial<AgentTaskSnapshot> {
  return {
    phase: "thinking",
    latestActivity: `Retrying model connection (${event.retryAttempt}/${event.maxRetries})`,
    transcript: event.discardPartialOutput
      ? clearModelTranscriptText(snapshot.transcript, event.step)
      : snapshot.transcript,
  };
}

export function serializeTranscriptValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

export function transcriptField(value: string): string {
  return truncate(value, MAX_TRANSCRIPT_FIELD);
}

export function summarize(output: string): string {
  return truncate(output.replace(/\s+/g, " ").trim(), 240);
}

export function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function addUsage(
  total: RunResult["usage"],
  next: RunResult["usage"] | undefined,
): RunResult["usage"] {
  return {
    inputTokens: total.inputTokens + (next?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (next?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (next?.totalTokens ?? 0),
  };
}
