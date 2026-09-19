import Link from "next/link";
import { cn } from "@/lib/cn";

export function GradientButton({
  children,
  href,
  type = "button",
  className,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  href?: string;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const classes = cn(
    "tf-gradient inline-flex min-h-[3rem] w-full shrink-0 items-center justify-center gap-2 rounded-full px-5 py-3 text-center text-[15px] font-medium leading-6 text-white shadow-md shadow-indigo-200 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  href,
  className,
  ariaLabel,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  href?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const classes = cn(
    "inline-flex min-h-[3rem] items-center justify-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-center text-[14px] font-medium leading-6 text-ink transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={classes} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function SmallButton({
  children,
  variant = "outline",
  size = "md",
  className,
  ariaLabel,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  variant?: "gradient" | "outline";
  size?: "md" | "sm";
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const classes = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full text-center font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm"
      ? "h-9 px-4 text-[13px] leading-5"
      : "min-h-[2.5rem] px-4 py-2 text-[13px] leading-5",
    variant === "gradient"
      ? "tf-gradient text-white shadow-md shadow-indigo-200"
      : "border border-line bg-white text-ink",
    className,
  );
  return (
    <button className={classes} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Field({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] text-muted">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="h-12 w-full min-w-0 rounded-2xl border border-line bg-[#F8FAFF] px-4 text-[14px] outline-none ring-indigo-200 placeholder:text-muted/70 focus:ring-2"
      />
    </label>
  );
}
