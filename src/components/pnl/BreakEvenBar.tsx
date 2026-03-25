'use client'

const formatINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

interface Props {
  contributionMargin: number
  overheads: number
}

export default function BreakEvenBar({ contributionMargin, overheads }: Props) {
  if (overheads === 0) return null

  const pct = Math.min((contributionMargin / overheads) * 100, 100)
  const isProfitable = contributionMargin >= overheads
  const operatingProfit = contributionMargin - overheads
  const shortfall = overheads - contributionMargin

  return (
    <div className="space-y-2">
      {/* Status label */}
      <div className="flex items-center justify-between text-sm">
        {isProfitable ? (
          <span className="font-semibold text-green-700 dark:text-green-400">
            Operating Profit: {formatINR(operatingProfit)}
          </span>
        ) : (
          <span className="font-semibold text-amber-700 dark:text-amber-400">
            Below break-even &mdash; shortfall of {formatINR(shortfall)}
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {Math.round(pct)}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isProfitable
              ? 'bg-green-500 dark:bg-green-600'
              : 'bg-amber-500 dark:bg-amber-600'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Caption */}
      <p className="text-xs text-muted-foreground">
        Break-even: {formatINR(contributionMargin)} / {formatINR(overheads)} ({Math.round(pct)}%)
      </p>
      {!isProfitable && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          You need {formatINR(shortfall)} more contribution margin to break even.
        </p>
      )}
    </div>
  )
}
