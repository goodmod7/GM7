import test from 'node:test';
import assert from 'node:assert/strict';

const chatTaskFlow = await import('./chatTaskFlow.ts');

test('assistant task confirmation responses still parse explicit confirm and cancel answers', () => {
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse('yes'), 'confirm');
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse('Go ahead!'), 'confirm');
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse("don't"), 'cancel');
  assert.equal(chatTaskFlow.interpretAssistantTaskConfirmationResponse('maybe later'), null);
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
