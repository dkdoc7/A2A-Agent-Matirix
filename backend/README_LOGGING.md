# 📝 로그 제어 가이드

## 🔇 로그 출력 최소화 방법

### **1. debug.py 사용 (권장)**

#### **조용한 모드 (최소 로그)**
```bash
python3 debug.py --quiet
```
- `critical` 레벨만 표시
- HTTP 액세스 로그 비활성화
- 색상 출력 비활성화

#### **에러만 표시 (기본값)**
```bash
python3 debug.py
```
- `error` 레벨만 표시
- HTTP 액세스 로그 비활성화

#### **상세 정보 표시**
```bash
python3 debug.py --verbose
```
- `info` 레벨 이상 표시

#### **모든 로그 표시**
```bash
python3 debug.py --debug
```
- `debug` 레벨까지 모든 로그 표시

### **2. app/main.py 직접 실행**

#### **조용한 모드**
```bash
python3 app/main.py --quiet
```

#### **에러만 표시**
```bash
python3 app/main.py --error
```

#### **기본 정보 표시**
```bash
python3 app/main.py
```

#### **디버그 모드**
```bash
python3 app/main.py --debug
```

## 📊 로그 레벨 설명

| 레벨 | 설명 | 출력되는 로그 |
|------|------|---------------|
| `critical` | 치명적 오류 | 심각한 시스템 오류만 |
| `error` | 오류 | 오류 및 예외 상황 |
| `warning` | 경고 | 경고 메시지 |
| `info` | 정보 | 일반적인 정보 메시지 |
| `debug` | 디버그 | 상세한 디버그 정보 |

## 🎯 권장 설정

### **개발 중 (로컬)**
```bash
python3 debug.py --verbose
```

### **테스트 중**
```bash
python3 debug.py --error
```

### **프로덕션/프레젠테이션**
```bash
python3 debug.py --quiet
```

## 🔧 환경 변수로 제어

```bash
# 환경 변수로 로그 레벨 설정
export UVICORN_LOG_LEVEL=error
python3 debug.py
```

## 📱 WebSocket 로그 제어

WebSocket 관련 로그도 로그 레벨에 따라 제어됩니다:

- **--quiet**: 연결/해제만 표시
- **--error**: 오류 상황만 표시  
- **--verbose**: 모든 WebSocket 활동 표시
- **--debug**: 상세한 디버그 정보 표시
