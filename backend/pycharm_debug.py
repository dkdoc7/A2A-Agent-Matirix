#!/usr/bin/env python3
"""
PyCharm에서 디버깅을 위한 실행 스크립트
"""
import os
import sys
from pathlib import Path

# 프로젝트 루트를 Python 경로에 추가
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# 환경 변수 설정
os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["AGENT_DATA_FILE"] = "data/agents.json"
os.environ["PING_INTERVAL_SECONDS"] = "3"

def main():
    """메인 함수 - 여기에 브레이크포인트를 설정할 수 있습니다"""
    print("🔧 PyCharm 디버그 모드로 시작합니다...")
    
    # 애플리케이션 가져오기
    from app.main import app
    
    print(f"✅ FastAPI 애플리케이션이 로드되었습니다: {app.title}")
    print(f"🌐 서버 주소: http://localhost:8000")
    print(f"📚 API 문서: http://localhost:8000/docs")
    
    # uvicorn으로 서버 실행
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="debug"
    )

if __name__ == "__main__":
    main()
