/**
 * Experimental AI Engineering Workflow UI
 * Secondary debug surface for the 5-phase spec-driven development workflow
 */

import { useState, useCallback } from 'react';
import {
  WorkflowPhase,
  WorkflowPhaseOrder,
  type WorkflowState,
  type AgentRole,
  type RalphConfig,
  AGENTS,
  AgentGroups,
  createWorkflowState,
  advancePhase,
  executePhase,
  runCompleteWorkflow,
} from '@ai-operator/shared';

interface AgentWorkflowProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

interface PhaseStatus {
  phase: WorkflowPhase;
  label: string;
  icon: string;
  description: string;
}

const PHASES: PhaseStatus[] = [
  { phase: WorkflowPhase.RESEARCH, label: 'Research', icon: '🔍', description: 'Analyze codebase and requirements' },
  { phase: WorkflowPhase.SPECIFY, label: 'Specify', icon: '📋', description: 'Create feature specification' },
  { phase: WorkflowPhase.PLAN, label: 'Plan', icon: '📐', description: 'Design implementation plan' },
  { phase: WorkflowPhase.WORK, label: 'Work', icon: '⚒️', description: 'Execute implementation' },
  { phase: WorkflowPhase.REVIEW, label: 'Review', icon: '✓', description: 'Multi-agent code review' },
];

export function AgentWorkflow({ isOpen, onClose, workspaceName }: AgentWorkflowProps) {
  const [workflowState, setWorkflowState] = useState<WorkflowState>(() => createWorkflowState(false));
  const [isRunning, setIsRunning] = useState(false);
  const [currentOutput, setCurrentOutput] = useState('');
  const [featureDescription, setFeatureDescription] = useState('');
  const [ralphMode, setRalphMode] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<AgentRole[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const runPhase = async (phase: WorkflowPhase) => {
    setIsRunning(true);
    addLog(`Starting ${phase} phase...`);

    try {
      const context = {
        workspacePath: `/home/user/${workspaceName}`,
        additionalContext: {
          description: featureDescription,
          selectedAgents,
        },
      };

      const previousPhase = WorkflowPhaseOrder[WorkflowPhaseOrder.indexOf(phase) - 1];
      const previousOutput = previousPhase 
        ? workflowState.phaseData[previousPhase].output as string 
        : undefined;

      const ralphConfig: RalphConfig | undefined = ralphMode ? {
        enabled: true,
        maxIterations: 5,
        qualityGate: '\\[NEEDS IMPROVEMENT\\]',
        failOnMaxIterations: false,
      } : undefined;

      const result = await executePhase(phase, context, previousOutput, ralphConfig);

      if (result.success) {
        setCurrentOutput(result.output);
        setWorkflowState(prev => advancePhase(prev, result.output));
        addLog(`✓ ${phase} phase completed`);
        
        if (result.artifacts.length > 0) {
          addLog(`  Created: ${result.artifacts.join(', ')}`);
        }
      } else {
        addLog(`✗ ${phase} phase failed: ${result.error}`);
      }
    } catch (error) {
      addLog(`✗ Error in ${phase}: ${error}`);
    } finally {
      setIsRunning(false);
    }
  };

  const runFullWorkflow = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog('Starting full workflow...');

    try {
      const context = {
        workspacePath: `/home/user/${workspaceName}`,
        additionalContext: {
          description: featureDescription,
          selectedAgents,
        },
      };

      const result = await runCompleteWorkflow(context, ralphMode);

      if (result.success) {
        setCurrentOutput(result.finalOutput);
        setWorkflowState(result.state);
        addLog('✓ Workflow completed successfully');
      } else {
        addLog('✗ Workflow failed');
      }
    } catch (error) {
      addLog(`✗ Workflow error: ${error}`);
    } finally {
      setIsRunning(false);
    }
  };

  const resetWorkflow = () => {
    setWorkflowState(createWorkflowState(ralphMode));
    setCurrentOutput('');
    setLogs([]);
  };

  const toggleAgent = (agent: AgentRole) => {
    setSelectedAgents(prev => 
      prev.includes(agent) 
        ? prev.filter(a => a !== agent)
        : [...prev, agent]
    );
  };

  const selectAgentGroup = (group: keyof typeof AgentGroups) => {
    const groupAgents = [...AgentGroups[group]] as AgentRole[];
    const allSelected = groupAgents.every((a: AgentRole) => selectedAgents.includes(a));
    
    if (allSelected) {
      setSelectedAgents(prev => prev.filter(a => !groupAgents.includes(a as AgentRole)));
    } else {
      setSelectedAgents(prev => [...new Set([...prev, ...groupAgents])]);
    }
  };

  if (!isOpen) return null;

  const currentPhaseIndex = WorkflowPhaseOrder.indexOf(workflowState.currentPhase);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '900px',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          padding: '1.5rem', 
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>🚀 Experimental AI Engineering Workflow</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.875rem' }}>
              Secondary debug workflow. The retail desktop assistant does not depend on this surface.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: '#666',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Sidebar - Phase Navigation */}
          <div style={{ 
            width: '240px', 
            borderRight: '1px solid #e5e7eb',
            background: '#f9fafb',
            padding: '1rem',
            overflowY: 'auto',
          }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={ralphMode}
                  onChange={(e) => setRalphMode(e.target.checked)}
                  disabled={isRunning}
                />
                <span>🔄 Ralph Wiggum Mode</span>
              </label>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                Persistent iteration until quality gates met
              </p>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                Workflow Phases
              </h4>
              {PHASES.map((phase, index) => {
                const isActive = workflowState.currentPhase === phase.phase;
                const isCompleted = workflowState.completedPhases.includes(phase.phase);
                const isPending = index > currentPhaseIndex;

                return (
                  <div
                    key={phase.phase}
                    style={{
                      padding: '0.75rem',
                      marginBottom: '0.5rem',
                      borderRadius: '6px',
                      background: isActive ? '#dbeafe' : isCompleted ? '#d1fae5' : 'white',
                      border: `1px solid ${isActive ? '#3b82f6' : isCompleted ? '#10b981' : '#e5e7eb'}`,
                      opacity: isPending ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{isCompleted ? '✓' : phase.icon}</span>
                      <span style={{ 
                        fontWeight: isActive ? 600 : 400,
                        fontSize: '0.875rem',
                      }}>
                        {index + 1}. {phase.label}
                      </span>
                    </div>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                      {phase.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Agent Selection */}
            <div>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                Select Agents ({selectedAgents.length})
              </h4>
              
              {Object.entries(AgentGroups).map(([group, agents]) => (
                <div key={group} style={{ marginBottom: '0.75rem' }}>
                  <button
                    onClick={() => selectAgentGroup(group as keyof typeof AgentGroups)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.5rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      background: '#f3f4f6',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {group.replace('_', ' ')}
                  </button>
                  {agents.map(agentId => {
                    const agent = AGENTS[agentId];
                    if (!agent) return null;
                    
                    return (
                      <label
                        key={agentId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAgents.includes(agentId)}
                          onChange={() => toggleAgent(agentId)}
                          disabled={isRunning}
                        />
                        <span title={agent.description}>{agent.name}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Main Content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Feature Input */}
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                Feature Description
              </label>
              <textarea
                value={featureDescription}
                onChange={(e) => setFeatureDescription(e.target.value)}
                placeholder="Describe what you want to build... (e.g., 'Add user authentication with JWT tokens')"
                disabled={isRunning}
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '0.875rem',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Action Buttons */}
            <div style={{ 
              padding: '1rem 1.5rem', 
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              gap: '0.75rem',
            }}>
              <button
                onClick={runFullWorkflow}
                disabled={isRunning || !featureDescription.trim()}
                style={{
                  padding: '0.625rem 1.25rem',
                  backgroundColor: isRunning || !featureDescription.trim() ? '#d1d5db' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: isRunning || !featureDescription.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isRunning ? 'Running...' : ralphMode ? '🔄 Run with Ralph' : '▶ Run Full Workflow'}
              </button>
              
              <button
                onClick={() => runPhase(workflowState.currentPhase)}
                disabled={isRunning || !featureDescription.trim()}
                style={{
                  padding: '0.625rem 1.25rem',
                  backgroundColor: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  cursor: isRunning || !featureDescription.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Step: {PHASES.find(p => p.phase === workflowState.currentPhase)?.label}
              </button>
              
              <button
                onClick={resetWorkflow}
                disabled={isRunning}
                style={{
                  padding: '0.625rem 1.25rem',
                  backgroundColor: 'white',
                  color: '#ef4444',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                }}
              >
                Reset
              </button>
            </div>

            {/* Output Display */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Main Output */}
              <div style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
                {currentOutput ? (
                  <pre
                    style={{
                      background: '#f9fafb',
                      padding: '1rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                      margin: 0,
                    }}
                  >
                    {currentOutput}
                  </pre>
                ) : (
                  <div style={{ 
                    textAlign: 'center', 
                    color: '#9ca3af',
                    padding: '3rem',
                  }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚀</div>
                    <p>Enter a feature description and run the workflow</p>
                    <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                      The AI Engineering System will guide you through Research → Specify → Plan → Work → Review
                    </p>
                  </div>
                )}
              </div>

              {/* Logs Panel */}
              {logs.length > 0 && (
                <div style={{ 
                  width: '280px', 
                  borderLeft: '1px solid #e5e7eb',
                  background: '#111827',
                  color: '#10b981',
                  padding: '1rem',
                  overflow: 'auto',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                }}>
                  <div style={{ 
                    color: '#6b7280', 
                    marginBottom: '0.5rem',
                    borderBottom: '1px solid #374151',
                    paddingBottom: '0.5rem',
                  }}>
                    Workflow Logs
                  </div>
                  {logs.map((log, i) => (
                    <div key={i} style={{ marginBottom: '0.25rem' }}>
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
