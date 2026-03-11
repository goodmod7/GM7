//! Experimental dialog for the in-progress advanced planning engine

import { useState, useCallback, useEffect } from 'react';
import { AgentProviderSelector } from './AgentProviderSelector.js';
import { AgentTaskMonitor } from './AgentTaskMonitor.js';
import type { ProviderType } from '../../lib/advancedAgent.js';
import {
  startAgentTask,
  getAgentTaskStatus,
  formatCost,
  estimateCost,
} from '../../lib/advancedAgent.js';

interface AgentTaskDialogProps {
  trigger?: React.ReactNode;
}

export function AgentTaskDialog({ trigger }: AgentTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderType | null>(null);
  const [starting, setStarting] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCostWarning, setShowCostWarning] = useState(false);

  // Check for active task on mount
  useEffect(() => {
    if (open) {
      void checkActiveTask();
    }
  }, [open]);

  const checkActiveTask = async () => {
    try {
      const status = await getAgentTaskStatus();
      if (status && status.status.type !== 'completed' && status.status.type !== 'failed') {
        setActiveTaskId(status.taskId);
      }
    } catch (err) {
      console.error('Failed to check active task:', err);
    }
  };

  const isPaidProvider = (p: ProviderType | null) => p === 'openai' || p === 'claude';

  const handleStart = async () => {
    if (!goal.trim()) return;

    // Show cost warning for paid providers
    if (isPaidProvider(selectedProvider) && !showCostWarning) {
      setShowCostWarning(true);
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const taskId = await startAgentTask(goal.trim(), selectedProvider ? { preferredProvider: selectedProvider } : undefined);
      setActiveTaskId(taskId);
      setGoal('');
      setShowCostWarning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start task');
    } finally {
      setStarting(false);
    }
  };

  const handleTaskComplete = useCallback(() => {
    setActiveTaskId(null);
    setOpen(false);
  }, []);

  const handleTaskCancel = useCallback(() => {
    setActiveTaskId(null);
  }, []);

  // Estimate cost for typical task
  const estimatedCost = estimateCost(selectedProvider, 4000, 1000);

  const styles: Record<string, React.CSSProperties> = {
    dialogOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: open ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    },
    dialog: {
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '24px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    },
    header: {
      marginBottom: '16px',
    },
    title: {
      fontSize: '1.25rem',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    description: {
      fontSize: '0.875rem',
      color: '#6b7280',
      marginTop: '4px',
    },
    section: {
      marginBottom: '24px',
    },
    label: {
      display: 'block',
      fontSize: '0.875rem',
      fontWeight: 500,
      marginBottom: '8px',
    },
    textarea: {
      width: '100%',
      padding: '12px',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      fontSize: '0.875rem',
      resize: 'none',
      minHeight: '100px',
    },
    labelRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px',
    },
    costBadge: {
      fontSize: '0.75rem',
      padding: '4px 8px',
      backgroundColor: '#f3f4f6',
      borderRadius: '9999px',
      color: '#374151',
    },
    helperText: {
      fontSize: '0.75rem',
      color: '#6b7280',
      marginTop: '8px',
    },
    error: {
      padding: '12px',
      backgroundColor: '#fef2f2',
      border: '1px solid #fecaca',
      borderRadius: '6px',
      color: '#991b1b',
      fontSize: '0.875rem',
      marginBottom: '16px',
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      marginTop: '24px',
    },
    button: {
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '0.875rem',
      fontWeight: 500,
      border: '1px solid #d1d5db',
      backgroundColor: 'white',
      cursor: 'pointer',
    },
    buttonPrimary: {
      backgroundColor: '#3b82f6',
      color: 'white',
      borderColor: '#3b82f6',
    },
    buttonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    warningBox: {
      padding: '16px',
      backgroundColor: '#fffbeb',
      border: '1px solid #fcd34d',
      borderRadius: '8px',
      marginBottom: '16px',
    },
    warningTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontWeight: 600,
      color: '#92400e',
      marginBottom: '8px',
    },
    warningText: {
      fontSize: '0.875rem',
      color: '#78350f',
    },
  };

  const content = () => {
    if (activeTaskId) {
      return (
        <AgentTaskMonitor
          taskId={activeTaskId}
          onComplete={handleTaskComplete}
          onCancel={handleTaskCancel}
        />
      );
    }

    if (showCostWarning) {
      return (
        <div>
          <div style={styles.warningBox}>
            <div style={styles.warningTitle}>
              <span>⚠️</span>
              Paid Provider Selected
            </div>
            <div style={styles.warningText}>
              <p><strong>Provider:</strong> {selectedProvider === 'openai' ? 'OpenAI GPT-4o' : 'Claude 3.5 Sonnet'}</p>
              <p><strong>Estimated cost:</strong> ~{formatCost(estimatedCost)} per task</p>
              <p style={{ marginTop: '8px', opacity: 0.8 }}>
                Consider using the free local Qwen model for privacy and cost savings.
              </p>
            </div>
          </div>
          <div style={styles.footer}>
            <button style={styles.button} onClick={() => setShowCostWarning(false)}>
              Go Back
            </button>
            <button style={{ ...styles.button, ...styles.buttonPrimary }} onClick={handleStart}>
              Continue with Paid Provider
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <span>✨</span>
            Experimental Advanced Engine
          </h2>
          <p style={styles.description}>
            Secondary debug surface for the in-progress advanced planning runtime. It is not the primary retail assistant yet.
          </p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.section}>
          <label style={styles.label}>What would you like me to do?</label>
          <textarea
            placeholder="Example: Open the browser, search for 'Rust programming language', and summarize the first 3 results..."
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            style={styles.textarea}
          />
        </div>

        <div style={styles.section}>
          <div style={styles.labelRow}>
            <label style={styles.label}>Provider</label>
            {selectedProvider && isPaidProvider(selectedProvider) && (
              <span style={styles.costBadge}>Est. {formatCost(estimatedCost)} / task</span>
            )}
          </div>
          <AgentProviderSelector
            value={selectedProvider}
            onChange={setSelectedProvider}
          />
          <p style={styles.helperText}>
            Select &quot;Local Qwen (Ollama)&quot; for free, private execution on your GPU.
          </p>
        </div>

        <div style={styles.footer}>
          <button style={styles.button} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            style={{
              ...styles.button,
              ...styles.buttonPrimary,
              ...(starting || !goal.trim() ? styles.buttonDisabled : {}),
            }}
            onClick={handleStart}
            disabled={!goal.trim() || starting}
          >
            {starting ? 'Starting...' : '▶ Start Experimental Task'}
          </button>
        </div>
      </>
    );
  };

  return (
    <>
      <div onClick={() => setOpen(true)} style={{ display: 'inline-block' }}>
        {trigger || (
          <button
            style={{
              padding: '0.5rem 1rem',
              background: '#f3e8ff',
              border: '1px solid #a855f7',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: '#6b21a8',
            }}
          >
            ✨ Experimental Advanced Engine
          </button>
        )}
      </div>

      <div style={styles.dialogOverlay} onClick={() => setOpen(false)}>
        <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
          {content()}
        </div>
      </div>
    </>
  );
}
