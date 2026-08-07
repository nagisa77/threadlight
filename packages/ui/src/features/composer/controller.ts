import { useRef, useState } from "react";
import type {
  CapabilityDescriptor,
  ConnectorStatusData,
  TurnMode,
} from "@threadlight/protocol";

import type { CapabilityQuery } from "../../capabilities.js";

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
}

export type VoiceInputStatus =
  "idle" | "requesting" | "recording" | "transcribing";

export function shouldIgnoreComposerKey(
  composing: boolean,
  nativeEvent: Pick<globalThis.KeyboardEvent, "isComposing" | "keyCode">,
) {
  return composing || nativeEvent.isComposing || nativeEvent.keyCode === 229;
}

export function preserveComposerFocusOnPointerDown(event: {
  preventDefault(): void;
}) {
  event.preventDefault();
}

export function activateComposerMenuOnPointerDown(
  event: { preventDefault(): void },
  activate: () => void,
) {
  preserveComposerFocusOnPointerDown(event);
  activate();
}

/** Keeps one asynchronous Composer submission in flight at a time. */
export function createSubmissionGate() {
  let pending = false;
  return {
    get pending(): boolean {
      return pending;
    },
    tryStart(): boolean {
      if (pending) return false;
      pending = true;
      return true;
    },
    stop(): void {
      pending = false;
    },
  };
}

export function useComposerController() {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionGate = useRef(createSubmissionGate());
  const inputValueRef = useRef("");
  const [composerMode, setComposerMode] = useState<TurnMode>("default");
  const [capabilities, setCapabilities] = useState<
    readonly CapabilityDescriptor[]
  >([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    readonly CapabilityDescriptor[]
  >([]);
  const [capabilityQuery, setCapabilityQuery] = useState<CapabilityQuery>();
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [connectorSetup, setConnectorSetup] = useState<{
    capability: CapabilityDescriptor;
    selection: CapabilityDescriptor;
    status: ConnectorStatusData;
  }>();
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [connectorError, setConnectorError] = useState<string>();
  const [voiceStatus, setVoiceStatus] = useState<VoiceInputStatus>("idle");
  const [voiceError, setVoiceError] = useState<string>();
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const composerRoot = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaRecorder = useRef<MediaRecorder | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const recordedChunks = useRef<Blob[]>([]);
  const voiceOperation = useRef(0);
  const dragDepth = useRef(0);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  return {
    input,
    setInput,
    submitting,
    setSubmitting,
    submissionGate,
    inputValueRef,
    composerMode,
    setComposerMode,
    capabilities,
    setCapabilities,
    selectedCapabilities,
    setSelectedCapabilities,
    capabilityQuery,
    setCapabilityQuery,
    activeCapabilityIndex,
    setActiveCapabilityIndex,
    addMenuOpen,
    setAddMenuOpen,
    capabilitiesLoading,
    setCapabilitiesLoading,
    connectorSetup,
    setConnectorSetup,
    connectorBusy,
    setConnectorBusy,
    connectorError,
    setConnectorError,
    voiceStatus,
    setVoiceStatus,
    voiceError,
    setVoiceError,
    pendingAttachments,
    setPendingAttachments,
    preparingAttachments,
    setPreparingAttachments,
    attachmentError,
    setAttachmentError,
    isDraggingFiles,
    setIsDraggingFiles,
    composerRoot,
    textarea,
    composing,
    fileInput,
    mediaRecorder,
    mediaStream,
    recordedChunks,
    voiceOperation,
    dragDepth,
    pendingAttachmentsRef,
  };
}
