// contentScript.js

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
}

/*******************************************************************
 * 1) [추가] "해당 URL인지" 판별하는 헬퍼 + 코드 실행/중단
 *******************************************************************/

// 현재 URL이 "두 가지 중 하나"인지 판별
function isValidEntrystoryUrl() {
  // URL 파라미터를 정확히 비교하기 위해 URL 객체 사용
  const urlObj = new URL(location.href);
  if (urlObj.pathname !== "/community/entrystory/list") {
    return false;
  }

  const term = urlObj.searchParams.get("term");
  const sort = urlObj.searchParams.get("sort");

  // term=all & sort=created,  또는 term=created & sort=all
  const case1 = (term === "all" && sort === "created");
  const case2 = (term === "created" && sort === "all");

  return (case1 || case2);
}

// 코드 중복 실행/중단 방지용 플래그
let scriptStarted = false;

// intervalId를 저장해 두었다가, URL 벗어나면 clearInterval
let mainIntervalId = null;

/*******************************************************************
 * 2) [추가] "메인 스크립트"를 시작하는 함수 (기존 코드 전부 포함)
 *******************************************************************/

// 0) 글 ID(또는 signature)를 저장할 Set (최초 1회 선언)
const knownIds = new Set();
// 첫 fetch 여부 플래그
let isFirstFetch = true;

function startEntrystoryScript() {
  if (scriptStarted) return; // 이미 시작했다면 중복 방지
  scriptStarted = true;

  // ★ 여기서 매번 다시 초기화해 URL을 벗어났다가 돌아올 때 새로 시작하도록 함
  knownIds.clear();
  isFirstFetch = true;

  /*************************************************
   * [원본 코드 시작 - 내용 그대로 유지]
   *************************************************/

  /*************************************************
   * [추가] 0) HTML에서 csrf-token, x-token 추출하는 함수
   *************************************************/
  function getTokensFromDom() {
    let csrfToken = "";
    let xToken = "";

    // 1) <meta name="csrf-token" content="..."> 에서 추출
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      csrfToken = metaTag.getAttribute('content') || "";
    }

    // 2) <script id="__NEXT_DATA__" ...> 안의 JSON에서 x-token 추출
    const nextDataScript = document.querySelector('#__NEXT_DATA__');
    if (nextDataScript) {
      try {
        const json = JSON.parse(nextDataScript.textContent);
        // xToken: props.initialState.common.user.xToken
        xToken = json?.props?.initialState?.common?.user?.xToken || "";
      } catch (e) {
        // console.warn("NEXT_DATA JSON 파싱 오류:", e);
      }
    }

    return { csrfToken, xToken };
  }

  /*************************************************
   * 1) GraphQL API 호출 설정 (원본 그대로 - 게시글 목록용)
   *************************************************/
  const requestOptions = {
    headers: {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9,ko-KR;q=0.8,ko;q=0.7",
      "content-type": "application/json",
      // [초기값] 나중에 실제 HTML에서 파싱해 덮어쓸 예정
      "csrf-token": "",
      "priority": "u=1, i",
      "sec-ch-ua": "\"Not(A:Brand\";v=\"24\", \"Chromium\";v=\"122\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-client-type": "Client",
      // [초기값] 나중에 실제 HTML에서 파싱해 덮어쓸 예정
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
   * 2) DOM 생성 로직 (글/댓글, 댓글 닫힘/펼침)
   *************************************************/

  // 날짜 포맷
  function formatDate(dateString) {
    const d = new Date(dateString);
    const year = String(d.getFullYear()).slice(-2);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    // 엔트리에 맞게 년.월.일 ㆍ 시:분
    return `${year}.${month}.${day} ・ ${hour}:${minute}`;
  }

  // 본문 내 URL -> <a ...> 변환
  function convertLinks(content) {
    return content.replace(/(https?:\/\/[^\s]+)/g, (match) => {
      return `<a target="_blank" href="/redirect?external=${match}" rel="noreferrer">${match}</a>`;
    });
  }

  // "댓글 닫힘" 상태 HTML
  function createCollapsedPostHTML(item, backgroundStyle, contentHtml, dateStr, likeCount, commentCount, userId, userName) {
    const likeClass = item.isLike ? "like active" : "like";

    // [마크 표시용]
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

    // [게시글에 달린 sticker 표시용]
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
          <img src="${stUrl}" alt="sticker">
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
      <!-- [a태그 내부에 mark + 닉네임] -->
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
        <div class="css-3dlt5k ex7w8381">
          <ul>
            <li><a>신고하기</a></li>
          </ul>
          <span class="css-p2vmor ex7w8380"><i>&nbsp;</i></span>
        </div>
      </div>
    </div>
  </div>
  <div></div>
</li>
    `.trim();
  }

  // "댓글 펼침" 상태 HTML
  function createExpandedPostHTML(item, commentsArray) {
    const userId = item.user?.id || "";
    const userName = item.user?.nickname || "NoName";
    const dateStr = formatDate(item.created);
    const likeCount = item.likesLength || 0;
    const commentCount = item.commentsLength || 0;
    const contentHtml = convertLinks(item.content || "");

    // 프로필 BG
    let bgStyle = 'background-image: url("/img/EmptyImage.svg");';
    const pf = item?.user?.profileImage;
    if (pf && pf.filename && pf.filename.length >= 4) {
      const sub1 = pf.filename.substring(0, 2);
      const sub2 = pf.filename.substring(2, 4);
      if (pf.imageType) {
        bgStyle = `background-image: url('/uploads/${sub1}/${sub2}/${pf.filename}.${pf.imageType}'), url('/img/EmptyImage.svg');`;
      } else {
        bgStyle = `background-image: url('/uploads/${sub1}/${sub2}/${pf.filename}'), url('/img/EmptyImage.svg');`;
      }
    }
    const likeClass = item.isLike ? "like active" : "like";

    // [마크 표시용]
    let userMarkHtml = "";
    const mark = item?.user?.mark;
    if (mark && mark.filename && mark.filename.length >= 4) {
      const msub1 = mark.filename.substring(0, 2);
      const msub2 = mark.filename.substring(2, 4);
      let markUrl = `/uploads/${msub1}/${msub2}/${mark.filename}`;
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

    // [게시글에 달린 sticker 표시]
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
          <img src="${stUrl}" alt="sticker">
        </em>
      `.trim();
    }

    // 댓글 목록
    const commentLis = commentsArray.map((c) => {
      const cUserId = c.user?.id || "";
      const cUserName = c.user?.nickname || "NoName";
      const cDate = formatDate(c.created);
      const cHtml = convertLinks(c.content || "");
      const cLike = c.likesLength || 0;
      const cLikeClass = c.isLike ? "like active" : "like";

      // 댓글 프로필 BG
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

      // [마크 표시 - 댓글 작성자]
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

      // [댓글의 sticker 표시]
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
            <img src="${cStUrl}" alt="sticker">
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
        <div class="css-3dlt5k ex7w8381">
          <ul><li><a>신고하기</a></li></ul>
          <span class="css-p2vmor ex7w8380"><i>&nbsp;</i></span>
        </div>
      </div>
    </div>
  </div>
</li>
      `.trim();
    }).join("\n");

    return `
<li class="css-1psq3e8 eelonj20">
  <div class="css-puqjcw e1877mpo2">
    <a class="css-18bdrlk enx4swp0" href="/profile/${userId}" style="${bgStyle}">
      <span class="blind">유저 썸네일</span>
    </a>
    <div class="css-1t19ptn ee2n3ac5">
      <a href="/profile/${userId}">
        ${userMarkHtml}${userName}
      </a>
      <em>${dateStr}</em>
    </div>
    <div class="css-6wq60h e1i41bku1">${contentHtml}</div>
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
        <div class="css-3dlt5k ex7w8381">
          <ul><li><a>신고하기</a></li></ul>
          <span class="css-p2vmor ex7w8380"><i>&nbsp;</i></span>
        </div>
      </div>
    </div>
  </div>
  <div>
    <div class="css-4e8bhg euhmxlr2">
      <ul class="css-1e7cskh euhmxlr1">
        ${commentLis}
      </ul>
      <div class="css-ahy3yn euhmxlr3">
        <div class="css-1cyfuwa e1h77j9v12">
          <div class="css-11v8s45 e1h77j9v1">
            <textarea id="Write" name="Write" placeholder="댓글을 입력해 주세요" style="height: 22px !important;"></textarea>
          </div>
          <!-- [스티커 추가 시 여기 아래에 sticker-preview 영역 삽입] -->
          <div class="css-fjfa6z e1h77j9v3" style="display: none;">
            <em>
              <img src="" alt="댓글 첨부 스티커" style="width: 105px; height: 105px;">
              <a href="/" role="button" class="btn-close-sticker"><span class="blind">스티커 닫기</span></a>
            </em>
          </div>
          <div class="css-ljggwk e1h77j9v9">
            <div class="css-109f9np e1h77j9v7">
              <!-- [스티커 관련 추가] 스티커 버튼 + 팝업 -->
              <a role="button" class="css-1394o6u e1h77j9v5">
                <span class="blind">스티커</span>
              </a>
              ${createStickerPopupHtml()}
            </div>
            <span class="css-11ofcmn e1h77j9v8">
              <a href="/" data-btn-type="login" data-testid="button" class="css-1adjw8a e13821ld2">등록</a>
            </span>
          </div>
        </div>
        <a href="/" role="button" class="active css-rb1pwc euhmxlr0">답글 접기</a>
      </div>
    </div>
  </div>
</li>
    `.trim();
  }

  /*************************************************
   * [스티커 팝업 HTML] -> 여기서 fetchStickerSet(s) 호출 후 동적 삽입
   *************************************************/
  function createStickerPopupHtml() {
    // 스티커 팝업을 표시할 기본 컨테이너
    return `
<div class="css-1viloiz e1h77j9v4" style="display: none;">
  <!-- 실제로는 자바스크립트로 내부 내용(스티커 목록)을 동적 삽입 -->
  <div id="stickerPopupInner" style="padding:8px;">
    <p style="font-size:14px;">스티커 불러오는 중...</p>
  </div>
</div>
    `.trim();
  }

  /**
 * [새로 추가] 여러 스티커 세트를 *병렬*로 불러오는 함수
 * (4개의 스티커 세트 ID 예시)
 */
  async function fetchAllStickerSets() {
    const csrf = requestOptions.headers["csrf-token"];
    const xtoken = requestOptions.headers["x-token"];

    // 예시: 4개의 스티커세트 ID
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
    return results.filter(Boolean); // null/undefined 제외
  }


  /**
 * [수정됨] 스티커 목록을 4개 탭으로 나누어 표시,
 * 스티커 클릭 시 __selectedStickerId를 설정 + 미리보기 띄우기.
 */
  async function loadStickersIntoPopup(popupEl) {
    const allSets = await fetchAllStickerSets();
    if (!allSets || allSets.length === 0) {
      popupEl.innerHTML = `<p style="color:red">스티커 세트를 불러올 수 없습니다.</p>`;
      return;
    }
  
    // (추가) 탭 아이콘 배열
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

      // ★ idx 범위를 초과하는 경우 대비해 아이콘은 일단 첫번째(0번)로 처리
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
  
    // --- 하단 탭별 이미지 목록 ---
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
          <!-- 이전 버튼(비활성 예시) -->
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

          <!-- 다음 버튼(비활성 예시) -->
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

    // --- 탭 클릭 ---
    const tabItems = popupEl.querySelectorAll('.css-1nidk14.ep1nhyt2');
    tabItems.forEach((li) => {
      li.addEventListener('click', () => {
        tabItems.forEach((x) => x.classList.remove('active'));
        li.classList.add('active');

        // "선택됨" 표시도 업데이트
        tabItems.forEach((x) => {
          const blind = x.querySelector('.blind');
          if (blind) blind.style.display = 'none';
        });
        const myBlind = li.querySelector('.blind');
        if (myBlind) myBlind.style.display = 'inline';

        // 아래쪽 스티커 목록 전환
        const tabNum = li.getAttribute('data-tab');
        const allUl = popupEl.querySelectorAll('.css-anbigi.ep1nhyt0 > ul[data-content]');
        allUl.forEach((u) => { u.style.display = 'none'; });
        const showUl = popupEl.querySelector(`ul[data-content="${tabNum}"]`);
        if (showUl) showUl.style.display = 'block';
      });
    });

    // --- 스티커 이미지 클릭 -> __selectedStickerId 설정 ---
    const stickerImgs = popupEl.querySelectorAll('img[data-sticker-id]');
    stickerImgs.forEach((imgEl) => {
      imgEl.addEventListener('click', (e) => {
        const sid = imgEl.getAttribute('data-sticker-id') || "";
        window.__selectedStickerId = sid;

        // 펼쳐진 댓글영역의 미리보기 표시
        const previewContainer = document.querySelector('.css-fjfa6z.e1h77j9v3');
        if (previewContainer) {
          previewContainer.style.display = 'block';
          const previewImg = previewContainer.querySelector('img');
          if (previewImg) {
            previewImg.src = imgEl.src;
          }
        }

        // 팝업 닫기
        const parentDiv = popupEl.closest('.css-1viloiz.e1h77j9v4');
        if (parentDiv) parentDiv.style.display = 'none';
      });
    });
  }

  /**
   * [댓글 닫힘] <li> DOM 생성
   */
  function makeCollapsedLi(item) {
    const userId = item.user?.id || "";
    const userName = item.user?.nickname || "NoName";
    const dateStr = formatDate(item.created);
    const likeCount = item.likesLength || 0;
    const commentCount = item.commentsLength || 0;
    const contentHtml = convertLinks(item.content || "");

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

    const htmlString = createCollapsedPostHTML(
      item, backgroundStyle, contentHtml, dateStr, likeCount, commentCount, userId, userName
    );
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    const li = tempDiv.firstElementChild; // <li>
    li.__itemData = item;

    // 이벤트 연결
    // 1) 댓글 버튼 -> 펼침
    const replyBtn = li.querySelector('.reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fetchCommentsThenExpand(li);
      });
    }
    // 2) 좋아요 버튼
    const likeBtn = li.querySelector('.like');
    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.isLike) {
          // 이미 좋아요면 -> unlike
          unlikeDiscuss(item.id, likeBtn, "discuss");
        } else {
          // 아니면 -> like
          likeDiscuss(item.id, likeBtn, "discuss");
        }
      });
    }

    return li;
  }

  /**
 * [수정됨] 댓글 펼치기 시, 스티커 UI(`setupStickerUiEvents`)도 연결.
 * (기존 코드에서 추가/수정된 부분만 표시)
 */
  async function fetchCommentsThenExpand(collapsedLi) {
    const item = collapsedLi.__itemData;
    const comments = await fetchComments(item.id);

    // createExpandedPostHTML는 기존 로직대로 생성
    const expandedHtml = createExpandedPostHTML(item, comments);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = expandedHtml;
    const expandedLi = tempDiv.firstElementChild;
    expandedLi.__itemData = item;

    // "답글 접기" 버튼 -> 닫힘상태 복귀
    const closeBtn = expandedLi.querySelector('.css-rb1pwc.euhmxlr0');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        revertToCollapsed(expandedLi);
      });
    }
    // 댓글버튼 -> 접기
    const replyBtn2 = expandedLi.querySelector('.reply');
    if (replyBtn2) {
      replyBtn2.addEventListener('click', (e) => {
        e.preventDefault();
        revertToCollapsed(expandedLi);
      });
    }

    // 글 좋아요
    const likeBtn = expandedLi.querySelector('.like');
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

    // 댓글 좋아요들
    const commentLikeBtns = expandedLi.querySelectorAll('.css-u1nrp7 a.like');
    commentLikeBtns.forEach((btnEl) => {
      btnEl.addEventListener('click', (ev) => {
        ev.preventDefault();
        const cId = btnEl.getAttribute('data-comment-id');
        const cData = comments.find((c) => c.id === cId);
        if (!cData) return;
        if (cData.isLike) {
          unlikeDiscuss(cData.id, btnEl, "comment", item.id);
        } else {
          likeDiscuss(cData.id, btnEl, "comment", item.id);
        }
      });
    });

    // [추가] 스티커 팝업 관련 이벤트 연결
    setupStickerUiEvents(expandedLi);

    // 댓글 등록 버튼 -> stickerId 포함 등록
    const registerBtn = expandedLi.querySelector('a.css-1adjw8a.e13821ld2');
    if (registerBtn) {
      registerBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const textarea = expandedLi.querySelector('textarea#Write');
        if (!textarea) return;
        const content = textarea.value.trim();

        const stickerId = window.__selectedStickerId || null;
        if (!content && !stickerId) {
          alert("댓글 내용을 입력해 주세요 (또는 스티커만 등록 가능).");
          return;
        }
        // createComment(discussId, content, stickerId)
        createComment(item.id, content, stickerId).then(() => {
          textarea.value = "";
          resetStickerSelection(expandedLi);
        });
      });
    }

    collapsedLi.replaceWith(expandedLi);
  }

  /**
   * "답글 접기" -> 다시 닫힘 상태로 교체
   */
  function revertToCollapsed(expandedLi) {
    const item = expandedLi.__itemData;
    const newCollapsed = makeCollapsedLi(item);
    expandedLi.replaceWith(newCollapsed);
  }

  /**
   * 댓글 Fetch
   */
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
        // console.warn("댓글 fetch error:", err);
        return [];
      });
  }

  /*************************************************
   * 3) 중복 체크용 signature (id만 사용)
   *************************************************/
  function createSignatureFromItem(item) {
    return item.id; 
  }

  /*************************************************
   * 4) 1초마다 새 글 / 기존 글 갱신
   *************************************************/
  (function initTokensAndStart() {
    const { csrfToken, xToken } = getTokensFromDom();
    requestOptions.headers["csrf-token"] = csrfToken;
    requestOptions.headers["x-token"] = xToken;

    // 여기서 setInterval 반환값을 전역 변수(mainIntervalId)에 저장
    mainIntervalId = setInterval(async () => {
      try {
        const res = await fetch("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions);
        const json = await res.json();
        const discussList = json?.data?.discussList?.list || [];

        if (isFirstFetch) {
          discussList.forEach((item) => {
            const itemSignature = createSignatureFromItem(item);
            knownIds.add(itemSignature);
          });
          isFirstFetch = false;
        }

        // 전체 글 순회
        for (let i = discussList.length - 1; i >= 0; i--) {
          const item = discussList[i];
          // 기존 글 업데이트(좋아요/댓글 수, 글 내용 등)
          updateDiscussItemInDom(item);

          // 새 글인지 판별
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
      } catch (err) {
        // console.warn("GraphQL fetch error:", err);
      }
    }, 1000);
  })();

  /*************************************************
   * [댓글용 CSS 주입 - 그대로 유지]
   *************************************************/
  (function injectCommentCss() {
    const style = document.createElement("style");
    style.setAttribute("id", "lowestPriorityCommentCss");
    style.textContent = `
/* (중략) 기존에 있던 긴 CSS. 1700줄 중 일부라 가정 */
/* 여기에 댓글 관련 CSS 전부 들어있다고 가정 */

.css-1psq3e8 {
  margin-top: 18px;
  background-color: #fff;
  border-radius: 20px;
  box-shadow: rgba(0, 0, 0, 0.06) 0px 1px 1px 0px;
}
.css-18bdrlk {
  overflow: hidden;
  position: absolute;
  border-radius: 50%;
  background-size: cover;
  background-position: 50% 50%;
  left: 27px;
  top: 27px;
  width: 50px;
  height: 50px;
}
.css-1t19ptn {
  margin-top: 8px;
}
.css-1t19ptn a {
  display: inline-block;
  font-size: 14px;
  font-weight: 600;
  color: #000;
  line-height: 16px;
  vertical-align: top;
}
.css-1e7cskh {
  border-top: 1px solid rgb(233, 233, 233);
  border-radius: 0 0 20px 20px;
}
.css-ahy3yn {
  padding: 27px;
  background-color: rgb(250, 250, 250);
  border-top: 1px solid rgb(233, 233, 233);
  border-radius: 0 0 20px 20px;
  position: relative;
  z-index: 20;
}
.css-u1nrp7:first-of-type {
  border-top: 0;
}
.css-u1nrp7 {
  margin: 0 27px;
  border-top: 1px solid rgb(233, 233, 233);
}
.css-uu8yq6.e3yf6l22 {
  padding-left: 48px;
}
.css-u1nrp7 .enx4swp0 {
  width: 30px;
  height: 30px;
  left: 0;
}
.css-16djw2l {
  overflow: hidden;
  position: absolute;
  border-radius: 50%;
  background-size: cover;
  background-position: 50% 50%;
  top: 27px;
  width: 30px;
  height: 30px;
  left: 0;
}
.css-u1nrp7 .ee2n3ac5 {
  margin-top: 0;
}
.css-u1nrp7 .e1i41bku1 {
  margin-top: 9px;
}
.css-6wq60h {
  overflow: hidden;
  margin-top: 7px;
  font-size: 16px;
  color: rgb(44, 49, 61);
  line-height: 22px;
  word-break: break-word;
}
.blind {
  overflow: hidden;
  position: absolute;
  top: 0;
  left: 0;
  margin: -1px;
  padding: 0;
  width: 1px;
  height: 1px;
  border: 0;
  clip: rect(0, 0, 0, 0);
}
.css-16djw2l::after {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(0, 0, 0, 0.01);
  border-radius: 50%;
  content: "";
}
.css-1dcwahm {
  margin-top: 18px;
  height: 12px;
}
.css-1dcwahm em {
  display: inline-block;
  margin-left: 18px;
  vertical-align: top;
}
.css-1dcwahm em:first-of-type {
  margin-left: 0;
}
.css-1dcwahm a {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  color: rgb(151, 151, 151);
  line-height: 12px;
  transition: color 0.3s;
  vertical-align: top;
}
.css-1dcwahm a.like::before {
  width: 14px;
  background-image: url(/img/IcoCmtLike.svg);
  background-size: 14px;
}
.css-1dcwahm a.active {
  color: rgb(22, 216, 163) !important;
}
.css-1dcwahm a::before {
  display: inline-block;
  height: 12px;
  margin: -1px 9px 0 0;
  transition: background-image 0.3s;
  vertical-align: top;
  content: "";
}
.css-13q8c66 {
  position: absolute;
  right: 10px;
  top: 16px;
  width: 40px;
  height: 40px;
}
.css-9ktsbr {
  position: absolute;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: 50%;
}
.css-19v4su1 {
  display: none;
  position: absolute;
  left: 33%;
  top: 59px;
  width: 98px;
  margin-left: -43px;
  z-index: 50;
}
.css-9ktsbr::before {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 18px;
  z-index: 10;
  content: "";
  margin: -9px 0 0 -2px;
  background: url(/img/IcoButtonMore.svg) 0 0 / 4px no-repeat;
}
.css-9ktsbr::after {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.06);
  transform: scale(0);
  transition: transform 0.3s;
  z-index: 1;
  content: "";
}
.css-1cyfuwa {
  position: relative;
  padding: 24px 27px 18px;
  border-radius: 10px;
  background-color: #fff;
  z-index: 30;
  border: 1px solid rgb(226, 226, 226);
}
.css-rb1pwc {
  display: block;
  height: 50px;
  margin: 14px -27px -27px;
  border-radius: 0 0 20px 20px;
  border-top: 1px solid rgb(233, 233, 233);
  background-color: #fff;
  font-size: 14px;
  font-weight: 600;
  color: rgb(151, 151, 151);
  text-align: center;
  line-height: 50px;
}
.css-11v8s45 {
  min-height: 44px;
}
.css-ljggwk {
  margin-top: 17px;
}
.css-1cyfuwa textarea {
  resize: none;
  width: 100%;
  height: 44px;
  max-height: 88px;
  border: 0;
  outline: none;
  font-size: 16px;
  color: #000;
  vertical-align: top;
  line-height: 22px;
}
.css-109f9np {
  float: left;
  position: relative;
  padding-top: 14px;
}
.css-1394o6u {
  display: inline-block;
  width: 20px;
  height: 20px;
  background-image: url(/img/IcoCmtSticker.svg);
  background-size: 20px;
  vertical-align: top;
  transition: background-image 0.3s;
}
.css-ljggwk::after {
  display: block;
  clear: both;
  content: "";
}
.css-11ofcmn {
  float: right;
  width: 110px;
}
.css-1adjw8a {
  display: block;
  overflow: hidden;
  box-sizing: border-box;
  height: 34px;
  border-radius: 17px;
  border: 1px solid rgb(22, 216, 163);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  transition: 0.3s;
  line-height: 34px;
  background-color: rgb(22, 216, 163);
  color: #fff;
}
.css-4e8bhg {
  background-color: rgb(250, 250, 250);
  border-radius: 0px 0px 20px 20px;
}
.css-uu8yq6 {
  position: relative;
  padding: 27px 73px 27px 48px;
}
.css-u1nrp7 .ee2n3ac5 em {
  display: inline;
  padding-left: 9px;
  line-height: 16px;
  vertical-align: top;
}
.css-rb1pwc::after {
    display: inline-block;
    width: 10px;
    height: 6px;
    vertical-align: top;
    content: "";
    margin: 22px 0px 0px 9px;
    background: url(/img/IconReplyMoreButton.svg) 0% 0% / 10px no-repeat;
}
.css-rb1pwc.active::after {
    transform: rotate(180deg);
}
.css-18ro4ma img {
  display: block;
  max-width: 74px;
  max-height: 74px;
}
.css-1b1jxqs {
  display: inline-block;
  width: 20px;
  height: 18px;
  margin-right: 4px;
  background-size: auto 18px;
  background-position: 50% 50%;
  background-repeat: no-repeat;
  vertical-align: middle;
}
/* [스티커 관련 추가] */
.css-fjfa6z.e1h77j9v3 {
  margin-top: 10px;
}
.css-fjfa6z.e1h77j9v3 img {
  border: 1px solid #eee;
  border-radius: 10px;
}
.css-fjfa6z.e1h77j9v3 .btn-close-sticker {
  display: inline-block;
  margin-left: 5px;
  color: #999;
  vertical-align: middle;
}
.css-1viloiz.e1h77j9v4 {
  position: absolute;
  top: 0;
  left: 0;
  margin-left: 40px;
  width: 400px;
  background: #fff;
  border: 1px solid #16d8a3;
  padding: 8px;
  border-radius: 10px;
  z-index: 999;
}
.css-65blbf {
  opacity: 0.7;
}
.css-65blbf:hover {
  opacity: 1;
}
.css-1viloiz.e1h77j9v4 {
  position: absolute;
  top: 0;
  left: 0;
  margin-left: 40px;
  width: 400px;
  background: #fff;
  border: 1px solid #16d8a3;
  padding: 8px;
  border-radius: 10px;
  z-index: 999;
}
.css-16ih3f8 {
  overflow: hidden;
  display: block;
  position: relative;
  width: 358px;
  height: 278px;
  padding: 0px;
  border: 1px solid rgb(22, 216, 163);
  border-radius: 10px;
  background-color: rgb(255, 255, 255);
  box-shadow: rgba(0, 0, 0, 0.06) 0px 1px 1px 0px;
  z-index: 20;
}
.css-zcg0zv {
  position: relative;
  padding: 0px 55px;
}
.css-anbigi {
  overflow-y: auto;
  height: calc(100% - 57px);
  padding: 18px 0px 0px 18px;
}
.css-anbigi > ul {
  overflow: hidden;
  margin: -18px 0px 0px -41px;
  padding-bottom: 18px;
}
.css-anbigi > ul > li {
  float: left;
  margin: 18px 0px 0px 41px;
}
.css-anbigi > ul > li > span {
  display: block;
  position: relative;
  hight: auto;
  width: auto;
  padding: 0px;
  transition: opacity 0.1s ease 0s;
  cursor: pointer;
}
.css-anbigi > ul > li > span::before {
  display: inline-block;
  width: 1px;
  height: 100%;
  margin-left: -1px;
  vertical-align: middle;
  content: "";
}
.css-xq7ycv {
  white-space: nowrap;
}
.css-zcg0zv {
  position: relative;
  padding: 0px 55px;
}
.css-65blbf {
  position: absolute;
  top: 0px;
  z-index: 1;
  width: 55px;
  height: 100%;
  padding: 0px 9px;
  box-sizing: border-box;
}
.css-1nidk14 {
  display: inline-block;
  position: relative;
  vertical-align: top;
}
.css-anbigi > ul > li > span > img {
    max-width: 74px;
    max-height: 74px;
}
.css-65blbf.btn_prev {
  left: 0px;
}
.css-65blbf svg {
  position: relative;
  margin-top: 2px;
}
.css-65blbf.btn_next {
  right: 0px;
}
.css-65blbf.btn_next svg {
  transform: rotate(180deg);
}
.css-anbigi > ul:hover > li > span {
  opacity: 0.3;
}
.css-anbigi > ul:hover > li:hover > span {
  opacity: 1;
}
.css-65blbf.flicking-arrow-disabled svg circle, .css-65blbf:disabled svg circle {
  stroke: rgb(226, 226, 226);
}
.css-65blbf.flicking-arrow-disabled svg path, .css-65blbf:disabled svg path {
    fill: rgb(203, 203, 203);
}
/* [기본] 탭 li의 밑줄은 연한 회색 */
.css-1nidk14::before {
  display: block;
  position: absolute;
  bottom: 0px;
  width: 100%;
  height: 1.5px;
  background-color: rgb(229, 230, 230);
  content: "";
}

/* [활성] 탭 li가 .active일 때만 초록색 */
.css-1nidk14.active::before {
  background-color: rgb(22, 216, 163);
}
.css-zcg0zv::before {
    display: block;
    position: absolute;
    bottom: 0px;
    right: 0px;
    left: 0px;
    height: 1.5px;
    background-color: rgb(229, 230, 230);
    content: "";
}
.css-fjfa6z.e1h77j9v3 img {
  border: 1px solid #eee;
  border-radius: 10px;
}
.css-fjfa6z em {
  display: block;
  position: relative;
  width: 66px;
  height: 66px;
  background-color: rgb(255, 255, 255);
  text-align: center;
  border-width: 1px;
  border-style: solid;
  border-color: rgb(226, 226, 226);
  border-image: initial;
  border-radius: 10px;
}
.css-fjfa6z em::before {
  display: inline-block;
  width: 1px;
  height: 100%;
  margin-left: -1px;
  vertical-align: middle;
  content: "";
}
.css-fjfa6z.e1h77j9v3 .btn-close-sticker {
  display: inline-block;
  margin-left: 5px;
  color: #999;
  vertical-align: middle;
}
.css-fjfa6z em > a {
  position: absolute;
  right: -11px;
  top: -11px;
  width: 22px;
  height: 22px;
  content: "";
  background: url(/img/IcoStickerClose.svg) 0% 0% / 22px no-repeat;
}
.css-fjfa6z em img {
  display: inline-block;
  max-width: 46px;
  max-height: 46px;
  vertical-align: middle;
}
    `;
    if (!document.getElementById("lowestPriorityCommentCss")) {
      document.head.appendChild(style);
    }
  })();

  /*************************************************
   * [추가] 좋아요 요청 (게시글/댓글 공용)
   *************************************************/
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
        targetSubject: targetSubject // "discuss" or "comment"
      }
    };

    const likeFetchOptions = {
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
      .catch((err) => {
        // console.warn("좋아요 요청 에러:", err);
      });
  }

  /*************************************************
   * [추가] 좋아요 취소 요청 (게시글/댓글 공용)
   *************************************************/
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
        target: targetId,
        targetSubject: targetSubject
      }
    };

    const unlikeFetchOptions = {
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
      .catch((err) => {
        // console.warn("좋아요 취소 요청 에러:", err);
      });
  }

  /*************************************************
   * [수정] 댓글 달기 (CREATE_COMMENT) - stickerItem 파라미터 사용
   *************************************************/
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
        // 댓글 등록 후, 해당 discussId 댓글 다시 불러와 갱신
        return refetchCommentsAndUpdate(discussId);
      })
      .catch((err) => {
        // console.warn("댓글 생성 에러:", err);
        alert("댓글 달기에 실패했습니다. 잠시 후 다시 시도해주세요.");
      });
  }

  /*************************************************
   * [추가] 게시글 목록 재조회 -> 업데이트
   *************************************************/
  function refetchAndUpdateList() {
    fetch("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions)
      .then((res) => res.json())
      .then((json) => {
        const newList = json?.data?.discussList?.list || [];
        newList.forEach((updatedItem) => {
          updateDiscussItemInDom(updatedItem);
        });
      })
      .catch((err) => {
        // console.warn("refetchAndUpdateList error:", err);
      });
  }

  /*************************************************
   * [추가] 댓글 재조회 -> 펼쳐진 상태만 업데이트
   *************************************************/
  function refetchCommentsAndUpdate(discussId) {
    return fetchComments(discussId).then((newComments) => {
      const allLis = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li.css-1psq3e8.eelonj20");
      let expandedLi = null;
      allLis.forEach((li) => {
        if (li.__itemData && li.__itemData.id === discussId) {
          expandedLi = li;
        }
      });
      if (!expandedLi) {
        return;
      }

      const item = expandedLi.__itemData;
      const newHtml = createExpandedPostHTML(item, newComments);
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const newExpandedLi = temp.firstElementChild;
      newExpandedLi.__itemData = item;

      const closeBtn = newExpandedLi.querySelector('.css-rb1pwc.euhmxlr0');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          revertToCollapsed(newExpandedLi);
        });
      }
      const likeBtn = newExpandedLi.querySelector('.like');
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
      const commentLikeBtns = newExpandedLi.querySelectorAll('.css-u1nrp7 a.like');
      commentLikeBtns.forEach((btnEl) => {
        btnEl.addEventListener('click', (ev) => {
          ev.preventDefault();
          const cId = btnEl.getAttribute('data-comment-id');
          const cData = newComments.find((cc) => cc.id === cId);
          if (!cData) return;
          if (cData.isLike) {
            unlikeDiscuss(cData.id, btnEl, "comment", item.id);
          } else {
            likeDiscuss(cData.id, btnEl, "comment", item.id);
          }
        });
      });
      const registerBtn = newExpandedLi.querySelector('a.css-1adjw8a.e13821ld2');
      if (registerBtn) {
        registerBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          const textarea = newExpandedLi.querySelector('textarea#Write');
          if (!textarea) return;
          const content = textarea.value.trim();
          const stickerId = window.__selectedStickerId || null;
          if (!content && !stickerId) {
            alert("댓글 내용을 입력해 주세요.");
            return;
          }
          createComment(item.id, content, stickerId).then(() => {
            textarea.value = "";
            resetStickerSelection(newExpandedLi);
          });
        });
      }

      setupStickerUiEvents(newExpandedLi, item);

      const replyBtn2 = newExpandedLi.querySelector('.reply');
      if (replyBtn2) {
        replyBtn2.addEventListener('click', (e) => {
          e.preventDefault();
          revertToCollapsed(newExpandedLi);
        });
      }

      expandedLi.replaceWith(newExpandedLi);
    });
  }

  /**
 * [새로 추가/수정] 펼쳐진 댓글영역에서
 * 스티커 팝업 열기/닫기 + loadStickersIntoPopup() 호출
 */
  function setupStickerUiEvents(expandedLi) {
    // 팝업 박스
    const popup = expandedLi.querySelector('.css-1viloiz.e1h77j9v4');
    // 스티커 버튼
    const stickerBtn = expandedLi.querySelector('.css-1394o6u.e1h77j9v5');
    if (stickerBtn && popup) {
      stickerBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (popup.style.display === 'none') {
          popup.style.display = 'block';
          // 실제 스티커 목록을 불러와 탭 UI 생성
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

    // '스티커 닫기' 버튼
    const closeStickerBtn = expandedLi.querySelector('.css-fjfa6z.e1h77j9v3 .btn-close-sticker');
    if (closeStickerBtn) {
      closeStickerBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        resetStickerSelection(expandedLi);
      });
    }
  }

  function resetStickerSelection(expandedLi) {
    window.__selectedStickerId = null;
    const preview = expandedLi.querySelector('.css-fjfa6z.e1h77j9v3');
    if (preview) {
      preview.style.display = 'none';
      const pvImg = preview.querySelector('img');
      if (pvImg) {
        pvImg.src = "";
      }
    }
  }

  /*************************************************
   * [추가] 화면에 있는 글(li) 중 해당 item.id인 것 갱신 (본문 + sticker + 좋아요/댓글)
   *************************************************/
  function updateDiscussItemInDom(updatedItem) {
    const allLis = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li");
    allLis.forEach((li) => {
      if (!li.__itemData) return;
      if (li.__itemData.id === updatedItem.id) {
        // 1) 좋아요/댓글 수, isLike
        li.__itemData.likesLength = updatedItem.likesLength;
        li.__itemData.commentsLength = updatedItem.commentsLength;
        li.__itemData.isLike = updatedItem.isLike;

        const likeA = li.querySelector("a.like");
        if (likeA) {
          likeA.textContent = `좋아요 ${updatedItem.likesLength}`;
          if (updatedItem.isLike) {
            likeA.classList.add("active");
          } else {
            likeA.classList.remove("active");
          }
        }
        const replyA = li.querySelector("a.reply");
        if (replyA) {
          replyA.textContent = `댓글 ${updatedItem.commentsLength}`;
        }

        // 2) 글 내용(content) 업데이트
        li.__itemData.content = updatedItem.content; // 데이터 동기화
        const contentDiv = li.querySelector(".css-6wq60h.e1i41bku1");
        if (contentDiv) {
          contentDiv.innerHTML = convertLinks(updatedItem.content || "");
        }

        // 3) 스티커도 갱신(기존 있으면 삭제 후, 새로 생성)
        li.__itemData.sticker = updatedItem.sticker;
        const oldStickerEl = li.querySelector("em.css-18ro4ma.e1877mpo0");
        if (oldStickerEl) {
          oldStickerEl.remove();
        }
        if (
          updatedItem.sticker &&
          updatedItem.sticker.filename &&
          updatedItem.sticker.filename.length >= 4
        ) {
          const stSub1 = updatedItem.sticker.filename.substring(0, 2);
          const stSub2 = updatedItem.sticker.filename.substring(2, 4);
          let stUrl = `/uploads/${stSub1}/${stSub2}/${updatedItem.sticker.filename}`;
          if (updatedItem.sticker.imageType) {
            stUrl += `.${updatedItem.sticker.imageType}`;
          }

          const newStickerHtml = `
            <em class="css-18ro4ma e1877mpo0">
              <img src="${stUrl}" alt="sticker">
            </em>
          `.trim();

          // contentDiv 바로 뒤에 삽입
          if (contentDiv) {
            contentDiv.insertAdjacentHTML("afterend", newStickerHtml);
          }
        }
      }
    });
  }

  /*************************************************
   * [원본 코드 끝]
   *************************************************/
}

/*******************************************************************
 * 3) [추가] "메인 스크립트"를 중단(stop)하는 함수
 *******************************************************************/
function stopEntrystoryScript() {
  if (!scriptStarted) return;
  scriptStarted = false;

  // setInterval을 clear해서 주기적으로 글을 불러오는 동작 중단
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    mainIntervalId = null;
  }
  // (이미 생성된 <li> DOM을 지울지 여부는 필요시 추가)
}

/*******************************************************************
 * 4) [추가] URL 변경 시, "재확인"하여 스크립트 실행/중단
 *******************************************************************/
function handleUrlChangeForEntrystory() {
  if (isValidEntrystoryUrl()) {
    startEntrystoryScript();
  } else {
    stopEntrystoryScript();
  }
}

// urlchange 이벤트에 반응
window.addEventListener('urlchange', handleUrlChangeForEntrystory);
// 최초 로딩 시 1회 판단
handleUrlChangeForEntrystory();
