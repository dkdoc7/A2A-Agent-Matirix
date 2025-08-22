import React, { useEffect, useRef, useState } from 'react'

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
		try {
			const resp = await fetch(`${BACKEND_BASE}/agents`)
			const data = await resp.json()
			setAgents(data.agents || [])
		} catch (error) {
			console.error('Failed to load agents:', error)
		}
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

	return (
		<div style={{ padding: 24 }}>
			<h2>Agent Station</h2>
			<table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
				<thead>
					<tr style={{ backgroundColor: '#f5f5f5' }}>
						<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>ID</th>
						<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Name</th>
						<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Endpoint</th>
						<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Status</th>
						<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Last Seen</th>
					</tr>
				</thead>
				<tbody>
					{agents.map((agent) => (
						<tr key={agent.id} style={{ borderBottom: '1px solid #eee' }}>
							<td style={{ padding: '12px' }}>{agent.id}</td>
							<td style={{ padding: '12px' }}>{agent.name}</td>
							<td style={{ padding: '12px' }}>{agent.endpoint}</td>
							<td style={{ 
								padding: '12px', 
								color: agent.status === 'active' ? '#2e7d32' : '#c62828',
								fontWeight: 600 
							}}>
								{agent.status}
							</td>
							<td style={{ padding: '12px' }}>{agent.last_seen_at || '-'}</td>
						</tr>
					))}
				</tbody>
			</table>
			{agents.length === 0 && (
				<div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
					No agents found
				</div>
			)}
		</div>
	)
}