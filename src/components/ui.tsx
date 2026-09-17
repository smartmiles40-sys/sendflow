// Shared form primitives used by the campaign composer and the sequence pages.
// Extracted from campanhas/nova so both flows share the exact same brand look.

export const inputCls =
  'w-full rounded-xl border border-border bg-surface2 px-[13px] py-3 text-sm text-ink outline-none placeholder:text-muted focus:border-blue2';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      {label && (
        <label className="mb-[9px] block text-[13px] font-semibold">
          {label} {hint && <span className="font-normal text-muted">{hint}</span>}
        </label>
      )}
      {children}
      {error && (
        <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function SegButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`min-w-[80px] flex-1 rounded-xl border px-2 py-[11px] text-center text-[13px] font-semibold transition-colors ${
        on
          ? 'border-blue bg-blue/15 text-ink'
          : 'border-border bg-surface2 text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-[42px] shrink-0 rounded-full transition-colors ${
        checked ? 'bg-blue' : 'bg-[#1F555A]'
      }`}
    >
      <span
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all ${
          checked ? 'left-[21px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}
