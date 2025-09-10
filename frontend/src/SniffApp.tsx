/// <reference types="vite/client" />
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

interface ChatEvent {
	role: 'host' | 'peer' | 'system'
	senderId: string
	senderName?: string
	direction: 'in' | 'out'
	text: string
	timestamp: number
}

interface AgentInfo {
	id: string
	name?: string
}

const BACKEND_BASE = (import.meta.env.VITE_BACKEND_BASE as string) || 'http://localhost:8000'

export const SniffApp: React.FC = () => {
	const params = new URLSearchParams(window.location.search)
	const agentIdsParam = params.get('agents') || ''
	const hostId = params.get('host') || ''
	const agentIds = useMemo(() => agentIdsParam.split(',').filter(Boolean), [agentIdsParam])

	const [agentsMap, setAgentsMap] = useState<Record<string, AgentInfo>>({})
	const [events, setEvents] = useState<ChatEvent[]>([])
	const [connected, setConnected] = useState<'connecting' | 'connected' | 'error'>('connecting')
	const wsRef = useRef<WebSocket | null>(null)
	const listEndRef = useRef<HTMLDivElement | null>(null)
	const chainIdRef = useRef(0)
	const timeoutsRef = useRef<number[]>([])
	const firstStepScheduledRef = useRef(false)

	useEffect(() => {
		// 에이전트 메타 정보 로드 (이름 표시용)
		const loadAgents = async () => {
			try {
				const resp = await fetch(`${BACKEND_BASE}/agents`)
				const data = await resp.json()
				const map: Record<string, AgentInfo> = {}
				for (const a of data.agents || []) {
					map[a.id] = { id: a.id, name: a.name }
				}
				setAgentsMap(map)
			} catch (e) {
				// 무시: 이름 없이도 동작
			}
		}
		loadAgents()
	}, [])

	useEffect(() => {
		const wsUrl = BACKEND_BASE.replace('http', 'ws') + '/ws'
		const ws = new WebSocket(wsUrl)
		wsRef.current = ws
		setConnected('connecting')

		ws.onopen = () => setConnected('connected')
		ws.onerror = () => setConnected('error')
		ws.onclose = () => setConnected('error')
		ws.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data)
				// 데모: 백엔드 브로드캐스트/에코를 채팅 이벤트로 매핑
				if (msg.type === 'agent_status_changed') {
					const a = msg.agent
					const isInSelected = agentIds.includes(a.id)
					if (!isInSelected) return
					const role: 'host' | 'peer' = a.id === hostId ? 'host' : 'peer'
					const text = `status -> ${a.status}`
					appendEvent({ role, senderId: a.id, senderName: a.name, direction: 'in', text })
				}
				if (msg.type === 'echo') {
					appendEvent({ role: 'system', senderId: 'system', direction: 'in', text: String(msg.message) })
				}
				if (msg.type === 'debug_message') {
					appendEvent({ role: 'system', senderId: 'system', direction: 'in', text: JSON.stringify(msg.content) })
				}
			} catch {}
		}

		return () => ws.close()
	}, [agentIdsParam, hostId])

	const appendEvent = useCallback((e: Omit<ChatEvent, 'timestamp'>) => {
		setEvents((prev) => [...prev, { ...e, timestamp: Date.now() }])
		setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
	}, [])

	// 초기 예제 대화 4개를 2초 간격으로 순차 표시 (StrictMode 안전, 첫 메시지 중복 방지)
	useEffect(() => {
		const safeHostId = hostId || 'host-1'
		const peersList = agentIds.filter((id) => id !== safeHostId)
		const samplePeer = peersList[0] || 'peer-1'
		const steps: Omit<ChatEvent, 'timestamp'>[] = [
			{ role: 'host', senderId: safeHostId, direction: 'out', text: '안녕! 스니핑 테스트를 시작할게.' },
			{ role: 'peer', senderId: samplePeer, direction: 'in', text: '네, 메시지 잘 수신됩니다.' },
			{ role: 'host', senderId: safeHostId, direction: 'out', text: '현재 상태 보고 부탁해.' },
			{ role: 'peer', senderId: samplePeer, direction: 'in', text: '모듈 정상 작동 중입니다.' },
		]

		// 기존 타이머 모두 해제
		timeoutsRef.current.forEach((t) => clearTimeout(t))
		timeoutsRef.current = []

		// 새로운 체인 ID 발급 (이전 예약 무효화)
		const myChainId = chainIdRef.current + 1
		chainIdRef.current = myChainId

		// StrictMode로 인한 이펙트 이중 실행에서 첫 메시지 중복 방지
		const startIndex = firstStepScheduledRef.current ? 1 : 0
		firstStepScheduledRef.current = true

		steps.forEach((evt, idx) => {
			if (idx < startIndex) return
			const tid = window.setTimeout(() => {
				if (chainIdRef.current !== myChainId) return
				appendEvent(evt)
			}, (idx - startIndex) * 2000)
			timeoutsRef.current.push(tid)
		})

		return () => {
			// 예약 취소 및 체인 무효화
			timeoutsRef.current.forEach((t) => clearTimeout(t))
			timeoutsRef.current = []
			chainIdRef.current += 1
		}
	}, [agentIdsParam, hostId, agentIds, appendEvent])

	const hostName = agentsMap[hostId]?.name || hostId
	const peers = agentIds.filter((id) => id !== hostId)

	const formatTime = (ts: number) => {
		try {
			return new Date(ts).toLocaleTimeString()
		} catch {
			return ''
		}
	}

	return (
		<div style={{ display: 'flex', height: '100vh', width: '640px', margin: '0 auto', boxSizing: 'border-box' }}>
			<div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column' }}>
				<div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
					<div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
						<h3 style={{ margin: 0 }}>Participants</h3>
						<span style={{ color: '#666', fontSize: 12 }}>({peers.length})</span>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<h3 style={{ margin: 0, textAlign: 'right' }}>Host</h3>
						<div style={{ fontSize: 12, color: connected === 'connected' ? '#2e7d32' : '#c62828', textAlign: 'right' }}>
							{connected === 'connected' ? 'Connected' : connected === 'connecting' ? 'Connecting...' : 'Error'}
						</div>
					</div>
				</div>
				<div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
					<div style={{ color: '#666', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
						{peers.map(id => agentsMap[id]?.name || id).join(', ') || '-'}
					</div>
					<div style={{ color: '#666', textAlign: 'right' }}>{hostName}</div>
				</div>
				<div style={{ flex: 1, overflowY: 'auto', background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 12 }}>
					{events.map((e, idx) => {
						const isHost = e.role === 'host'
						const isSystem = e.role === 'system'
						return (
							<div key={idx} style={{ display: 'flex', justifyContent: isSystem ? 'center' : (isHost ? 'flex-end' : 'flex-start'), marginBottom: 10 }}>
								{isSystem ? (
									<div style={{ fontSize: 12, color: '#888' }}>{e.text}</div>
								) : (
									<div style={{ maxWidth: '70%' }}>
										<div style={{ fontSize: 12, color: '#888', display: 'flex', justifyContent: isHost ? 'flex-end' : 'flex-start', gap: 6 }}>
											{isHost ? (
												<>
													<span title={new Date(e.timestamp).toLocaleString()}>{formatTime(e.timestamp)}</span>
													<span>{agentsMap[e.senderId]?.name || e.senderId}</span>
												</>
											) : (
												<>
													<span>{agentsMap[e.senderId]?.name || e.senderId}</span>
													<span title={new Date(e.timestamp).toLocaleString()}>{formatTime(e.timestamp)}</span>
												</>
											)}
										</div>
										<div style={{ background: isHost ? '#e8f0fe' : '#fff', border: `1px solid ${isHost ? '#c3d4fd' : '#e0e0e0'}`, display: 'inline-block', padding: '7.2px 10px', borderRadius: 6 }}>
											{e.text}
										</div>
									</div>
								)}
							</div>
						)
					})}
					<div ref={listEndRef} />
				</div>
			</div>
		</div>
	)
}

export default SniffApp


