const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(token|secret|password|key)/i;
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-admin-api-key',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) || SENSITIVE_KEY_PATTERN.test(key);
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  const cached = seen.get(value);
  if (cached) {
    return cached;
  }

  if (value instanceof Error) {
    const errorObject: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    seen.set(value, errorObject);

    const errorRecord = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const entry = errorRecord[key];
      errorObject[key] = isSensitiveKey(key)
        ? REDACTED_VALUE
        : redactValue(entry, seen);
    }

    return errorObject;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const entry of value) {
      clone.push(redactValue(entry, seen));
    }
    return clone;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = isSensitiveKey(key)
      ? REDACTED_VALUE
      : redactValue(entry, seen);
  }

  return clone;
}

export function redact<T>(value: T): T {
  return redactValue(value, new WeakMap<object, unknown>()) as T;
}
