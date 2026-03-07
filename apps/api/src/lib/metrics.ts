type Labels = Record<string, string | number>;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];
const histograms = new Map<string, number[]>();
const histogramSums = new Map<string, number>();
const histogramCounts = new Map<string, number>();

function normalizeValue(value: string | number): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function keyFor(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name;
  }

  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  const encoded = sorted.map(([k, v]) => `${k}=${normalizeValue(v)}`).join(',');
  return `${name}|${encoded}`;
}

function splitKey(key: string): { name: string; encoded: string } {
  const idx = key.indexOf('|');
  if (idx === -1) {
    return { name: key, encoded: '' };
  }
  return {
    name: key.slice(0, idx),
    encoded: key.slice(idx + 1),
  };
}

function encodedToPromLabels(encoded: string): string {
  if (!encoded) {
    return '';
  }
  const labels = encoded
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const [k, v] = pair.split('=');
      return `${k}="${v}"`;
    })
    .join(',');
  return labels ? `{${labels}}` : '';
}

export function incCounter(name: string, labels?: Labels, amount = 1): void {
  const key = keyFor(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

export function setGauge(name: string, value: number): void {
  gauges.set(keyFor(name), value);
}

export function observeDuration(name: string, valueMs: number, labels?: Labels): void {
  const key = keyFor(name, labels);
  const bucketCounts = histograms.get(key) ?? new Array(histBuckets.length).fill(0);
  for (let i = 0; i < histBuckets.length; i++) {
    if (valueMs <= histBuckets[i]) {
      bucketCounts[i] += 1;
    }
  }
  histograms.set(key, bucketCounts);
  histogramSums.set(key, (histogramSums.get(key) ?? 0) + valueMs);
  histogramCounts.set(key, (histogramCounts.get(key) ?? 0) + 1);
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  const counterNames = new Set<string>();
  for (const [key] of counters) {
    const { name } = splitKey(key);
    counterNames.add(name);
  }

  for (const name of Array.from(counterNames).sort()) {
    lines.push(`# TYPE ${name} counter`);
    for (const [key, value] of counters) {
      const parsed = splitKey(key);
      if (parsed.name !== name) {
        continue;
      }
      lines.push(`${parsed.name}${encodedToPromLabels(parsed.encoded)} ${value}`);
    }
  }

  const gaugeNames = new Set<string>();
  for (const [key] of gauges) {
    const { name } = splitKey(key);
    gaugeNames.add(name);
  }

  for (const name of Array.from(gaugeNames).sort()) {
    lines.push(`# TYPE ${name} gauge`);
    for (const [key, value] of gauges) {
      const parsed = splitKey(key);
      if (parsed.name !== name) {
        continue;
      }
      lines.push(`${parsed.name}${encodedToPromLabels(parsed.encoded)} ${value}`);
    }
  }

  const histogramNames = new Set<string>();
  for (const [key] of histograms) {
    const { name } = splitKey(key);
    histogramNames.add(name);
  }

  for (const name of Array.from(histogramNames).sort()) {
    lines.push(`# TYPE ${name} histogram`);

    for (const [key, bucketCounts] of histograms) {
      const parsed = splitKey(key);
      if (parsed.name !== name) {
        continue;
      }

      const baseLabels = parsed.encoded
        .split(',')
        .filter(Boolean)
        .map((pair) => {
          const [k, v] = pair.split('=');
          return `${k}="${v}"`;
        });

      for (let i = 0; i < histBuckets.length; i++) {
        const le = histBuckets[i] === Infinity ? '+Inf' : String(histBuckets[i]);
        const labels = [...baseLabels, `le="${le}"`].join(',');
        lines.push(`${name}_bucket{${labels}} ${bucketCounts[i]}`);
      }

      lines.push(`${name}_sum${baseLabels.length ? '{' + baseLabels.join(',') + '}' : ''} ${histogramSums.get(key) ?? 0}`);
      lines.push(`${name}_count${baseLabels.length ? '{' + baseLabels.join(',') + '}' : ''} ${histogramCounts.get(key) ?? 0}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function metricLabels(input: Labels): Labels {
  return input;
}

export function counterLabelsFromRateLimitKey(key: string): Labels {
  const keyType = key.split(':')[0] || 'unknown';
  return { keyType };
}
