const version = '1.0';
const epoch = new Date().getTime();
const logsByTab = {};
const NETWORK_LEVEL = 199;
let offset = 0;

const captureOptions = {
  video: true, audio: false,
  videoConstraints: {
  mandatory: {
      minWidth: 16,
      minHeight: 9,
      maxWidth: 1440,
      maxHeight: 900,
      maxFrameRate: 60,
    },
  },
};

const getScheletonReport = () => ({
  log: {
    version: '1.2',
    creator: {
      name: 'logTracker',
      version: "0.1"
    },
    pages: [
      {
        startedDateTime: new Date().toISOString(),
        id: 'page_1',
        title: '',
        pageTimings: {
          onContentLoad: 0,
          onLoad: 0
        }
      }
    ],
    entries: []
  }
});

const URLToArray = url => {
  const request = [];
  const pairs = url.substring(url.indexOf('?') + 1).split('&');
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue;
    const pair = pairs[i].split('=');
    request.push({
      name: decodeURIComponent(pair[0]),
      value: decodeURIComponent(pair[1])
    });
  }
  return request;
};

const mapEntry = ({ request, response }) => {
  return {
    startedDateTime: new Date(epoch + request.timestamp).toISOString(),
    time: response.timestamp - request.timestamp,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: response.protocol,
      cookies: [],
      headers: Object.keys(request.headers).map(key => ({
        name: key,
        value: request.headers[key]
      })),
      queryString: request.url.indexOf('?') > -1 ? URLToArray(request.url) : [],
      headersSize: 50,
      bodySize: -1,
      postData: {
        mimeType: request.headers['Content-Type'] || '',
        text: request.postData,
        params: request.postData ? URLToArray(request.postData) : undefined
      }
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      httpVersion: response.protocol,
      cookies: [],
      headers: Object.keys(response.headers).map(key => ({
        name: key,
        value: response.headers[key]
      })),
      headersSize: 50,
      content: {
        base64Encoded: response.base64Encoded,
        body: response.body,
        size: response.encodedDataLength,
        mimeType: response.mimeType,
        text: response.body + '\n\n' + response.statusText + '\n\n' + response.headersText
      },
      redirectURL: '',
      bodySize: response.encodedDataLength
    },
    cache: {},
    timings: {
      dns: response.timing.dnsEnd - response.timing.dnsStart,
      connect: response.timing.connectEnd - response.timing.connectStart,
      blocked: 0,
      send: response.timing.sendEnd - response.timing.sendStart,
      wait: response.timing.receiveHeadersEnd - response.timing.sendEnd,
      receive: response.timing.receiveHeadersEnd
    }
  }
};

const handleConsoleMessage = (tabId, message) => {
  const log = logsByTab[tabId];
  log.console.push(message);
  logsByTab[tabId] = log;
};

const handleRequestWillBeSent = (tabId, params) => {
  const log = logsByTab[tabId];
  log.network[params.requestId] = {};
  log.network[params.requestId].request = Object.assign({}, params.request, {
    timestamp: params.timestamp
  });
};

const handleResponseReceived = (tabId, params) => {
  const log = logsByTab[tabId];
  const requestId = params.requestId;
  const timestamp = params.timestamp;
  const response = params.response;
  let currentData = log.network[params.requestId] || {};
  chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }, function(
    responseBody
  ) {
    log.network[requestId] = {
      timestamp,
      ...currentData,
      response: { ...response, timestamp, ...responseBody }
    };
  });
};

const onDebugEvent = (debuggeeId = {}, message, params = {}) => {
  switch (message) {
    case 'Log.entryAdded':
      handleConsoleMessage(debuggeeId.tabId, params.entry);
      break;
    case 'Network.requestWillBeSent':
      handleRequestWillBeSent(debuggeeId.tabId, params);
      break;
    case 'Network.responseReceived':
      handleResponseReceived(debuggeeId.tabId, params);
    default:
      break;
  }
};

const startRecording = (tabId) => {
  chrome.tabCapture.capture(captureOptions, function (stream) {
    if (!stream) {
        return;
    }

    logsByTab[tabId].mediaStream = stream;
    const recordedChunks = [];
    const options = {
        mimeType: 'video/webm; codecs=vp9',
    };

    logsByTab[tabId].mediaRecorder = new MediaRecorder(stream, options);
    logsByTab[tabId].mediaRecorder.ondataavailable = function (event) {
        if (event.data.size > 0) {
          const url = URL.createObjectURL(event.data);
          const a = document.createElement('a');
          document.body.appendChild(a);
          a.style = 'display: none';
          a.href = url;
          a.download = `video.${new Date().toISOString()}.webm`;
          a.click();
          URL.revokeObjectURL(url);
        }
    }

    logsByTab[tabId].mediaRecorder.start();
  })
}

const downloadReport = (data, filename, type) => {
  const blob = new Blob([data], {
    type
  });

  const a = document.createElement('a');
  a.download = filename;
  a.href = window.URL.createObjectURL(blob);
  a.dataset.downloadurl = [type, a.download, a.href].join(':');
  a.click();
};

const downloadConsoleReport = tabId => {
  let consoleData = "'LEVEL','MESSAGE','SOURCE'\n \n";

  logsByTab[tabId].console.forEach(element => {
    consoleData += `'${element.level}','${element.text}','${element.url}'\n`;
  });

  downloadReport(consoleData, `console.${new Date().toISOString()}.csv`, 'csv');
};

const downloadHARReport = tabId => {
  const keys = Object.keys(logsByTab[tabId].network);
  const report = getScheletonReport();

  keys.forEach(key => {
    const element = logsByTab[tabId].network[key];
    if (element.response && element.response.status >= NETWORK_LEVEL) {
      try {
        report.log.entries.push(mapEntry(element));
      } catch(e) {
        console.log(e);
      }
    }
  });

  downloadReport(
    JSON.stringify(report, undefined, 2),
    `network.${new Date().toISOString()}.har`,
    'har'
  );
};

const stopRecording = tabId => {
  const mediaRecorder = logsByTab[tabId].mediaRecorder;
  const mediaStream = logsByTab[tabId].mediaStream;

  if (mediaRecorder != null && mediaStream != null) {
    mediaRecorder.stop();
    mediaStream.getVideoTracks()[0].stop();
  }
};

const onDebuggerAttach = tabId => {
  chrome.browserAction.setIcon({ path: 'icon.red.png' });

  logsByTab[tabId] = {
    console: [],
    network: {},
    mediaRecorder: null,
    mediaStream: null
  };

  chrome.debugger.sendCommand(
    {
      tabId: tabId
    },
    'Network.enable'
  );

  chrome.debugger.sendCommand(
    {
      tabId: tabId
    },
    'Log.enable'
  );

  chrome.debugger.onEvent.addListener(onDebugEvent);

  startRecording(tabId);
};

const onDebuggerDetach = (tab, reason) => {
  chrome.browserAction.setIcon({ path: 'icon.green.png' });
  const tabId = typeof tab === 'number' ? tab : tab.tabId;

  downloadConsoleReport(tabId);
  downloadHARReport(tabId);
  stopRecording(tabId);

  chrome.debugger.sendCommand({ tabId: tabId }, 'Network.disable');
  chrome.debugger.sendCommand({ tabId: tabId }, 'Log.disable');
  logsByTab[tabId] = undefined;
};

const onUserAction = tab => {
  if (!logsByTab[tab.id]) {
    chrome.debugger.attach({ tabId: tab.id }, version, onDebuggerAttach.bind(null, tab.id));
  } else {
    chrome.debugger.detach({ tabId: tab.id }, onDebuggerDetach.bind(null, tab.id));
  }
};

// register events
chrome.browserAction.onClicked.addListener(onUserAction);
chrome.debugger.onDetach.addListener(onDebuggerDetach);
