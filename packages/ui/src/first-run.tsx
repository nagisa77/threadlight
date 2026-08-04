import { useEffect, useState } from "react";
import type { ConversationAccessMode } from "@threadlight/protocol";
import {
  Check,
  CircleAlert,
  CircleCheck,
  FolderOpen,
  KeyRound,
  Link2,
  LoaderCircle,
  Play,
  ShieldCheck,
} from "lucide-react";

import { useI18n } from "./i18n.js";
import type { ProjectSummary } from "./projects.js";
import {
  PROVIDER_OPTIONS,
  SettingsSelectField,
  providerIsConfiguredFor,
  providerIsConfigured,
  type ModelProviderId,
  type ProviderDiagnostic,
  type SettingsAdapter,
  type SettingsSnapshot,
  type SettingsUpdate,
} from "./settings.js";

export type FirstRunStep =
  | "provider"
  | "test"
  | "project"
  | "permissions"
  | "demo";

const FIRST_RUN_STEPS: readonly FirstRunStep[] = [
  "provider",
  "test",
  "project",
  "permissions",
  "demo",
];

export function firstRunInitialStep(
  settings: SettingsSnapshot,
): FirstRunStep {
  return providerIsConfigured(settings) ? "test" : "provider";
}

export function firstRunSettingsUpdate(
  settings: SettingsSnapshot,
  provider: ModelProviderId,
  model: string,
  apiKey: string,
): SettingsUpdate {
  const key = apiKey.trim();
  return {
    language: settings.language,
    theme: settings.theme,
    preferredProjectOpener: settings.preferredProjectOpener,
    provider,
    qwenBaseUrl: settings.qwenBaseUrl,
    kimiBaseUrl: settings.kimiBaseUrl,
    doubaoBaseUrl: settings.doubaoBaseUrl,
    geminiBaseUrl: settings.geminiBaseUrl,
    grokBaseUrl: settings.grokBaseUrl,
    customBaseUrl: settings.customBaseUrl,
    model: model.trim(),
    ...(key ? providerSecretUpdate(provider, key) : {}),
  };
}

export function firstRunProviderBaseUrl(
  settings: SettingsSnapshot,
  provider: ModelProviderId,
): string | undefined {
  if (provider === "qwen") return settings.qwenBaseUrl;
  if (provider === "kimi") return settings.kimiBaseUrl;
  if (provider === "doubao") return settings.doubaoBaseUrl;
  if (provider === "gemini") return settings.geminiBaseUrl;
  if (provider === "grok") return settings.grokBaseUrl;
  if (provider === "custom") return settings.customBaseUrl;
  return undefined;
}

export function FirstRunGuide({
  adapter,
  settings,
  project,
  connectionReady,
  initialStep,
  onSettingsSaved,
  onRuntimeRestart,
  onOpenProject,
  onRunDemo,
}: {
  adapter: SettingsAdapter;
  settings: SettingsSnapshot;
  project?: ProjectSummary;
  connectionReady: boolean;
  initialStep?: FirstRunStep;
  onSettingsSaved(settings: SettingsSnapshot): void;
  onRuntimeRestart(): Promise<void>;
  onOpenProject(): Promise<void>;
  onRunDemo(accessMode: ConversationAccessMode): Promise<void>;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<FirstRunStep>(() =>
    initialStep ?? firstRunInitialStep(settings),
  );
  const [provider, setProvider] = useState(settings.provider);
  const initialProvider = providerOption(settings.provider);
  const [model, setModel] = useState(
    initialProvider.models.some(({ value }) => value === settings.model)
      ? settings.model
      : initialProvider.defaultModel,
  );
  const [apiKey, setApiKey] = useState("");
  const [accessMode, setAccessMode] =
    useState<ConversationAccessMode>("approval");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic>();
  const selectedProvider = providerOption(provider);
  const selectedProviderConfigured = providerIsConfiguredFor(
    settings,
    provider,
  );
  const currentIndex = FIRST_RUN_STEPS.indexOf(step);

  useEffect(() => {
    if (step === "project" && project) setStep("permissions");
  }, [project, step]);

  async function saveProvider() {
    if (working || (!apiKey.trim() && !selectedProviderConfigured)) return;
    setWorking(true);
    setError(undefined);
    try {
      const snapshot = await adapter.save(
        firstRunSettingsUpdate(settings, provider, model, apiKey),
      );
      setApiKey("");
      onSettingsSaved(snapshot);
      await onRuntimeRestart();
      setStep("test");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking(false);
    }
  }

  async function testConnection() {
    if (!adapter.testProvider || working) return;
    setWorking(true);
    setError(undefined);
    setDiagnostic(undefined);
    try {
      const result = await adapter.testProvider({
        provider: settings.provider,
        model: settings.model,
        ...(firstRunProviderBaseUrl(settings, settings.provider)
          ? {
              baseUrl: firstRunProviderBaseUrl(
                settings,
                settings.provider,
              ),
            }
          : {}),
      });
      setDiagnostic(result);
      if (result.status === "success" && result.code === "ok") {
        setStep(project ? "permissions" : "project");
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking(false);
    }
  }

  async function runDemo() {
    if (working || !connectionReady) return;
    setWorking(true);
    setError(undefined);
    try {
      await onRunDemo(accessMode);
    } catch (reason) {
      setError(errorMessage(reason));
      setWorking(false);
    }
  }

  return (
    <div className="first-run-page">
      <section className="first-run-card" aria-labelledby="first-run-title">
        <header className="first-run-header">
          <div>
            <span className="first-run-eyebrow">{t("firstRunEyebrow")}</span>
            <h1 id="first-run-title">{t("firstRunTitle")}</h1>
            <p>{t("firstRunDescription")}</p>
          </div>
          <span className="first-run-progress-count">
            {currentIndex + 1} / {FIRST_RUN_STEPS.length}
          </span>
        </header>

        <ol className="first-run-steps" aria-label={t("firstRunProgress")}>
          {FIRST_RUN_STEPS.map((candidate, index) => (
            <li
              key={candidate}
              className={`${index < currentIndex ? "complete" : ""} ${candidate === step ? "current" : ""}`}
              aria-current={candidate === step ? "step" : undefined}
            >
              <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
              <small>{t(firstRunStepKey(candidate))}</small>
            </li>
          ))}
        </ol>

        <div className="first-run-content">
          {step === "provider" && (
            <>
              <StepHeading
                icon={<KeyRound size={18} />}
                title={t("firstRunProviderTitle")}
                description={t("firstRunProviderDescription")}
              />
              <div className="first-run-fields">
                <SettingsSelectField
                  id="first-run-provider"
                  label={t("provider")}
                  description={t("firstRunProviderChoice")}
                  value={provider}
                  options={PROVIDER_OPTIONS.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                  onChange={(value) => {
                    const next = value as ModelProviderId;
                    const option = providerOption(next);
                    setProvider(next);
                    setModel(option.defaultModel);
                    setApiKey("");
                    setError(undefined);
                  }}
                />
                <SettingsSelectField
                  id="first-run-model"
                  label={t("defaultModel")}
                  description={t("firstRunModelChoice")}
                  value={model}
                  options={selectedProvider.models.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                  onChange={setModel}
                />
                <label className="first-run-secret" htmlFor="first-run-key">
                  <span>{selectedProvider.keyLabel}</span>
                  <small>{selectedProvider.keyDescription}</small>
                  <input
                    id="first-run-key"
                    type="password"
                    value={apiKey}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={
                      selectedProviderConfigured
                        ? t("configuredKeyKept")
                        : provider === "custom"
                          ? t("optional")
                          : "sk-…"
                    }
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setError(undefined);
                    }}
                  />
                </label>
              </div>
              <StepActions
                error={error}
                primary={t("saveAndContinue")}
                disabled={
                  working || (!apiKey.trim() && !selectedProviderConfigured)
                }
                working={working}
                onPrimary={() => void saveProvider()}
              />
            </>
          )}

          {step === "test" && (
            <>
              <StepHeading
                icon={<Link2 size={18} />}
                title={t("firstRunTestTitle")}
                description={t("firstRunTestDescription", {
                  provider: providerOption(settings.provider).label,
                })}
              />
              {diagnostic && (
                <div
                  className={`first-run-diagnostic ${diagnostic.status}`}
                  role="status"
                >
                  {diagnostic.status === "success" ? (
                    <CircleCheck size={17} />
                  ) : (
                    <CircleAlert size={17} />
                  )}
                  <span>
                    <strong>
                      {diagnostic.status === "success"
                        ? t("connectionSuccessful")
                        : t("connectionFailed")}
                    </strong>
                    <small>
                      {diagnostic.endpoint} · {diagnostic.latencyMs} ms
                    </small>
                  </span>
                </div>
              )}
              <StepActions
                error={error ?? diagnostic?.detail}
                primary={working ? t("testingConnection") : t("testConnection")}
                secondary={t("editProvider")}
                disabled={working || !adapter.testProvider}
                working={working}
                onSecondary={() => {
                  setDiagnostic(undefined);
                  setError(undefined);
                  setStep("provider");
                }}
                onPrimary={() => void testConnection()}
              />
            </>
          )}

          {step === "project" && (
            <>
              <StepHeading
                icon={<FolderOpen size={18} />}
                title={t("firstRunProjectTitle")}
                description={t("firstRunProjectDescription")}
              />
              <StepActions
                error={error}
                primary={working ? t("openingProject") : t("openProject")}
                disabled={working}
                working={working}
                onPrimary={() => {
                  setWorking(true);
                  setError(undefined);
                  void onOpenProject()
                    .catch((reason) => setError(errorMessage(reason)))
                    .finally(() => setWorking(false));
                }}
              />
            </>
          )}

          {step === "permissions" && (
            <>
              <StepHeading
                icon={<ShieldCheck size={18} />}
                title={t("firstRunPermissionsTitle")}
                description={t("firstRunPermissionsDescription")}
              />
              <div className="first-run-permission-options">
                {(["approval", "full"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={accessMode === mode ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="first-run-access"
                      value={mode}
                      checked={accessMode === mode}
                      onChange={() => setAccessMode(mode)}
                    />
                    <span>
                      <strong>
                        {mode === "approval"
                          ? t("approvalMode")
                          : t("fullAccessMode")}
                      </strong>
                      <small>
                        {mode === "approval"
                          ? t("firstRunApprovalDescription")
                          : t("firstRunFullAccessDescription")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <StepActions
                error={error}
                primary={t("continue")}
                disabled={false}
                working={false}
                onPrimary={() => setStep("demo")}
              />
            </>
          )}

          {step === "demo" && (
            <>
              <StepHeading
                icon={<Play size={18} />}
                title={t("firstRunDemoTitle")}
                description={t("firstRunDemoDescription")}
              />
              <div className="first-run-demo-prompt">
                <span>{t("demoTask")}</span>
                <p>{t("firstRunDemoPrompt")}</p>
              </div>
              <StepActions
                error={error}
                primary={
                  working
                    ? t("startingDemoTask")
                    : connectionReady
                      ? t("runDemoTask")
                      : t("waitingForRuntime")
                }
                disabled={working || !connectionReady}
                working={working}
                secondary={t("checkConnectionSettings")}
                onSecondary={() => {
                  setError(undefined);
                  setStep("test");
                }}
                onPrimary={() => void runDemo()}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StepHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="first-run-step-heading">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function StepActions({
  error,
  primary,
  secondary,
  disabled,
  working,
  onSecondary,
  onPrimary,
}: {
  error?: string;
  primary: string;
  secondary?: string;
  disabled: boolean;
  working: boolean;
  onSecondary?(): void;
  onPrimary(): void;
}) {
  return (
    <div className="first-run-actions">
      <p role="status">{error}</p>
      <div>
        {secondary && onSecondary && (
          <button
            type="button"
            className="first-run-secondary pressable"
            disabled={working}
            onClick={onSecondary}
          >
            {secondary}
          </button>
        )}
        <button
          type="button"
          className="first-run-primary pressable"
          disabled={disabled}
          onClick={onPrimary}
        >
          {working && <LoaderCircle className="spin" size={14} />}
          {primary}
        </button>
      </div>
    </div>
  );
}

function firstRunStepKey(step: FirstRunStep) {
  if (step === "provider") return "firstRunStepProvider" as const;
  if (step === "test") return "firstRunStepTest" as const;
  if (step === "project") return "firstRunStepProject" as const;
  if (step === "permissions") return "firstRunStepPermissions" as const;
  return "firstRunStepDemo" as const;
}

function providerOption(provider: ModelProviderId) {
  return (
    PROVIDER_OPTIONS.find(({ value }) => value === provider) ??
    PROVIDER_OPTIONS[0]
  );
}

function providerSecretUpdate(
  provider: ModelProviderId,
  value: string,
): Partial<SettingsUpdate> {
  if (provider === "deepseek") return { deepSeekApiKey: value };
  if (provider === "qwen") return { qwenApiKey: value };
  if (provider === "kimi") return { kimiApiKey: value };
  if (provider === "doubao") return { doubaoApiKey: value };
  if (provider === "gemini") return { geminiApiKey: value };
  if (provider === "grok") return { grokApiKey: value };
  if (provider === "custom") return { customApiKey: value };
  return { openAIApiKey: value };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
