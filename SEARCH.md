# QuickDrop 검색 접근

정리일: 2026-10-06. 사용자는 별도 비용 없이 검색으로 서비스를 찾는 방식을 선택했습니다. 도메인이나 광고를 구매하지 않고 **https://dropgo.up.railway.app/** 을 유지합니다.

## 준비한 구성

- 한국어 제목 `퀵드롭 QuickDrop | QR로 PC·휴대폰 파일 전송`, 검색 설명과 Open Graph 정보를 추가했습니다.
- canonical은 홈페이지 주소를 가리키며, HTML에는 JavaScript 실행 전에도 읽을 수 있는 서비스 설명과 JavaScript 필요 안내가 있습니다.
- `public/sitemap.xml`에는 홈페이지 한 개만 담았습니다. 임시 `/join/{roomId}` 주소와 전송 자료는 검색엔진에 제출하지 않습니다.
- `public/robots.txt`는 홈페이지 수집을 허용하고 `/api/`, `/ws`를 제외합니다. `/join/`은 robots.txt로 차단하지 않아 검색로봇이 HTTP `X-Robots-Tag: noindex, nofollow, noarchive`를 읽을 수 있습니다.
- 임시 참가 링크와 API/WS에는 위 검색 제외 응답 헤더를 적용했습니다. 검색 제외는 접근 인증을 대신하지 않으며 QR/연결 코드를 아는 사람의 참가 방식은 그대로입니다.

검색용 변경은 코드에 반영됐으며 운영 반영과 네이버 제출 결과는 배포 후 확인합니다. 현재 이 문서에 기록된 실제 제출 결과는 없습니다. 색인 등록, 노출 시점이나 검색 순위를 보장하지 않습니다. 네이버도 IndexNow의 목적을 변경 알림으로 설명하며 색인을 보장하지 않는다고 안내합니다. [네이버 공식 소개](https://searchadvisor.naver.com/guide/indexnow-about)

## 네이버에 홈페이지 변경 알리기

네이버는 IndexNow를 지원합니다. `scripts/search-submit.mjs`는 배포된 소유 증명 파일의 내용과 홈페이지 접근 가능 여부를 확인한 뒤 홈페이지 URL 한 개만 네이버에 POST합니다.

```sh
npm run search:submit -- https://dropgo.up.railway.app
```

먼저 `public/<IndexNow-key>.txt`가 같은 공개 서버에 배포되어 있어야 합니다. 이 파일은 의도적으로 공개하는 사이트 소유 증명이며 Railway·GitHub·Google 계정의 로그인 토큰이 아닙니다. 계정 인증정보나 Room URL을 제출하지 않습니다.

결과는 Git에서 제외된 `.quickdrop/search-submission.json`에 저장합니다. HTTP `200`은 요청 수신 성공, `202`는 수신 후 키 확인 대기입니다. 둘 다 검색 결과 노출을 확인한 상태가 아닙니다. [네이버 요청 형식과 응답 코드](https://searchadvisor.naver.com/guide/indexnow-request)

## Google 확인은 선택 사항

소유자가 Google Search Console에 `https://dropgo.up.railway.app/`을 **URL 접두어 속성**으로 추가하고 제공받은 HTML 파일 또는 메타 태그로 소유권을 확인할 수 있습니다. 제공된 실제 검증값을 사용해야 하며 현재 저장소에는 임의의 Google/Naver 계정 검증 태그를 넣지 않았습니다. [Google 소유권 확인 안내](https://support.google.com/webmasters/answer/9008080?hl=en)

소유권 확인 후 홈페이지 URL 검사에서 색인 생성을 요청하거나 `https://dropgo.up.railway.app/sitemap.xml`을 제출할 수 있습니다. Google 계정 연결·소유권 확인·수동 색인 요청은 아직 수행하지 않았습니다. 요청해도 즉시 검색에 나타나는 것은 아닙니다. [Google 재크롤링 요청 안내](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl?hl=ko)

## 주소가 바뀌면

`index.html`의 canonical·Open Graph URL, `public/sitemap.xml`, `public/robots.txt`의 Sitemap URL, `PUBLIC_URL`을 함께 바꿉니다. 검색 제출 스크립트의 기본 origin도 갱신하거나 새 origin을 인자로 전달합니다. 소유 증명 파일을 새 주소에 배포하고 검증한 다음 새 홈페이지를 제출합니다. 현재 메타데이터와 사이트맵은 기존 운영 origin을 명시한 정적 파일입니다.
