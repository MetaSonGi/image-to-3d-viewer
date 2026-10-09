# 📷 이미지 → 3D 뷰어 (Image to 3D Viewer)

2D 이미지를 업로드하면 **깊이 맵(Depth Map)** 을 생성하고, **Three.js**로 입체적인 3D 뷰를 만들어주는 웹 앱입니다.
100% 클라이언트 사이드 동작 — 이미지가 서버로 전송되지 않습니다.

## ✨ 주요 기능

- 🖱️ **드래그 & 드롭 / 파일 선택** 이미지 업로드 (JPG, PNG, WebP)
- 📸 **카메라로 찍기**: 폰·PC 카메라로 바로 촬영해서 3D 변환 (HTTPS 환경에서 동작)
- 🎨 이미지 없이 체험할 수 있는 **테스트 패턴 생성** 버튼
- 🌫️ **깊이 맵 생성**: 밝기(luminance) 추출 → 박스 블러 반복(가우시안 근사) → 정규화
- 🧊 **3D 뷰**: 깊이 값으로 정점을 밀어낸 변위 평면(displaced plane) 렌더링
- 🎛️ **깊이 강도 슬라이더**, **와이어프레임 토글**, **자동 회전 토글**
- 🖱️ **마우스 패럴랙스**: 마우스를 움직이면 시점이 부드럽게 따라다님
- 🖼️ **3개 탭**: 원본 / 깊이 맵 / 3D 뷰
- 🌙 다크 모던 UI (한국어)

> 이미지는 자동으로 **최대 512px**로 축소되어 처리됩니다 (성능 최적화).

## 🚀 실행 방법

빌드 과정이 필요 없습니다. 정적 파일만으로 동작합니다.

**방법 1 — 브라우저에서 바로 열기**

```bash
# index.html 파일을 브라우저로 열기 (더블클릭)
```

> ⚠️ `file://`로 열면 ES 모듈 + importmap이 브라우저 보안 정책에 막힐 수 있습니다.
> 아래 로컬 서버 방식을 권장합니다.

**방법 2 — 로컬 서버 (권장)**

```bash
cd image-to-3d-viewer
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

Three.js는 CDN(importmap, `unpkg`)에서 불러오므로 인터넷 연결이 필요합니다.

## 🔧 동작 원리

```
이미지 업로드
   ↓ (최대 512px 다운스케일)
밝기 추출: luminance = 0.299R + 0.587G + 0.114B
   ↓
박스 블러 2회 반복 (분리형, 가로+세로) → 부드러운 깊이 맵
   ↓
min-max 정규화 (0~1)
   ↓
PlaneGeometry 정점을 깊이값 × 강도만큼 Z축으로 변위
   ↓
Three.js 렌더링 (MeshStandardMaterial + 조명 + 마우스 패럴랙스)
```

밝은 픽셀 = 앞으로 튀어나오고, 어두운 픽셀 = 뒤로 들어갑니다.

## 🖼️ 스크린샷

| 원본 | 깊이 맵 | 3D 뷰 |
|------|---------|-------|
| _(스크린샷 추가 예정)_ | _(스크린샷 추가 예정)_ | _(스크린샷 추가 예정)_ |

## 📁 파일 구조

```
image-to-3d-viewer/
├── index.html   # UI 구조 + importmap (Three.js CDN)
├── style.css    # 다크 모던 UI 스타일
├── app.js       # 이미지 처리 + 깊이 맵 + Three.js 렌더링
├── README.md
└── .gitignore
```

## 🛠️ 기술 스택

- Three.js `0.160.0` (CDN, ES 모듈)
- Canvas 2D API (이미지 처리, 깊이 맵 생성)
- 순수 HTML/CSS/JS — 빌드 도구 불필요

---

## English Summary

A client-side web app that converts a 2D image into an interactive 3D view.
It generates a depth map from image luminance (box-blur smoothing + normalization)
and renders it as a displaced plane in Three.js. Features drag & drop upload,
depth-strength slider, wireframe toggle, auto-rotate, and mouse parallax —
all in a dark modern Korean UI. No build step; just serve the folder statically.
