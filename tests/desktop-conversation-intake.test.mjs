import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const assistantConversationPath = 'apps/desktop/src/lib/assistantConversation.ts';
const llmModPath = 'apps/desktop/src-tauri/src/llm/mod.rs';
const nativeOllamaPath = 'apps/desktop/src-tauri/src/llm/native_ollama.rs';
const openaiPath = 'apps/desktop/src-tauri/src/llm/openai.rs';
const openaiCompatPath = 'apps/desktop/src-tauri/src/llm/openai_compat.rs';
const claudePath = 'apps/desktop/src-tauri/src/llm/claude.rs';
const libRsPath = 'apps/desktop/src-tauri/src/lib.rs';

function readSource(path) {
  return readFileSync(path, 'utf8');
}

test('conversation intake bridge exposes a dedicated conversation result contract', () => {
  const llmModSource = readSource(llmModPath);
  const assistantConversationSource = readSource(assistantConversationPath);

  assert.match(
    llmModSource,
    /\breply\b[\s\S]{0,160}\bmessage\b|\bmessage\b[\s\S]{0,160}\breply\b/i,
    'LLM module should define a reply variant with a message field'
  );
  assert.match(
    llmModSource,
    /\bconfirm_task\b[\s\S]{0,260}\bgoal\b[\s\S]{0,180}\bsummary\b[\s\S]{0,180}\bprompt\b|\bprompt\b[\s\S]{0,180}\bsummary\b[\s\S]{0,180}\bgoal\b[\s\S]{0,260}\bconfirm_task\b/i,
    'LLM module should define a confirm_task variant with goal, summary, and prompt fields'
  );
  assert.match(
    assistantConversationSource,
    /invoke\([^)]*assistant_conversation_turn/,
    'Desktop helper should invoke the dedicated conversation-turn IPC'
  );
  assert.match(
    assistantConversationSource,
    /\breply\b[\s\S]{0,140}\bmessage\b|\bmessage\b[\s\S]{0,140}\breply\b/i,
    'Desktop helper should consume or expose a reply payload with a message field'
  );
  assert.match(
    assistantConversationSource,
    /\bconfirm_task\b[\s\S]{0,220}\bgoal\b[\s\S]{0,160}\bsummary\b[\s\S]{0,160}\bprompt\b|\bprompt\b[\s\S]{0,160}\bsummary\b[\s\S]{0,160}\bgoal\b[\s\S]{0,220}\bconfirm_task\b/i,
    'Desktop helper should consume or expose a confirm_task payload with goal, summary, and prompt fields'
  );
});

test('conversation intake bridge exposes a dedicated Tauri IPC entrypoint', () => {
  const libRsSource = readSource(libRsPath);

  assert.match(
    libRsSource,
    /#\[tauri::command\][\s\S]*assistant_conversation_turn[\s\S]*\(/,
    'Rust bridge should expose an assistant_conversation_turn command'
  );
});

for (const providerPath of [nativeOllamaPath, openaiPath, openaiCompatPath, claudePath]) {
  test(`conversation intake prompt is explicit in ${providerPath}`, () => {
    const source = readSource(providerPath);

    assert.match(
      source,
      /do not start execution from the intake turn/i,
      'provider prompt should forbid starting execution from the intake turn'
    );
    assert.match(
      source,
      /ask clarifying questions when details are missing/i,
      'provider prompt should ask clarifying questions when needed'
    );
    assert.match(
      source,
      /confirm_task/i,
      'provider prompt should mention the confirm_task response shape'
    );
    assert.match(
      source,
      /I will[\s\S]*Confirm\?|Confirm\?[\s\S]*I will/i,
      'provider prompt should require a plain-language task summary before confirmation'
    );
  });
}
