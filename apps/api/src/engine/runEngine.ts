import type { RunWithSteps, RunStep, StepStatus, ApprovalDecision, LogLine, ToolSummary } from '@ai-operator/shared';
import { RunStatus, createServerMessage } from '@ai-operator/shared';
import { runStore, type RunEngine } from '../store/runs.js';
import { sendToDevice } from '../lib/ws-handler.js';
import type { FastifyInstance } from 'fastify';

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STEP_DELAY_MS = 500; // Base delay between steps

export function createRunEngine(runId: string, fastify: FastifyInstance): RunEngine {
  let stopped = false;
  let currentStepIndex = -1;
  let approvalResolve: ((decision: ApprovalDecision) => void) | null = null;

  const sendLog = (stepId: string, line: string, level: LogLine['level'] = 'info') => {
    const run = runStore.get(runId);
    if (!run) return;

    const log: LogLine = { line, level, at: Date.now() };
    runStore.addLog(runId, stepId, log);
    persistRun(runId);

    // Send to device
    const msg = createServerMessage('server.run.log', {
      deviceId: run.deviceId,
      runId,
      stepId,
      line,
      level,
      at: log.at,
    });
    sendToDevice(run.deviceId, msg);

    // Also send to SSE subscribers
    sseBroadcast({ type: 'log_line', runId, stepId, log });
  };

  const updateStep = (stepId: string, status: StepStatus, updates?: Partial<RunStep>) => {
    const run = runStore.get(runId);
    if (!run) return;

    const step = run.steps.find((s) => s.stepId === stepId);
    if (!step) return;

    const now = Date.now();
    const stepUpdate: Partial<RunStep> = {
      status,
      ...updates,
    };

    if (status === 'running' && !step.startedAt) {
      stepUpdate.startedAt = now;
    }
    if ((status === 'done' || status === 'failed') && !step.endedAt) {
      stepUpdate.endedAt = now;
    }

    runStore.updateStep(runId, stepId, stepUpdate);
    persistRun(runId);

    // Send to device
    const msg = createServerMessage('server.run.step_update', {
      deviceId: run.deviceId,
      runId,
      step: { ...step, ...stepUpdate },
    });
    sendToDevice(run.deviceId, msg);

    // Broadcast to SSE
    sseBroadcast({ type: 'step_update', runId, step: { ...step, ...stepUpdate } });
  };

  const updateRunStatus = (status: RunStatus, reason?: string) => {
    const run = runStore.updateStatus(runId, status, reason);
    if (run) {
      persistRun(runId);
      // Send to device
      const msg = createServerMessage('server.run.status', {
        deviceId: run.deviceId,
        runId,
        status,
      });
      sendToDevice(run.deviceId, msg);

      // Broadcast to SSE
      sseBroadcast({ type: 'run_update', run });
    }
  };

  const waitForApproval = async (_approvalId: string): Promise<ApprovalDecision> => {
    return new Promise((resolve) => {
      approvalResolve = resolve;

      // Set timeout
      setTimeout(() => {
        if (approvalResolve) {
          approvalResolve('denied');
          approvalResolve = null;
        }
      }, APPROVAL_TIMEOUT_MS);
    });
  };

  const executeStep = async (step: RunStep): Promise<boolean> => {
    if (stopped) return false;

    const stepIndex = currentStepIndex;
    fastify.log.info({ runId, stepId: step.stepId, stepTitle: step.title }, 'Executing step');

    updateStep(step.stepId, 'running');
    sendLog(step.stepId, `Starting: ${step.title}`, 'info');

    // Simulate work based on step
    switch (stepIndex) {
      case 0: // Understand goal
        await delay(300);
        sendLog(step.stepId, 'Analyzing goal requirements...', 'info');
        await delay(400);
        sendLog(step.stepId, 'Goal understood: ' + runStore.get(runId)?.goal.slice(0, 50) + '...', 'info');
        break;

      case 1: // Propose approach
        await delay(400);
        sendLog(step.stepId, 'Evaluating possible approaches...', 'info');
        await delay(300);
        sendLog(step.stepId, 'Selected approach: Deterministic execution with approval checkpoints', 'info');
        break;

      case 2: // Request approval
        await delay(300);
        sendLog(step.stepId, 'Preparing approval request...', 'info');

        // Create approval request
        const approvalId = crypto.randomUUID();
        const run = runStore.get(runId);
        if (run) {
          runStore.setPendingApproval(runId, {
            approvalId,
            runId,
            title: 'Proceed with execution?',
            description: 'The agent is ready to proceed with the task. This step requires your approval to continue.',
            risk: 'medium',
            expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
            status: 'pending',
          });
          persistRun(runId);

          updateRunStatus('waiting_for_user');
          updateStep(step.stepId, 'blocked');

          // Send approval request to device
          const approvalMsg = createServerMessage('server.approval.request', {
            deviceId: run.deviceId,
            runId,
            approval: run.pendingApproval!,
          });
          sendToDevice(run.deviceId, approvalMsg);

          // Broadcast to SSE
          sseBroadcast({ type: 'run_update', run: runStore.get(runId)! });

          // Wait for decision
          const decision = await waitForApproval(approvalId);

          if (stopped) return false;

          if (decision === 'approved') {
            sendLog(step.stepId, 'Approval granted, continuing...', 'info');
            updateStep(step.stepId, 'done');
            return true;
          } else {
            sendLog(step.stepId, 'Approval denied or expired', 'error');
            updateStep(step.stepId, 'failed');
            return false;
          }
        }
        break;

      case 3: // Produce final result
        await delay(500);
        sendLog(step.stepId, 'Generating final summary...', 'info');
        await delay(400);
        sendLog(step.stepId, 'Execution completed successfully', 'info');
        break;
    }

    if (stopped) return false;

    await delay(200);
    updateStep(step.stepId, 'done');
    return true;
  };

  const run = async () => {
    fastify.log.info({ runId }, 'Starting run engine');

    const runData = runStore.get(runId);
    if (!runData) {
      fastify.log.error({ runId }, 'Run not found');
      return;
    }

    // Send full run details to device
    const detailsMsg = createServerMessage('server.run.details', {
      deviceId: runData.deviceId,
      run: runData,
    });
    sendToDevice(runData.deviceId, detailsMsg);

    updateRunStatus('running');

    // Execute each step
    for (let i = 0; i < runData.steps.length; i++) {
      if (stopped) break;

      currentStepIndex = i;
      const step = runData.steps[i];
      const success = await executeStep(step);

      if (!success) {
        if (!stopped) {
          updateRunStatus('failed', `Step "${step.title}" failed or was denied`);
        }
        runStore.deleteEngine(runId);
        return;
      }

      // Small delay between steps
      if (i < runData.steps.length - 1) {
        await delay(STEP_DELAY_MS);
      }
    }

    if (!stopped) {
      updateRunStatus('done');
      fastify.log.info({ runId }, 'Run completed successfully');
    }

    runStore.deleteEngine(runId);
  };

  return {
    async start() {
      stopped = false;
      await run();
    },

    stop() {
      stopped = true;
      if (approvalResolve) {
        approvalResolve('denied');
        approvalResolve = null;
      }
      fastify.log.info({ runId }, 'Run engine stopped');
    },

    handleApproval(decision: ApprovalDecision, comment?: string) {
      const run = runStore.get(runId);
      if (run?.pendingApproval) {
        runStore.resolveApproval(runId, decision, comment);
        persistRun(runId);
        if (approvalResolve) {
          approvalResolve(decision);
          approvalResolve = null;
        }
      }
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SSE Broadcast functionality (will be set by the main server)
type SSEEvent =
  | { type: 'device_update'; device: unknown }
  | { type: 'run_update'; run: RunWithSteps }
  | { type: 'step_update'; runId: string; step: RunStep }
  | { type: 'log_line'; runId: string; stepId?: string; log: LogLine }
  | { type: 'screen_update'; deviceId: string; meta: { frameId: string; width: number; height: number; mime: string; at: number; byteLength: number } }
  | { type: 'action_update'; action: unknown }
  | { type: 'tool_update'; tool: ToolSummary };

let sseBroadcastFn: ((event: SSEEvent) => void) | null = null;
let persistRunFn: ((runId: string) => void) | null = null;

export function setSSEBroadcast(fn: (event: SSEEvent) => void): void {
  sseBroadcastFn = fn;
}

export function setRunPersistence(fn: (runId: string) => void): void {
  persistRunFn = fn;
}

function sseBroadcast(event: SSEEvent): void {
  if (sseBroadcastFn) {
    sseBroadcastFn(event);
  }
}

function persistRun(runId: string): void {
  if (persistRunFn) {
    persistRunFn(runId);
  }
}

// Also export for direct use
export { sseBroadcast };
