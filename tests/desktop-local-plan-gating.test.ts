import assert from 'node:assert/strict';
import test from 'node:test';

test('desktop local plan helper derives free and plus local AI entitlements and daily limits', async () => {
  const imported = await import('../apps/desktop/src/lib/localPlan.ts');

  const freePlan = imported.getLocalAiPlanPolicy({
    subscriptionStatus: 'inactive',
    subscriptionCurrentPeriodEnd: null,
    planPriceId: null,
    localAiPlan: 'free',
    freeLocalTaskLimit: 5,
    visionBoostIncluded: false,
  });
  const plusPlan = imported.getLocalAiPlanPolicy({
    subscriptionStatus: 'active',
    subscriptionCurrentPeriodEnd: null,
    planPriceId: 'price_plus',
    localAiPlan: 'plus',
    freeLocalTaskLimit: null,
    visionBoostIncluded: true,
  });

  assert.equal(freePlan.plan, 'free');
  assert.equal(freePlan.localTaskLimit, 5);
  assert.equal(freePlan.visionBoostIncluded, false);

  assert.equal(plusPlan.plan, 'plus');
  assert.equal(plusPlan.localTaskLimit, null);
  assert.equal(plusPlan.visionBoostIncluded, true);
});

test('desktop local plan helper tracks app-side free local task usage per day', async () => {
  const imported = await import('../apps/desktop/src/lib/localPlan.ts');
  const store = new Map();
  const storage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };

  const policy = imported.getLocalAiPlanPolicy({
    subscriptionStatus: 'inactive',
    subscriptionCurrentPeriodEnd: null,
    planPriceId: null,
    localAiPlan: 'free',
    freeLocalTaskLimit: 2,
    visionBoostIncluded: false,
  });

  const dayKey = '2026-03-11';
  assert.deepEqual(imported.readLocalAiTaskUsage(storage, dayKey), { dayKey, tasksStarted: 0 });
  assert.equal(imported.canStartManagedLocalTask(policy, imported.readLocalAiTaskUsage(storage, dayKey)).allowed, true);

  imported.recordManagedLocalTaskStart(storage, dayKey);
  imported.recordManagedLocalTaskStart(storage, dayKey);

  const usage = imported.readLocalAiTaskUsage(storage, dayKey);
  assert.deepEqual(usage, { dayKey, tasksStarted: 2 });
  assert.equal(imported.canStartManagedLocalTask(policy, usage).allowed, false);
  assert.match(
    imported.canStartManagedLocalTask(policy, usage).reason || '',
    /limit|plus/i,
    'free-plan limit messaging should explain the local task cap'
  );

  assert.deepEqual(imported.readLocalAiTaskUsage(storage, '2026-03-12'), {
    dayKey: '2026-03-12',
    tasksStarted: 0,
  });
});
