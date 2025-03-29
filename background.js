// background.js - 백그라운드에서 탭을 관리하고 댓글 등록을 처리하는 스크립트

// 백그라운드 탭 관리를 위한 상태 저장
let commentTabs = {};

// contentScript.js로부터 메시지를 받아 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "postComment") {
    // 댓글 등록 요청 처리
    postCommentInBackground(message.postUrl, message.commentText, message.stickerId, sender.tab.id)
      .then(result => {
        sendResponse({ success: true, result });
      })
      .catch(error => {
        console.error("[Entry Extension Background] 댓글 등록 오류:", error);
        sendResponse({ success: false, error: error.message });
      });
    
    // sendResponse를 비동기적으로 호출하기 위해 true 반환
    return true;
  }
});

/**
 * 백그라운드에서 댓글을 등록하는 함수
 * @param {string} postUrl - 게시글 URL
 * @param {string} commentText - 댓글 내용
 * @param {string|null} stickerId - 스티커 ID (없으면 null)
 * @param {number} sourceTabId - 요청을 보낸 원본 탭 ID
 * @returns {Promise} - 작업 완료 후 결과를 반환하는 Promise
 */
async function postCommentInBackground(postUrl, commentText, stickerId, sourceTabId) {
  try {
    // 1. 백그라운드에서 새 탭 생성 (사용자에게 보이지 않음)
    const tab = await chrome.tabs.create({
      url: postUrl,
      active: false // 사용자에게 보이지 않도록 비활성 상태로 생성
    });
    
    // 탭 정보 저장
    commentTabs[tab.id] = {
      sourceTabId,
      commentText,
      stickerId,
      status: 'created'
    };
    
    // 2. 탭이 로드될 때까지 대기 후 스크립트 실행
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, updatedTab) {
      // 해당 탭이 아니거나 로딩이 완료되지 않았으면 무시
      if (tabId !== tab.id || changeInfo.status !== 'complete') return;
      
      // 리스너 제거 (한 번만 실행)
      chrome.tabs.onUpdated.removeListener(listener);
      
      // 탭 상태 업데이트
      commentTabs[tab.id].status = 'loaded';
      
      // 3. 댓글 등록 스크립트 실행
      executeCommentScript(tab.id, commentText, stickerId);
    });
    
    // 작업 완료를 기다리는 Promise 반환
    return new Promise((resolve, reject) => {
      // 최대 15초 타임아웃 설정 (기존 30초에서 단축)
      const timeout = setTimeout(() => {
        cleanupTab(tab.id);
        reject(new Error("댓글 등록 시간 초과"));
      }, 5000);
      
      // 댓글 등록 완료 메시지를 기다리는 리스너
      chrome.runtime.onMessage.addListener(function completionListener(msg, sender) {
        if (sender.tab && sender.tab.id === tab.id && msg.action === "commentCompleted") {
          // 리스너 및 타임아웃 제거
          chrome.runtime.onMessage.removeListener(completionListener);
          clearTimeout(timeout);
          
          // 탭 정리
          cleanupTab(tab.id);
          
          // 결과 반환
          resolve(msg.result);
        }
      });
    });
  } catch (error) {
    console.error("[Entry Extension Background] 탭 생성 오류:", error);
    throw error;
  }
}

/**
 * 댓글 등록 스크립트를 실행하는 함수
 * @param {number} tabId - 스크립트를 실행할 탭 ID
 * @param {string} commentText - 댓글 내용
 * @param {string|null} stickerId - 스티커 ID (없으면 null)
 */
function executeCommentScript(tabId, commentText, stickerId) {
  // 탭에 스크립트 주입
  chrome.scripting.executeScript({
    target: { tabId },
    function: simulateUserComment,
    args: [commentText, stickerId]
  }).catch(error => {
    console.error("[Entry Extension Background] 스크립트 실행 오류:", error);
    cleanupTab(tabId);
  });
}

/**
 * 사용이 끝난 탭을 정리하는 함수
 * @param {number} tabId - 정리할 탭 ID
 */
function cleanupTab(tabId) {
  // 탭 정보가 있으면 삭제
  if (commentTabs[tabId]) {
    delete commentTabs[tabId];
  }
  
  // 탭 닫기
  chrome.tabs.remove(tabId).catch(error => {
    console.error("[Entry Extension Background] 탭 닫기 오류:", error);
  });
}

/**
 * 사용자 댓글 작성을 시뮬레이션하는 함수 (탭 내에서 실행됨)
 * @param {string} commentText - 댓글 내용
 * @param {string|null} stickerId - 스티커 ID (없으면 null)
 */
function simulateUserComment(commentText, stickerId) {
  // 실행 결과를 저장할 객체
  const result = {
    success: false,
    message: ""
  };
  
  // 비동기 작업을 위한 즉시 실행 함수
  (async function() {
    try {
      // 페이지가 완전히 로드될 때까지 추가 대기
      await new Promise(resolve => setTimeout(resolve,30));
      
      // 1. 댓글 버튼 찾기 및 클릭
      const replyButtons = Array.from(document.querySelectorAll('a.reply'));
      if (replyButtons.length === 0) {
        throw new Error("댓글 버튼을 찾을 수 없습니다");
      }
      
      // 첫 번째 댓글 버튼 클릭
      replyButtons[0].click();
      
      // 댓글 입력창이 나타날 때까지 대기
      await new Promise(resolve => setTimeout(resolve, 3));
      
      // 2. 댓글 입력창 찾기 및 내용 입력
      const textarea = document.querySelector('textarea#Write');
      if (!textarea) {
        throw new Error("댓글 입력창을 찾을 수 없습니다");
      }
      
      // 댓글 내용 입력 (사용자가 직접 입력한 것처럼)
      textarea.focus();
      
      // 이벤트 시뮬레이션을 통한 입력
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: commentText
      });
      
      // 값 설정 후 이벤트 발생
      textarea.value = commentText;
      textarea.dispatchEvent(inputEvent);
      
      // 3. 스티커가 있는 경우 스티커 처리 (구현 필요시 추가)
      
      // 4. 등록 버튼 찾기 및 클릭 
      await new Promise(resolve => setTimeout(resolve, 3));
      
      const submitButton = document.querySelector('a[data-btn-type="login"][data-testid="button"]');
      if (!submitButton) {
        throw new Error("등록 버튼을 찾을 수 없습니다");
      }
      
      // 등록 버튼 클릭
      submitButton.click();
      
      // 댓글 등록 완료 대기
      await new Promise(resolve => setTimeout(resolve, 3));
      
      // 성공 결과 설정
      result.success = true;
      result.message = "댓글이 성공적으로 등록되었습니다";
    } catch (error) {
      // 오류 발생 시 결과 설정
      result.success = false;
      result.message = error.message || "댓글 등록 중 오류가 발생했습니다";
      console.error("[Entry Extension Content] 댓글 등록 오류:", error);
    } finally {
      // 결과를 background.js로 전송
      chrome.runtime.sendMessage({
        action: "commentCompleted",
        result: result
      });
    }
  })();
}