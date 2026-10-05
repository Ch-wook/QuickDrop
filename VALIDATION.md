# QuickDrop 검증 기록

## 2026-10-06 출시 준비 재검증

- `npm test`: 7개 파일, **58개 통과**. TURN 임시 인증의 만료 timestamp·coturn 서명·요청별 독립성과 비밀키 비노출, 설정 API 캐시 금지·rate limit 포함.
- `npm run build`: TypeScript 검사 및 production 프런트/서버 빌드 통과.
- production E2E: **8개 통과, 4개 skip**, 실패 없음. skip은 중복 교차 엔진 검사 2개와 Windows WebKit의 WebRTC 미지원 검사 2개.
- `npm audit --json`: 알려진 취약점 **0개**.
- 원격 배포 및 공개 주소 E2E는 Railway 계정 연결이 없어 미실행. 운영 TURN 서버·실제 iPhone/Android·Docker 실행은 여전히 미검증.
- 상세 배포 상태: [DEPLOYMENT.md](./DEPLOYMENT.md).

아래는 2026-09-23 당시의 검사 기록입니다.

검증일: 2026-09-23 (Asia/Seoul). 환경: Windows, Node.js v24.15.0, npm 11.12.1.

## 최종 결과

| 검사 | 결과 |
|---|---|
| `npm run check` | TypeScript 오류 없음 |
| `npm test` | 6개 파일, **53개 통과** (안정성 보완 후) |
| `npm run build` | 프런트엔드 및 서버 production bundle 생성 성공 |
| production 서버 E2E | **8개 통과**, 4개 skip, 실패 없음 |
| 공개 HTTPS 터널 E2E | 이전 실행 **1개 통과**; 현재도 이전 주소가 유효함을 의미하지 않음 |
| `npm run mobile:status` | 종료된 로컬 서버를 `stopped`로 판정하고 코드 1로 종료 |
| `npm audit` | 의존성 설치 시 알려진 취약점 0개 |
| `npm audit --omit=dev` | 최종 runtime dependency 취약점 0개 |
| `git diff --check` | 오류 없음 |
| Docker 실행 | Docker CLI가 없어 실행 미검증 |
| 실제 iPhone / Android / TURN | 장치·외부 서버가 없어 미검증 |

프로덕션 E2E 실행 명령(PowerShell):

```powershell
npm run build
$env:E2E_PRODUCTION = '1'
npm run test:e2e
Remove-Item Env:E2E_PRODUCTION
```

POSIX shell에서는 `E2E_PRODUCTION=1 npm run test:e2e`입니다. E2E는 실제 `npm start`로 정적 빌드와 WebSocket 서버를 시작했습니다.

## 브라우저별 검증

| 엔진 | 실제 WebRTC | 확인 범위 |
|---|---|---|
| Chromium 153 (Playwright) | 통과 | QR 해독, 연결, ping/pong, URL, 복사, PNG preview, ZIP/PDF/PNG 다운로드 byte 일치, drop/paste, 코드 fallback, 퇴장·재참가, 모바일 레이아웃 |
| Firefox 155 (Playwright) | 통과 | 같은 전송 시나리오, 파일 byte 일치, 퇴장·재참가, 모바일 레이아웃. OS clipboard 내용 검사는 Chromium에서만 수행 |
| Chromium ↔ Firefox | 통과 | 서로 다른 엔진 간 텍스트 및 여러 청크 파일 전송, 다운로드 byte 일치 |
| WebKit 26.6 Windows (Playwright) | 지원 API 없음 | 설치된 엔진의 `RTCPeerConnection`이 `undefined`; 지원 불가 안내, 반응형 화면, 도움말과 키보드 focus 복귀만 통과 |

4개 skip 중 2개는 Windows WebKit의 WebRTC API 부재로 인한 전송 시나리오입니다. 나머지 2개는 Chromium 프로젝트에서 이미 실행한 교차 엔진 검사를 Firefox/WebKit 프로젝트에서 중복 실행하지 않기 위한 것입니다. WebKit 전송 성공 또는 실제 Safari/휴대폰 검증 완료를 의미하지 않습니다. macOS WebKit/Safari 및 실기기에서 추가 확인해야 합니다.

QR은 렌더링된 PNG를 독립 decoder(jsQR)로 해독하여 실제 `/join/{roomId}` 주소와 일치하는지 검사했습니다. PNG 수신 이미지는 `naturalWidth`로 정상 디코딩을 확인했습니다. 링크 새 탭 테스트의 외부 목적지는 테스트에서 응답을 대체하여 외부 사이트 상태에 의존하지 않도록 했습니다. 파일 전송 자체는 실제 WebRTC DataChannel을 사용하며 mock하지 않았습니다.

파일 취소, 수신 용량 제한, 청크 순서/크기 오류, 타임아웃, backpressure 중 취소, ACK 전후 상태는 단위 테스트로 검증했습니다. 100MiB 한계 파일과 장시간 모바일 백그라운드 전송은 실제 기기에서 추가 검증이 필요합니다.

## 테스트 중 수정한 문제

- 테스트 서버의 localhost IPv4/IPv6 readiness 차이: E2E 주소를 `127.0.0.1`로 명시.
- Firefox에서는 상대 탭 종료 시 DataChannel error가 `PEER_LEFT`보다 먼저 발생: 연결 종료 처리에 짧은 유예를 두어 정상 퇴장은 Room 대기로 돌아가도록 수정. 동일 Room 재참가까지 E2E 검증.
- QR quiet zone을 4 modules로 확보하고 독립 decoder 검사를 추가.
- 이미지 fixture를 유효한 PNG로 생성하고 실제 이미지 디코딩 검사를 추가.
- 개발 의존성 Vitest의 알려진 취약점을 패치 버전으로 갱신.

## 시각 검증

`artifacts/`의 데스크톱 대기/연결 화면 및 375~390px 모바일 화면을 캡처했습니다. 데스크톱 대기 화면, 모바일 연결 화면을 직접 확인했고, 가로 overflow가 없음을 E2E에서 검사했습니다. 해당 디렉터리는 임시 검증 결과이며 Git에서 제외합니다.

앱 내 Browser 스킬의 runtime을 초기화했지만 연결 가능한 브라우저 인스턴스가 없어, 저장소의 Playwright 테스트에서 검증을 수행했습니다.

## QR 접속 거부 수정 검증 (2026-09-23)

- PC 서버는 실행 중이었으나, 기존 localhost QR은 휴대폰 자신의 주소를 가리키는 것이 원인이었습니다.
- localhost/127.x/IPv6 loopback/wildcard/HTTP 주소 판별 15개 사례를 추가했습니다.
- 로컬 페이지 → PUBLIC_URL 이동, Room 경로 보존, HTTPS proxy 요청의 redirect loop 방지를 실제 HTTP로 검사했습니다.
- `npm run dev:mobile`을 실제 실행해 공식 cloudflared의 고정 버전과 SHA-256을 검증하고 임시 HTTPS 주소를 발급했습니다.
- 이 공개 주소에서 Chromium 두 독립 컨텍스트로 QR 이미지 해독, 같은 HTTPS origin 참가, 두 WSS socket, 실제 WebRTC 텍스트와 69,000-byte 파일의 다운로드 일치를 확인했습니다.
- localhost UI에서는 QR을 표시하지 않고 원인 및 휴대폰용 실행 방법을 안내합니다. 같은 PC 테스트 연결 링크는 유지합니다.
- 이 검증은 실제 스마트폰 카메라/OS 검증을 의미하지 않습니다. 임시 터널은 PC가 켜져 있는 동안만 유지되며 상시 배포가 아닙니다.

## 배포 전 남은 확인

### 후속 안정성 점검

- 기록 299개 상태에서 파일 두 개 선택 시 먼저 선택한 파일도 전송 시작을 못 할 수 있는 문제를 수정하고 회귀 테스트를 추가했습니다.
- IPv4-mapped IPv6 loopback/wildcard 및 확장 IPv6 loopback을 휴대폰 QR에서 제외했습니다.
- 임시 터널은 이전 공개 HTTPS 검사 후 DNS `ENOTFOUND`가 관찰됐습니다. 이 상태를 숨기지 않도록 로컬 세션 확인과 공개 healthcheck를 분리한 상태 검사 명령을 추가했습니다.
- 상태 검사 6개 사례와 URL 4개 사례, 파일 큐 1개 사례를 추가하여 총 53개 테스트가 통과했습니다.
- 수정본의 production 빌드와 전체 E2E를 재실행하여 8개 통과, 4개 skip을 확인했습니다.
- 상시 배포 및 고정 도메인은 아직 완료하지 않았습니다.

### 외부 환경에서 필요한 확인

1. 실제 휴대폰 두 대 또는 PC + 휴대폰에서 HTTPS 주소로 QR 스캔·전송·저장.
2. 서로 다른 통신망에서 STUN-only 실패 안내와 TURN 경유 연결 확인.
3. Docker가 설치된 환경에서 `docker compose up --build` 및 healthcheck 확인.
4. 공개 운영 시 단기 TURN credential, reverse proxy의 정확한 trust 설정 및 Room URL access log 마스킹.
