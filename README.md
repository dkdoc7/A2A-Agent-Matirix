# A2A-Agent-Matrix

A2A (Agent-to-Agent) discovery service for managing and monitoring agent connections.

## 프로젝트 구조

```
A2A-Agent-Matrix/
├── backend/          # FastAPI 백엔드
├── frontend/         # React 프론트엔드
└── README.md
```

## 백엔드 API

### 기본 정보
- **Framework**: FastAPI
- **Port**: 8000
- **Base URL**: `http://localhost:8000`

### API 엔드포인트

#### 1. Discovery Info
```
GET /
```
서비스의 프로토콜 정보와 사용 가능한 엔드포인트를 반환합니다.

**응답 예시:**
```json
{
  "protocol": "A2A",
  "version": "1.0",
  "endpoints": {
    "list_agents": "/agents",
    "register_agent": "/agent",
    "ws": "/ws"
  }
}
```

#### 2. Agent 목록 조회
```
GET /agents
```
등록된 모든 에이전트 목록을 반환합니다.

**쿼리 파라미터:**
- `status` (optional): `active` 또는 `inactive`로 필터링

**응답 예시:**
```json
{
  "agents": [
    {
      "id": "agent-001",
      "name": "Test Agent",
      "endpoint": "http://localhost:3000",
      "status": "active",
      "last_seen_at": "2024-01-01T12:00:00Z"
    }
  ]
}
```

#### 3. Agent 등록
```
POST /agent
```
새로운 에이전트를 등록합니다.

**요청 본문:**
```json
{
  "id": "agent-001",
  "name": "Test Agent",
  "endpoint": "http://localhost:3000"
}
```

**응답 예시:**
```json
{
  "id": "agent-001",
  "name": "Test Agent",
  "endpoint": "http://localhost:3000",
  "status": "inactive",
  "last_seen_at": null
}
```

#### 4. WebSocket 연결
```
WebSocket /ws
```
실시간 에이전트 상태 변경 알림을 받기 위한 WebSocket 연결입니다.

**메시지 타입:**
- `agent_status_changed`: 에이전트 상태가 변경되었을 때

**메시지 예시:**
```json
{
  "type": "agent_status_changed",
  "agent": {
    "id": "agent-001",
    "name": "Test Agent",
    "endpoint": "http://localhost:3000",
    "status": "active",
    "last_seen_at": "2024-01-01T12:00:00Z"
  }
}
```

### 에이전트 상태

- **ACTIVE**: 에이전트가 온라인이고 응답 가능한 상태
- **INACTIVE**: 에이전트가 오프라인이거나 응답하지 않는 상태

### 자동 상태 감지

백엔드는 3초마다 등록된 모든 에이전트에 ping 요청을 보내 상태를 자동으로 감지합니다.

## 프론트엔드

- **Framework**: React + Vite
- **Port**: 5173
- **URL**: `http://localhost:5173`

## 실행 방법

### 백엔드 실행
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 프론트엔드 실행
```bash
cd frontend
npm install
npm run dev
```

## API 문서

FastAPI 자동 생성 문서는 다음 URL에서 확인할 수 있습니다:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
