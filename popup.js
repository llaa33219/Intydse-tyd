document.addEventListener('DOMContentLoaded', () => {
    const enableExtensionCheckbox = document.getElementById('enableExtension');
    const allowHtmlCheckbox = document.getElementById('allowHtml');
    const allowMarkdownCheckbox = document.getElementById('allowMarkdown');
    // 자바스크립트 허용과 관련된 요소(checkbox)는 없음
  
    // 1) 저장된 설정 불러오기
    chrome.storage.sync.get(
      ["enableExtension", "allowHtml", "allowMarkdown"],
      (result) => {
        enableExtensionCheckbox.checked = !!result.enableExtension;
        allowHtmlCheckbox.checked = !!result.allowHtml;
        allowMarkdownCheckbox.checked = !!result.allowMarkdown;
      }
    );
  
    // 2) 체크박스 바뀔 때마다 저장 + 메시지 전송
    enableExtensionCheckbox.addEventListener('change', () => {
      const isEnabled = enableExtensionCheckbox.checked;
      chrome.storage.sync.set({ enableExtension: isEnabled }, () => {
        // contentScript.js 쪽으로 on/off 메시지 보냄
        sendToggleMessage(isEnabled);
      });
    });
  
    allowHtmlCheckbox.addEventListener('change', () => {
      chrome.storage.sync.set({ allowHtml: allowHtmlCheckbox.checked });
    });
  
    allowMarkdownCheckbox.addEventListener('change', () => {
      chrome.storage.sync.set({ allowMarkdown: allowMarkdownCheckbox.checked });
    });
  });
  
  // 확장 기능 on/off 시 contentScript에 메시지 전달
  function sendToggleMessage(shouldEnable) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: shouldEnable ? "enableScript" : "disableScript"
        });
      }
    });
  }
  