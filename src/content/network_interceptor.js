// This script is injected into the MAIN world to hook window.fetch and XMLHttpRequest
(function () {
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;
    const originalFetch = window.fetch;

    // Hook Fetch
    window.fetch = async function (...args) {
        const [resource, config] = args;
        const url = typeof resource === 'string' ? resource : resource?.url;

        if (url && (url.includes('api/timedtext') || url.includes('youtube.com/api/timedtext') || url.includes('.vtt'))) {
            window.postMessage({ type: 'AISUB_INTERCEPT_URL', url: url }, '*');
        }

        return originalFetch.apply(this, args);
    };

    // Hook XHR (YouTube often uses fetch, but just in case)
    XHR.open = function (method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function (postData) {
        if (this._url && (this._url.includes('api/timedtext') || this._url.includes('youtube.com/api/timedtext') || this._url.includes('.vtt'))) {
            window.postMessage({ type: 'AISUB_INTERCEPT_URL', url: this._url }, '*');
        }
        return send.apply(this, arguments);
    };
})();
