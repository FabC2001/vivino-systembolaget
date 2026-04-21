export function getRating(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "getRating", payload }, (messageResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!messageResponse) {
        reject(new Error("No response from background"));
        return;
      }
      const [response, error] = messageResponse;
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response);
    });
  });
}
