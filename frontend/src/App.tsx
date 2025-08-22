import React, { useEffect, useRef, useState, useCallback } from 'react'

interface Agent {
	id: string
	name: string
	endpoint: string
	status: 'active' | 'inactive'
	last_seen_at?: string | null
}

interface WebSocketMessage {
	type: 'agent_status_changed'
	agent: Agent
}

const BACKEND_BASE = (import.meta.env.VITE_BACKEND_BASE as string) || 'http://localhost:8000'

export const App: React.FC = () => {
	const [agents, setAgents] = useState<Agent[]>([])
	const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const reconnectAttemptsRef = useRef(0)
	const maxReconnectAttempts = 5

	const loadAgents = useCallback(async () => {
		try {
			const resp = await fetch(`${BACKEND_BASE}/agents`)
			const data = await resp.json()
			setAgents(data.agents || [])
			setLastUpdate(new Date())
			console.log('Agents loaded:', data.agents?.length || 0)
		} catch (error) {
			console.error('Failed to load agents:', error)
		}
	}, [])

	const updateAgent = useCallback((updatedAgent: Agent) => {
		setAgents((prev) => {
			const existing = prev.find((a) => a.id === updatedAgent.id)
			if (!existing) {
				console.log('New agent added:', updatedAgent.id)
				return [...prev, updatedAgent]
			}
			
			const hasChanged = existing.status !== updatedAgent.status || 
							  existing.last_seen_at !== updatedAgent.last_seen_at
			
			if (hasChanged) {
				console.log('Agent status changed:', updatedAgent.id, existing.status, '->', updatedAgent.status)
				return prev.map((a) => (a.id === updatedAgent.id ? updatedAgent : a))
			}
			
			return prev
		})
		setLastUpdate(new Date())
	}, [])

	const connectWebSocket = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.close()
		}

		setWsStatus('connecting')
		const wsUrl = BACKEND_BASE.replace('http', 'ws') + '/ws'
		const ws = new WebSocket(wsUrl)
		wsRef.current = ws

		ws.onopen = () => {
			setWsStatus('connected')
			reconnectAttemptsRef.current = 0
			console.log('WebSocket connected successfully')
			
			// Keep-alive ping
			const interval = setInterval(() => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send('ping')
				}
			}, 15000)
			;(ws as any)._keepAlive = interval
		}

		ws.onmessage = (event) => {
			try {
				const msg: WebSocketMessage = JSON.parse(event.data)
				console.log('WebSocket message received:', msg)
				
				if (msg.type === 'agent_status_changed' && msg.agent) {
					updateAgent(msg.agent)
				}
			} catch (e) {
				console.error('Failed to parse WebSocket message:', e, 'Raw data:', event.data)
			}
		}

		ws.onclose = (event) => {
			setWsStatus('disconnected')
			const interval = (ws as any)._keepAlive
			if (interval) clearInterval(interval)
			
			console.log('WebSocket closed:', event.code, event.reason)
			
			// Auto-reconnect with exponential backoff
			if (reconnectAttemptsRef.current < maxReconnectAttempts) {
				const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000)
				reconnectAttemptsRef.current++
				
				if (reconnectTimeoutRef.current) {
					clearTimeout(reconnectTimeoutRef.current)
				}
				reconnectTimeoutRef.current = setTimeout(() => {
					console.log(`Reconnecting... Attempt ${reconnectAttemptsRef.current}`)
					connectWebSocket()
				}, delay)
			} else {
				setWsStatus('error')
				console.error('Max reconnection attempts reached')
			}
		}

		ws.onerror = (error) => {
			setWsStatus('error')
			console.error('WebSocket error:', error)
		}
	}, [updateAgent])

	useEffect(() => {
		loadAgents()
		connectWebSocket()

		return () => {
			if (wsRef.current) {
				wsRef.current.close()
			}
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current)
			}
		}
	}, [loadAgents, connectWebSocket])

	const getStatusColor = (status: string) => {
		return status === 'active' ? '#2e7d32' : '#c62828'
	}

	const getStatusIcon = (status: string) => {
		return status === 'active' ? '🟢' : '🔴'
	}

	const handleRefresh = () => {
		loadAgents()
	}

	return (
		<div style={{ padding: 24 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
				<h2>Agent Station</h2>
				<div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
					<button 
						onClick={handleRefresh}
						style={{
							padding: '8px 16px',
							backgroundColor: '#1976d2',
							color: 'white',
							border: 'none',
							borderRadius: '4px',
							cursor: 'pointer'
						}}
					>
						🔄 Refresh
					</button>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<div style={{
							width: '12px',
							height: '12px',
							borderRadius: '50%',
							backgroundColor: wsStatus === 'connected' ? '#4caf50' : 
											wsStatus === 'connecting' ? '#ff9800' : 
											wsStatus === 'error' ? '#f44336' : '#9e9e9e'
						}} />
						<span style={{ fontSize: '14px', color: '#666' }}>
							{wsStatus === 'connected' ? 'Connected' : 
							 wsStatus === 'connecting' ? 'Connecting...' : 
							 wsStatus === 'error' ? 'Connection Error' : 'Disconnected'}
						</span>
					</div>
					{lastUpdate && (
						<span style={{ fontSize: '14px', color: '#666' }}>
							Last update: {lastUpdate.toLocaleTimeString()}
						</span>
					)}
				</div>
			</div>

			<table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
				<thead>
					<tr style={{ backgroundColor: '#f5f5f5' }}>
						<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Status</th>
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
							<td style={{ padding: '12px', textAlign: 'center' }}>
								<span style={{ fontSize: '16px' }}>{getStatusIcon(agent.status)}</span>
							</td>
							<td style={{ padding: '12px' }}>{agent.id}</td>
							<td style={{ padding: '12px' }}>{agent.name}</td>
							<td style={{ padding: '12px' }}>{agent.endpoint}</td>
							<td style={{ 
								padding: '12px', 
								color: getStatusColor(agent.status),
								fontWeight: 600 
							}}>
								{agent.status}
							</td>
							<td style={{ padding: '12px', color: '#666' }}>
								{agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : '-'}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			
			{agents.length === 0 && (
				<div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
					No agents found
				</div>
			)}

			{wsStatus === 'disconnected' && reconnectAttemptsRef.current < maxReconnectAttempts && (
				<div style={{ 
					textAlign: 'center', 
					padding: '20px', 
					color: '#ff9800',
					backgroundColor: '#fff3e0',
					borderRadius: '4px',
					marginTop: '20px'
				}}>
					WebSocket disconnected. Reconnecting in {Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000) / 1000} seconds... (Attempt {reconnectAttemptsRef.current}/{maxReconnectAttempts})
				</div>
			)}

			{wsStatus === 'error' && (
				<div style={{ 
					textAlign: 'center', 
					padding: '20px', 
					color: '#f44336',
					backgroundColor: '#ffebee',
					borderRadius: '4px',
					marginTop: '20px'
				}}>
					WebSocket connection error. Max reconnection attempts reached. Please refresh the page.
				</div>
			)}
		</div>
	)
}