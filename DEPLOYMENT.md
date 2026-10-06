# QuickDrop 출시 및 운영

확인일: 2026-10-06. **기존 서비스는 https://dropgo.up.railway.app 에서 동작 중입니다.** 사용자가 제공한 Railway 화면의 Online 상태와 실제 HTTP/QR/WSS/WebRTC 전송을 확인했습니다. 최적화한 새 로컬 빌드는 검증됐지만, 현재 배포 도구 인증이 `Unauthorized`여서 새 버전 재배포는 아직 확인되지 않았습니다.

- 프로젝트: `ab9bfe11-b642-4f84-8549-943a09c71d2e`
- 환경: `production`, 서비스 이름: `quickdrop`
- 새 빌드 확인: `npm run deploy:verify -- https://dropgo.up.railway.app`
- 개선 내용/측정: [OPTIMIZATION.md](./OPTIMIZATION.md)

## 주소 결정

`.qd`는 [IANA 공식 최상위 도메인 목록](https://data.iana.org/TLD/tlds-alpha-by-domain.txt)에 없습니다. 일반 도메인 등록으로 `서비스.qd`를 만들 수 없습니다.

현재 발급된 기본 도메인 `dropgo.up.railway.app`을 사용합니다. `/api/config`의 `PUBLIC_URL`도 같은 HTTPS origin으로 확인됐습니다. 기본 도메인 형식은 `이름.up.railway.app`입니다. [Railway 도메인 문서](https://docs.railway.com/networking/domains/working-with-domains)

`railway.app` 자체는 제공자의 도메인이므로 이 프로젝트에 할당할 수 없습니다. `up.railway.app` 접미사를 없애려면 사용자가 소유한 별도 도메인을 연결해야 합니다. 도메인 구매는 실행하지 않았습니다.

## 계정 인증 확인 기록

- 공식 Railway CLI `5.63.3`을 npm 실행 도구로 준비했습니다. 프로젝트 의존성은 변경하지 않았습니다.
- 브라우저 콜백 로그인은 5분 동안 콜백을 받지 못해 timeout으로 종료했습니다.
- 기기 코드 방식으로 재시도했고 사용자는 Railway 웹페이지의 인증 성공을 확인했습니다.
- 그 후에도 `railway whoami --json`과 `railway list --json`은 `Unauthorized`를 반환했고, CLI 인증 설정 파일이 생성되지 않았습니다. 코드 로그인 프로세스에도 완료 결과가 도착하지 않았습니다.
- 따라서 웹페이지의 성공 표시와 배포 도구의 실제 인증 상태가 일치하지 않는 상황입니다. 구체적인 원인은 아직 확인되지 않았으며, 사용자에게 승인이 필요하다는 사실만으로 원인을 단정하지 않습니다.

로그인 링크나 일회용 코드, 토큰은 문서/Git에 기록하지 않습니다. 로그인 완료 후 `whoami`와 프로젝트 조회가 성공하는 것을 확인한 뒤 기존 서비스를 갱신해야 합니다. 필요 시 같은 PC의 터미널에서 `npx --yes @railway/cli@5.63.3 login`을 실행하고 브라우저 승인을 완료합니다. 브라우저 접근이 어려운 환경에서는 `login --browserless`를 사용합니다. [공식 CLI 인증 안내](https://docs.railway.com/cli#authentication)

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
2. 기존 `quickdrop` 서비스를 재사용합니다. GitHub `Ch-wook/QuickDrop`의 `main` 소스 연결 여부를 확인하고 저장소 루트의 Dockerfile과 railway.json을 사용합니다. 이미 존재하는 프로젝트를 다시 생성하지 않습니다.
3. 아래 환경 변수를 설정합니다. 플랫폼이 제공하는 `PORT`를 사용하고 공개 도메인의 target port를 서버와 맞춥니다.
4. 기존 `dropgo.up.railway.app` 도메인과 `PUBLIC_URL`을 유지하여 재배포합니다.
5. healthcheck, 홈페이지, QR, WSS, 실제 전송을 확인합니다.
6. 성공한 URL·배포 ID·Git commit·검증일을 이 문서에 기록한 뒤 출시 완료로 표시합니다.

CLI 인증이 완료되면 프로젝트 루트에서 기존 서비스에 업로드할 수 있습니다:

```powershell
npx --yes @railway/cli@5.63.3 up --project ab9bfe11-b642-4f84-8549-943a09c71d2e --service quickdrop --environment production --detach
```

GitHub 자동 배포를 사용하는 경우 서비스 Source에 올바른 저장소/브랜치가 연결되어야 합니다. 단순 Redeploy는 이전 소스의 재배포일 수 있으므로, 반드시 새 커밋으로 빌드됐는지와 `deploy:verify` 결과를 확인합니다.

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

임시 인증정보도 유효 시간 동안은 브라우저에서 확인할 수 있습니다. 익명 발급이므로 TURN 제공자의 할당량·전송량 제한과 사용량 알림도 설정해야 합니다. 최적화본은 TURN이 설정된 새 Peer 협상마다 인증정보를 갱신합니다. 연결 도중의 주기적 갱신/ICE restart는 아직 구현하지 않았으므로 운영 서버에서는 인증 만료 전후와 긴 전송을 추가 검증해야 합니다. 현재 공개 설정에는 STUN 1개만 확인되며 운영 TURN 서버 연결은 별도 필요합니다.

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
npm run deploy:verify -- https://dropgo.up.railway.app
$env:E2E_BASE_URL = 'https://dropgo.up.railway.app'
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
| 단위·통합 검사 | 9개 파일, 83개 통과 |
| TypeScript + 운영 빌드 | 통과 |
| 운영 빌드 브라우저 E2E | 8개 통과, 4개 skip |
| 의존성 audit | 알려진 취약점 0개 |
| Railway 배포 권한 | 사용자 웹 인증 성공 확인, CLI는 여전히 Unauthorized |
| 기존 원격 서비스/HTTPS 주소 | dropgo.up.railway.app 정상 응답 |
| 기존 공개 서버 E2E | 1개 통과 |
| 최적화본 원격 반영 | 미확인, 공개 HTML은 아직 이전 빌드 |
| 실기기 / 운영 TURN | 미실행 |

배포 권한이 확인되면 위 순서로 기존 서비스를 갱신하고 최종 검증을 이어갑니다.
