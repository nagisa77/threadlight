import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type { Translate } from "../../i18n.js";
import {
  MAX_VOICE_AUDIO_BYTES,
  appendVoiceTranscript,
  preferredRecordingMimeType,
  voiceInputErrorMessage,
  type VoiceInputAdapter,
} from "../../voice-input.js";
import type { VoiceInputStatus } from "./controller.js";

export function useVoiceInputController({
  adapter,
  setInput,
  textarea,
  t,
}: {
  adapter?: VoiceInputAdapter;
  setInput: Dispatch<SetStateAction<string>>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  t: Translate;
}) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string>();
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const operationRef = useRef(0);

  const release = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    recorderRef.current = undefined;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = undefined;
    chunksRef.current = [];
  }, []);

  const cancel = useCallback(() => {
    operationRef.current += 1;
    release();
    setStatus("idle");
    setError(undefined);
  }, [release]);

  const finish = useCallback(
    async (recorder: MediaRecorder, operation: number) => {
      if (
        !adapter ||
        operation !== operationRef.current ||
        recorder !== recorderRef.current
      ) {
        return;
      }
      setStatus("transcribing");
      const chunks = chunksRef.current;
      const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
      recorderRef.current = undefined;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = undefined;
      chunksRef.current = [];

      try {
        const recording = new Blob(chunks, { type: mimeType });
        if (recording.size === 0) throw new Error(t("emptyRecording"));
        if (recording.size > MAX_VOICE_AUDIO_BYTES) {
          throw new Error(t("recordingTooLarge"));
        }
        const transcript = await adapter.transcribe({
          audio: await recording.arrayBuffer(),
          mimeType,
        });
        if (operation !== operationRef.current) return;
        setInput((value) => appendVoiceTranscript(value, transcript));
        requestAnimationFrame(() => {
          const element = textarea.current;
          if (!element) return;
          element.style.height = "auto";
          element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
          element.focus();
        });
      } catch (cause) {
        if (operation === operationRef.current) {
          setError(voiceInputErrorMessage(cause, t));
        }
      } finally {
        if (operation === operationRef.current) setStatus("idle");
      }
    },
    [adapter, setInput, t, textarea],
  );

  const start = useCallback(async () => {
    if (!adapter || status !== "idle") return;
    const operation = ++operationRef.current;
    setError(undefined);
    setStatus("requesting");

    try {
      if (!window.isSecureContext) {
        throw new Error(t("microphoneSecureContextRequired"));
      }
      await adapter.prepare?.();
      if (operation !== operationRef.current) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(t("microphoneRecordingUnsupported"));
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error(t("voiceInputUnsupported"));
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (operation !== operationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const mimeType = preferredRecordingMimeType((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (operation !== operationRef.current) return;
        release();
        setStatus("idle");
        setError(t("recordingInterrupted"));
      };
      recorder.onstop = () => void finish(recorder, operation);
      recorder.start();
      setStatus("recording");
    } catch (cause) {
      if (operation !== operationRef.current) return;
      release();
      setStatus("idle");
      setError(voiceInputErrorMessage(cause, t));
    }
  }, [adapter, finish, release, status, t]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || status !== "recording") return;
    setStatus("transcribing");
    if (recorder.state === "inactive") {
      void finish(recorder, operationRef.current);
    } else {
      recorder.stop();
    }
  }, [finish, status]);

  useEffect(
    () => () => {
      operationRef.current += 1;
      release();
    },
    [release],
  );

  return { status, error, setError, start, stop, cancel };
}
