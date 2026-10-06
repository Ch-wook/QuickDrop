# QuickDrop 최적화 기록

검증일: 2026-10-06. 최적화본을 https://dropgo.up.railway.app 에 배포했습니다. 아래 측정은 로컬 빌드 기준이며, 운영 서버가 같은 JS/CSS와 압축·캐시 설정을 제공하는 것은 `npm run deploy:verify -- https://dropgo.up.railway.app` 통과로 확인했습니다.

## 측정 결과

| 항목 | 변경 전 | 변경 후 | 의미 |
|---|---:|---:|---|
| 초기 JS 원본 | 371,575 bytes | 348,361 bytes | QR 생성 코드 지연 로딩 |
| Vite의 초기 JS gzip 예상치 | 115.98 kB | 106.78 kB | 초기 JS 약 7.9% 감소 |
| 새 초기 JS Brotli 파일 | 없음 | 92,258 bytes | 운영 서버가 사전 압축 파일을 제공 |
| 1 MiB + 37 bytes 파일 읽기 | 65회 | 5회 | 16 KiB 전송 청크 유지, 읽기만 최대 256 KiB씩 묶음 |
| 제한기 5,000개 키에서 10,000회 검사 | 405.75ms | 0.84ms | 동일 Windows/Node 환경, 5회 측정 중앙값 |

제한기 수치는 전체 서비스 처리량이 아닌 해당 함수의 고정 시간 벤치마크입니다. 네트워크 전송 속도 향상을 보장하는 측정은 아닙니다. QR을 실제 표시하면 별도 25.84 kB 코드(gzip 약 10.14 kB)도 로딩하므로 전체 JS 용량 감소로 해석하면 안 됩니다. 새로운 분할 로딩/안정성 코드 때문에 전체 JS 원본은 약간 늘었습니다.

## 적용 사항

- QR 라이브러리는 HTTPS 참가 링크가 준비됐을 때 로딩합니다.
- 전송 카드에 memo와 안정적인 callback을 적용해 입력 중 변경 없는 기록의 렌더링을 줄였습니다. 이미지 미리보기는 지연 로딩/비동기 디코딩합니다.
- 파일을 최대 256 KiB씩 읽고 16 KiB로 나누어 보냅니다. 전송 버퍼 상한과 취소 확인은 각 청크에 유지하며 중간 배열 복사를 줄였습니다.
- 수신 기록이 300개로 가득 찼을 때 해당 전송만 거절하고 연결은 유지합니다. 기록을 비운 뒤 다시 수신할 수 있습니다.
- 취소와 기록 삭제, 종료 직전 Blob 변환의 경쟁 상태를 처리했습니다.
- 설정/Room 생성에 15초, 연결 협상에 30초 제한을 적용했습니다. 종료된 세션의 늦은 응답이 새 연결을 만들지 않습니다.
- TURN을 설정한 경우 새 Peer 협상마다 임시 인증정보를 갱신합니다. 현재 연결을 유지하는 중간 갱신/ICE restart는 별도 범위입니다.
- 요청 제한기는 단조 증가 시간을 사용하고 만료된 앞부분만 정리합니다. 활성 키 전체를 매 요청마다 탐색하지 않습니다.
- 운영 모드의 잘못된 WebSocket Upgrade 경로를 즉시 거부합니다. 서버 종료는 중복 호출에 안전하며 미완료 HTTP 응답도 5초 후 종료합니다.
- 빌드 시 JS/CSS의 Brotli/gzip 사본을 생성합니다. 요청 시 압축 CPU 비용 없이 사전 압축 파일을 제공하고 encoding 품질값·HEAD·ETag를 처리합니다.
- 해시 자산은 1년 immutable 캐시, HTML은 매번 재검증합니다. 이전 HTML이 새 배포의 자산과 섞이지 않도록 합니다.
- 개발 의존성 `source-map-js`를 1.2.2로 갱신해 audit에서 발견한 취약점 1개를 해소했습니다. 새 직접 의존성은 추가하지 않았습니다.

## 검증

- 단위/통합: **9개 파일, 83개 통과**.
- TypeScript/운영 빌드: 통과.
- 새 로컬 운영 빌드 E2E: **8개 통과, 4개 skip**. skip은 중복 교차 엔진 2개와 Windows WebKit의 WebRTC 미지원 2개입니다.
- 배포된 최적화본 공개 HTTPS E2E: **Chromium·Firefox 2개 통과, 16.0초**. QR 해독, WSS, 실제 DataChannel, 텍스트 및 72,000-byte 파일의 다운로드 일치를 검사했습니다.
- `npm audit --json`: 알려진 취약점 **0개**.
- 압축 검사는 실제 HTTP 응답을 Brotli/gzip 해제하여 원본과 비교하고, encoding q=0·identity·406·HEAD·304·경로 접근·캐시를 검사합니다.
- 새 배포 판별: healthcheck와 PUBLIC_URL 외에 HTML의 자산 해시, JS/CSS 실제 내용, 압축 및 캐시 설정을 검증합니다.

## 배포 확인

배포 코드 `91aba3b`의 Railway 배포가 성공했습니다. 공개 서버가 `index-DlbgtMzG.js`와 `index-DFBmzxZh.css`를 제공하며 로컬 빌드와 해시·내용이 일치합니다. Brotli/캐시 응답, healthcheck 및 PUBLIC_URL도 검증했습니다. CLI는 여전히 `Unauthorized`이지만 GitHub Source로 배포를 완료했습니다. 후속 푸시만으로 자동 배포가 시작되는지는 미검증입니다. 배포 ID와 상세 상태는 [DEPLOYMENT.md](./DEPLOYMENT.md)를 참고하세요.

```powershell
npm run build
npm run deploy:verify -- https://dropgo.up.railway.app
$env:E2E_BASE_URL = 'https://dropgo.up.railway.app'
npm run test:e2e -- --project=chromium --project=firefox
Remove-Item Env:E2E_BASE_URL
```

첫 검증 명령이 다른 빌드라고 실패하면 GitHub 푸시만으로 새 버전이 배포됐다고 간주하지 않습니다. 실제 iPhone/Android, 이동통신망, 운영 TURN 강제 relay, 100 MiB 경계/장시간 전송은 추가 검증이 필요합니다.
