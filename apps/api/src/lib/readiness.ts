export interface ReadyChecks {
  db: boolean;
  schema: boolean;
  stripe: boolean;
  github: boolean;
}

export interface ReadinessInput {
  billingEnabled: boolean;
  desktopReleaseSource: 'file' | 'github';
  stripe: {
    secretKeyConfigured: boolean;
    webhookSecretConfigured: boolean;
    priceIdConfigured: boolean;
  };
  github: {
    repoConfigured: boolean;
  };
  checkDatabase: () => Promise<void>;
  checkSchema: () => Promise<void>;
}

export interface ReadinessReport {
  ok: boolean;
  checks: ReadyChecks;
  failures: string[];
}

export async function evaluateReadiness(input: ReadinessInput): Promise<ReadinessReport> {
  const failures: string[] = [];
  const checks: ReadyChecks = {
    db: true,
    schema: true,
    stripe: true,
    github: true,
  };

  try {
    await input.checkDatabase();
  } catch {
    checks.db = false;
    failures.push('Database probe failed');
  }

  try {
    await input.checkSchema();
  } catch {
    checks.schema = false;
    failures.push('Required schema tables are missing');
  }

  if (input.billingEnabled) {
    checks.stripe =
      input.stripe.secretKeyConfigured && input.stripe.webhookSecretConfigured && input.stripe.priceIdConfigured;
    if (!checks.stripe) {
      failures.push('Stripe config is incomplete');
    }
  }

  if (input.desktopReleaseSource === 'github') {
    checks.github = input.github.repoConfigured;
    if (!checks.github) {
      failures.push('GitHub desktop release config is incomplete');
    }
  }

  return {
    ok: checks.db && checks.schema && checks.stripe && checks.github,
    checks,
    failures,
  };
}
