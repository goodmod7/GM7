import test from 'node:test';
import assert from 'node:assert/strict';

const chatTaskFlow = await import('./chatTaskFlow.ts');
const gorkhKnowledge = await import('./gorkhKnowledge.ts');

test('assistant task confirmation responses still parse explicit confirm and cancel answers', () => {
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse('yes'), 'confirm');
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse('Go ahead!'), 'confirm');
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse("don't"), 'cancel');
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse('maybe later'), null);
});

test('free AI setup approval responses parse explicit confirm and cancel answers', () => {
  assert.equal(chatTaskFlow.interpretFreeAiSetupResponse('yes'), 'confirm');
  assert.equal(chatTaskFlow.interpretFreeAiSetupResponse('go ahead'), 'confirm');
  assert.equal(chatTaskFlow.interpretFreeAiSetupResponse('cancel'), 'cancel');
  assert.equal(chatTaskFlow.interpretFreeAiSetupResponse('maybe'), null);
});

test('assistant task start confirmation depends on active execution state', () => {
  assert.equal(chatTaskFlow.shouldConfirmAssistantTaskStart(null), true);
  assert.equal(
    chatTaskFlow.shouldConfirmAssistantTaskStart({
      runId: 'run-active',
      goal: 'Fix tests in this repo',
      status: 'waiting_for_user',
      createdAt: 1,
      updatedAt: 1,
      deviceId: 'device-1',
      steps: [],
    }),
    false
  );
});

test('free AI setup preflight report stays retail friendly and asks for approval', () => {
  assert.equal(chatTaskFlow.buildFreeAiSetupPreflightReport.length, 0);

  const report = chatTaskFlow.buildFreeAiSetupPreflightReport();

  const text = [
    report.title,
    report.summary,
    report.details,
    report.prompt,
  ].join('\n');

  assert.match(report.title, /Free AI/i);
  assert.match(report.summary, /Free AI.*required/i);
  assert.match(report.summary, /local engine|AI model/i);
  assert.doesNotMatch(report.summary, /brew|ollama pull/i);
  assert.match(report.prompt, /approve|approval/i);
  assert.doesNotMatch(text, /brew|ollama pull/i);
  assert.deepEqual(gorkhKnowledge.GORKH_FREE_AI_SETUP_COPY.actions, {
    retry: 'Retry Free AI',
    cancel: 'Cancel this task',
    openSettings: 'Open Settings',
  });
});
