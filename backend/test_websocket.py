#!/usr/bin/env python3
"""
WebSocket 연결을 테스트하는 간단한 Python 스크립트
"""
import asyncio
import websockets
import json
import time

async def test_websocket():
    uri = "ws://localhost:8000/ws"
    
    try:
        print(f"🔌 WebSocket 연결 시도: {uri}")
        
        async with websockets.connect(uri) as websocket:
            print("✅ WebSocket 연결 성공!")
            
            # 연결 확인 메시지 대기
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                data = json.loads(response)
                print(f"📨 서버 응답: {data}")
                
                if data.get('type') == 'connection_established':
                    print("🎉 연결 확인 메시지 수신!")
                else:
                    print(f"⚠️ 예상치 못한 메시지 타입: {data.get('type')}")
                    
            except asyncio.TimeoutError:
                print("⏰ 연결 확인 메시지 타임아웃")
            except Exception as e:
                print(f"❌ 메시지 수신 오류: {e}")
            
            # 테스트 메시지 전송
            test_message = f"테스트 메시지 {int(time.time())}"
            print(f"📤 테스트 메시지 전송: {test_message}")
            
            try:
                await websocket.send(test_message)
                print("✅ 메시지 전송 성공")
                
                # 에코 응답 대기
                try:
                    echo_response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    echo_data = json.loads(echo_response)
                    print(f"🔄 에코 응답: {echo_data}")
                    
                    if echo_data.get('type') == 'echo':
                        print("🎯 에코 응답 확인!")
                    else:
                        print(f"⚠️ 예상치 못한 에코 응답 타입: {echo_data.get('type')}")
                        
                except asyncio.TimeoutError:
                    print("⏰ 에코 응답 타임아웃")
                except Exception as e:
                    print(f"❌ 에코 응답 수신 오류: {e}")
                    
            except Exception as e:
                print(f"❌ 메시지 전송 오류: {e}")
            
            # 잠시 대기
            print("⏳ 3초 대기...")
            await asyncio.sleep(3)
            
    except Exception as e:
        print(f"❌ WebSocket 연결 오류: {e}")

if __name__ == "__main__":
    print("🚀 WebSocket 테스트 시작")
    asyncio.run(test_websocket())
    print("🏁 테스트 완료")
