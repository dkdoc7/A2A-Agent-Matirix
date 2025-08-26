#!/usr/bin/env python3
"""
파이썬 디버거로 FastAPI 애플리케이션을 시작하는 스크립트
"""
import os
import sys
import uvicorn
from pathlib import Path

# 프로젝트 루트 디렉토리를 Python 경로에 추가
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# 환경 변수 설정
os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["AGENT_DATA_FILE"] = "data/agents.json"
os.environ["PING_INTERVAL_SECONDS"] = "3"

# 로그 출력 제어
os.environ["UVICORN_LOG_LEVEL"] = "error"  # uvicorn 로그 레벨
os.environ["PYTHONPATH"] = str(project_root)  # Python 경로 설정

if __name__ == "__main__":
    # 명령행 인수로 로그 레벨 제어
    log_level = "error"  # 기본값: error만 표시
    if "--quiet" in sys.argv:
        log_level = "critical"  # critical만 표시 (거의 모든 로그 숨김)
    elif "--verbose" in sys.argv:
        log_level = "info"  # info 이상 표시
    elif "--debug" in sys.argv:
        log_level = "debug"  # 모든 로그 표시
    
    print("🔧 디버그 모드로 FastAPI 애플리케이션을 시작합니다...")
    print(f"📁 프로젝트 루트: {project_root}")
    print(f"🌐 서버 주소: http://localhost:8000")
    print(f"📚 API 문서: http://localhost:8000/docs")
    print(f"📝 로그 레벨: {log_level}")
    print("=" * 50)
    
    # 디버그 모드로 uvicorn 실행 (로그 최소화)
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level=log_level,  # 동적으로 설정된 로그 레벨 사용
        access_log=False,   # HTTP 액세스 로그 비활성화
        use_colors=False    # 색상 출력 비활성화
    )
