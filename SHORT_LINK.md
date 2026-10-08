# QuickDrop 짧은 접속 링크

등록·확인일: **2026-10-09 (Asia/Seoul)**

| 항목 | 값 |
|---|---|
| 직접 입력할 주소 | **`da.gd/qd20`** |
| HTTPS 링크 | **https://da.gd/qd20** |
| 이동 대상 | **https://dropgo.up.railway.app/** |
| 등록 비용 | 별도 도메인 구매·계정 가입·유료 결제 없이 발급 |
| 용도 | QuickDrop 홈페이지 접속 |

## 사용 방법

브라우저 주소창에 `da.gd/qd20`을 입력합니다. 새로 만든 링크에 대한 보안 안내가 나오면 **`https://dropgo.up.railway.app/`** 을 눌러 이동합니다. 이 안내는 da.gd의 신규 링크 처리 정책이며 QuickDrop 로그인이나 결제 화면이 아닙니다. [공식 홈페이지](https://da.gd/), [공식 구현의 신규 링크 안내](https://github.com/dagd/dagd/blob/master/src/applications/shorten/DaGdShortenController.php)

첫 기기의 QuickDrop 화면에서 QR을 휴대폰으로 스캔하거나, 다른 PC에서도 홈페이지를 열고 6자리 코드를 입력합니다. 자료 전송과 대화방 사용 방법은 [README.md](./README.md#짧은-주소로-바로-사용하기)에 있습니다.

짧은 주소로 접속해도 최종 페이지의 origin은 기존 Railway 주소입니다. QR, WebSocket, canonical, 검색 사이트맵, 저장된 기기별 기록도 기존 주소를 계속 사용합니다. 단축 링크 서비스에는 공개 홈페이지 주소만 등록했으며 임시 Room 참가 주소·owner token·resume token·전송 자료를 제출하지 않았습니다.

## 발급과 확인

- 요청한 `is.gd/qd200`은 공식 API의 GET·POST 등록 요청에서 `Error, database insert failed`를 반환했고 직접 접속도 404였습니다. 이름을 바꾼 요청에도 같은 오류가 나타났습니다. 따라서 발급 완료 링크로 안내하지 않습니다. [is.gd 공식 API](https://is.gd/apishorteningreference.php)
- da.gd 공식 단축 API로 `qd20` 별칭을 등록했고 응답은 **HTTP 200, `https://da.gd/qd20`** 이었습니다. [공식 도움말](https://da.gd/help)
- 등록한 짧은 주소의 HTML 보안 안내가 **HTTP 200**이며 실제 홈페이지를 가리키는 링크가 있음을 확인했습니다. 이동 대상 홈페이지와 `/api/health`도 **HTTP 200**이며 정상입니다.
- 실제 Chromium 브라우저의 **393×852 모바일 화면**에서 짧은 링크 → 신규 링크 안내의 목적지 클릭 → QuickDrop 화면과 6자리 연결 코드 표시를 확인했습니다. 최종 origin은 기존 운영 주소와 일치합니다. 이미지 확인 파일은 Git 제외 `artifacts/short-link-mobile.png`입니다.
- `da.gd/qd200`도 등록 응답은 받았지만 실제 접속 확인에서 404가 나와 현재 안내 주소로 사용하지 않습니다. README에는 접속이 확인된 `da.gd/qd20`만 빠른 접속 주소로 표시합니다.

보안 안내가 표시되는 시점의 동작을 설명하는 것으로, 즉시 자동 리다이렉트나 안내 화면의 종료 시점을 보장하지 않습니다. 원래 주소를 표시하는 화면에서 목적지 링크를 누르면 QuickDrop을 사용할 수 있습니다.

## 운영

- 짧은 주소가 열리지 않으면 원래 주소 https://dropgo.up.railway.app/ 를 직접 엽니다.
- 주소를 자주 입력하지 않으려면 **접속한 QuickDrop 페이지**를 북마크 또는 홈 화면 바로가기로 저장합니다.
- 새 운영 도메인으로 이전할 때는 먼저 새 주소의 정상 접속을 확인하고 단축 링크와 문서를 갱신합니다. 짧은 링크를 생성하기 위해 `PUBLIC_URL`을 단축 주소로 바꾸지 않습니다.
- 이 링크의 등록을 위해 QuickDrop 코드, Railway 도메인·환경 변수, 검색 설정을 변경하지 않았습니다. 홈페이지에 들어오는 방법과 사용자 문서를 추가한 작업입니다.
- 단축 서비스의 가용성은 별도 운영 범위입니다. 자동 만료가 없거나 영구히 동작한다고 약속하지 않으며 원래 주소도 함께 안내합니다.

공개 등록 정보와 HTTP 확인 결과는 로컬의 Git 제외 파일 `.quickdrop/short-link.json`에도 보관합니다. 인증정보는 포함하지 않습니다.
