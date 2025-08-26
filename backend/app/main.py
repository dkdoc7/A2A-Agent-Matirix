import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, field_validator

DATA_FILE = os.environ.get("AGENT_DATA_FILE", "data/agents.json")
PING_INTERVAL_SECONDS = int(os.environ.get("PING_INTERVAL_SECONDS", "3"))


class AgentStatus:
    ACTIVE = "active"
    INACTIVE = "inactive"


class Agent(BaseModel):
    id: str
    name: str
    endpoint: HttpUrl
    status: str = AgentStatus.INACTIVE
    last_seen_at: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        if value not in {AgentStatus.ACTIVE, AgentStatus.INACTIVE}:
            raise ValueError("Invalid status")
        return value
    
    def to_dict(self) -> dict:
        """JSON 직렬화 가능한 딕셔너리로 변환"""
        data = self.model_dump()
        data['endpoint'] = str(data['endpoint'])
        return data


class AgentRegisterRequest(BaseModel):
    id: str
    name: str
    endpoint: HttpUrl


class AgentListResponse(BaseModel):
    agents: List[Agent]


class DiscoveryInfo(BaseModel):
    protocol: str
    version: str
    endpoints: Dict[str, str]


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        #await websocket.send_json({"type": "agent_status_changed", "agent":"123","message": "WebSocket connected successfully", "timestamp": datetime.now(timezone.utc).isoformat()})       
        async with self._lock:
            self.active_connections.append(websocket)
            print(f"🔗 WebSocket connected. Total connections: {len(self.active_connections)}")
            print(f"   Connection ID: {id(websocket)}")
            print(f"   Client: {websocket.client.host}:{websocket.client.port}")
            if hasattr(websocket, 'client_state'):
                print(f"   State: {websocket.client_state.name} (value: {websocket.client_state.value})")
            else:
                print(f"   State: Unknown (no client_state attribute)")

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
                print(f"🔌 WebSocket disconnected. Total connections: {len(self.active_connections)}")
                print(f"   Connection ID: {id(websocket)}")
                print(f"   Client: {websocket.client.host}:{websocket.client.port}")

    async def broadcast(self, message: dict) -> None:
        print(f"Broadcasting message to {len(self.active_connections)} connections: {message}")
        stale: List[WebSocket] = []
        
        for connection in list(self.active_connections):
            try:
                # 더 안전한 연결 상태 확인
                if hasattr(connection, 'client_state') and connection.client_state.value == 1:
                    # 연결 상태가 CONNECTED인 경우
                    await connection.send_json(message)
                    print(f"✅ Message sent successfully to connection {id(connection)}")
                else:
                    # 연결 상태를 확인할 수 없거나 CONNECTED가 아닌 경우
                    print(f"⚠️ Connection {id(connection)} state unclear, attempting to send anyway...")
                    try:
                        await connection.send_json(message)
                        print(f"✅ Message sent successfully to connection {id(connection)} (after retry)")
                    except Exception as retry_error:
                        print(f"❌ Retry failed for connection {id(connection)}: {retry_error}")
                        stale.append(connection)
            except Exception as e:
                print(f"❌ Failed to send message to connection {id(connection)}: {e}")
                stale.append(connection)
        
        # 끊어진 연결들 정리
        for s in stale:
            print(f"🗑️ Removing stale connection {id(s)}")
            await self.disconnect(s)
        
        print(f"📡 Broadcast completed. Active connections: {len(self.active_connections)}")


class AgentStore:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = asyncio.Lock()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        if not os.path.exists(self.path):
            self._write({"agents": []})

    def _read_sync(self) -> dict:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return {"agents": []}

    def _write(self, data: dict) -> None:
        tmp_path = self.path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.path)

    async def list_agents(self) -> List[Agent]:
        async with self._lock:
            data = self._read_sync()
            return [Agent(**a) for a in data.get("agents", [])]

    async def upsert_agent(self, agent: Agent) -> None:
        async with self._lock:
            data = self._read_sync()
            agents = data.get("agents", [])
            updated = False
            for idx, a in enumerate(agents):
                if a["id"] == agent.id:
                    agent_dict = agent.model_dump()
                    agent_dict['endpoint'] = str(agent_dict['endpoint'])
                    agents[idx] = agent_dict
                    updated = True
                    break
            if not updated:
                agent_dict = agent.model_dump()
                agent_dict['endpoint'] = str(agent_dict['endpoint'])
                agents.append(agent_dict)
            data["agents"] = agents
            self._write(data)

    async def set_status(self, agent_id: str, status: str, last_seen_at: Optional[str]) -> Optional[Agent]:
        async with self._lock:
            data = self._read_sync()
            agents = data.get("agents", [])
            for idx, a in enumerate(agents):
                if a["id"] == agent_id:
                    old_status = a.get("status")
                    old_last_seen = a.get("last_seen_at")
                    if old_status == status : #시간까지는 필요 없음 and old_last_seen == last_seen_at:
                        return None
                    a["status"] = status
                    a["last_seen_at"] = last_seen_at
                    agents[idx] = a
                    data["agents"] = agents
                    self._write(data)
                    
                    # endpoint를 문자열로 변환하여 반환 (JSON 직렬화 문제 해결)
                    agent_dict = a.copy()
                    if 'endpoint' in agent_dict:
                        agent_dict['endpoint'] = str(agent_dict['endpoint'])
                    return Agent(**agent_dict)
        return None


app = FastAPI(title="Agent Station", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()
store = AgentStore(DATA_FILE)


@app.on_event("startup")
async def startup_event() -> None:
    asyncio.create_task(ping_loop())


@app.get("/", response_model=DiscoveryInfo)
async def get_root_info() -> DiscoveryInfo:
    return DiscoveryInfo(
        protocol="A2A",
        version="1.0",
        endpoints={
            "list_agents": "/agents",
            "register_agent": "/agent",
            "ws": "/ws",
        },
    )


@app.get("/agents", response_model=AgentListResponse)
async def list_agents(status: Optional[str] = Query(None, description="Filter by status: active|inactive")) -> AgentListResponse:
    agents = await store.list_agents()
    if status in {AgentStatus.ACTIVE, AgentStatus.INACTIVE}:
        agents = [a for a in agents if a.status == status]
    return AgentListResponse(agents=agents)


@app.post("/agent", response_model=Agent)
async def register_agent(req: AgentRegisterRequest) -> Agent:
    agent = Agent(id=req.id, name=req.name, endpoint=req.endpoint, status=AgentStatus.INACTIVE)
    await store.upsert_agent(agent)
    
    # WebSocket을 통해 새로운 에이전트 등록을 브로드캐스트
    await manager.broadcast({
        "type": "agent_status_changed",
        "agent": agent.to_dict(),
    })
    
    return agent


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    print(f"🔌 WebSocket connection attempt from {websocket.client.host}:{websocket.client.port}")
    
    try:
        await manager.connect(websocket)
        print(f"✅ WebSocket connected successfully. Total connections: {len(manager.active_connections)}")
        
        # 연결 확인 메시지 전송
        try:
            await websocket.send_json({
                "type": "connection_established",
                "message": "WebSocket connected successfully",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            print(f"📤 Connection confirmation message sent to {id(websocket)}")
        except Exception as e:
            print(f"❌ Failed to send connection confirmation: {e}")
        
        # 메시지 수신 대기
        while True:
            try:
                data = await websocket.receive_text()
                print(f"📨 Received message from client {id(websocket)}: {data}")
                
                # 에코 메시지로 응답 (연결 상태 확인용)
                try:
                    await websocket.send_json({
                        "type": "echo",
                        "message": data,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                    print(f"📤 Echo response sent to {id(websocket)}")
                except Exception as echo_error:
                    print(f"❌ Failed to send echo response: {echo_error}")
                    break
                
            except WebSocketDisconnect:
                print(f"🔌 WebSocket disconnected by client {id(websocket)}")
                break
            except Exception as e:
                print(f"❌ Error in WebSocket message handling for {id(websocket)}: {e}")
                break
                
    except Exception as e:
        print(f"❌ Error in WebSocket connection for {id(websocket)}: {e}")
    finally:
        await manager.disconnect(websocket)
        print(f"🧹 WebSocket cleanup completed for {id(websocket)}. Total connections: {len(manager.active_connections)}")


@app.get("/debug/websocket")
async def debug_websocket():
    """WebSocket 연결 상태를 디버깅하기 위한 엔드포인트"""
    return {
        "active_connections": len(manager.active_connections),
        "connection_details": [
            {
                "id": id(conn),
                "client": f"{conn.client.host}:{conn.client.port}" if conn.client else "Unknown",
                "state": conn.client_state.name if hasattr(conn, 'client_state') else "Unknown"
            }
            for conn in manager.active_connections
        ],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/debug/broadcast")
async def debug_broadcast(message: dict):
    """테스트 메시지를 브로드캐스트하는 디버그 엔드포인트"""
    await manager.broadcast({
        "type": "debug_message",
        "content": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    return {"message": "Broadcast sent", "active_connections": len(manager.active_connections)}


@app.post("/debug/send_direct")
async def debug_send_direct(connection_id: int, message: dict):
    """특정 WebSocket 연결로 직접 메시지를 전송하는 디버그 엔드포인트"""
    for conn in manager.active_connections:
        if id(conn) == connection_id:
            try:
                await conn.send_json({
                    "type": "direct_message",
                    "content": message,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })
                return {"message": f"Direct message sent to connection {connection_id}", "success": True}
            except Exception as e:
                return {"message": f"Failed to send direct message: {e}", "success": False}
    
    return {"message": f"Connection {connection_id} not found", "success": False}


@app.get("/debug/connections")
async def debug_connections():
    """현재 활성 WebSocket 연결들의 상세 정보를 반환"""
    connections = []
    for conn in manager.active_connections:
        try:
            connections.append({
                "id": id(conn),
                "client": f"{conn.client.host}:{conn.client.port}" if conn.client else "Unknown",
                "state": conn.client_state.name if hasattr(conn, 'client_state') else "Unknown",
                "state_value": conn.client_state.value if hasattr(conn, 'client_state') else "Unknown"
            })
        except Exception as e:
            connections.append({
                "id": id(conn),
                "client": "Error",
                "state": "Error",
                "state_value": str(e)
            })
    
    return {
        "total_connections": len(manager.active_connections),
        "connections": connections,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


async def ping_loop() -> None:
    async with httpx.AsyncClient(timeout=2.0) as client:
        while True:
            try:
                agents = await store.list_agents()
                for agent in agents:
                    try:
                        resp = await client.get(str(agent.endpoint).rstrip("/") + "/ping")
                        if resp.status_code == 200:
                            # ping 정상응답
                            now = datetime.now(timezone.utc).isoformat()
                            updated = await store.set_status(agent.id, AgentStatus.ACTIVE, now)
                            if updated is not None: #상태가 바뀐경우 (Inactive -> Active)
                                print(f"agent {agent.id} activated!")
                                await manager.broadcast({
                                    "type": "agent_status_changed",
                                    "agent": updated.to_dict(),
                                })
                        else:
                            updated = await store.set_status(agent.id, AgentStatus.INACTIVE, agent.last_seen_at)
                            if updated is not None: #상태가 바뀐경우 (Active -> Inactive)
                                print(f"agent {agent.id} deactivated!")
                                await manager.broadcast({
                                    "type": "agent_status_changed",
                                    "agent": updated.to_dict(),
                                })
                    except Exception:
                        updated = await store.set_status(agent.id, AgentStatus.INACTIVE, agent.last_seen_at)
                        if updated is not None: #상태가 바뀐경우 (Active -> Inactive)
                            print(f"agent {agent.id} deactivated!")
                            await manager.broadcast({
                                "type": "agent_status_changed",
                                    "agent": updated.to_dict(),
                            })
            except Exception:
                pass
            await asyncio.sleep(PING_INTERVAL_SECONDS)


if __name__ == "__main__":
    import uvicorn
    import sys
    
    # 로그 레벨 제어
    log_level = "info"  # 기본값
    if "--quiet" in sys.argv:
        log_level = "critical"
    elif "--error" in sys.argv:
        log_level = "error"
    elif "--debug" in sys.argv:
        log_level = "debug"
        import logging
        #logging.basicConfig(level=logging.DEBUG)
        print("Debug mode enabled")
    
    print(f"Log level: {log_level}")
    
    # 개발 서버 실행
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level=log_level,
        access_log=False if "--quiet" in sys.argv else True
    )