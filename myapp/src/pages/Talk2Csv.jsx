// src/pages/Talk2Csv.jsx
import { useEffect, useRef, useState } from 'react'
import { api } from '../utils/api'
import '../styles/talk2csv.css'
import {
  ResponsiveContainer,
  LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar,
  AreaChart, Area,
  ScatterChart, Scatter
} from 'recharts'

export default function Talk2Csv() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! Ask me about your data. I can run read-only SQL and draw charts.' }
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const send = async () => {
    if (!input.trim()) return
    const userTurn = { role: 'user', content: input }
    setMessages(m => [...m, userTurn])
    setInput('')
    setBusy(true)
    try {
      const res = await api.assistantChat([...messages, userTurn])
      const assistantTurn = {
        role: 'assistant',
        content: res.answer || '(no answer)',
        data: res.rows,
        columns: res.columns,
        sql: res.sql,
        chart: res.chart,
        sql_error: res.sql_error,
      }
      setMessages(m => [...m, assistantTurn])
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: 'Error: ' + (e.message || String(e)) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="talk2csv page page--pad">
      <div className="section__header">
        <h2 className="section__title">Talk2CSV</h2>
        <p className="muted small">LLM has read-only SQL access. Ask questions, request charts, or explore.</p>
      </div>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            <div className="msg__bubble">
              {m.content}
              {m.sql && <pre className="sql">{m.sql}</pre>}
              {m.sql_error && <div className="alert alert--error">SQL error: {m.sql_error}</div>}
              {m.columns && m.data && (
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead><tr>{m.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {m.data.slice(0, 50).map((row, ri) => (
                        <tr key={ri}>{m.columns.map(c => <td key={c}>{row[c]}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {m.chart && m.data && <Chart block={m.chart} data={m.data} />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="e.g., plot average chlorophyll_a per month by sampling point"
          rows={2}
        />
        <button className="button button--primary" onClick={send} disabled={busy}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

function Chart({ block, data }) {
  const type = (block?.type || 'line').toLowerCase()
  const xKey = block?.x
  const series = Array.isArray(block?.series) ? block.series : []
  if (!xKey || !series.length) return null

  // defensively coerce series to numbers
  const dataCoerced = (data || []).map(row => {
    const r = { ...row }
    for (const s of series) {
      const v = r[s]
      const n = typeof v === 'string' ? Number(v) : v
      r[s] = Number.isFinite(n) ? n : null
    }
    return r
  })

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={xKey} />
      <YAxis />
      <Tooltip />
      <Legend />
    </>
  )

  return (
    <div className="chart-card">
      <ResponsiveContainer width="100%" height={320}>
        {type === 'bar' ? (
          <BarChart data={dataCoerced}>
            {common}
            {series.map(s => <Bar key={s} dataKey={s} />)}
          </BarChart>
        ) : type === 'area' ? (
          <AreaChart data={dataCoerced}>
            {common}
            {series.map(s => <Area key={s} type="monotone" dataKey={s} />)}
          </AreaChart>
        ) : type === 'scatter' ? (
          <ScatterChart>
            {common}
            <Scatter data={dataCoerced} dataKey={series[0]} />
          </ScatterChart>
        ) : (
          <LineChart data={dataCoerced}>
            {common}
            {series.map(s => (
              <Line key={s} type="monotone" dataKey={s} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
