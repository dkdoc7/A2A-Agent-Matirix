import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Grid, GridColumn as Column } from '@progress/kendo-react-grid'

interface Agent {
	id: string
	name: string
	endpoint: string
	status: 'active' | 'inactive'
	last_seen_at?: string | null
}

const BACKEND_BASE = (import.meta.env.VITE_BACKEND_BASE as string) || 'http://localhost:8000'

export const App: React.FC = () => {
	const [agents, setAgents] = useState<Agent[]>([])
	const wsRef = useRef<WebSocket | null>(null)

	const loadAgents = async () => {
		const resp = await fetch(`${BACKEND_BASE}/agents`)
		const data = await resp.json()
		setAgents(data.agents || [])
	}

	useEffect(() => {
		loadAgents()
	}, [])

	useEffect(() => {
		const wsUrl = BACKEND_BASE.replace('http', 'ws') + '/ws'
		const ws = new WebSocket(wsUrl)
		wsRef.current = ws
		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data)
				if (msg.type === 'agent_status_changed' && msg.agent) {
					setAgents((prev) => {
						const existing = prev.find((a) => a.id === msg.agent.id)
						if (!existing) {
							return [...prev, msg.agent]
						}
						return prev.map((a) => (a.id === msg.agent.id ? msg.agent : a))
					})
				}
			} catch (e) {
				// ignore
			}
		}
		ws.onopen = () => {
			// keep-alive pings from client to satisfy server's receive loop
			const interval = setInterval(() => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send('ping')
				}
			}, 15000)
			;(ws as any)._keepAlive = interval
		}
		ws.onclose = () => {
			const interval = (ws as any)._keepAlive
			if (interval) clearInterval(interval)
		}
		return () => {
			try { ws.close() } catch {}
		}
	}, [])

	const statusCell = useMemo(() => (props: any) => {
		const value = props.dataItem[props.field]
		const color = value === 'active' ? '#2e7d32' : '#c62828'
		return (
			<td style={{ color, fontWeight: 600 }}>
				{value}
			</td>
		)
	}, [])

	return (
		<div style={{ padding: 24 }}>
			<h2>Agent Station</h2>
			<Grid style={{ height: '70vh' }} data={agents}>
				<Column field="id" title="ID" width="200px" />
				<Column field="name" title="Name" width="220px" />
				<Column field="endpoint" title="Endpoint" width="320px" />
				<Column field="status" title="Status" cell={statusCell as any} width="140px" />
				<Column field="last_seen_at" title="Last Seen" />
			</Grid>
		</div>
	)
}