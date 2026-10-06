# QuickDrop 출시 및 운영

확인일: 2026-10-06. **상시 배포 및 고정 도메인은 아직 발급되지 않았습니다.** 사용자는 Railway 인증 성공을 확인했지만, 배포 도구에서는 아직 인증이 완료되지 않아 원격 서비스 생성·배포를 실행하지 못했습니다. 아래 주소 후보는 예약되거나 사용 가능하다고 확인된 주소가 아닙니다.

## 주소 결정

`.qd`는 [IANA 공식 최상위 도메인 목록](https://data.iana.org/TLD/tlds-alpha-by-domain.txt)에 없습니다. 일반 도메인 등록으로 `서비스.qd`를 만들 수 없습니다.

별도 도메인 구매 없이 Railway 기본 HTTPS 도메인을 먼저 사용합니다. `qd`, `qdrop`, `quickdrop` 순서로 짧은 이름의 사용 가능 여부를 확인하고, 실제 발급 성공한 주소를 `PUBLIC_URL`로 확정합니다. 기본 도메인 형식은 `이름.up.railway.app`입니다. [Railway 도메인 문서](https://docs.railway.com/networking/domains/working-with-domains)

사용자는 이후 `qd.up.railway.app` 대신 `railway.app`을 요청했습니다. `railway.app` 자체는 제공자의 도메인이므로 이 프로젝트에 할당할 수 없습니다. 사용자에게 공개할 최종 짧은 주소는 아직 확정되지 않았으며, `up.railway.app` 접미사를 없애려면 사용자가 소유한 별도 도메인을 연결해야 합니다. 도메인 구매는 실행하지 않았습니다.

## 계정 인증 확인 기록

- 공식 Railway CLI `5.63.3`을 npm 실행 도구로 준비했습니다. 프로젝트 의존성은 변경하지 않았습니다.
- 브라우저 콜백 로그인은 5분 동안 콜백을 받지 못해 timeout으로 종료했습니다.
- 기기 코드 방식으로 재시도했고 사용자는 Railway 웹페이지의 인증 성공을 확인했습니다.
- 그 후에도 `railway whoami --json`과 `railway list --json`은 `Unauthorized`를 반환했고, CLI 인증 설정 파일이 생성되지 않았습니다. 코드 로그인 프로세스에도 완료 결과가 도착하지 않았습니다.
- 따라서 웹페이지의 성공 표시와 배포 도구의 실제 인증 상태가 일치하지 않는 상황입니다. 구체적인 원인은 아직 확인되지 않았으며, 사용자에게 승인이 필요하다는 사실만으로 원인을 단정하지 않습니다.

로그인 링크나 일회용 코드, 토큰은 문서/Git에 기록하지 않습니다. 로그인 완료 후 `whoami`와 프로젝트 목록 조회가 성공하는 것을 확인한 뒤 서비스를 생성해야 합니다. 필요 시 같은 PC의 터미널에서 `npx --yes @railway/cli@5.63.3 login`을 실행하고 브라우저 승인을 완료합니다. 브라우저 접근이 어려운 환경에서는 `login --browserless`를 사용합니다. [공식 CLI 인증 안내](https://docs.railway.com/cli#authentication)

## 현재 배포 구성

- GitHub: `Ch-wook/QuickDrop`, 브랜치 `main`.
- Dockerfile: Node 24, production build, non-root 실행.
- railway.json: Docker builder, `/api/health`, 실패 시 재시작, replica 1개.
- 하나의 프로세스가 프런트엔드·HTTP API·WebSocket을 함께 제공합니다.
- Room은 메모리 상태이므로 다중 replica/여러 리전으로 늘리면 안 됩니다.
- 별도 DB·파일 저장소·볼륨은 필요 없습니다.
- 정적 호스팅만으로는 `/api/rooms`와 `/ws`가 실행되지 않습니다.

## 배포 순서

1. 연결된 Railway 계정에서 사용 가능한 프로젝트/플랜과 비용 조건을 확인합니다. 유료 플랜 구매·전환은 별도 비용 확인 후 진행합니다.
2. GitHub `main`을 소스로 서비스를 생성하고 저장소 루트의 Dockerfile과 railway.json을 사용합니다.
3. 아래 환경 변수를 설정합니다. 플랫폼이 제공하는 `PORT`를 사용하고 공개 도메인의 target port를 서버와 맞춥니다.
4. 서비스 HTTPS 도메인을 발급하고 `PUBLIC_URL`에 확정 주소를 설정하여 재배포합니다.
5. healthcheck, 홈페이지, QR, WSS, 실제 전송을 확인합니다.
6. 성공한 URL·배포 ID·Git commit·검증일을 이 문서에 기록한 뒤 출시 완료로 표시합니다.

| 변수 | 운영 설정 |
|---|---|
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| PORT | Railway 제공값, 없으면 앱 기본 3000과 도메인 target port 일치 |
| PUBLIC_URL | 실제 발급된 `https://...` origin, 경로 없음 |
| TRUST_PROXY | 직접 Railway reverse proxy 1단계 구성에서 1; 추가 프록시가 있으면 실제 경로 검증 |
| ROOM_TTL | 600000 |
| MAX_FILE_SIZE | 104857600 |
| MAX_SESSION_BYTES | 209715200 |

`PUBLIC_URL`과 프록시 HTTPS 정보가 다르면 리디렉션 반복 또는 origin 거부가 발생할 수 있습니다. `/api/health` 성공만으로 QR/전송까지 정상이라고 판단하지 않습니다. 기존 PC의 임시 trycloudflare 주소는 출시 주소로 사용하지 않습니다.

## 서로 다른 통신망: TURN

STUN만으로 연결되지 않는 NAT/방화벽이 있으므로 광범위한 공개 출시에는 운영 TURN 서버와 실망 검증이 필요합니다. TURN 서버 자체는 이 저장소/현재 배포에서 생성되지 않았습니다.

coturn REST 인증을 지원하는 서버에는 다음을 설정합니다.

- TURN 서버: `use-auth-secret` 활성화와 충분히 무작위인 `static-auth-secret` 설정.
- QuickDrop: 같은 비밀값을 `TURN_SECRET`에 입력하고 `TURN_URL` 설정. 비밀값은 최소 32자.
- `TURN_CREDENTIAL_TTL=3600`: 기본 1시간, 허용 600~86400초.
- 예시 TURN URL 형식: `turn:relay.example.com:3478,turns:relay.example.com:5349` (실제 운영 서버 주소로 교체).

`/api/config`는 요청마다 만료 timestamp와 무작위 ID가 포함된 username 및 HMAC-SHA1 인증정보를 생성합니다. `TURN_SECRET`은 응답에 포함하지 않습니다. 응답은 `no-store`이며 IP당 분당 120회로 제한합니다. 고정 `TURN_USERNAME`/`TURN_PASSWORD`는 제한된 테스트 계정 호환용이며 `TURN_SECRET`이 있으면 임시 인증이 우선합니다. [coturn 인증 규격](https://github.com/coturn/coturn/wiki/turnserver#turn-rest-api)

임시 인증정보도 유효 시간 동안은 브라우저에서 확인할 수 있습니다. 익명 발급이므로 TURN 제공자의 할당량·전송량 제한과 사용량 알림도 설정해야 합니다. 인증정보 자동 갱신은 현재 구현하지 않았으므로 장시간 열린 페이지에서 신규 연결이 실패하면 페이지를 새로 열어 인증정보를 재발급받습니다. 운영 서버에서는 인증 만료 전후와 긴 전송을 추가 검증해야 합니다.

## 출시 검증

로컬 운영 빌드 검증(PowerShell):

```powershell
npm ci
npm test
npm run build
$env:E2E_PRODUCTION = '1'
npm run test:e2e
Remove-Item Env:E2E_PRODUCTION
npm audit
```

실제 발급된 HTTPS 주소 검증:

```powershell
$env:E2E_BASE_URL = 'https://실제발급된주소'
npm run test:e2e -- --project=chromium
Remove-Item Env:E2E_BASE_URL
```

공개 주소 E2E는 QR을 해독하고, 두 브라우저의 WSS 접속·WebRTC 연결·텍스트 및 파일 전송·다운로드 byte 일치를 확인합니다. 테스트 완료 후 페이지를 닫아 임시 Room을 정리합니다.

실제 Android Chrome 및 iPhone Safari에서 QR, 코드 입력, 양방향 파일/이미지 저장을 별도로 확인합니다. PC Wi-Fi ↔ 휴대폰 셀룰러와 TURN 강제 relay도 확인해야 합니다. 현재 이 실기기/운영 TURN 검증은 미완료입니다.

## 운영 및 복구

- `/api/health`를 외부 모니터링하고 배포 실패/재시작·메모리·네트워크 사용량 알림을 설정합니다. 모니터링 계정은 아직 연결되지 않았습니다.
- 로그에 전송 내용, TURN 비밀키, owner token을 남기지 않습니다. 프록시 로그의 `/join/{roomId}`도 마스킹 또는 제외합니다.
- 장애 시 직전 성공 배포를 Railway에서 복구합니다. 서버 재시작/교체 시 메모리 Room이 사라지므로 양쪽 기기에서 새 연결이 필요합니다.
- 사용자 증가 시 단순 replica 증가 전에 공유 Room/신호 라우팅 설계를 먼저 변경합니다.

## 2026-10-06 확인 결과

| 항목 | 상태 |
|---|---|
| 단위·통합 검사 | 7개 파일, 58개 통과 |
| TypeScript + 운영 빌드 | 통과 |
| 운영 빌드 브라우저 E2E | 8개 통과, 4개 skip |
| 의존성 audit | 알려진 취약점 0개 |
| Railway 배포 권한 | 사용자 웹 인증 성공 확인, CLI는 여전히 Unauthorized |
| 원격 서비스/고정 HTTPS 주소 | 미생성 |
| 공개 배포 주소 E2E / 실기기 / TURN | 미실행 |

배포 계정 인증이 완료되면 위 순서로 원격 배포와 최종 검증을 이어갑니다.
