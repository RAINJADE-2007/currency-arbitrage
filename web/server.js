import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createReferenceRates } from './reference-rates.js';

const port = Number(process.env.PORT ?? 4173);
const project = new URL('../', import.meta.url);
const engineName = process.platform === 'win32' ? 'arbitrage_web.exe' : 'arbitrage_web';
const enginePaths = ['build/', 'build/Release/', 'build/Debug/'].map(folder =>
    fileURLToPath(new URL(folder + engineName, project)),
);
const files = new Map([
    ['/', ['web/index.html', 'text/html; charset=utf-8']],
    ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
    ['/app.js', ['web/app.js', 'text/javascript; charset=utf-8']],
    ['/draft.js', ['web/draft.js', 'text/javascript; charset=utf-8']],
    ['/graph-view.js', ['web/graph-view.js', 'text/javascript; charset=utf-8']],
    ['/network-layout.js', ['web/network-layout.js', 'text/javascript; charset=utf-8']],
    ['/reference-feed.js', ['web/reference-feed.js', 'text/javascript; charset=utf-8']],
]);
for (const sample of ['network_demo', 'profitable', 'no_arbitrage', 'break_even', 'disconnected', 'near_threshold', 'invalid_rate']) {
    files.set(`/data/${sample}.txt`, [`data/${sample}.txt`, 'text/plain; charset=utf-8']);
}
const actions = new Set(['parse', 'validate', 'weights', 'analyze']);
const inputLimit = 2 * 1024 * 1024;
const getReferenceRates = createReferenceRates();

function send(response, code, type, body) {
    response.writeHead(code, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(body);
}

function sendJson(response, code, body) {
    send(response, code, 'application/json; charset=utf-8', JSON.stringify(body));
}

async function readInput(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size <= inputLimit) chunks.push(chunk);
    }
    return size <= inputLimit ? Buffer.concat(chunks).toString('utf8') : null;
}

function invokeEngine(engine, action, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(engine, [action], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        const reply = [];
        let size = 0;
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Engine timeout'));
        }, 10000);
        child.stdout.on('data', chunk => {
            size += chunk.length;
            if (size <= inputLimit) {
                reply.push(chunk);
            } else {
                child.kill();
                reject(new Error('Engine output is too large'));
            }
        });
        child.stdin.on('error', reject);
        child.on('error', reject);
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error('Engine exited unsuccessfully'));
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(reply).toString('utf8')));
            } catch (error) {
                reject(error);
            }
        });
        child.stdin.end(input, 'utf8');
    });
}

async function handle(request, response) {
    const host = request.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        sendJson(response, 403, { status: 'InvalidHost' });
        return;
    }
    const url = new URL(request.url, `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/api/reference-rates') {
        const rates = await getReferenceRates();
        sendJson(response, rates.status === 'Ok' ? 200 : 503, rates);
        return;
    }
    const file = files.get(url.pathname);
    if (request.method === 'GET' && file) {
        const content = await readFile(new URL(file[0], project), 'utf8');
        send(response, 200, file[1], url.pathname === '/'
            ? content.replace('name="arbitrage-runtime" content="static"', 'name="arbitrage-runtime" content="native"')
            : content);
        return;
    }
    const action = url.pathname.slice('/api/'.length);
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/') || !actions.has(action)) {
        sendJson(response, 404, { status: 'NotFound' });
        return;
    }
    if (request.headers.origin && request.headers.origin !== url.origin) {
        sendJson(response, 403, { status: 'InvalidOrigin' });
        return;
    }

    const graph = await readInput(request);
    if (graph === null) {
        sendJson(response, 413, { status: 'InputTooLarge' });
        return;
    }
    const amount = url.searchParams.get('amount') ?? '1';
    if (action === 'analyze' && /[\r\n]/u.test(amount)) {
        sendJson(response, 400, { status: 'InvalidInput', stage: 'amount' });
        return;
    }
    const engine = enginePaths.find(existsSync);
    if (!engine) {
        sendJson(response, 503, { status: 'EngineUnavailable' });
        return;
    }
    const input = action === 'analyze' ? `${amount}\n${graph}` : graph;
    sendJson(response, 200, await invokeEngine(engine, action, input));
}

const server = createServer((request, response) => {
    handle(request, response).catch(error => {
        console.error(error.message);
        if (!response.headersSent) sendJson(response, 500, { status: 'EngineError' });
    });
});
server.listen(port, '127.0.0.1', () => {
    console.log(`套汇工作台 http://127.0.0.1:${port}`);
});
