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
	const sid = params.get('sid') || ''
	const agentIds = useMemo(() => agentIdsParam.split(',').filter(Boolean), [agentIdsParam])

	const [agentsMap, setAgentsMap] = useState<Record<string, AgentInfo>>({})
	const [events, setEvents] = useState<ChatEvent[]>([])
	const [connected, setConnected] = useState<'connecting' | 'connected' | 'error'>('connecting')
	const wsRef = useRef<WebSocket | null>(null)
	const listEndRef = useRef<HTMLDivElement | null>(null)
	const bcRef = useRef<BroadcastChannel | null>(null)
	const processedMessagesRef = useRef<Set<string>>(new Set())

	const normalizeId = (v: string): string => {
		try {
			return decodeURIComponent(String(v ?? '')).trim()
		} catch {
			return String(v ?? '').trim()
		}
	}

	const appendEvent = useCallback((e: Omit<ChatEvent, 'timestamp'>) => {
		const withTs = { ...e, timestamp: Date.now() }
		console.log('[Sniff] appendEvent', withTs)
		setEvents((prev) => [...prev, withTs])
		setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
	}, [])

	const handleIncomingChat = useCallback((payload: any) => {
		if (!payload || payload.type !== 'chat_message') return
		const rawSender = String(payload.sender || '')
		const message = String(payload.message ?? '')
		const timestamp = payload.timestamp || Date.now()
		
		// 중복 메시지 방지: sender + message + timestamp 조합으로 고유 키 생성
		const messageKey = `${rawSender}-${message}-${timestamp}`
		if (processedMessagesRef.current.has(messageKey)) {
			console.log('[Sniff] Duplicate message ignored', messageKey)
			return
		}
		processedMessagesRef.current.add(messageKey)
		
		if (!rawSender) return
		// 참여자 필터링: host 또는 peers에 포함된 sender만 표시
		const isParticipant = rawSender === hostId || agentIds.includes(rawSender)
		if (!isParticipant) {
			console.log('[Sniff] Message ignored - sender not in participants', { rawSender, hostId, agentIds })
			return
		}
		const isHost = normalizeId(rawSender) === normalizeId(hostId)
		console.log('[Sniff] handleIncomingChat', { rawSender, hostId, isHost, message })
		appendEvent({ role: isHost ? 'host' : 'peer', senderId: rawSender, direction: 'in', text: message })
	}, [hostId, agentIds, appendEvent])

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
		// 히스토리 로딩
		const loadHistory = async () => {
			if (!sid) return
			try {
				const resp = await fetch(`${BACKEND_BASE}/chat/${encodeURIComponent(sid)}`)
				const data = await resp.json()
				if (Array.isArray(data.messages)) {
					const mapped: ChatEvent[] = data.messages.map((m: any) => {
						const isHost = normalizeId(m.sender) === normalizeId(hostId)
						console.log('[Sniff] loadHistory', { sender: m.sender, hostId, isHost, message: m.message })
						return {
							role: isHost ? 'host' : (m.sender === 'system' ? 'system' : 'peer'),
							senderId: m.sender,
							direction: 'in',
							text: m.message,
							timestamp: Date.parse(m.timestamp) || Date.now(),
						}
					})
					setEvents(mapped)
				}
			} catch (e) {
				console.log('[Sniff] failed to load history', e)
			}
		}
		loadHistory()
	}, [sid, hostId])

	useEffect(() => {
		// BroadcastChannel 구독: App 또는 다른 창에서 전달된 채팅 이벤트 처리
		bcRef.current = new BroadcastChannel('agentmatrix-chat')
		const bc = bcRef.current
		bc.onmessage = (ev) => {
			const data = ev.data
			const payload = data && typeof data === 'object' && 'payload' in data ? (data as any).payload : data
			console.log('[Sniff] BC message', payload)
			handleIncomingChat(payload)
		}
		return () => {
			try { bc.close() } catch {}
			bcRef.current = null
		}
	}, [handleIncomingChat])

	useEffect(() => {
		const wsUrl = BACKEND_BASE.replace('http', 'ws') + '/ws'
		const ws = new WebSocket(wsUrl)
		wsRef.current = ws
		setConnected('connecting')

		ws.onopen = () => { console.log('[Sniff] WS open', { sid, hostId, agentIds }); setConnected('connected') }
		ws.onerror = (e) => { console.log('[Sniff] WS error', e); setConnected('error') }
		ws.onclose = (e) => { console.log('[Sniff] WS close', e); setConnected('error') }
		ws.onmessage = (ev) => {
			console.log('[Sniff] WS message raw', ev.data)
			try {
				const msg = JSON.parse(ev.data)
				console.log('[Sniff] WS message parsed', msg)
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
				if (msg.type === 'chat_message') {
					// WS로 직접 수신한 경우에도 처리 및 재전송 (App 미존재 시 대비)
					handleIncomingChat(msg)
					try {
						if (!bcRef.current) bcRef.current = new BroadcastChannel('agentmatrix-chat')
						bcRef.current.postMessage({ source: 'sniff', payload: msg })
						console.log('[Sniff] Rebroadcasted chat_message via BroadcastChannel', msg)
					} catch {}
				}
			} catch {}
		}

		return () => ws.close()
	}, [agentIdsParam, hostId, sid, agentIds, appendEvent])


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
				{/* 방 제목 + 수정 버튼 */}
				<div style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: '#f5f5f5', borderRadius: 8, border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
					<h2 style={{ margin: 0, fontSize: '18px', color: '#333', textAlign: 'center', flex: 1 }}>
						{sid || 'Unknown Room'}
					</h2>
					<button
						style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
						onClick={() => {
							const input = window.prompt('세션 ID를 입력하세요(sid):', sid)
							if (!input) return
							try {
								const u = new URL(window.location.href)
								u.searchParams.set('sid', input)
								window.location.href = u.toString()
							} catch {}
						}}
					>
						수정
					</button>
				</div>
				
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


