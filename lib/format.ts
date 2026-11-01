export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/** failures per hour → failures FPMH (failures per million hours) */
export function toPerMillion(lambdaPerHour: number | null | undefined): number | null {
  if (lambdaPerHour == null || !Number.isFinite(lambdaPerHour)) return null;
  return lambdaPerHour * 1e6;
}

export function fmtLambda(lambdaPerHour: number | null | undefined, digits = 3): string {
  const v = toPerMillion(lambdaPerHour);
  if (v == null) return "—";
  if (v === 0) return "0";
  if (Math.abs(v) < 0.001) return v.toExponential(2);
  return v.toFixed(digits);
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function ppm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 1e6).toFixed(0)} ppm`;
}

export function hours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 h";
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M h`;
  if (value >= 1e4) return `${Math.round(value).toLocaleString("en-US")} h`;
  if (value >= 1) return `${value.toFixed(1)} h`;
  return `${(value * 60).toFixed(0)} min`;
}

export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function dateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.includes("T") || value.includes(" ") ? value.replace(" ", "T") + "Z" : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.includes("T") || value.includes(" ") ? value.replace(" ", "T") + "Z" : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().replace("T", " ").slice(0, 16);
}

export function relative(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.includes("T") || value.includes(" ") ? value.replace(" ", "T") + "Z" : value);
  if (Number.isNaN(d.getTime())) return value;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return dateOnly(value);
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value.includes("T") || value.includes(" ") ? value.replace(" ", "T") + "Z" : value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function addInterval(from: Date, value: number, unit: string): Date {
  const d = new Date(from.getTime());
  switch (unit) {
    case "hours":
      d.setTime(d.getTime() + value * 3600_000);
      break;
    case "days":
      d.setDate(d.getDate() + value);
      break;
    case "weeks":
      d.setDate(d.getDate() + value * 7);
      break;
    case "months":
      d.setMonth(d.getMonth() + value);
      break;
    default:
      d.setDate(d.getDate() + value);
  }
  return d;
}
