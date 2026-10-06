# QuickDrop 프로젝트 진행 현황

최종 정리일: **2026-10-07**. 구현 범위, 수정 이력, 검증 결과, 실행 방법과 남은 작업을 정리합니다.

2026-10-07 운영 서버 재확인: healthcheck 정상, 공개 주소 일치, 파일당 200MiB 및 수신 보관·예약 합계 200MiB 설정 유지. 아래 전송·회귀 검사와 검색 제출은 2026-10-06 실행 기록입니다.

최신 변경 `7272183`: 파일당 기본 한도를 **200MiB(209,715,200 bytes)**로 높이고 검색용 제목·설명·사이트맵·임시 참가 링크의 검색 제외 및 네이버 제출 명령을 추가했습니다. 운영 서버의 실제 200MiB 제한과 새 자산을 확인했고 단위·통합 **86개**, 공개 Chromium·Firefox E2E **2개**가 통과했습니다. 네이버 IndexNow 요청은 HTTP 200으로 접수됐으며 실제 검색 노출은 미확인입니다. 전체 요약은 [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md), 검색 구성은 [SEARCH.md](./SEARCH.md)에 있습니다. 아래 83개 검사와 초기 최적화 수치는 앞선 배포의 기록입니다.

최적화본 검사 결과: 단위·통합 **83개 통과**, 로컬 production E2E **8개 통과/4개 skip**, 공개 E2E **2개 통과**, 빌드 통과, audit 취약점 **0개**. QR 코드 분리, 전송 읽기 묶음, 제한기 성능, 압축/캐시, TURN 갱신, 연결 종료 처리를 개선했습니다. 자세한 수치는 [OPTIMIZATION.md](./OPTIMIZATION.md)에 있습니다.

최적화본 코드 `91aba3b`가 https://dropgo.up.railway.app 에 배포됐습니다. 로컬 빌드와 공개 JS/CSS의 해시·내용 및 Brotli/캐시 설정 일치를 확인하고 Chromium·Firefox에서 실제 QR/WSS/WebRTC 전송을 검증했습니다. 상세 배포 기록은 [DEPLOYMENT.md](./DEPLOYMENT.md)를 참고하세요.

## 1. 현재 상태

**양방향 전송 MVP의 구현·최적화·Railway 배포를 완료했습니다.** 두 브라우저를 연결해 텍스트·링크·이미지·파일을 주고받습니다. 저장소는 [Ch-wook/QuickDrop](https://github.com/Ch-wook/QuickDrop), 연결된 배포 소스 브랜치는 `main`입니다.

Railway 공개 주소는 **https://dropgo.up.railway.app**입니다. CLI의 `Unauthorized`는 남아 있지만 GitHub Source를 통한 배포는 성공했습니다. 기능 검증 기준 코드 `91aba3b` 배포 이후 문서 커밋 `d783cd9`를 푸시해 자동 배포 시작과 성공까지 확인했습니다. 이전 `trycloudflare.com` 주소는 일회성 개발 터널이며 운영 주소가 아닙니다.

사용자는 휴대폰 연결 성공을 알려왔습니다. 휴대폰 OS·브라우저 종류와 실제 파일 전송·저장 성공 여부는 아직 확인하지 않았습니다.

## 2. 서비스 목적

`웹사이트 열기 → QR 또는 코드로 연결 → 자료 보내기`가 기본 흐름입니다.

- Device A와 Device B는 동등하며 모두 송신/수신할 수 있습니다.
- 로그인, 회원가입, 앱 설치, 계정 DB가 없습니다.
- 서버는 연결 중개와 Room 관리만 담당합니다.
- 실제 전송은 WebRTC를 사용하며 텍스트/파일을 서버에 영구 저장하지 않습니다.
- 두 기기에서 브라우저 페이지를 열어두어야 합니다.

## 3. 구현 완료 기능

| 구분 | 구현 내용 |
|---|---|
| 연결 | 임시 Room, HTTPS QR, 6자리 코드, 최대 2 Peer |
| 협상 | WebSocket offer/answer/ICE, 참가 순서로 initiator 결정 |
| 전송 | 암호화된 reliable/ordered RTCDataChannel |
| 텍스트/URL | 자동 URL 판별, 표시, 복사, 새 탭 열기 |
| 이미지 | JPEG/PNG/WebP preview, 이름·크기, 다운로드 |
| 파일 | 일반 binary, 다중 파일 큐, 16KiB 청크, 수신 Blob |
| 상태 | 양쪽 진행률, 수신 ACK, 취소, 오류/타임아웃 |
| 입력 | 첨부, 드래그 앤 드롭, 이미지/파일 paste, Ctrl/⌘+Enter |
| 세션 | 메모리 기록, 기록 비우기, Blob URL 해제, 퇴장·재참가 |
| 서버 | 대기 TTL, 빈 Room 삭제, heartbeat, rate limit |
| 화면 | 한국어 반응형 UI, label/focus, 키보드 도움말 |
| 실행 | dev 명령, production 빌드, Docker/Compose/Railway 설정 |

## 4. 지금까지 수정한 문제

### 휴대폰 QR 접속 거부

PC에서 만든 QR에 `localhost:3000`이 들어가 있었습니다. 휴대폰은 이 주소를 자기 자신으로 해석하므로 PC 서버에 연결되지 않았습니다.

수정 내용:

1. localhost, IPv4/IPv6 loopback, wildcard 주소에서 휴대폰 QR을 표시하지 않습니다. IPv4-mapped IPv6 loopback도 검사합니다.
2. 일반 HTTP 주소에는 HTTPS 필요 안내를 제공합니다.
3. 같은 PC의 다른 창 테스트는 로컬 연결 링크로 유지합니다.
4. `npm run dev:mobile`이 공식 cloudflared를 SHA-256 검증 후 실행하고 임시 HTTPS와 production 서버를 함께 준비합니다.
5. `PUBLIC_URL`이 설정되면 로컬 페이지를 정식 HTTPS 주소로 이동해 PC와 휴대폰의 origin을 맞춥니다.

### Firefox의 정상 퇴장 처리

DataChannel 종료 이벤트가 `PEER_LEFT`보다 먼저 도착하는 경우 짧은 유예를 두어 정상 퇴장은 대기 상태로 돌아가도록 수정했습니다. 같은 Room 재참가까지 검사했습니다.

### 기록 한도에서 파일 큐가 멈추는 문제

기록이 299개일 때 파일 두 개를 선택하면 첫 파일은 대기열에 들어가지만 다음 파일 추가 시 예외로 인해 전송 시작까지 도달하지 못할 수 있었습니다.

이제 한도 초과 파일만 추가하지 않고 안내하며, **이미 수락한 파일은 계속 전송**합니다. 해당 조건을 직접 재현하는 회귀 테스트를 추가했습니다.

### 종료되거나 접근 불가능한 임시 주소

강제 종료 후 `.quickdrop/mobile.json`만 남을 수 있고, 로컬 서버가 살아 있어도 공개 터널의 DNS/접속이 실패할 수 있습니다. 이전 실행에서도 HTTPS E2E 통과 후 `ENOTFOUND`가 관찰됐으므로 URL 파일의 존재만으로 접속 가능하다고 판단하지 않습니다.

- `npm run mobile:status`가 로컬 세션 일치를 확인한 뒤 공개 HTTPS healthcheck까지 검사합니다.
- 실행 중에는 30초마다 확인하고 상태가 실패/복구로 바뀌면 터미널에 알립니다.
- 중지, 오래된 URL, 공개 DNS/네트워크 오류를 구분합니다.
- 기존 Room을 자동으로 새 Room으로 바꾸지 않습니다. 계속 실패하면 실행을 다시 시작하고 새 QR을 사용합니다.

## 5. 프로젝트 구성

| 경로 | 역할 |
|---|---|
| `client/` | React UI, Peer 연결, 파일 전송, 기록/미리보기 |
| `server/` | Express API, WebSocket, Room/TTL/rate limit, 환경 변수 |
| `shared/` | 공통 schema/타입, chunk 조립, 파일명/URL 검증 |
| `scripts/` | 모바일 HTTPS 실행과 현재 접속 상태 검사 |
| `tests/` | 단위/통합, 브라우저·교차 엔진·HTTPS E2E |
| `Dockerfile`, `compose.yaml` | production 컨테이너 |
| `railway.json` | Docker 빌드, healthcheck, 1 replica 배포 설정 |

상세 파일 트리, 프로토콜, 환경 변수와 연결 diagram은 [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)에 있습니다.

## 6. 앞선 최적화 배포 검증 결과 (2026-10-06)

| 검사 | 결과 |
|---|---|
| 단위·통합 | **9개 파일, 83개 통과** |
| TypeScript | 통과 |
| production 빌드 | 프런트·서버 생성 및 JS/CSS 사전 압축 성공 |
| production E2E | **8개 통과**, 4개 skip |
| 공개 HTTPS E2E | **Chromium·Firefox 2개 통과**, 16.0초; QR 해독, WSS, 실제 WebRTC 텍스트·72,000-byte 파일 |
| 공개 빌드 일치 | deploy:verify 통과; JS/CSS 해시·내용, Brotli/캐시, health/PUBLIC_URL |
| 모바일 상태 명령 | 종료된 로컬 서버를 `stopped`로 판정함을 실제 확인 |
| 상태 검사 회귀 | 중지, 세션 불일치, DNS 실패, 정상/잘못된 응답 |
| 실기기/외부 TURN | 사용자 휴대폰 연결 성공 제보; OS별 전송·저장과 운영 TURN 미검증 |
| 로컬 Docker Compose | Docker CLI가 없어 미실행 |
| 상시 배포/고정 주소 | Railway 배포 성공, dropgo.up.railway.app |

4개 skip 중 2개는 Windows WebKit의 WebRTC API 부재, 나머지 2개는 교차 엔진 검사의 중복 실행 제외입니다. Chromium/Firefox의 실제 전송과 Windows WebKit의 UI/오류 안내를 검증했습니다. 실제 Safari·iPhone·Android 검증을 대체하지 않습니다.

공개 주소에서 데스크톱 QR과 390px 모바일 연결·텍스트·다운로드 화면도 확인했습니다. 이는 실제 휴대폰 카메라·OS 검증을 대체하지 않습니다. 과거 임시 터널 검사와 이번 운영 배포 검사를 구분한 기록은 [VALIDATION.md](./VALIDATION.md)에 있습니다.

## 7. 실행 방법

같은 PC에서 개발:

```sh
npm install
npm run dev
```

`http://localhost:3000`에서 다른 브라우저/시크릿 창을 연결합니다.

서비스 사용은 두 기기에서 https://dropgo.up.railway.app 을 열어 시작합니다. 휴대폰으로 로컬 수정본을 개발 확인하려는 경우:

```sh
npm run dev:mobile
```

터미널의 **새 HTTPS 주소를 PC에서 먼저 열고** 해당 QR을 휴대폰으로 스캔합니다. PC와 실행 터미널을 켜두어야 하며 재실행마다 주소가 바뀝니다.

다른 터미널에서 현재 접속 상태 확인:

```sh
npm run mobile:status
```

`ready`일 때 주소를 출력하고 코드 0으로 종료합니다. 중지/불일치/접속 실패는 설명과 함께 코드 1로 종료합니다.

검증 명령:

```sh
npm run check
npm test
npm run build
npm run test:e2e
```

production 및 외부 HTTPS E2E 명령은 README에 있습니다.

## 8. 제한과 보안

- 파일당 기본 200MiB(209,715,200 bytes), 수신 보관 합계 200MiB, 파일 큐 20개, 기록 300개. 기존 수신 파일이 남아 있으면 새 파일을 받을 공간이 부족할 수 있으므로 저장 후 기록을 비웁니다.
- Room 최대 2 Peer, 대기 TTL 10분, JOIN IP당 분당 10회.
- QR/코드를 아는 사람은 참가할 수 있으며 별도 사용자 인증은 없습니다.
- HTTPS/WSS, origin/schema/payload 검사, 파일명 정제, React escaping 적용.
- 새로고침/새 연결/서버 재시작 후 기록이나 전송은 복구하지 않습니다.
- 일부 NAT/방화벽에는 TURN이 필요합니다. `TURN_SECRET`을 통한 임시 인증정보 발급은 구현됐으며 실제 운영 TURN 서버 연결과 검증이 남아 있습니다.
- `.env`, 로컬 로그/터널 상태/실행 파일, 테스트 산출물은 Git에서 제외합니다.

## 9. 남은 작업

| 순서 | 작업 | 필요한 조건 |
|---|---|---|
| 1 | 실제 iPhone/Android QR·전송·저장 | 사용자 연결 제보에 더해 OS별 전송·저장 확인 |
| 2 | 서로 다른 통신망 및 TURN 확인 | 운영 TURN 서버/단기 credential |
| 3 | 로컬 Docker Compose 실행/healthcheck 검증 | Docker 실행 환경 |
| 4 | 200MiB 경계·장시간·백그라운드 | 실기기 메모리/네트워크 검증 |

Remember Device, PWA, Share Target, 3대 이상 연결, Offline Drop, Push, Transfer Resume는 원래 MVP 범위 밖이며 미구현입니다.

## 10. 문서 안내

- [README.md](./README.md): 사용 및 개발 시작
- [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md): 전체 코드/인프라 구성
- [PROJECT_STATUS.md](./PROJECT_STATUS.md): 진행 현황과 작업 인수인계
- [VALIDATION.md](./VALIDATION.md): 실제 검사 결과 및 한계
- [DEPLOYMENT.md](./DEPLOYMENT.md): 출시 주소·환경 설정·검증·복구 절차
- [OPTIMIZATION.md](./OPTIMIZATION.md): 최적화 수치와 회귀 검사
- [SEARCH.md](./SEARCH.md): 무료 검색 접근 구성과 검색엔진 제출 상태
