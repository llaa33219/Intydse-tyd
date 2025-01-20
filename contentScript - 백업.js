// contentScript.js

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
      // console.warn("NEXT_DATA JSON 파싱 오류:", e); // 에러 나도 안나는거처럼 보이게 하기
    }
  }

  return { csrfToken, xToken };
}

/*************************************************
 * 0) 글 ID(또는 signature)를 저장할 Set
 *************************************************/
const knownIds = new Set();
// 첫 fetch 여부 플래그
let isFirstFetch = true;

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
  // 엔트리에 맞에 년.월.일 ㆍ 시:분
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
  
  // [마크 표시용] - 추가 스타일 포함
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

  // [마크 표시용] - 추가 스타일 포함
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

    // [마크 표시용 - 댓글 작성자] - 추가 스타일 포함
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

    return `
<li class="css-u1nrp7 e9nkex10">
  <div class="css-uu8yq6 e3yf6l22">
    <a class="css-16djw2l enx4swp0" href="/profile/${cUserId}" style="${cBg}">
      <span class="blind">유저 썸네일</span>
    </a>
    <div class="css-1t19ptn ee2n3ac5">
      <!-- [댓글 a태그 내부에 mark + 닉네임] -->
      <a href="/profile/${cUserId}">
        ${cUserMarkHtml}${cUserName}
      </a>
      <em>${cDate}</em>
    </div>
    <div class="css-6wq60h e1i41bku1">${cHtml}</div>
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
      <!-- [a태그 내부에 mark + 닉네임] -->
      <a href="/profile/${userId}">
        ${userMarkHtml}${userName}
      </a>
      <em>${dateStr}</em>
    </div>
    <div class="css-6wq60h e1i41bku1">${contentHtml}</div>
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
          <div class="css-ljggwk e1h77j9v9">
            <div class="css-109f9np e1h77j9v7">
              <a role="button" class="css-1394o6u e1h77j9v5">
                <span class="blind">스티커</span>
              </a>
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
  // 2) 좋아요 버튼 -> like/unlike
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
 * [댓글 펼치기] -> expanded 구조로 교체
 */
async function fetchCommentsThenExpand(collapsedLi) {
  const item = collapsedLi.__itemData;
  const comments = await fetchComments(item.id);
  const expandedHtml = createExpandedPostHTML(item, comments);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = expandedHtml;
  const expandedLi = tempDiv.firstElementChild;
  expandedLi.__itemData = item;

  // "답글 접기"
  const closeBtn = expandedLi.querySelector('.css-rb1pwc.euhmxlr0');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      revertToCollapsed(expandedLi);
    });
  }

  // **[추가 부분] 댓글 펼쳐진 상태에서 '댓글 X' 버튼 누르면 접기**
  const replyBtn2 = expandedLi.querySelector('.reply');
  if (replyBtn2) {
    replyBtn2.addEventListener('click', (e) => {
      e.preventDefault();
      revertToCollapsed(expandedLi);
    });
  }
  // ------------------------------------------

  // 글 좋아요 버튼
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

  // 댓글 좋아요 버튼들
  const commentLikeBtns = expandedLi.querySelectorAll('.css-u1nrp7 a.like');
  commentLikeBtns.forEach((btnEl) => {
    btnEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      const commentId = btnEl.getAttribute('data-comment-id');
      // 해당 comment 데이터
      const cData = comments.find((c) => c.id === commentId);
      if (!cData) return;

      if (cData.isLike) {
        unlikeDiscuss(commentId, btnEl, "comment", item.id);
      } else {
        likeDiscuss(commentId, btnEl, "comment", item.id);
      }
    });
  });

  // **댓글 등록** 버튼
  const registerBtn = expandedLi.querySelector('a.css-1adjw8a.e13821ld2');
  if (registerBtn) {
    registerBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const textarea = expandedLi.querySelector('textarea#Write');
      if (!textarea) return;
      const content = textarea.value.trim();
      if (!content) {
        alert("댓글 내용을 입력해 주세요.");
        return;
      }
      createComment(item.id, content).then(() => {
        textarea.value = "";
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
      // console.warn("댓글 fetch error:", err); // 대충 에러 나도 안나는거처럼 보이게 하기
      return [];
    });
}

/*************************************************
 * 3) 중복 체크용 signature
 *************************************************/
function createSignatureFromItem(item) {
  const userName = item.user?.nickname || "NoName";
  const dateStr = formatDate(item.created);
  const content = item.content || "";
  return `${userName}|${dateStr}|${content.trim()}`;
}

/*************************************************
 * 4) 1초마다 새 글 / 기존 글 갱신
 *************************************************/
(function initTokensAndStart() {
  // 토큰 추출
  const { csrfToken, xToken } = getTokensFromDom();
  requestOptions.headers["csrf-token"] = csrfToken;
  requestOptions.headers["x-token"] = xToken;

  setInterval(async () => {
    try {
      const res = await fetch("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions);
      const json = await res.json();
      const discussList = json?.data?.discussList?.list || [];

      if (isFirstFetch) {
        // 첫 fetch 시, 중복만 등록
        discussList.forEach((item) => {
          const itemSignature = createSignatureFromItem(item);
          knownIds.add(itemSignature);
        });
        isFirstFetch = false;
      }

      // 전체 글 순회
      for (let i = discussList.length - 1; i >= 0; i--) {
        const item = discussList[i];
        // 기존 글 업데이트(좋아요/댓글 수 등)
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
      // console.warn("GraphQL fetch error:", err); // 에러 나도 안나는거처럼 보이게 하기 어짜피 지금은 잘 작동하는거 같음
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
  `;
  document.head.appendChild(style);
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
    .then((data) => {
      // console.log("좋아요 요청 성공:", data);

      if (targetSubject === "discuss") {
        // 게시글 좋아요 -> refetch & update
        refetchAndUpdateList();
      } else if (targetSubject === "comment" && discussIdIfComment) {
        // 댓글 좋아요 -> 해당 글 댓글만 다시 반영
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
      targetSubject: targetSubject // "discuss" or "comment"
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
    .then((data) => {
      // console.log("좋아요 취소 요청 성공:", data);

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
 * [추가] 댓글 달기 (CREATE_COMMENT)
 *************************************************/
function createComment(discussId, content) {
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
      target: discussId,
      targetSubject: "discuss",
      targetType: "individual"
    }
  };

  const fetchOptions = {
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

  // 성공 시 -> refetchCommentsAndUpdate
  return fetch("https://playentry.org/graphql/CREATE_COMMENT", fetchOptions)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`CREATE_COMMENT failed: ${res.status}`);
      }
      return res.json();
    })
    .then((json) => {
      // console.log("댓글 생성 성공:", json);
      // 댓글 다시 불러와 반영
      return refetchCommentsAndUpdate(discussId);
    })
    .catch((err) => {
      // console.warn("댓글 생성 에러:", err);
      alert("댓글 달기에 실패했습니다. 잠시 후 다시 시도해 주세요.");
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
      // console.warn("refetchAndUpdateList error:", err); // 어짜피 이런 에러 잘 안나서 상관없음
    });
}

/*************************************************
 * [추가] 댓글 재조회 -> 펼쳐진 상태만 업데이트
 *************************************************/
function refetchCommentsAndUpdate(discussId) {
  return fetchComments(discussId).then((newComments) => {
    // 펼쳐진 <li> 찾기
    const allLis = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li.css-1psq3e8.eelonj20");
    let expandedLi = null;
    allLis.forEach((li) => {
      if (li.__itemData && li.__itemData.id === discussId) {
        expandedLi = li;
      }
    });
    if (!expandedLi) {
      // 펼쳐지지 않았다면 굳이 갱신 안함
      return;
    }

    // 기존 item
    const item = expandedLi.__itemData;
    // 새 expanded 구조
    const newHtml = createExpandedPostHTML(item, newComments);
    const temp = document.createElement("div");
    temp.innerHTML = newHtml;
    const newExpandedLi = temp.firstElementChild;
    newExpandedLi.__itemData = item;

    // 이벤트 다시 연결 (답글 접기, 좋아요 버튼, 댓글 좋아요, 등록 등)
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
        if (!content) {
          alert("댓글 내용을 입력해 주세요.");
          return;
        }
        createComment(item.id, content).then(() => {
          textarea.value = "";
        });
      });
    }

    // **[추가 부분] 펼쳐진 상태에서도 '댓글 X'를 누르면 접기**
    const replyBtn2 = newExpandedLi.querySelector('.reply');
    if (replyBtn2) {
      replyBtn2.addEventListener('click', (e) => {
        e.preventDefault();
        revertToCollapsed(newExpandedLi);
      });
    }
    // ---------------------------------------------------------

    expandedLi.replaceWith(newExpandedLi);
  });
}

/*************************************************
 * [추가] 화면에 있는 글(li) 중 해당 item.id인 것 갱신
 *************************************************/
function updateDiscussItemInDom(updatedItem) {
  const allLis = document.querySelectorAll("ul.css-1urx3um.e18x7bg03 li");
  allLis.forEach((li) => {
    if (!li.__itemData) return;
    if (li.__itemData.id === updatedItem.id) {
      li.__itemData.likesLength = updatedItem.likesLength;
      li.__itemData.commentsLength = updatedItem.commentsLength;
      li.__itemData.isLike = updatedItem.isLike;

      // 좋아요/댓글 버튼 텍스트와 클래스
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
    }
  });
}
