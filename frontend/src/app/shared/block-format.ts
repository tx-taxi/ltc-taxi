const DECIMALS = 8, SYMBOL = 'LTC', FEE_UNIT = 'lit/vB', FEE_SCALE = 1;

// Hub strips share the page document, while explorers serve each language at
// its own URL. Never use browser preferences to change an English page.
function blockLocale(): 'es' | 'en-US' {
  return typeof document !== 'undefined' && /^es(?:-|$)/i.test(document.documentElement?.lang || '') ? 'es' : 'en-US';
}

// Keep exact values intact; only change the decimal separator in Spanish.
function exactDisplay(value: string): string {
  return blockLocale() === 'es' ? value.replace('.', ',') : value;
}

// Presentation only: never round provider data or detail-page amounts.
export function compactBlockNumber(value: number, amount = false): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.001) return value < 0 ? '>' + exactDisplay('−0.001') : '<' + exactDisplay('0.001');
  if (abs >= 1000) {
    const units = ['', 'k', 'M', 'B', 'T'];
    let group = Math.min(4, Math.floor(Math.log10(abs) / 3));
    let scaled = Number((value / 1000 ** group).toPrecision(3));
    if (Math.abs(scaled) >= 1000 && group < 4) { group++; scaled /= 1000; }
    return scaled.toLocaleString(blockLocale(), { maximumSignificantDigits: 3, useGrouping: false }) + units[group];
  }
  return value.toLocaleString(blockLocale(), amount
    ? { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false }
    : { maximumSignificantDigits: 3, useGrouping: false });
}

export function compactBlockAmount(value: number | string, atomic = false): string {
  if (value == null) return '—';
  return compactBlockNumber(Number(value) / (atomic ? 1 : 10 ** DECIMALS), !atomic);
}

export function exactBlockAmount(value: number | string): string {
  if (value == null) return '—';
  try {
    const n = BigInt(value), abs = n < 0n ? -n : n, scale = 10n ** BigInt(DECIMALS);
    const fraction = (abs % scale).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
    return (n < 0n ? '-' : '') + (abs / scale).toString() + (fraction ? '.' + fraction : '');
  } catch { return '—'; }
}

export function blockValueDetails(total: number | string, median: number, min: number, max: number): string {
  const rate = (value: number) => value == null || !Number.isFinite(value) ? '—' : exactDisplay(String(value / FEE_SCALE));
  return $localize`:@@taxi.ltc.block.details:Total fees: ${exactDisplay(exactBlockAmount(total))}:fees: ${SYMBOL}:symbol:. Median fee rate: ${rate(median)}:median: ${FEE_UNIT}:feeUnit:. Fee range: ${rate(min)}:min:–${rate(max)}:max: ${FEE_UNIT}:rangeUnit:.`;
}
