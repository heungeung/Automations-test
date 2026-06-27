# Korean Stock Research PWA

한국 상장 종목의 현재가, 일봉/주봉/월봉 차트, 10% 이상 보유 ETF를 확인하는 설치형 웹앱(PWA) 프로젝트입니다.

## 사용 방법

GitHub Pages로 배포한 뒤 Android Chrome에서 홈 화면에 추가해 앱처럼 사용할 수 있습니다.

종목코드는 6자리 숫자로 입력합니다. 예: `005930`

## 데이터

- 현재가와 차트는 Yahoo Finance 차트 API 형식의 한국 심볼(`.KS`, `.KQ`)을 사용합니다.
- 브라우저 CORS 제한이 있을 수 있어 직접 호출 실패 시 공개 CORS 프록시를 fallback으로 사용합니다.
- ETF 편입 정보는 `etf-holdings-kr.json`의 로컬 데이터셋을 기준으로 계산합니다.
- ETF 편입 비중은 자주 바뀌므로 실제 서비스에서는 운용사/거래소 공시 데이터로 갱신해야 합니다.
