import { cn } from "@/lib/utils"

type SparklineProps = {
  values: number[]
  /** CSS color for the stroke. Defaults to the primary viz series. */
  color?: string
  width?: number
  height?: number
  className?: string
  /** Accessible description, e.g. "Completed per day, last 14 days". */
  label?: string
}

/**
 * A 12-to-14 point trend line for stat tiles. No axes, no labels: the value
 * beside it carries the number, the line carries the shape.
 */
export function Sparkline({
  values,
  color = "var(--viz-1)",
  width = 72,
  height = 24,
  className,
  label,
}: SparklineProps) {
  if (values.length < 2) return null

  const max = Math.max(...values, 1)
  const pad = 2
  const stepX = (width - pad * 2) / (values.length - 1)
  const points = values.map((v, i) => {
    const x = pad + i * stepX
    const y = height - pad - (v / max) * (height - pad * 2)
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const
  })
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ")
  const [endX, endY] = points[points.length - 1]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("shrink-0 overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r={2.5} fill={color} stroke="var(--surface-1)" strokeWidth={1.5} />
    </svg>
  )
}
