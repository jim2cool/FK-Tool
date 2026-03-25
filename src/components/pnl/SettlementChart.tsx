'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface Props {
  timeline: Array<{ date: string; settled: number; pending: number }>
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100000) return `${sign}\u20B9${(abs / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${sign}\u20B9${(abs / 1000).toFixed(1)}K`
  return `${sign}\u20B9${abs.toFixed(0)}`
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

export default function SettlementChart({ timeline }: Props) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={timeline}
          margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
        >
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(d).getDate().toString()}
            tick={{ fontSize: 11 }}
          />
          <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} width={60} />
          <Tooltip
            formatter={(value) => fmt(Number(value ?? 0))}
            labelFormatter={(label) =>
              new Date(String(label)).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })
            }
          />
          <Legend />
          <Bar
            dataKey="settled"
            stackId="a"
            fill="#22c55e"
            name="Settled"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="pending"
            stackId="a"
            fill="#f97316"
            name="Pending"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Settlement status grouped by order date. Actual bank deposit dates not
        tracked.
      </p>
    </div>
  )
}
