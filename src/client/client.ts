const exp = (<any>global).exports;

RegisterNuiCallbackType('screenshot_created');

interface ResultData {
    cb: (data: string) => void;
    timer: ReturnType<typeof setTimeout>;
}

const results: {[id: string]: ResultData} = {};
let correlationId = 0;
const REQUEST_TIMEOUT_MS = 30000;

function registerCorrelation(cb: (result: string) => void) {
    const id = correlationId.toString();

    const timer = setTimeout(() => {
        if (!results[id]) {
            return;
        }

        console.warn(`screenshot_basic: timed out waiting for screenshot result (${id})`);
        const timedOutCb = results[id].cb;
        delete results[id];
        timedOutCb('');
    }, REQUEST_TIMEOUT_MS);

    results[id] = { cb, timer };

    correlationId++;

    return id;
}

function resolveCorrelation(id: string, data: string) {
    const result = results[id];
    if (!result) {
        return;
    }

    clearTimeout(result.timer);
    delete results[id];
    result.cb(data);
}

on('__cfx_nui:screenshot_created', (body: any, cb: (arg: any) => void) => {
    cb(true);

    if (!body || body.id === undefined) {
        return;
    }

    resolveCorrelation(String(body.id), String(body.data || ''));
});

exp('requestScreenshot', (options: any, cb?: (result: string) => void) => {
    const opts = typeof options === 'object' && options !== null
        ? { ...options }
        : { encoding: 'jpg', quality: 0.92 };
    const callback = typeof options === 'function' ? options : cb;

    if (typeof callback !== 'function') {
        console.error('requestScreenshot: callback is required');
        return;
    }

    opts.resultURL = null;
    opts.targetField = null;
    opts.targetURL = `http://${GetCurrentResourceName()}/screenshot_created`;
    opts.correlation = registerCorrelation(callback);

    SendNuiMessage(JSON.stringify({ request: opts }));
});

exp('requestScreenshotUpload', (url: string, field: string, options?: any, cb?: (result: string) => void) => {
    // Handle overloaded signature
    const opts = typeof options === 'object' && options !== null
        ? { ...options }
        : { headers: {}, encoding: 'jpg', quality: 0.92 };
    const callback = typeof options === 'function' ? options : cb;

    if (typeof callback !== 'function') {
        console.error('requestScreenshotUpload: callback is required');
        return;
    }

    if (!url || !field) {
        console.error('requestScreenshotUpload: url and field are required');
        return;
    }

    if (!opts.headers || typeof opts.headers !== 'object') {
        opts.headers = {};
    }

    opts.targetURL = url;
    opts.targetField = field;
    opts.resultURL = `http://${GetCurrentResourceName()}/screenshot_created`;
    opts.correlation = registerCorrelation(callback);

    SendNuiMessage(JSON.stringify({ request: opts }));
});

onNet('screenshot_basic:requestScreenshot', (options: any, uploadPath: string) => {
    if (!options || typeof options !== 'object') {
        console.error('Invalid screenshot options');
        return;
    }

    if (!uploadPath || typeof uploadPath !== 'string') {
        console.error('Invalid upload path');
        return;
    }

    const endpoint = GetCurrentServerEndpoint();
    if (!endpoint) {
        console.error('Unable to resolve server endpoint for screenshot upload');
        return;
    }

    const requestOptions = {
        ...options,
        encoding: options.encoding || 'jpg',
        targetURL: `http://${endpoint}${uploadPath}`,
        targetField: 'file',
        resultURL: null,
        correlation: registerCorrelation(() => {})
    };

    SendNuiMessage(JSON.stringify({ request: requestOptions }));
});