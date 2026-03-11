import { useEffect, useState } from 'react';
import {
  getLocalAiInstallStageLabel,
  getLocalAiTierDetails,
  getLocalAiTierRuntimePlan,
  type LocalAiHardwareProfile,
  type LocalAiInstallProgress,
  type LocalAiInstallStage,
  type LocalAiRuntimeStatus,
  type LocalAiTier,
  type LocalAiTierRecommendation,
} from '../lib/localAi.js';

interface FreeAiSetupCardProps {
  status: LocalAiRuntimeStatus | null;
  installProgress: LocalAiInstallProgress | null;
  recommendation: LocalAiTierRecommendation | null;
  hardwareProfile: LocalAiHardwareProfile | null;
  busy?: boolean;
  actionBusy?: boolean;
  error?: string | null;
  showVisionBoost?: boolean;
  onStart: (tier: LocalAiTier) => void;
  onEnableVisionBoost: () => void;
  onRefresh: () => void;
}

const STAGE_ORDER: Array<{ key: LocalAiInstallStage; label: string }> = [
  { key: 'not_started', label: 'Not installed' },
  { key: 'installing', label: 'Downloading' },
  { key: 'installed', label: 'Installed' },
  { key: 'starting', label: 'Starting' },
  { key: 'ready', label: 'Ready' },
  { key: 'error', label: 'Error' },
];
const TIER_RECOMMENDATION_LABELS: Record<LocalAiTier, string> = {
  light: 'Light recommended',
  standard: 'Standard recommended',
  vision: 'Vision Boost optional',
};

function summarizeHardware(profile: LocalAiHardwareProfile | null): string | null {
  if (!profile) {
    return null;
  }

  const parts = [`${profile.logicalCpuCores} CPU cores`];
  if (profile.ramBytes) {
    parts.push(`${Math.max(1, Math.round(profile.ramBytes / (1024 * 1024 * 1024)))} GB RAM`);
  }
  if (profile.gpuSummary) {
    parts.push(profile.gpuSummary);
  } else {
    parts.push('GPU unknown');
  }
  return parts.join(' • ');
}

export function FreeAiSetupCard({
  status,
  installProgress,
  recommendation,
  hardwareProfile,
  busy = false,
  actionBusy = false,
  error = null,
  showVisionBoost = false,
  onStart,
  onEnableVisionBoost,
  onRefresh,
}: FreeAiSetupCardProps) {
  const recommendedTier = recommendation?.tier ?? 'light';
  const [selectedTier, setSelectedTier] = useState<LocalAiTier>(recommendedTier);

  useEffect(() => {
    setSelectedTier(recommendedTier);
  }, [recommendedTier]);

  const activeStage = installProgress?.stage ?? status?.installStage ?? 'not_started';
  const stageLabel = getLocalAiInstallStageLabel(activeStage);
  const hardwareSummary = summarizeHardware(hardwareProfile);
  const selectedDetails = getLocalAiTierDetails(selectedTier);
  const visionPlan = getLocalAiTierRuntimePlan(status?.selectedTier ?? recommendation?.tier ?? 'standard');
  const visionModel = visionPlan.optionalVisionModel;
  const visionBoostInstalled = Boolean(
    status?.selectedModel === visionModel || status?.installedModels.includes(visionModel)
  );
  const visionBoostAvailable = showVisionBoost
    || Boolean(recommendation?.visionAvailable || visionBoostInstalled || status?.selectedTier === 'vision');

  return (
    <section
      style={{
        marginTop: '1rem',
        padding: '1rem',
        background: '#f8fafc',
        border: '1px solid #dbe4f0',
        borderRadius: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', color: '#0f172a' }}>Start Free AI</h3>
          <p style={{ margin: '0.35rem 0 0', color: '#475569', fontSize: '0.875rem', maxWidth: '64ch', lineHeight: 1.5 }}>
            The desktop can prepare a free local assistant for this machine. It starts with a lighter local mode by default and keeps Vision Boost optional.
          </p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.45rem 0.8rem',
            borderRadius: '9999px',
            background: activeStage === 'ready' ? '#dcfce7' : '#eff6ff',
            color: activeStage === 'ready' ? '#166534' : '#1d4ed8',
            fontWeight: 600,
            fontSize: '0.75rem',
          }}
        >
          {stageLabel}
        </div>
      </div>

      {hardwareSummary && (
        <div
          style={{
            marginTop: '0.85rem',
            padding: '0.75rem',
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            fontSize: '0.8125rem',
            color: '#475569',
          }}
        >
          Best guess for this machine: {hardwareSummary}
        </div>
      )}

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.65rem' }}>
        {STAGE_ORDER.map((stage) => {
          const active = activeStage === stage.key || (activeStage === 'planned' && stage.key === 'installing');
          return (
            <div
              key={stage.key}
              style={{
                padding: '0.65rem 0.8rem',
                borderRadius: '8px',
                border: `1px solid ${active ? '#93c5fd' : '#e5e7eb'}`,
                background: active ? '#eff6ff' : 'white',
                fontSize: '0.8125rem',
                color: active ? '#1d4ed8' : '#475569',
                fontWeight: active ? 600 : 500,
              }}
            >
              {stage.label}
            </div>
          );
        })}
      </div>

      {installProgress?.message && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: '#fff7ed',
            border: '1px solid #fdba74',
            borderRadius: '8px',
            color: '#9a3412',
            fontSize: '0.875rem',
          }}
        >
          {installProgress.message}
        </div>
      )}

      {status?.externalServiceDetected && activeStage !== 'ready' && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: '#ecfdf5',
            border: '1px solid #86efac',
            borderRadius: '8px',
            color: '#166534',
            fontSize: '0.875rem',
          }}
        >
          A local AI service is already running on this machine. You can refresh status or keep using the assistant while the managed setup path is added.
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginTop: '1rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {(['light', 'standard', 'vision'] as LocalAiTier[]).map((tier) => {
          const details = getLocalAiTierDetails(tier);
          const isSelected = selectedTier === tier;
          const isRecommended = recommendation?.tier === tier;
          const label =
            tier === 'vision'
              ? TIER_RECOMMENDATION_LABELS.vision
              : isRecommended
                ? TIER_RECOMMENDATION_LABELS[tier]
                : details.title;

          return (
            <button
              key={tier}
              type="button"
              onClick={() => setSelectedTier(tier)}
              style={{
                textAlign: 'left',
                padding: '0.9rem',
                borderRadius: '10px',
                border: `1px solid ${isSelected ? '#0f172a' : '#dbe4f0'}`,
                background: isSelected ? '#f8fafc' : 'white',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a' }}>{label}</div>
              <div style={{ marginTop: '0.35rem', fontSize: '0.8125rem', color: '#475569' }}>{details.bestFor}</div>
              <div style={{ marginTop: '0.55rem', fontSize: '0.75rem', color: '#64748b' }}>
                Download: {details.downloadSizeLabel}
              </div>
              <div style={{ marginTop: '0.2rem', fontSize: '0.75rem', color: '#64748b' }}>
                Disk: {details.diskRequirementLabel}
              </div>
              <div style={{ marginTop: '0.2rem', fontSize: '0.75rem', color: '#64748b' }}>
                {details.performanceExpectation}
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          marginTop: '1rem',
          padding: '0.85rem',
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          fontSize: '0.875rem',
          color: '#334155',
        }}
      >
        <strong>{selectedDetails.title}:</strong> {selectedDetails.bestFor} Estimated download {selectedDetails.downloadSizeLabel}. Keep roughly {selectedDetails.diskRequirementLabel} free.
      </div>

      {visionBoostAvailable && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.85rem',
            background: visionBoostInstalled ? '#ecfdf5' : '#eff6ff',
            border: `1px solid ${visionBoostInstalled ? '#86efac' : '#bfdbfe'}`,
            borderRadius: '8px',
            fontSize: '0.875rem',
            color: visionBoostInstalled ? '#166534' : '#1d4ed8',
          }}
        >
          <strong>Vision Boost</strong>
          <p style={{ margin: '0.45rem 0 0', lineHeight: 1.5 }}>
            {visionBoostInstalled
              ? `Ready with ${visionModel}. The assistant can stay lightweight for normal work and only use the heavier screenshot model when a task truly needs it.`
              : `Optional for screenshot-heavy work such as Photoshop, Blender, or UI automation. The default free model stays lighter until you enable ${visionModel}.`}
          </p>
          {!visionBoostInstalled && (
            <button
              onClick={onEnableVisionBoost}
              disabled={busy || actionBusy || activeStage === 'not_started'}
              style={{
                marginTop: '0.75rem',
                padding: '0.6rem 0.95rem',
                borderRadius: '8px',
                border: 'none',
                background: busy || actionBusy || activeStage === 'not_started' ? '#cbd5e1' : '#1d4ed8',
                color: 'white',
                cursor: busy || actionBusy || activeStage === 'not_started' ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Enable Vision Boost
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => onStart(selectedTier)}
          disabled={busy || actionBusy}
          style={{
            padding: '0.6rem 0.95rem',
            borderRadius: '8px',
            border: 'none',
            background: busy || actionBusy ? '#cbd5e1' : '#0f172a',
            color: 'white',
            cursor: busy || actionBusy ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {actionBusy ? 'Preparing Free AI...' : 'Start Free AI'}
        </button>
        <button
          onClick={onRefresh}
          disabled={busy}
          style={{
            padding: '0.6rem 0.95rem',
            borderRadius: '8px',
            border: '1px solid #d1d5db',
            background: 'white',
            color: '#111827',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          Refresh status
        </button>
      </div>
    </section>
  );
}
