# QuickDrop 출시 및 운영

## 2026-10-09 연결 안정성·기기별 기록 변경

로컬 빌드와 단위·통합 92개, 운영 빌드 E2E 14개 통과/7개 skip을 확인했습니다. GitHub `main` 푸시를 통한 자동 배포 후 상태와 공개 자산·전송을 확인합니다. 현재 공개 주소는 `https://dropgo.up.railway.app`이며, `go.up.railway.app`으로의 변경은 CLI `Unauthorized`로 아직 실행하지 못했습니다. 변경 원인·기록 보관·범위는 [RELIABILITY.md](./RELIABILITY.md)에 있습니다.

아래 항목은 이전 배포 이력입니다.

확인일: 2026-10-06. **최적화본을 https://dropgo.up.railway.app 에 배포하고 검증했습니다.** GitHub의 Railway 배포 성공 상태와 공개 서버의 실제 자산 해시·내용·압축·캐시 설정을 확인했습니다. Chromium·Firefox 공개 E2E 2개가 통과했으며 QR 해독, WSS, WebRTC 텍스트 및 72,000-byte 파일의 다운로드 일치를 검증했습니다.

후속 **200MiB·검색 접근 변경 `7272183`의 배포와 공개 검증도 완료했습니다.** 운영 설정의 `maxFileSize=209715200`, 검색 제목·canonical·robots·사이트맵·임시 참가 URL의 noindex, 새 자산 `index-DKbB_D6K.js`를 확인했습니다. 단위·통합 86개 및 공개 Chromium·Firefox E2E 2개(19.7초)가 통과했습니다. 최신 기능 배포 ID는 `26dfe327-635a-45fe-8dce-17b2837f2f0a`이며 아래 첫 배포 식별자들은 이전 최적화 배포 기록입니다. 검색 제출 상태는 [SEARCH.md](./SEARCH.md)에 기록합니다.

- 프로젝트: `ab9bfe11-b642-4f84-8549-943a09c71d2e`
- 환경: `production` (`8f80c170-be57-409d-ba7e-86c0fafa6681`)
- 서비스: `quickdrop` (`ae67e523-51d8-469b-8f7e-0f1b37e53c03`)
- 성공한 배포: `9a5e86b0-5dc8-4836-a2f3-3e01db2a4479`
- 기능 검증 기준 코드: [`91aba3b8f5d5331b0917b7cd219000b0a5cb8bc6`](https://github.com/Ch-wook/QuickDrop/commit/91aba3b8f5d5331b0917b7cd219000b0a5cb8bc6)
- 후속 문서 푸시 자동 배포: [`d783cd9ac2a996c5a4d9985856b193e290c14e80`](https://github.com/Ch-wook/QuickDrop/commit/d783cd9ac2a996c5a4d9985856b193e290c14e80), 배포 `7121c779-8733-451e-977f-f3ad05ff2824` 성공
- 확인한 자산: `index-DlbgtMzG.js`, `index-DFBmzxZh.css`
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
- CLI 인증 문제의 구체적인 원인은 아직 확인되지 않았습니다. 이후 Railway 웹에서 GitHub 저장소를 연결해 배포했으며, CLI 인증 제한과 실제 서비스 배포 완료는 별개입니다.

로그인 링크나 일회용 코드, 토큰은 문서/Git에 기록하지 않습니다. 향후 CLI로 배포할 때는 `whoami`와 프로젝트 조회가 성공하는 것을 먼저 확인합니다. CLI 인증이 필요하면 같은 PC의 터미널에서 `npx --yes @railway/cli@5.63.3 login`을 실행하고 브라우저 승인을 완료합니다. 브라우저 접근이 어려운 환경에서는 `login --browserless`를 사용합니다. 현재 서비스는 GitHub 소스로 배포됐으므로 이 CLI 제한 때문에 배포가 미완료인 것은 아닙니다. [공식 CLI 인증 안내](https://docs.railway.com/cli#authentication)

## 현재 배포 구성

- GitHub Source 연결 완료: `Ch-wook/QuickDrop`, 브랜치 `main`.
- Dockerfile: Node 24, production build, non-root 실행.
- railway.json: Docker builder, `/api/health`, 실패 시 재시작, replica 1개.
- 하나의 프로세스가 프런트엔드·HTTP API·WebSocket을 함께 제공합니다.
- Room은 메모리 상태이므로 다중 replica/여러 리전으로 늘리면 안 됩니다.
- 별도 DB·파일 저장소·볼륨은 필요 없습니다.
- 정적 호스팅만으로는 `/api/rooms`와 `/ws`가 실행되지 않습니다.

## 후속 배포 순서

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

GitHub Source 연결 후 문서 커밋 `d783cd9`를 `main`에 푸시하자 별도 사용자 조작 없이 Railway 배포가 시작됐고, GitHub 상태가 `pending`에서 `success`로 바뀌었습니다. 배포 `7121c779-8733-451e-977f-f3ad05ff2824`의 성공으로 푸시 자동 배포까지 확인했습니다. 앞선 화면의 자동 배포 사용 불가 표시와 실제 동작을 구분해 기록합니다. 후속 코드 배포에서도 커밋 상태와 `deploy:verify` 결과를 확인합니다. 단순 Redeploy는 이전 소스의 재배포일 수 있습니다.

| 변수 | 운영 설정 |
|---|---|
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| PORT | Railway 제공값, 없으면 앱 기본 3000과 도메인 target port 일치 |
| PUBLIC_URL | 실제 발급된 `https://...` origin, 경로 없음 |
| TRUST_PROXY | 직접 Railway reverse proxy 1단계 구성에서 1; 추가 프록시가 있으면 실제 경로 검증 |
| ROOM_TTL | 600000 |
| MAX_FILE_SIZE | 209715200 (파일당 200MiB) |
| MAX_SESSION_BYTES | 209715200 |

`PUBLIC_URL`과 프록시 HTTPS 정보가 다르면 리디렉션 반복 또는 origin 거부가 발생할 수 있습니다. `/api/health` 성공만으로 QR/전송까지 정상이라고 판단하지 않습니다. 기존 PC의 임시 trycloudflare 주소는 출시 주소로 사용하지 않습니다.

기존 Railway 환경 변수에 `MAX_FILE_SIZE=104857600`이 남아 있으면 새 코드의 200MiB 기본값보다 우선합니다. 변경 배포 후 `/api/config`의 `maxFileSize`가 `209715200`인지 확인합니다. 수신 보관 합계 `MAX_SESSION_BYTES`는 200MiB로 유지합니다.

## 서로 다른 통신망: TURN

STUN만으로 연결되지 않는 NAT/방화벽이 있으므로 광범위한 공개 출시에는 운영 TURN 서버와 실제 통신망 검증이 필요합니다. TURN 서버 자체는 이 저장소/현재 배포에서 생성되지 않았습니다.

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
npm run test:e2e -- --project=chromium --project=firefox
Remove-Item Env:E2E_BASE_URL
```

공개 주소 E2E는 QR을 해독하고, 두 브라우저의 WSS 접속·WebRTC 연결·텍스트 및 파일 전송·다운로드 byte 일치를 확인합니다. 테스트 완료 후 페이지를 닫아 임시 Room을 정리합니다.

사용자는 휴대폰 연결 성공을 알려왔지만 OS·브라우저와 파일 전송·저장 여부는 확인하지 않았습니다. 실제 Android Chrome 및 iPhone Safari에서 QR, 코드 입력, 양방향 파일/이미지 저장을 별도로 확인합니다. PC Wi-Fi ↔ 휴대폰 셀룰러와 TURN 강제 relay도 확인해야 합니다.

## 운영 및 복구

- `/api/health`를 외부 모니터링하고 배포 실패/재시작·메모리·네트워크 사용량 알림을 설정합니다. 모니터링 계정은 아직 연결되지 않았습니다.
- 로그에 전송 내용, TURN 비밀키, owner token을 남기지 않습니다. 프록시 로그의 `/join/{roomId}`도 마스킹 또는 제외합니다.
- 장애 시 직전 성공 배포를 Railway에서 복구합니다. 서버 재시작/교체 시 메모리 Room이 사라지므로 양쪽 기기에서 새 연결이 필요합니다.
- 사용자 증가 시 단순 replica 증가 전에 공유 Room/신호 라우팅 설계를 먼저 변경합니다.

## 2026-10-06 초기 최적화 배포 확인 결과

| 항목 | 상태 |
|---|---|
| 단위·통합 검사 | 9개 파일, 83개 통과 |
| TypeScript + 운영 빌드 | 통과 |
| 운영 빌드 브라우저 E2E | 8개 통과, 4개 skip |
| 의존성 audit | 알려진 취약점 0개 |
| Railway 배포 | GitHub Source 연결 후 성공, 배포 코드 91aba3b |
| Railway CLI 인증 | Unauthorized 유지; 완료된 GitHub 소스 배포와 별개 |
| 후속 푸시 자동 배포 | d783cd9 문서 푸시로 자동 시작·성공 확인 |
| 공개 서비스/HTTPS 주소 | dropgo.up.railway.app 정상 응답 |
| 최적화본 공개 E2E | Chromium·Firefox 2개 통과, 16.0초 |
| 최적화본 원격 반영 | deploy:verify 통과; 로컬 JS/CSS 해시·내용, Brotli/캐시, health/PUBLIC_URL 일치 |
| 화면 확인 | 데스크톱 QR, 390px 모바일 연결·텍스트·다운로드 화면 확인 |
| 실기기 / 운영 TURN | 사용자 휴대폰 연결 제보; OS별 전송·저장 및 운영 TURN 미검증 |

앞선 최적화본 배포와 공개 브라우저 검증은 완료했습니다. 실제 iPhone/Android, 통신망 간 연결, 운영 TURN, 현재 기본 한도인 200MiB 경계 및 장시간 전송 검증은 후속 작업입니다.
