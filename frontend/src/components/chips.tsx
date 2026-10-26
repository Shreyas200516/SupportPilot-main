import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type Category,
  type Priority,
  type Status,
  type Ticket,
} from "@/lib/data";
import { slaLabel, slaState } from "@/lib/store";

export const chip = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-medium leading-4",
  {
    variants: {
      tone: {
        neutral: "bg-neutral-soft text-foreground/80",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        accent: "bg-terracotta-soft text-terracotta",
        dark: "bg-primary text-primary-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);
const dot = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-muted-foreground",
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-danger",
      accent: "bg-terracotta",
      dark: "bg-primary-foreground",
    },
  },
});
type Tone = "neutral" | "success" | "warning" | "danger" | "accent" | "dark";

export function Chip({
  tone = "neutral",
  withDot,
  className,
  children,
}: {
  tone?: Tone;
  withDot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(chip({ tone }), className)}>
      {withDot && <span className={dot({ tone })} aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<Status, Tone> = {
  new: "accent",
  open: "neutral",
  waiting: "warning",
  escalated: "danger",
  resolved: "success",
};
const PRIORITY_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "neutral",
  low: "neutral",
};

export const StatusChip = ({ status }: { status: Status }) => (
  <Chip tone={STATUS_TONE[status]} withDot>
    {STATUS_LABEL[status]}
  </Chip>
);
export function PriorityChip({ priority }: { priority: Priority }) {
  const bars = { critical: 4, high: 3, medium: 2, low: 1 }[priority];
  return (
    <Chip tone={PRIORITY_TONE[priority]}>
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4].map((b) => (
          <span
            key={b}
            className={cn(
              "w-0.5 rounded-full bg-current",
              b <= bars ? "opacity-100" : "opacity-25",
            )}
            style={{ height: 3 + b * 2 }}
          />
        ))}
      </span>
      {PRIORITY_LABEL[priority]}
    </Chip>
  );
}

export function SeverityChip({ severity }: { severity: "Critical" | "High" | "Medium" | "Low" }) {
  const tone: Tone =
    severity === "Critical" ? "danger" : severity === "High" ? "warning" : "neutral";
  return <Chip tone={tone}>Sev · {severity}</Chip>;
}

export const CategoryChip = ({ category }: { category: Category }) => (
  <span className="text-xs text-muted-foreground">{category}</span>
);

export function SlaChip({ ticket }: { ticket: Ticket }) {
  const s = slaState(ticket);
  const tone: Tone =
    s === "overdue" ? "danger" : s === "at-risk" ? "warning" : s === "met" ? "success" : "neutral";
  return <Chip tone={tone}>{slaLabel(ticket)}</Chip>;
}

export function ConfidenceChip({ value }: { value: number }) {
  const level = value >= 75 ? "High" : value >= 60 ? "Medium" : "Low";
  return (
    <Chip tone={level === "High" ? "success" : level === "Medium" ? "warning" : "danger"}>
      {level} · {value}%
    </Chip>
  );
}

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-foreground",
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}
export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
