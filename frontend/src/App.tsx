import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'

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
	const [selectedIds, setSelectedIds] = useState<string[]>([])
	const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const reconnectTimeoutRef = useRef<number | null>(null)
	const reconnectAttemptsRef = useRef(0)
	const maxReconnectAttempts = 5
	const bcRef = useRef<BroadcastChannel | null>(null)

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
				// 새로운 에이전트 추가 시에만 업데이트 시간 갱신
				setLastUpdate(new Date())
				return [...prev, updatedAgent]
			}
			
			const hasChanged = existing.status !== updatedAgent.status || 
							  existing.last_seen_at !== updatedAgent.last_seen_at
			
			if (hasChanged) {
				// 상태가 실제로 바뀐 경우에만 업데이트 시간 갱신
				setLastUpdate(new Date())
				return prev.map((a) => (a.id === updatedAgent.id ? updatedAgent : a))
			}
			
			return prev
		})
	}, [])

	const connectWebSocket = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.close()
		}

		//setWsStatus('connecting')
		const wsUrl = BACKEND_BASE.replace('http', 'ws') + '/ws'
		const ws = new WebSocket(wsUrl)
		wsRef.current = ws

		ws.onopen = () => {
			setWsStatus('connected')
			reconnectAttemptsRef.current = 0
			console.log('WebSocket connected successfully')
		}

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data)
				console.log('WebSocket message received:', msg)
				
				if (msg.type === 'agent_status_changed') {
					if(msg.agent)
					{
						updateAgent(msg.agent)
					}
				}
				// 새 채팅 이벤트를 모든 스니프 창으로 전달
				if (msg.type === 'chat_message') {
					if (!bcRef.current) {
						bcRef.current = new BroadcastChannel('agentmatrix-chat')
					}
					try {
						bcRef.current.postMessage({ source: 'app', payload: msg })
						console.log('Broadcasted chat_message via BroadcastChannel', msg)
					} catch (e) {
						console.error('Failed to broadcast chat_message', e)
					}
				}
			} catch (e) {
				console.error('Failed to parse WebSocket message:', e, 'Raw data:', event.data)
			}
		}

		ws.onclose = (event) => {
			console.log('WebSocket closed:', event.code, event.reason)
			setWsStatus('disconnected')
			
			// Auto-reconnect with exponential backoff
			if (reconnectAttemptsRef.current < maxReconnectAttempts) {
				const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000)
				reconnectAttemptsRef.current++
				
				if (reconnectTimeoutRef.current) {
					clearTimeout(reconnectTimeoutRef.current)
				}
				reconnectTimeoutRef.current = window.setTimeout(() => {
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
		// BroadcastChannel 초기화
		bcRef.current = new BroadcastChannel('agentmatrix-chat')
		connectWebSocket()

		return () => {
			if (wsRef.current) {
				wsRef.current.close()
			}
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current)
			}
			if (bcRef.current) {
				try { bcRef.current.close() } catch {}
				bcRef.current = null
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

	const toggleSelect = (agentId: string, checked: boolean) => {
		setSelectedIds((prev) => {
			if (checked) {
				if (prev.includes(agentId)) return prev
				return [...prev, agentId]
			} else {
				return prev.filter((id) => id !== agentId)
			}
		})
	}

	const selectedAgents = useMemo(() => {
		const idSet = new Set(selectedIds)
		return agents.filter((a) => idSet.has(a.id))
	}, [agents, selectedIds])

	const handleSniff = () => {
		if (selectedIds.length < 2) return
		const hostId = selectedIds[0]
		const now = new Date()
		const pad = (n: number, len = 2) => String(n).padStart(len, '0')
		const sidTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${pad(now.getMilliseconds(),3)}`
		const sid = encodeURIComponent(`${hostId}-${sidTime}`)
		const url = `${window.location.origin}/?sniff=1&agents=${encodeURIComponent(selectedIds.join(','))}&host=${encodeURIComponent(hostId)}&sid=${sid}`
		window.open(url, '_blank', 'noopener')
	}

	return (
		<div style={{ padding: 24 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
				<h2>Agent Station</h2>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
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
						<button 
							onClick={handleSniff}
							disabled={selectedIds.length < 2}
							style={{
								padding: '8px 16px',
								backgroundColor: selectedIds.length < 2 ? '#90a4ae' : '#6a1b9a',
								color: 'white',
								border: 'none',
								borderRadius: '4px',
								cursor: selectedIds.length < 2 ? 'not-allowed' : 'pointer'
							}}
							title={selectedIds.length < 2 ? '두 명 이상 선택하세요' : '선택한 에이전트 스니핑'}
						>
							🕵️ Sniff ({selectedIds.length})
						</button>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<div style={{
							width: '12px',
							height: '12px',
							borderRadius: '50%',
							transition: 'background-color 200ms ease',
							backgroundColor: wsStatus === 'connected' ? '#4caf50' : 
										wsStatus === 'connecting' ? '#ff9800' : 
										wsStatus === 'error' ? '#f44336' : '#9e9e9e'
						}} />
						{lastUpdate && (
							<span style={{ fontSize: '14px', color: '#666' }}>
								· Last update: {lastUpdate.toLocaleTimeString()}
							</span>
						)}
					</div>
				</div>
			</div>

			<table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
				<thead>
					<tr style={{ backgroundColor: '#f5f5f5' }}>
						<th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #ddd', width: '60px' }}>Select</th>
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
								<input 
									type="checkbox" 
									checked={selectedIds.includes(agent.id)} 
									onChange={(e) => toggleSelect(agent.id, e.target.checked)}
									title={selectedIds.length === 0 ? '처음 선택된 에이전트가 방장(오른쪽)' : ''}
								/>
							</td>
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

			{selectedAgents.length > 0 && (
				<div style={{ marginTop: '12px', color: '#555', fontSize: 14 }}>
					선택됨: {selectedAgents.map(a => a.name || a.id).join(', ')} {selectedIds.length > 0 && `(방장: ${selectedAgents.find(a=>a.id===selectedIds[0])?.name || selectedIds[0]})`}
				</div>
			)}
			
			{agents.length === 0 && (
				<div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
					No agents found
				</div>
			)}


		</div>
	)
}