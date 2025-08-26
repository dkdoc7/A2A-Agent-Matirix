#!/usr/bin/env bash
set -euo pipefail

echo "🔧 파이썬 디버거로 FastAPI 애플리케이션을 시작합니다..."
echo "📁 현재 디렉토리: $(pwd)"
echo "🐍 Python 버전: $(python3 --version)"
echo "=" * 50

# 환경 변수 설정
export PYTHONUNBUFFERED=1
export AGENT_DATA_FILE="data/agents.json"
export PING_INTERVAL_SECONDS=3

# 디버그 모드로 실행
python3 debug.py
