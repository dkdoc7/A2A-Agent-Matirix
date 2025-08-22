import asyncio
import json
import os
from datetime import datetime
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
        async with self._lock:
            self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        stale: List[WebSocket] = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)
        for s in stale:
            await self.disconnect(s)


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
                    agents[idx] = agent.model_dump()
                    updated = True
                    break
            if not updated:
                agents.append(agent.model_dump())
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
                    if old_status == status and old_last_seen == last_seen_at:
                        return None
                    a["status"] = status
                    a["last_seen_at"] = last_seen_at
                    agents[idx] = a
                    data["agents"] = agents
                    self._write(data)
                    return Agent(**a)
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
    return agent


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)


async def ping_loop() -> None:
    async with httpx.AsyncClient(timeout=2.0) as client:
        while True:
            try:
                agents = await store.list_agents()
                for agent in agents:
                    try:
                        resp = await client.get(str(agent.endpoint).rstrip("/") + "/ping")
                        if resp.status_code == 200:
                            now = datetime.utcnow().isoformat() + "Z"
                            updated = await store.set_status(agent.id, AgentStatus.ACTIVE, now)
                            if updated is not None:
                                await manager.broadcast({
                                    "type": "agent_status_changed",
                                    "agent": updated.model_dump(),
                                })
                        else:
                            updated = await store.set_status(agent.id, AgentStatus.INACTIVE, agent.last_seen_at)
                            if updated is not None:
                                await manager.broadcast({
                                    "type": "agent_status_changed",
                                    "agent": updated.model_dump(),
                                })
                    except Exception:
                        updated = await store.set_status(agent.id, AgentStatus.INACTIVE, agent.last_seen_at)
                        if updated is not None:
                            await manager.broadcast({
                                "type": "agent_status_changed",
                                "agent": updated.model_dump(),
                            })
            except Exception:
                pass
            await asyncio.sleep(PING_INTERVAL_SECONDS)