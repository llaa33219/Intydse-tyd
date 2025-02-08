/******************************************************************* 
 * 전역에서 쓸 "스토리지 설정" 관련 변수들 + 로딩, 감시
 *******************************************************************/
let allowHtml = false;
let allowMarkdown = false;
let allowJs = false;
let extensionEnabled = true; // 기본값: true 라 가정

// 1) 초기 로딩
chrome.storage.sync.get(
  ["enableExtension", "allowHtml", "allowMarkdown", "allowJs"],
  (result) => {
    extensionEnabled = (result.enableExtension !== false); 
    allowHtml = !!result.allowHtml;
    allowMarkdown = !!result.allowMarkdown;
    allowJs = !!result.allowJs;

    // 확장 기능 on/off 설정값이 false일 경우, 초기에 중단상태로 시작
    if (!extensionEnabled) {
      stopEntrystoryScript();
    }
  }
);

// 2) 변경 감지
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.enableExtension) {
      extensionEnabled = !!changes.enableExtension.newValue;
      // 사용자가 저장된 값을 바꾸면, 그 즉시 반영
      if (!extensionEnabled) {
        stopEntrystoryScript();
      } else {
        startEntrystoryScript();
      }
    }
    if (changes.allowHtml) {
      allowHtml = !!changes.allowHtml.newValue;
    }
    if (changes.allowMarkdown) {
      allowMarkdown = !!changes.allowMarkdown.newValue;
    }
    if (changes.allowJs) {
      allowJs = !!changes.allowJs.newValue;
    }
  }
});

// 3) popup.js에서 보내는 메시지 수신 -> on/off
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "enableScript") {
    extensionEnabled = true;
    startEntrystoryScript();
  } else if (request.action === "disableScript") {
    extensionEnabled = false;
    stopEntrystoryScript();
  }
});

/*******************************************************************
 * [추가] 글/댓글 내용에서 HTML/마크다운 실행 허용 여부를 반영하기 위한 함수
 *       (자바스크립트 허용 관련 로직은 전부 제거)
 *******************************************************************/
function sanitizeUserContent(rawContent) {
  let result = rawContent;

  // 1) HTML 코드 자체를 허용 안 할 때, <script> 태그도 제거
  if (!allowHtml) {
    // <script>...</script> 제거
    result = result.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    // onXXX= 같은 인라인 스크립트 제거 (HTML OFF일 때는 이런 속성도 불허)
    result = result.replace(/\son\w+="[^"]*"/gi, '');
    result = result.replace(/\son\w+='[^']*'/gi, '');

    // 그리고 HTML 태그를 전부 escape
    result = result
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 2) 마크다운 허용 시, 간단 파서 적용
  if (allowMarkdown) {
    result = parseMarkdown(result);
  }

  return result;
}

/*******************************************************************
 * [수정: 마크다운 파싱 로직 강화]
 *******************************************************************/
function parseMarkdown(text) {
  let parsed = text;

  // 코드 블럭
  parsed = parsed.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // 인라인 코드
  parsed = parsed.replace(/`([^`]+)`/g, '<code>$1</code>');

  // **볼드**
  parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // *이탤릭*
  parsed = parsed.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // ~~취소선~~
  parsed = parsed.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // 확장 헤딩 (H4 ~ H6)
  parsed = parsed.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
  parsed = parsed.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
  parsed = parsed.replace(/^#### (.*)$/gm, '<h4>$1</h4>');

  // 헤딩 (H1 ~ H3)
  parsed = parsed.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  parsed = parsed.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  parsed = parsed.replace(/^# (.*)$/gm, '<h1>$1</h1>');

  // 인용구
  parsed = parsed.replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');

  // 수평선
  parsed = parsed.replace(/^-{3,}$/gm, '<hr/>');

  // 이미지
  parsed = parsed.replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // 링크
  parsed = parsed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 순서없는 리스트
  parsed = parsed.replace(/^(\*|\+|\-)\s+(.*)/gm, '<ul><li>$2</li></ul>');
  // 여러 줄에 걸쳐 나온 UL 병합
  while (/<\/ul>\s*<ul>/.test(parsed)) {
    parsed = parsed.replace(/<\/ul>\s*<ul>/g, '');
  }

  // 순서있는 리스트
  parsed = parsed.replace(/^(\d+)\.\s+(.*)/gm, '<ol><li>$2</li></ol>');
  // 여러 줄에 걸쳐 나온 OL 병합
  while (/<\/ol>\s*<ol>/.test(parsed)) {
    parsed = parsed.replace(/<\/ol>\s*<ol>/g, '');
  }

  // 줄바꿈 -> <br/>
  parsed = parsed.replace(/\n/g, '<br/>');

  return parsed;
}

/*******************************************************************
 * [추가] 실제로 <script> 태그가 동작하도록 재삽입하는 함수
 *   - allowJs=true 인 상태에서 <script>...</script>를
 *     innerHTML 으로 넣으면 실행 안 되므로 새 <script> 엘리먼트로 교체
 *******************************************************************/
function reInjectInlineScripts(parentEl) {
  if (!allowJs) return; // 허용이 아니면 수행 안 함

  const scriptEls = parentEl.querySelectorAll('script');
  scriptEls.forEach((oldScript) => {
    const newScript = document.createElement('script');
    // 속성 복사
    for (let i = 0; i < oldScript.attributes.length; i++) {
      const attr = oldScript.attributes[i];
      newScript.setAttribute(attr.name, attr.value);
    }
    // 본문 복사
    newScript.textContent = oldScript.textContent;
    // 교체
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}


/*******************************************************************
 * 기존 콘탠츠 스크립트 원본 코드 (질문에서 주신 부분 유지)
 *******************************************************************/


/*******************************************************************
 * 0) [추가] 히스토리 변경감지(새로고침 없이 pushState/replaceState/push 등)
 *******************************************************************/

// 중복 삽입 방지 플래그
if (!window.__entryStory_list_urlChangeHookInjected__) {
  window.__entryStory_list_urlChangeHookInjected__ = true;

  // pushState 훅킹
  (function (history) {
    const origPushState = history.pushState;
    history.pushState = function () {
      const ret = origPushState.apply(history, arguments);
      window.dispatchEvent(new Event('urlchange'));
      return ret;
    };
  })(window.history);

  // replaceState 훅킹
  (function (history) {
    const origReplaceState = history.replaceState;
    history.replaceState = function () {
      const ret = origReplaceState.apply(history, arguments);
      window.dispatchEvent(new Event('urlchange'));
      return ret;
    };
  })(window.history);

  // popstate: 뒤로가기/앞으로가기
  window.addEventListener('popstate', function () {
    window.dispatchEvent(new Event('urlchange'));
  });

  // ---------------------------------------------------------------
  // [추가] location.href 직접 변경 시 등도 주기적으로 감지 (폴백)
  // ---------------------------------------------------------------
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      window.dispatchEvent(new Event('urlchange'));
    }
  }, 500);
}

/*******************************************************************
 * 1) [추가] "해당 URL인지" 판별하는 헬퍼 + 코드 실행/중단
 *******************************************************************/

function isValidEntrystoryUrl() {
  const urlObj = new URL(location.href);
  if (urlObj.pathname !== "/community/entrystory/list") {
    return false;
  }

  const term = urlObj.searchParams.get("term");
  const sort = urlObj.searchParams.get("sort");

  // [수정] score 추가
  const validTerms = ["all", "created"];
  const validSorts = ["all", "created", "commentsLength", "likesLength", "score"];

  if (!validTerms.includes(term)) return false;
  if (!validSorts.includes(sort)) return false;

  return true;
}

// 코드 중복 실행/중단 방지용 플래그
let scriptStarted = false;
// intervalId 저장
let mainIntervalId = null;

/*******************************************************************
 * 2) [추가] "메인 스크립트"를 시작하는 함수 (기존 코드 전부 포함)
 *******************************************************************/

// (글 ID 저장용)
const knownIds = new Set();
let isFirstFetch = true;

// [추가] '더보기' 메뉴 바깥 클릭 시 닫기 위한 핸들러 변수
let docClickHandlerForMoreMenus = null;

function startEntrystoryScript() {
  if (scriptStarted) return; // 이미 실행 중이면 중복 방지
  scriptStarted = true;

  // 매번 초기화
  knownIds.clear();
  isFirstFetch = true;

  /*************************************************
   * [원본 코드 시작 - 내용 그대로 유지]
   *************************************************/

  /*************************************************
   * 0) HTML에서 csrf-token, x-token 추출
   *************************************************/
  function getTokensFromDom() {
    let csrfToken = "";
    let xToken = "";

    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      csrfToken = metaTag.getAttribute('content') || "";
    }

    const nextDataScript = document.querySelector('#__NEXT_DATA__');
    if (nextDataScript) {
      try {
        const json = JSON.parse(nextDataScript.textContent);
        // xToken: props.initialState.common.user.xToken
        xToken = json?.props?.initialState?.common?.user?.xToken || "";
      } catch (e) {}
    }
    return { csrfToken, xToken };
  }

  /*************************************************
   * 1) GraphQL API 호출 설정 (게시글 목록용)
   *************************************************/
  const requestOptions = {
    headers: {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9,ko-KR;q=0.8,ko;q=0.7",
      "content-type": "application/json",
      // 초기값(나중에 실제 HTML에서 파싱해 덮어씀)
      "csrf-token": "",
      "priority": "u=1, i",
      "sec-ch-ua": "\"Not(A:Brand\";v=\"24\", \"Chromium\";v=\"122\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-client-type": "Client",
      // 초기값(나중에 실제 HTML에서 파싱해 덮어씀)
      "x-token": ""
    },
    referrer: "https://playentry.org/community/entrystory/list?sort=created&term=all",
    referrerPolicy: "unsafe-url",
    body: JSON.stringify({
      query: `
      query SELECT_ENTRYSTORY(
        $pageParam: PageParam
        $query: String
        $user: String
        $category: String
        $term: String
        $prefix: String
        $progress: String
        $discussType: String
        $searchType: String
        $searchAfter: JSON
        $tag: String
      ){
        discussList(
          pageParam: $pageParam
          query: $query
          user: $user
          category: $category
          term: $term
          prefix: $prefix
          progress: $progress
          discussType: $discussType
          searchType: $searchType
          searchAfter: $searchAfter
          tag: $tag
        ) {
          total
          list {
            id
            content
            created
            commentsLength
            likesLength
            user {
              id
              nickname
              username
              profileImage {
                id
                name
                label {
                  ko
                  en
                  ja
                  vn
                }
                filename
                imageType
                dimension {
                  width
                  height
                }
                trimmed {
                  filename
                  width
                  height
                }
              }
              status {
                following
                follower
              }
              description
              role
              mark {
                id
                name
                label {
                  ko
                  en
                  ja
                  vn
                }
                filename
                imageType
                dimension {
                  width
                  height
                }
                trimmed {
                  filename
                  width
                  height
                }
              }
            }
            image {
              id
              name
              label {
                ko
                en
                ja
                vn
              }
              filename
              imageType
              dimension {
                width
                height
              }
              trimmed {
                filename
                width
                height
              }
            }
            sticker {
              id
              name
              label {
                ko
                en
                ja
                vn
              }
              filename
              imageType
              dimension {
                width
                height
              }
              trimmed {
                filename
                width
                height
              }
            }
            isLike
          }
          searchAfter
        }
      }
      `,
      variables: {
        "category": "free",
        "searchType": "scroll",
        "term": "all",
        "discussType": "entrystory",
        "pageParam": {
          "display": 10,
          "sort": "created"
        }
      }
    }),
    method: "POST",
    mode: "cors",
    credentials: "include"
  };

  /*************************************************
   * (아래에 댓글/좋아요/스티커 등 기존 로직 존재)
   *************************************************/

  // 날짜 포맷
  function formatDate(dateString) {
    const d = new Date(dateString);
    const year = String(d.getFullYear()).slice(-2);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ・ ${hour}:${minute}`;
  }

  /*******************************************************************
   * [수정] convertLinks 함수: 
   *        "https://", "http://" 로 시작하면 그대로 링크화,
   *        그 외에는 "http://"를 붙여 링크화
   *******************************************************************/
  function convertLinks(content) {
    // [포인트] capture (그룹) 사용: 
    //   "https://", "http://" 등을 포함할 수 있게 정규식 확장
    //   ( + domain 형태 전부 일괄로 잡아옴 )
    return content.replace(
      /\b((https?:\/\/)?[a-z0-9\-]+\.[a-z0-9.\-]+(?:\/[^\s]*)?)\b/gi,
      (match, p1) => {
        // 이미 "http://" 또는 "https://"로 시작하면 그대로
        if (/^https?:\/\//i.test(p1)) {
          return `<a target="_blank" href="/redirect?external=${p1}" rel="noreferrer">${p1}</a>`;
        }
        // 그 외(프로토콜이 안붙은 경우)는 "http://" 붙여 링크
        return `<a target="_blank" href="/redirect?external=http://${p1}" rel="noreferrer">${p1}</a>`;
      }
    );
  }

  // "내 아바타" 파일명 얻기
  function getMyAvatarFilename() {
    const em = document.querySelector('em[data-testid="avatarButton"]');
    if (!em) return null;
    const styleAttr = em.getAttribute('style') || "";
    const match = styleAttr.match(/\/uploads\/([^)'"]+)/);
    if (!match) return null;
    const segments = match[1].split('/');
    return segments[segments.length - 1];
  }

  /***************************************************************
   * [추가] 스티커 로딩/미리보기 UI 등
   ***************************************************************/
  async function fetchAllStickerSets() {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    const stickerIds = [
      "6049a7d7cea5c400506e9bee",
      "63a15d244a098f0076fbcf6f",
      "667d24f09776a4d6c18f1312",
      "667d25049776a4d6c18f176c"
    ];

    const promises = stickerIds.map((id) => {
      const bodyJson = {
        query: `
          query SELECT_STICKER($id: ID) {
            sticker(id: $id) {
              id
              title
              stickers {
                id
                name
                filename
                imageType
              }
            }
          }
        `,
        variables: { id }
      };

      return fetch("https://playentry.org/graphql/SELECT_STICKER", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrf,
          "x-token": xtoken
        },
        credentials: "include",
        body: JSON.stringify(bodyJson)
      })
      .then(r => r.json())
      .then(json => json?.data?.sticker);
    });

    const results = await Promise.all(promises);
    return results.filter(Boolean);
  }

  function createStickerPopupHtml() {
    return `
<div class="css-1viloiz e1h77j9v4" style="display: none;">
  <div id="stickerPopupInner" style="padding:8px;">
    <p style="font-size:14px;">스티커 불러오는 중...</p>
  </div>
</div>
    `.trim();
  }

  async function loadStickersIntoPopup(popupEl) {
    const allSets = await fetchAllStickerSets();
    if (!allSets || allSets.length === 0) {
      popupEl.innerHTML = `<p style="color:red">스티커 세트를 불러올 수 없습니다.</p>`;
      return;
    }

    const tabIcons = [
      "/uploads/x3/bo/x3boffn0laut8eh811n2df90a1b5rwut.svg",
      "/uploads/mc/3w/mc3w1gi8lbvvke6f16jaf1cfe40ifdzt.svg",
      "/uploads/60/62/60625380lxx0i0xl001a1c9a956nhrlt.png",
      "/uploads/d4/2b/d42b92felxx0igbl0013c50459dubj7n.png"
    ];

    let tabBtnsHtml = "";
    allSets.forEach((setData, idx) => {
      const isSelected = (idx === 0) ? `<span class="blind">선택됨</span>` : "";
      const safeTitle = setData.title || `Set${idx+1}`;
      const iconUrl = tabIcons[idx] || tabIcons[0];

      tabBtnsHtml += `
        <li class="css-1nidk14 ep1nhyt2" data-tab="${idx + 1}">
          <button type="button">
            <img src="${iconUrl}"
                 width="55" height="39"
                 alt="${safeTitle}">
          </button>
          ${isSelected}
        </li>
      `;
    });

    let tabsContentHtml = "";
    allSets.forEach((setData, idx) => {
      const showStyle = (idx === 0) ? `style="display:block;"` : `style="display:none;"`;
      let liImgs = "";
      setData.stickers.forEach((st) => {
        const sub1 = st.filename.substring(0,2);
        const sub2 = st.filename.substring(2,4);
        let url = `/uploads/${sub1}/${sub2}/${st.filename}`;
        if (st.imageType) {
          url += `.${st.imageType}`;
        }

        liImgs += `
          <li>
            <span>
              <img src="${url}"
                   alt="${st.name}"
                   style="width:300px; height:300px; cursor:pointer;"
                   data-sticker-id="${st.id}">
            </span>
          </li>
        `;
      });

      tabsContentHtml += `
        <ul data-content="${idx + 1}" ${showStyle}>
          ${liImgs}
        </ul>
      `;
    });

    popupEl.innerHTML = `
      <div class="css-16ih3f8 ep1nhyt5">
        <div class="css-zcg0zv ep1nhyt4">
          <button type="button" 
            class="btn_prev flicking-arrow-prev is-outside css-65blbf ep1nhyt1 flicking-arrow-disabled">
            <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg">
              <g fill="none" fill-rule="evenodd">
                <circle stroke="#16d8a3" cx="12" cy="12" r="11.5"></circle>
                <path d="m10.356 12 3.894 3.408a.545.545 0 0 1-.718.82l-4.364-3.817a.545.545 0 0 1 0-.821l4.364-3.819a.545.545 0 1 1 .718.821L10.356 12z" fill="#16d8a3"></path>
              </g>
            </svg>
            <span class="blind">스티커 탭 이전 보기</span>
          </button>

          <div data-select-index="1" class="css-xq7ycv ep1nhyt3">
            <div class="flicking-viewport">
              <ul class="flicking-camera">
                ${tabBtnsHtml}
              </ul>
            </div>
          </div>

          <button type="button" 
            class="btn_next flicking-arrow-next is-outside css-65blbf ep1nhyt1 flicking-arrow-disabled">
            <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg">
              <g fill="none" fill-rule="evenodd">
                <circle stroke="#16d8a3" cx="12" cy="12" r="11.5"></circle>
                <path d="m10.356 12 3.894 3.408a.545.545 0 0 1-.718.82l-4.364-3.817a.545.545 0 0 1 0-.821l4.364-3.819a.545.545 0 1 1 .718.821L10.356 12z" fill="#16d8a3"></path>
              </g>
            </svg>
            <span class="blind">스티커 탭 다음 보기</span>
          </button>
        </div>

        <div class="css-anbigi ep1nhyt0">
          ${tabsContentHtml}
        </div>
      </div>
    `;

    // 탭 전환
    const tabItems = popupEl.querySelectorAll('.css-1nidk14.ep1nhyt2');
    tabItems.forEach((li) => {
      li.addEventListener('click', () => {
        tabItems.forEach((x) => x.classList.remove('active'));
        li.classList.add('active');

        tabItems.forEach((x) => {
          const blind = x.querySelector('.blind');
          if (blind) blind.style.display = 'none';
        });
        const myBlind = li.querySelector('.blind');
        if (myBlind) myBlind.style.display = 'inline';

        const tabNum = li.getAttribute('data-tab');
        const allUl = popupEl.querySelectorAll('.css-anbigi.ep1nhyt0 > ul[data-content]');
        allUl.forEach((u) => { u.style.display = 'none'; });
        const showUl = popupEl.querySelector(`ul[data-content="${tabNum}"]`);
        if (showUl) showUl.style.display = 'block';
      });
    });

    // 스티커 선택 -> 미리보기
    const stickerImgs = popupEl.querySelectorAll('img[data-sticker-id]');
    stickerImgs.forEach((imgEl) => {
      imgEl.addEventListener('click', (e) => {
        const sid = imgEl.getAttribute('data-sticker-id') || "";
        window.__selectedStickerId = sid;

        const container = popupEl.closest('.edit-mode-li') || 
                          popupEl.closest('.css-4e8bhg.euhmxlr2');
        if (!container) {
          popupEl.style.display = 'none';
          return;
        }

        const previewContainer = container.querySelector('.css-fjfa6z.e1h77j9v3');
        if (previewContainer) {
          previewContainer.style.display = 'block';
          const previewImg = previewContainer.querySelector('img');
          if (previewImg) {
            previewImg.src = imgEl.src;
          }
        }

        popupEl.style.display = 'none';
      });
    });
  }

  function setupStickerUiEvents(container) {
    const popup = container.querySelector('.css-1viloiz.e1h77j9v4');
    const stickerBtn = container.querySelector('.css-1394o6u.e1h77j9v5');
    if (stickerBtn && popup) {
      stickerBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (popup.style.display === 'none') {
          popup.style.display = 'block';
          const innerDiv = popup.querySelector('#stickerPopupInner');
          if (innerDiv) {
            innerDiv.innerHTML = `<p style="font-size:14px;">스티커 로딩중...</p>`;
            await loadStickersIntoPopup(innerDiv);
          }
        } else {
          popup.style.display = 'none';
        }
      });
    }

    const closeStickerBtn = container.querySelector('.btn-close-sticker');
    if (closeStickerBtn) {
      closeStickerBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        resetStickerSelection(container);
      });
    }
  }

  function resetStickerSelection(container) {
    window.__selectedStickerId = null;
    const preview = container.querySelector('.css-fjfa6z.e1h77j9v3');
    if (preview) {
      preview.style.display = 'none';
      const pvImg = preview.querySelector('img');
      if (pvImg) {
        pvImg.src = "";
      }
    }
  }

  /***************************************************************
   * [추가] 글 수정(GraphQL)
   ***************************************************************/
  function repairEntrystory(discussId, content, stickerItem = null) {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    const bodyData = {
      query: `
        mutation REPAIR_ENTRYSTORY(
          $id: ID,
          $content: String,
          $image: String,
          $sticker: ID,
          $stickerItem: ID
        ){
          repairEntryStory(
            id: $id,
            content: $content,
            image: $image,
            sticker: $sticker,
            stickerItem: $stickerItem
          ) {
            id
            content
            created
            commentsLength
            likesLength
            isLike
            sticker {
              id
              filename
              imageType
            }
            user {
              id
              nickname
              username
              profileImage {
                filename
                imageType
              }
              mark {
                id
                filename
                imageType
              }
            }
          }
        }
      `,
      variables: {
        id: discussId,
        content: content,
        image: null,
        sticker: null,
        stickerItem: stickerItem
      }
    };

    const fetchOptions = {
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "csrf-token": csrf,
        "x-token": xtoken
      },
      body: JSON.stringify(bodyData),
      method: "POST",
      credentials: "include"
    };

    return fetch("https://playentry.org/graphql/REPAIR_ENTRYSTORY", fetchOptions)
      .then(res => {
        if (!res.ok) {
          throw new Error(`REPAIR_ENTRYSTORY failed: ${res.status}`);
        }
        return res.json();
      })
      .then(json => {
        const updated = json?.data?.repairEntryStory;
        if (!updated || !updated.id) {
          throw new Error("잘못된 수정 응답");
        }
        // ----- BugFix: 수정 성공 후 스티커ID 초기화 -----
        window.__selectedStickerId = null;

        return updated;
      });
  }

  /***************************************************************
   * [추가] "수정하기" 모드: <li>를 통째로 교체
   ***************************************************************/
  function editPostInPlace(oldLi) {
    const item = oldLi.__itemData;
    if (!item) return;

    // (1) 새 편집모드 li
    const editLi = document.createElement('li');
    editLi.className = "css-15iqo0v e13giesq1 edit-mode-li";

    const safeContent = item.content || "";
    let stUrl = "";
    if (item.sticker && item.sticker.filename) {
      const sub1 = item.sticker.filename.substring(0,2);
      const sub2 = item.sticker.filename.substring(2,4);
      stUrl = `/uploads/${sub1}/${sub2}/${item.sticker.filename}`;
      if (item.sticker.imageType) {
        stUrl += `.${item.sticker.imageType}`;
      }
    }

    editLi.innerHTML = `
<div class="css-1t2q9uf e13giesq0">
  <div class="css-1cyfuwa e1h77j9v12">
    <div class="css-11v8s45 e1h77j9v1">
      <textarea id="Write" name="Write" style="height: 22px !important;">${safeContent}</textarea>
    </div>
    <div class="css-fjfa6z e1h77j9v3" style="${stUrl ? '' : 'display:none;'}">
      <em>
        <img src="${stUrl}" alt="댓글 첨부 스티커" style="width: 105px; height: 105px;">
        <a href="/" role="button" class="btn-close-sticker">
          <span class="blind">스티커 닫기</span>
        </a>
      </em>
    </div>
    <div class="css-ljggwk e1h77j9v9">
      <div class="css-109f9np e1h77j9v7">
        <a role="button" class="css-1394o6u e1h77j9v5">
          <span class="blind">스티커</span>
        </a>
        ${createStickerPopupHtml()}
      </div>
      <span class="css-11ofcmn e1h77j9v8">
        <a href="/" data-btn-type="login" data-testid="button"
           class="css-1adjw8a e13821ld2 edit-submit-btn">수정</a>
      </span>
    </div>
  </div>
</div>
    `.trim();

    // (2) oldLi -> editLi 교체
    oldLi.parentNode.replaceChild(editLi, oldLi);

    // (3) 스티커 UI 구성
    setupStickerUiEvents(editLi);

    // (4) "수정" 버튼 동작
    const submitBtn = editLi.querySelector('.edit-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const textarea = editLi.querySelector('textarea#Write');
        if (!textarea) return;

        const newContent = textarea.value.trim();
        const stickerId = window.__selectedStickerId || null;

        repairEntrystory(item.id, newContent, stickerId)
          .then((updatedItem) => {
            // 새로 받아온 updatedItem으로 신규 <li> 생성
            const newLi = makeCollapsedLi(updatedItem);
            // 편집중인 editLi 를 대체
            if (editLi.parentNode) {
              editLi.parentNode.replaceChild(newLi, editLi);
            }
          })
          .catch(() => {
            alert('글 수정에 실패했습니다. 잠시 후 다시 시도해주세요.');
            // 실패 시 -> 원본 li로 복귀
            if (editLi.parentNode) {
              editLi.parentNode.replaceChild(oldLi, editLi);
            }
          });
      });
    }
  }

  /***************************************************************
   * 기존 "일반 모드" 글 목록 <li> 생성
   ***************************************************************/
  function createCollapsedPostHTML(item, backgroundStyle, contentHtml, dateStr, likeCount, commentCount, userId, userName) {
    const likeClass = item.isLike ? "like active" : "like";

    let userMarkHtml = "";
    const mark = item?.user?.mark;
    if (mark && mark.filename && mark.filename.length >= 4) {
      const sub1 = mark.filename.substring(0, 2);
      const sub2 = mark.filename.substring(2, 4);
      let markUrl = `/uploads/${sub1}/${sub2}/${mark.filename}`;
      if (mark.imageType) {
        markUrl += `.${mark.imageType}`;
      }
      userMarkHtml = `
        <span class="css-1b1jxqs ee2n3ac2" 
          style="background-image: url('${markUrl}'), url('/img/EmptyImage.svg');
                 display: inline-block; 
                 font-size: 14px; 
                 font-weight: 600; 
                 color: rgb(255, 255, 255); 
                 line-height: 16px; 
                 vertical-align: top;">
          <span class="blind">${mark.name || "마크"}</span>
        </span>
      `.trim();
    }

    let stickerHtml = "";
    if (item.sticker && item.sticker.filename && item.sticker.filename.length >= 4) {
      const stSub1 = item.sticker.filename.substring(0, 2);
      const stSub2 = item.sticker.filename.substring(2, 4);
      let stUrl = `/uploads/${stSub1}/${stSub2}/${item.sticker.filename}`;
      if (item.sticker.imageType) {
        stUrl += `.${item.sticker.imageType}`;
      }
      stickerHtml = `
        <em class="css-18ro4ma e1877mpo0">
          <img src="${stUrl}" alt="sticker" style="width: 74px; height: 74px;">
        </em>
      `.trim();
    }

    return `
<li class="css-1mswyjj eelonj20">
  <div class="css-puqjcw e1877mpo2">
    <a class="css-18bdrlk enx4swp0" href="/profile/${userId}" style="${backgroundStyle}">
      <span class="blind">유저 썸네일</span>
    </a>
    <div class="css-1t19ptn ee2n3ac5">
      <a href="/profile/${userId}">
        ${userMarkHtml}${userName}
      </a>
      <em>${dateStr}</em>
    </div>
    <div class="css-6wq60h e1i41bku1">
      ${contentHtml}
    </div>
    ${stickerHtml}
    <div class="css-1dcwahm e15ke9c50">
      <em><a role="button" class="${likeClass}">좋아요 ${likeCount}</a></em>
      <em><a role="button" class="reply">댓글 ${commentCount}</a></em>
    </div>
    <div class="css-13q8c66 e12alrlo2">
      <a href="/" role="button" class="css-9ktsbr e12alrlo1" style="display: block;">
        <span class="blind">더보기</span>
      </a>
      <div class="css-19v4su1 e12alrlo0">
        <div href="" class="css-1v3ka1a e1wvddxk0">
          <ul>
            <li><a href="https://playentry.org/community/entrystory/${item.id}/">게시글로 이동</a></li>
            <li><a href="/" class="report-button" data-discuss-id="${item.id}">신고하기</a></li>
          </ul>
          <span class="css-1s3ybmc e1wvddxk1"><i>&nbsp;</i></span>
        </div>
      </div>
    </div>
  </div>
  <div></div>
</li>
    `.trim();
  }

  function makeCollapsedLi(item) {
    const userId = item.user?.id || "";
    const userName = item.user?.nickname || "NoName";
    const dateStr = formatDate(item.created);
    const likeCount = item.likesLength || 0;
    const commentCount = item.commentsLength || 0;

    const sanitized = sanitizeUserContent(item.content || "");
    const contentHtml = convertLinks(sanitized);

    let backgroundStyle = 'background-image: url("/img/EmptyImage.svg");';
    const pf = item?.user?.profileImage;
    if (pf && pf.filename && pf.filename.length >= 4) {
      const sub1 = pf.filename.substring(0, 2);
      const sub2 = pf.filename.substring(2, 4);
      if (pf.imageType) {
        backgroundStyle = `background-image: url('/uploads/${sub1}/${sub2}/${pf.filename}.${pf.imageType}'), url('/img/EmptyImage.svg');`;
      } else {
        backgroundStyle = `background-image: url('/uploads/${sub1}/${sub2}/${pf.filename}'), url('/img/EmptyImage.svg');`;
      }
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = createCollapsedPostHTML(
      item, backgroundStyle, contentHtml, dateStr, likeCount, commentCount, userId, userName
    );
    const li = tempDiv.firstElementChild;
    li.__itemData = item;

    // 내 글이면 수정하기 추가
    const myAvatarFilename = getMyAvatarFilename();
    if (pf && pf.filename && myAvatarFilename) {
      const fullProfileImage = pf.filename + (pf.imageType ? '.' + pf.imageType : '');
      if (fullProfileImage === myAvatarFilename) {
        li.classList.add("css-1kivsx6");
        const ulMenu = li.querySelector('.css-13q8c66.e12alrlo2 ul');
        if (ulMenu) {
          const editLi = document.createElement('li');
          editLi.innerHTML = `<a href="/" class="edit-button" data-discuss-id="${item.id}">수정하기</a>`;
          ulMenu.insertBefore(editLi, ulMenu.firstElementChild);
        }
      }
    }

    // 댓글 펼치기/접기
    const replyBtn = li.querySelector('.reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const existingCommentSection = li.querySelector('.css-4e8bhg.euhmxlr2');
        if (existingCommentSection) {
          revertToCollapsed(li);
        } else {
          fetchCommentsThenExpand(li);
        }
      });
    }

    // 좋아요
    const likeBtn = li.querySelector('.like');
    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.isLike) {
          unlikeDiscuss(item.id, likeBtn, "discuss");
        } else {
          likeDiscuss(item.id, likeBtn, "discuss");
        }
      });
    }

    // 더보기
    const moreBtn = li.querySelector('.css-9ktsbr.e12alrlo1');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        moreBtn.classList.toggle('active');
        const nextDiv = moreBtn.parentNode.querySelector('.css-19v4su1.e12alrlo0')
                       || moreBtn.parentNode.querySelector('.css-16el6fj.e12alrlo0');
        if (nextDiv) {
          if (nextDiv.classList.contains('css-19v4su1')) {
            nextDiv.classList.remove('css-19v4su1');
            nextDiv.classList.add('css-16el6fj');
          } else {
            nextDiv.classList.remove('css-16el6fj');
            nextDiv.classList.add('css-19v4su1');
          }
        }
      });
    }

    // 신고하기
    const reportBtn = li.querySelector('.report-button');
    if (reportBtn) {
      reportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openReportModal(item.id);
      });
    }

    // 수정하기
    const editBtn = li.querySelector('.edit-button');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        editPostInPlace(li);
      });
    }

    return li;
  }

  /***************************************************************
   * 댓글 로딩/갱신/펼치기
   ***************************************************************/
  function fetchComments(discussId) {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    const bodyData = {
      query: `
        query SELECT_COMMENTS(
          $pageParam: PageParam
          $target: String
          $searchAfter: JSON
          $likesLength: Int
          $groupId: ID
        ){
          commentList(
            pageParam: $pageParam
            target: $target
            searchAfter: $searchAfter
            likesLength: $likesLength
            groupId: $groupId
          ) {
            total
            searchAfter
            likesLength
            list {
              id
              content
              created
              likesLength
              isLike
              user {
                id
                nickname
                username
                profileImage {
                  id
                  name
                  filename
                  imageType
                }
                mark {
                  id
                  name
                  filename
                  imageType
                }
              }
              sticker {
                id
                name
                filename
                imageType
              }
            }
          }
        }
      `,
      variables: {
        target: discussId,
        pageParam: {
          display: 10,
          sort: "created",
          order: 1
        }
      }
    };

    const commentFetchOptions = {
      headers: {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9,ko-KR;q=0.8,ko;q=0.7",
        "content-type": "application/json",
        "csrf-token": csrf,
        "priority": "u=1, i",
        "sec-ch-ua": "\"Not(A:Brand\";v=\"24\", \"Chromium\";v=\"122\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-client-type": "Client",
        "x-token": xtoken
      },
      referrer: "https://playentry.org/community/entrystory/list?sort=created&term=all",
      referrerPolicy: "unsafe-url",
      body: JSON.stringify(bodyData),
      method: "POST",
      mode: "cors",
      credentials: "include"
    };

    return fetch("https://playentry.org/graphql/SELECT_COMMENTS", commentFetchOptions)
      .then((res) => res.json())
      .then((json) => {
        return json?.data?.commentList?.list || [];
      })
      .catch((err) => {
        return [];
      });
  }

  function createSignatureFromItem(item) {
    return item.id;
  }

  let olderSearchAfter = null;

  (function initTokensAndStart() {
    const { csrfToken, xToken } = getTokensFromDom();
    requestOptions.headers["csrf-token"] = csrfToken;
    requestOptions.headers["x-token"] = xToken;

    mainIntervalId = setInterval(async () => {
      if (!extensionEnabled) {
        return;
      }

      if (document.body.scrollHeight <= 50) {
        location.reload();
        return;
      }

      try {
        const urlObj = new URL(location.href);
        const paramSort = urlObj.searchParams.get("sort");
        const paramTerm = urlObj.searchParams.get("term");
        const paramQuery = urlObj.searchParams.get("query") || "";

        let finalSortValue = "created";
        if (paramSort === "commentsLength") {
          finalSortValue = "commentsLength";
        } else if (paramSort === "likesLength") {
          finalSortValue = "likesLength";
        } else if (paramSort === "score") {
          finalSortValue = "score";
        }

        let finalTermValue = "all";
        if (paramTerm === "created") {
          finalTermValue = "created";
        }

        const bodyObj = JSON.parse(requestOptions.body);
        bodyObj.variables.term = finalTermValue;
        bodyObj.variables.pageParam.sort = finalSortValue;
        bodyObj.variables.query = paramQuery;

        requestOptions.body = JSON.stringify(bodyObj);

        const res = await fetch("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions);
        const json = await res.json();
        const discussList = json?.data?.discussList?.list || [];
        const currentSearchAfter = json?.data?.discussList?.searchAfter || null;

        if (isFirstFetch) {
          olderSearchAfter = currentSearchAfter;
          const targetUl = document.querySelector("ul.css-1urx3um.e18x7bg03");
          if (targetUl) {
            for (let i = discussList.length - 1; i >= 0; i--) {
              const item = discussList[i];
              const signature = createSignatureFromItem(item);
              knownIds.add(signature);
              const li = makeCollapsedLi(item);
              targetUl.prepend(li);
            }
          }
          isFirstFetch = false;
        } else {
          // 기존 목록 갱신
          for (let i = 0; i < discussList.length; i++) {
            updateDiscussItemInDom(discussList[i]);
          }
          // 새 글 추가
          for (let i = discussList.length - 1; i >= 0; i--) {
            const item = discussList[i];
            const itemSignature = createSignatureFromItem(item);
            if (!knownIds.has(itemSignature)) {
              knownIds.add(itemSignature);
              const targetUl = document.querySelector("ul.css-1urx3um.e18x7bg03");
              if (targetUl) {
                const li = makeCollapsedLi(item);
                targetUl.prepend(li);
              }
            }
          }
        }
      } catch (err) {}

      // 열려있는 댓글도 갱신
      const openCommentSections = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li .css-4e8bhg.euhmxlr2");
      openCommentSections.forEach((section) => {
        const li = section.closest('li');
        if (li && li.__itemData && li.__itemData.id) {
          refetchCommentsAndUpdate(li.__itemData.id);
        }
      });
    }, 1000);

    function fetchOlderEntrystories(sa) {
      const req = JSON.parse(JSON.stringify(requestOptions));
      const urlObj = new URL(location.href);
      const paramSort = urlObj.searchParams.get("sort");
      const paramTerm = urlObj.searchParams.get("term");
      const paramQuery = urlObj.searchParams.get("query") || "";

      let finalSortValue = "created";
      if (paramSort === "commentsLength") {
        finalSortValue = "commentsLength";
      } else if (paramSort === "likesLength") {
        finalSortValue = "likesLength";
      } else if (paramSort === "score") {
        finalSortValue = "score";
      }

      let finalTermValue = "all";
      if (paramTerm === "created") {
        finalTermValue = "created";
      }

      const originalBody = JSON.parse(req.body);
      originalBody.variables.term = finalTermValue;
      originalBody.variables.pageParam.sort = finalSortValue;
      originalBody.variables.searchAfter = sa;
      originalBody.variables.query = paramQuery;
      req.body = JSON.stringify(originalBody);

      return fetch("https://playentry.org/graphql/SELECT_ENTRYSTORY", req)
        .then((res) => res.json())
        .then((json) => {
          const dList = json?.data?.discussList;
          return {
            list: dList?.list || [],
            searchAfter: dList?.searchAfter || null
          };
        });
    }

    document.addEventListener("click", function(e) {
      if (e.target.matches('.css-qtq074.e18x7bg02')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (!olderSearchAfter) {
          console.log("더 이상 불러올 글이 없습니다.(searchAfter=null)");
          return false;
        }
        fetchOlderEntrystories(olderSearchAfter).then((result) => {
          if (result && result.list && result.list.length > 0) {
            const ulEl = document.querySelector("ul.css-1urx3um.e18x7bg03");
            if (ulEl) {
              result.list.forEach((item) => {
                const signature = createSignatureFromItem(item);
                if (!knownIds.has(signature)) {
                  knownIds.add(signature);
                  const li = makeCollapsedLi(item);
                  ulEl.append(li);
                }
              });
            }
            olderSearchAfter = result.searchAfter || null;
          }
        }).catch((err) => {
          console.error("더 오래된 글 불러오기 실패:", err);
        });
        
        return false;
      }
    }, true);
  })();

  (function injectCommentCss() {
    const existingLink = document.querySelector('link#lowestPriorityCommentCss');
    if (!existingLink) {
      const link = document.createElement('link');
      link.id = 'lowestPriorityCommentCss';
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('style.css');
      document.head.appendChild(link);
    }
  })();

  /***************************************************************
   * 좋아요
   ***************************************************************/
  function likeDiscuss(targetId, buttonEl, targetSubject, discussIdIfComment) {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    const bodyData = {
      query: `
        mutation LIKE($target: String, $targetSubject: String, $targetType: String, $groupId: ID) {
          like(target: $target, targetSubject: $targetSubject, targetType: $targetType, groupId: $groupId) {
            target
            targetSubject
            targetType
          }
        }
      `,
      variables: {
        target: targetId,
        targetSubject: targetSubject
      }
    };

    const likeFetchOptions = {
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "csrf-token": csrf,
        "x-token": xtoken
      },
      referrer: "https://playentry.org/community/entrystory/list?sort=created&term=all",
      referrerPolicy: "unsafe-url",
      body: JSON.stringify(bodyData),
      method: "POST",
      mode: "cors",
      credentials: "include"
    };

    fetch("https://playentry.org/graphql/LIKE", likeFetchOptions)
      .then((r) => {
        if (!r.ok) throw new Error(`LIKE request failed: ${r.status}`);
        return r.json();
      })
      .then(() => {
        if (targetSubject === "discuss") {
          refetchAndUpdateList();
        } else if (targetSubject === "comment" && discussIdIfComment) {
          refetchCommentsAndUpdate(discussIdIfComment);
        }
      })
      .catch((err) => {});
  }

  function unlikeDiscuss(targetId, buttonEl, targetSubject, discussIdIfComment) {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    const bodyData = {
      query: `
        mutation UNLIKE($target: String, $groupId: ID) {
          unlike(target: $target, groupId: $groupId) {
            target
            targetSubject
            targetType
          }
        }
      `,
      variables: {
        target: targetId
      }
    };

    const unlikeFetchOptions = {
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "csrf-token": csrf,
        "x-token": xtoken
      },
      referrer: "https://playentry.org/community/entrystory/list?sort=created&term=all",
      referrerPolicy: "unsafe-url",
      body: JSON.stringify(bodyData),
      method: "POST",
      mode: "cors",
      credentials: "include"
    };

    fetch("https://playentry.org/graphql/UNLIKE", unlikeFetchOptions)
      .then((r) => {
        if (!r.ok) throw new Error(`UNLIKE request failed: ${r.status}`);
        return r.json();
      })
      .then(() => {
        if (targetSubject === "discuss") {
          refetchAndUpdateList();
        } else if (targetSubject === "comment" && discussIdIfComment) {
          refetchCommentsAndUpdate(discussIdIfComment);
        }
      })
      .catch((err) => {});
  }

  /***************************************************************
   * 댓글 작성
   ***************************************************************/
  function createComment(discussId, content, stickerId = null) {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    const bodyData = {
      query: `
        mutation CREATE_COMMENT(
          $content: String
          $image: String
          $sticker: ID
          $stickerItem: ID
          $target: String
          $targetSubject: String
          $targetType: String
          $groupId: ID
        ) {
          createComment(
            content: $content
            image: $image
            sticker: $sticker
            stickerItem: $stickerItem
            target: $target
            targetSubject: $targetSubject
            targetType: $targetType
            groupId: $groupId
          ) {
            warning
            comment {
              id
              content
              created
              likesLength
              isLike
            }
          }
        }
      `,
      variables: {
        content: content,
        sticker: null,
        stickerItem: stickerId,
        target: discussId,
        targetSubject: "discuss",
        targetType: "individual"
      }
    };

    const fetchOptions = {
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "csrf-token": csrf,
        "x-token": xtoken
      },
      body: JSON.stringify(bodyData),
      method: "POST",
      credentials: "include"
    };

    return fetch("https://playentry.org/graphql/CREATE_COMMENT", fetchOptions)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`CREATE_COMMENT failed: ${res.status}`);
        }
        return res.json();
      })
      .then(() => {
        // ----- BugFix: 댓글 작성 성공 후 스티커ID 초기화 -----
        window.__selectedStickerId = null;

        return refetchCommentsAndUpdate(discussId);
      })
      .catch((err) => {
        alert("댓글 달기에 실패했습니다. 잠시 후 다시 시도해주세요.");
      });
  }

  /***************************************************************
   * 목록 재조회
   ***************************************************************/
  function refetchAndUpdateList() {
    const urlObj = new URL(location.href);
    const paramSort = urlObj.searchParams.get("sort");
    const paramTerm = urlObj.searchParams.get("term");
    const paramQuery = urlObj.searchParams.get("query") || "";

    const bodyObj = JSON.parse(requestOptions.body);

    let finalSortValue = "created";
    if (paramSort === "commentsLength") {
      finalSortValue = "commentsLength";
    } else if (paramSort === "likesLength") {
      finalSortValue = "likesLength";
    } else if (paramSort === "score") {
      finalSortValue = "score";
    }

    let finalTermValue = "all";
    if (paramTerm === "created") {
      finalTermValue = "created";
    }

    bodyObj.variables.term = finalTermValue;
    bodyObj.variables.pageParam.sort = finalSortValue;
    bodyObj.variables.query = paramQuery;
    requestOptions.body = JSON.stringify(bodyObj);

    fetch("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions)
      .then((res) => res.json())
      .then((json) => {
        const newList = json?.data?.discussList?.list || [];
        newList.forEach((updatedItem) => {
          updateDiscussItemInDom(updatedItem);
        });
      })
      .catch((err) => {});
  }

  /***************************************************************
   * 댓글 섹션 / 갱신
   ***************************************************************/
  function createCommentSectionHTML(item, commentsArray) {
    const commentLis = commentsArray.map((c) => {
      const cUserId = c.user?.id || "";
      const cUserName = c.user?.nickname || "NoName";
      const cDate = formatDate(c.created);

      const safeContent = sanitizeUserContent(c.content || "");
      const cHtml = convertLinks(safeContent);
      const cLike = c.likesLength || 0;
      const cLikeClass = c.isLike ? "like active" : "like";

      let cBg = 'background-image: url("/img/EmptyImage.svg");';
      const cPf = c?.user?.profileImage;
      if (cPf && cPf.filename && cPf.filename.length >= 4) {
        const ccSub1 = cPf.filename.substring(0, 2);
        const ccSub2 = cPf.filename.substring(2, 4);
        if (cPf.imageType) {
          cBg = `background-image: url('/uploads/${ccSub1}/${ccSub2}/${cPf.filename}.${cPf.imageType}'), url('/img/EmptyImage.svg');`;
        } else {
          cBg = `background-image: url('/uploads/${ccSub1}/${ccSub2}/${cPf.filename}'), url('/img/EmptyImage.svg');`;
        }
      }

      let cUserMarkHtml = "";
      const cMark = c?.user?.mark;
      if (cMark && cMark.filename && cMark.filename.length >= 4) {
        const cmSub1 = cMark.filename.substring(0, 2);
        const cmSub2 = cMark.filename.substring(2, 4);
        let cMarkUrl = `/uploads/${cmSub1}/${cmSub2}/${cMark.filename}`;
        if (cMark.imageType) {
          cMarkUrl += `.${cMark.imageType}`;
        }
        cUserMarkHtml = `
          <span class="css-1b1jxqs ee2n3ac2"
            style="background-image: url('${cMarkUrl}'), url('/img/EmptyImage.svg');
                   display: inline-block; 
                   font-size: 14px; 
                   font-weight: 600; 
                   color: rgb(255, 255, 255); 
                   line-height: 16px; 
                   vertical-align: top;">
            <span class="blind">${cMark.name || "마크"}</span>
          </span>
        `.trim();
      }

      let cStickerHtml = "";
      if (c.sticker && c.sticker.filename && c.sticker.filename.length >= 4) {
        const cStSub1 = c.sticker.filename.substring(0, 2);
        const cStSub2 = c.sticker.filename.substring(2, 4);
        let cStUrl = `/uploads/${cStSub1}/${cStSub2}/${c.sticker.filename}`;
        if (c.sticker.imageType) {
          cStUrl += `.${c.sticker.imageType}`;
        }
        cStickerHtml = `
          <em class="css-18ro4ma e1877mpo0">
            <img src="${cStUrl}" alt="sticker" style="width: 74px; height: 74px;">
          </em>
        `.trim();
      }

      return `
<li class="css-u1nrp7 e9nkex10">
  <div class="css-uu8yq6 e3yf6l22">
    <a class="css-16djw2l enx4swp0" href="/profile/${cUserId}" style="${cBg}">
      <span class="blind">유저 썸네일</span>
    </a>
    <div class="css-1t19ptn ee2n3ac5">
      <a href="/profile/${cUserId}">
        ${cUserMarkHtml}${cUserName}
      </a>
      <em>${cDate}</em>
    </div>
    <div class="css-6wq60h e1i41bku1">
      ${cHtml}
    </div>
    ${cStickerHtml}
    <div class="css-1dcwahm e15ke9c50">
      <em><a role="button" class="${cLikeClass}" data-comment-id="${c.id}">좋아요 ${cLike}</a></em>
    </div>
    <div class="css-13q8c66 e12alrlo2">
      <a href="/" role="button" class="css-9ktsbr e12alrlo1" style="display: block;">
        <span class="blind">더보기</span>
      </a>
      <div class="css-19v4su1 e12alrlo0">
        <div class="css-1v3ka1a e1wvddxk0">
          <ul>
            <li><a href="https://playentry.org/community/entrystory/${item.id}/">게시글로 이동</a></li>
          </ul>
          <span class="css-1s3ybmc e1wvddxk1"><i>&nbsp;</i></span>
        </div>
      </div>
    </div>
  </div>
</li>
      `.trim();
    }).join("");

    return `
<div class="css-4e8bhg euhmxlr2">
  <ul class="css-1e7cskh euhmxlr1">
    ${commentLis}
  </ul>
  <div class="css-ahy3yn euhmxlr3">
    <div class="css-1cyfuwa e1h77j9v12">
      <div class="css-11v8s45 e1h77j9v1">
        <textarea id="Write" name="Write" placeholder="댓글을 입력해 주세요" style="height: 22px !important;"></textarea>
      </div>
      <div class="css-fjfa6z e1h77j9v3" style="display: none;">
        <em>
          <img src="" alt="댓글 첨부 스티커" style="width: 105px; height: 105px;">
          <a href="/" role="button" class="btn-close-sticker">
            <span class="blind">스티커 닫기</span>
          </a>
        </em>
      </div>
      <div class="css-ljggwk e1h77j9v9">
        <div class="css-109f9np e1h77j9v7">
          <a role="button" class="css-1394o6u e1h77j9v5">
            <span class="blind">스티커</span>
          </a>
          ${createStickerPopupHtml()}
        </div>
        <span class="css-11ofcmn e1h77j9v8">
          <a href="/" data-btn-type="login" data-testid="button"
             class="css-1adjw8a e13821ld2">등록</a>
        </span>
      </div>
    </div>
    <a href="/" role="button" class="active css-rb1pwc euhmxlr0">
      답글 접기
    </a>
  </div>
</div>
    `.trim();
  }

  async function fetchCommentsThenExpand(collapsedLi) {
    const item = collapsedLi.__itemData;
    const comments = await fetchComments(item.id);

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = createCommentSectionHTML(item, comments);
    const commentSection = tempDiv.firstElementChild;

    const closeBtn = commentSection.querySelector('.css-rb1pwc.euhmxlr0');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        revertToCollapsed(collapsedLi);
      });
    }

    const commentLikeBtns = commentSection.querySelectorAll('a.like[data-comment-id]');
    commentLikeBtns.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const cId = btn.getAttribute('data-comment-id');
        const cData = comments.find(cc => cc.id === cId);
        if (!cData) return;
        if (cData.isLike) {
          unlikeDiscuss(cData.id, btn, "comment", item.id);
        } else {
          likeDiscuss(cData.id, btn, "comment", item.id);
        }
      });
    });

    setupStickerUiEvents(commentSection);

    const registerBtn = commentSection.querySelector('a.css-1adjw8a.e13821ld2');
    if (registerBtn) {
      registerBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const textarea = commentSection.querySelector('textarea#Write');
        if (!textarea) return;
        const content = textarea.value.trim();
        const stickerId = window.__selectedStickerId || null;
        if (!content && !stickerId) {
          alert("댓글 내용을 입력해 주세요 (또는 스티커만 등록 가능).");
          return;
        }
        createComment(item.id, content, stickerId).then(() => {
          textarea.value = "";
          resetStickerSelection(commentSection);
        });
      });
    }

    const commentMoreBtns = commentSection.querySelectorAll('.css-9ktsbr.e12alrlo1');
    commentMoreBtns.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        btn.classList.toggle('active');
        const nextDiv = btn.parentNode.querySelector('.css-19v4su1.e12alrlo0')
                      || btn.parentNode.querySelector('.css-16el6fj.e12alrlo0');
        if (nextDiv) {
          if (nextDiv.classList.contains('css-19v4su1')) {
            nextDiv.classList.remove('css-19v4su1');
            nextDiv.classList.add('css-16el6fj');
          } else {
            nextDiv.classList.remove('css-16el6fj');
            nextDiv.classList.add('css-19v4su1');
          }
        }
      });
    });

    collapsedLi.appendChild(commentSection);
    reInjectInlineScripts(commentSection);
  }

  function revertToCollapsed(li) {
    const commentSection = li.querySelector('.css-4e8bhg.euhmxlr2');
    if (commentSection) {
      commentSection.remove();
    }
  }

  function refetchCommentsAndUpdate(discussId) {
    return fetchComments(discussId).then((newComments) => {
      const allLis = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li");
      let targetLi = null;
      allLis.forEach((li) => {
        if (li.__itemData && li.__itemData.id === discussId) {
          targetLi = li;
        }
      });
      if (!targetLi) {
        return;
      }

      const commentSection = targetLi.querySelector('.css-4e8bhg.euhmxlr2');
      if (!commentSection) {
        return;
      }

      const commentUl = commentSection.querySelector('.css-1e7cskh.euhmxlr1');
      if (!commentUl) {
        return;
      }

      const newCommentLisHtml = newComments.map((c) => {
        const cUserId = c.user?.id || "";
        const cUserName = c.user?.nickname || "NoName";
        const cDate = formatDate(c.created);

        const safeContent = sanitizeUserContent(c.content || "");
        const cHtml = convertLinks(safeContent);
        const cLike = c.likesLength || 0;
        const cLikeClass = c.isLike ? "like active" : "like";

        let cBg = 'background-image: url("/img/EmptyImage.svg");';
        const cPf = c?.user?.profileImage;
        if (cPf && cPf.filename && cPf.filename.length >= 4) {
          const ccSub1 = cPf.filename.substring(0, 2);
          const ccSub2 = cPf.filename.substring(2, 4);
          if (cPf.imageType) {
            cBg = `background-image: url('/uploads/${ccSub1}/${ccSub2}/${cPf.filename}.${cPf.imageType}'), url('/img/EmptyImage.svg');`;
          } else {
            cBg = `background-image: url('/uploads/${ccSub1}/${ccSub2}/${cPf.filename}'), url('/img/EmptyImage.svg');`;
          }
        }

        let cUserMarkHtml = "";
        const cMark = c?.user?.mark;
        if (cMark && cMark.filename && cMark.filename.length >= 4) {
          const cmSub1 = cMark.filename.substring(0, 2);
          const cmSub2 = cMark.filename.substring(2, 4);
          let cMarkUrl = `/uploads/${cmSub1}/${cmSub2}/${cMark.filename}`;
          if (cMark.imageType) {
            cMarkUrl += `.${cMark.imageType}`;
          }
          cUserMarkHtml = `
            <span class="css-1b1jxqs ee2n3ac2"
              style="background-image: url('${cMarkUrl}'), url('/img/EmptyImage.svg');
                     display: inline-block; 
                     font-size: 14px; 
                     font-weight: 600; 
                     color: rgb(255, 255, 255); 
                     line-height: 16px; 
                     vertical-align: top;">
              <span class="blind">${cMark.name || "마크"}</span>
            </span>
          `.trim();
        }

        let cStickerHtml = "";
        if (c.sticker && c.sticker.filename && c.sticker.filename.length >= 4) {
          const cStSub1 = c.sticker.filename.substring(0, 2);
          const cStSub2 = c.sticker.filename.substring(2, 4);
          let cStUrl = `/uploads/${cStSub1}/${cStSub2}/${c.sticker.filename}`;
          if (c.sticker.imageType) {
            cStUrl += `.${c.sticker.imageType}`;
          }
          cStickerHtml = `
            <em class="css-18ro4ma e1877mpo0">
              <img src="${cStUrl}" alt="sticker" style="width: 74px; height: 74px;">
            </em>
          `.trim();
        }

        return `
<li class="css-u1nrp7 e9nkex10">
  <div class="css-uu8yq6 e3yf6l22">
    <a class="css-16djw2l enx4swp0" href="/profile/${cUserId}" style="${cBg}">
      <span class="blind">유저 썸네일</span>
    </a>
    <div class="css-1t19ptn ee2n3ac5">
      <a href="/profile/${cUserId}">
        ${cUserMarkHtml}${cUserName}
      </a>
      <em>${cDate}</em>
    </div>
    <div class="css-6wq60h e1i41bku1">
      ${cHtml}
    </div>
    ${cStickerHtml}
    <div class="css-1dcwahm e15ke9c50">
      <em><a role="button" class="${cLikeClass}" data-comment-id="${c.id}">좋아요 ${cLike}</a></em>
    </div>
    <div class="css-13q8c66 e12alrlo2">
      <a href="/" role="button" class="css-9ktsbr e12alrlo1" style="display: block;">
        <span class="blind">더보기</span>
      </a>
      <div class="css-19v4su1 e12alrlo0">
        <div class="css-1v3ka1a e1wvddxk0">
          <ul>
            <li><a href="https://playentry.org/community/entrystory/${discussId}/">게시글로 이동</a></li>
          </ul>
          <span class="css-1s3ybmc e1wvddxk1"><i>&nbsp;</i></span>
        </div>
      </div>
    </div>
  </div>
</li>
        `.trim();
      }).join("");

      commentUl.innerHTML = newCommentLisHtml;

      const newLikeBtns = commentUl.querySelectorAll('a.like[data-comment-id]');
      newLikeBtns.forEach((btnEl) => {
        const cId = btnEl.getAttribute('data-comment-id');
        const cData = newComments.find((cc) => cc.id === cId);
        btnEl.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (!cData) return;
          if (cData.isLike) {
            unlikeDiscuss(cData.id, btnEl, "comment", discussId);
          } else {
            likeDiscuss(cData.id, btnEl, "comment", discussId);
          }
        });
      });

      const newMoreBtns = commentUl.querySelectorAll('.css-9ktsbr.e12alrlo1');
      newMoreBtns.forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          btn.classList.toggle('active');
          const nextDiv = btn.parentNode.querySelector('.css-19v4su1.e12alrlo0')
                        || btn.parentNode.querySelector('.css-16el6fj.e12alrlo0');
          if (nextDiv) {
            if (nextDiv.classList.contains('css-19v4su1')) {
              nextDiv.classList.remove('css-19v4su1');
              nextDiv.classList.add('css-16el6fj');
            } else {
              nextDiv.classList.remove('css-16el6fj');
              nextDiv.classList.add('css-19v4su1');
            }
          }
        });
      });

      reInjectInlineScripts(commentUl);
    });
  }

  // updateDiscussItemInDom: 실시간 갱신(좋아요/댓글수 등)
  function updateDiscussItemInDom(updatedItem) {
    const lis = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li");
    let foundLi = null;
    lis.forEach((li) => {
      if (li.__itemData && li.__itemData.id === updatedItem.id) {
        foundLi = li;
      }
    });
    if (!foundLi) return;

    // 좋아요/댓글 수 갱신
    const likeBtn = foundLi.querySelector('.like');
    if (likeBtn) {
      if (updatedItem.isLike) likeBtn.classList.add('active');
      else likeBtn.classList.remove('active');
      likeBtn.textContent = `좋아요 ${updatedItem.likesLength || 0}`;
    }
    const replyBtn = foundLi.querySelector('.reply');
    if (replyBtn) {
      replyBtn.textContent = `댓글 ${updatedItem.commentsLength || 0}`;
    }

    // item.content 등도 실시간 반영하려면 아래 부분 추가 가능
    foundLi.__itemData = updatedItem;
  }

  /***************************************************************
   * [추가] 여기서부터 ‘더보기’ 메뉴가 열려 있을 때, 
   *        배경(바깥) 클릭 시 자동으로 닫히도록 처리
   ***************************************************************/
  if (!docClickHandlerForMoreMenus) {
    docClickHandlerForMoreMenus = function(e) {
      // 현재 활성화(열려있는) 상태인 .css-9ktsbr.e12alrlo1 찾아서
      // 바깥을 클릭했다면 닫기
      const openMenus = document.querySelectorAll('.css-9ktsbr.e12alrlo1.active');
      openMenus.forEach((moreBtn) => {
        // 더보기 컨테이너
        const nextDiv = moreBtn.parentNode.querySelector('.css-16el6fj.e12alrlo0')
                      || moreBtn.parentNode.querySelector('.css-19v4su1.e12alrlo0');

        // 클릭이 moreBtn 영역 안이나 nextDiv 안에 속하면 그대로 두고,
        // 그 외(바깥)라면 닫는다.
        if (nextDiv && !moreBtn.contains(e.target) && !nextDiv.contains(e.target)) {
          // 더보기 비활성화
          moreBtn.classList.remove('active');
          if (nextDiv.classList.contains('css-16el6fj')) {
            // 현재 열려있는 상태를 닫기
            nextDiv.classList.remove('css-16el6fj');
            nextDiv.classList.add('css-19v4su1');
          }
        }
      });
    };
    document.addEventListener('click', docClickHandlerForMoreMenus, true);
  }
}

/*******************************************************************
 * 3) [추가] "메인 스크립트"를 중단(stop)하는 함수
 *******************************************************************/
function stopEntrystoryScript() {
  if (!scriptStarted) return;
  scriptStarted = false;

  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    mainIntervalId = null;
  }

  // [추가] 더보기 닫기 핸들러 제거
  if (docClickHandlerForMoreMenus) {
    document.removeEventListener('click', docClickHandlerForMoreMenus, true);
    docClickHandlerForMoreMenus = null;
  }
}

/*******************************************************************
 * 4) [수정] URL 변경 시, "재확인" -> 스크립트 재시작
 *     + 다른 페이지에서 오거나 아예 새로고침 시에도
 *       기존 사이트 글 UL을 제거하도록 로직 수정
 *******************************************************************/
function handleUrlChangeForEntrystory() {
  // (추가) 기존 사이트 글 제거 후 새 UL 생성 (여러 개 있으면 모두 처리)
  {
    const oldUls = document.querySelectorAll("ul.css-1urx3um.e18x7bg03");
    oldUls.forEach((oldUl) => {
      const parent = oldUl.parentElement;
      if (parent) {
        oldUl.remove();
        // 새 UL을 만들어 부모에 다시 삽입
        const newUl = document.createElement("ul");
        newUl.className = "css-1urx3um e18x7bg03";
        parent.appendChild(newUl);
      }
    });
  }

  if (isValidEntrystoryUrl() && extensionEnabled) {
    // 매번 stop 후 재시작
    stopEntrystoryScript();
    startEntrystoryScript();
  } else {
    stopEntrystoryScript();
  }
}

window.addEventListener('urlchange', handleUrlChangeForEntrystory);
handleUrlChangeForEntrystory();

/*******************************************************************
 * 5) [추가] 신고하기 모달(“정말로 신고할까요?”)을 띄우는 함수
 *******************************************************************/
function openReportModal(discussId) {
  let popupEl = document.getElementById('reportPopup');
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.id = 'reportPopup';
    popupEl.style.position = 'fixed';
    popupEl.style.top = '50%';
    popupEl.style.left = '50%';
    popupEl.style.transform = 'translate(-50%, -50%)';
    popupEl.style.zIndex = '9999';

    // 임시 안내 (신고 기능 미완성)
    popupEl.innerHTML = `
      <div class="css-6zwuwq ejqp9sd8">
        <div class="css-su85lg ejqp9sd9">
          <div class="css-g2sts3 ejqp9sd5">
            <div class="css-1rsy03z ejqp9sd0">
              <div class="css-1i6ie4z e1ff2x9k0">
                <strong class="css-14c2cg ejqp9sd4">현재 확장 프로그램에 신고 기능이 완성되지 않았습니다. 게시글로 이동 후 신고해주세요</strong>
                <p>신고된 내용이 엔트리 운영정책을 위반한 <br class="mobile">것으로 판단되면 원칙에 따라 처리합니다.</p>
                <p>엔트리 운영정책과 무관한 신고에 대해서는 <br class="mobile">처리되지 않을 수 있고, <br class="tablet">허위로 신고한 <br class="mobile">사용자에게는 불이익이 있을 수 있어요.</p>
              </div>
            </div>
          </div>
          <div class="css-198mr1i ejqp9sd7">
            <button height="42" width="0" class="css-1esh4h5 egyuc730" role="button" data-testid="button" font-size="16" style="margin-right: 8px;">취소</button>
            <button height="42" width="0" class="css-fkhbxt egyuc730" role="button" data-testid="button" font-size="16">신고</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(popupEl);

    // 취소 버튼
    const cancelBtn = popupEl.querySelector('.css-1esh4h5.egyuc730');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        popupEl.style.display = 'none';
      });
    }

    // 신고 버튼
    const reportBtn = popupEl.querySelector('.css-fkhbxt.egyuc730');
    if (reportBtn) {
      reportBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        popupEl.style.display = 'none';
      });
    }
  } else {
    popupEl.style.display = 'block';
  }
}
