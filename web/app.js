import { isPositiveDecimal, maxDraftBytes, parseDraft, serializeDraft, serializeSnapshot } from './draft.js';
import { createGraphView } from './graph-view.js';

const byId = id => document.getElementById(id);
const native = document.querySelector('meta[name="arbitrage-runtime"]').content === 'native';
const view = createGraphView(byId('graph'), byId('graph-empty'), focusCurrency);
const none = { currencies: [], edges: [] };
const pageSize = 12;
const draftKey = 'currency-arbitrage.custom-draft.v1';
const state = {
    graph: none,
    source: '0 0\n',
    sample: 'custom',
    weights: null,
    cycle: [],
    page: 0,
    sourceRequest: 0,
    activeRequest: null,
    lastAction: null,
    customSource: null,
    removal: null,
};

const examples = {
    network_demo: '19 个币种、43 条单向兑换边的合成样例，用于查看区域内连接和跨区兑换路径。',
    profitable: '从 1 USD 出发，闭环换回 1.064 USD，预期收益 6.4%。',
    no_arbitrage: '闭环乘积为 0.931，预期不会报告盈利套汇。',
    break_even: '闭环乘积为 1，正好盈亏平衡。',
    disconnected: 'AAA、BBB、CCC 分量的闭环乘积为 1.2，预期收益 20%。',
    near_threshold: '1.00000000001 可形成候选，预期未通过最终收益阈值。',
    invalid_rate: '汇率为 0，C++ 解析模块完成后应拒绝此输入。',
};

const statusCopy = {
    InvalidInput: ['输入不合法', '请检查数值、字段和图数据格式。'],
    NotFound: ['币种未找到', '兑换边引用的币种需要先在图中声明。'],
    DuplicateCurrency: ['币种重复', '每个币种名称只可声明一次。'],
    DuplicateRate: ['兑换边重复', '每个方向仅保留一条兑换边。'],
    CapacityExceeded: ['超出容量', '最多支持 100 个币种、10,000 条兑换边。'],
    EmptyGraph: ['当前没有币种', '添加币种或选择示例后再检测。'],
    FileError: ['输入读取失败', '请检查图文本。'],
    InvalidCycle: ['闭环恢复失败', '请检查候选环和前驱边信息。'],
    BelowProfitThreshold: ['本次候选未通过收益阈值', '图中仍可能存在其他达到阈值的闭环。'],
    NumericError: ['金额超出计算范围', '请检查数值范围或尝试调整起始金额。'],
    EngineUnavailable: ['尚未构建 C++ 程序', '按照 README 编译 arbitrage_web 后重试。'],
    EngineError: ['无法运行 C++ 程序', '请检查终端输出和编译环境。'],
    InputTooLarge: ['图文本过大', '草稿最多支持 2 MB。'],
};

function textElement(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}

function editorMessage(copy = '', error = false) {
    byId('editor-message').textContent = copy;
    byId('editor-message').dataset.error = String(error);
}

function requireAppliedDraft() {
    if (byId('draft-dirty').hidden) return true;
    editorMessage('请先应用或撤销图文本修改。', true);
    return false;
}

function setDraftDirty(dirty) {
    byId('draft-dirty').hidden = !dirty;
    byId('discard-draft').hidden = !dirty;
}

function runResult(title, copy, tone = 'neutral', details = []) {
    const card = byId('run-result');
    card.dataset.tone = tone;
    card.replaceChildren(textElement('strong', title), textElement('p', copy), ...details);
}

function blankResult() {
    if (native) {
        runResult('等待检测', '填好对应 C++ 模块后即可在此查看实际结果。');
    } else {
        runResult('当前为静态预览', '在项目目录运行本地服务即可连接 C++ 模块。');
    }
}

function refreshButtons() {
    for (const id of ['analyze', 'parse', 'validate', 'weights']) {
        byId(id).disabled = !native || state.activeRequest !== null;
    }
}

function rememberCustom(source) {
    state.customSource = source;
    try {
        if (source === null) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, source);
    } catch {
        // Keep the current draft in memory if browser storage is unavailable.
    }
}

function clearParseResult() {
    if (state.lastAction !== 'parse') return;
    state.lastAction = null;
    state.activeRequest = null;
    blankResult();
    refreshButtons();
}

function fillCurrencies() {
    const names = state.graph?.currencies ?? [];
    for (const id of ['from', 'to', 'remove-currency']) {
        const select = byId(id);
        const current = select.value;
        select.replaceChildren(...names.map(name => new Option(name, name)));
        select.disabled = names.length === 0;
        if (names.includes(current)) {
            select.value = current;
        } else if (id === 'to' && names.length > 1) {
            select.selectedIndex = 1;
        }
    }
    const focus = byId('focus-currency');
    focus.replaceChildren(new Option('全部币种', ''), ...names.map(name => new Option(name, name)));
    focus.disabled = names.length === 0;
    focusCurrency('');
    byId('rate-form').querySelector('button').disabled = names.length === 0;
    byId('remove-currency-button').disabled = names.length === 0;
}

function focusCurrency(name) {
    byId('focus-currency').value = name;
    view.focusCurrency(name);
    const summary = byId('focus-summary');
    summary.hidden = !name;
    if (!name || !state.graph) return;
    const outgoing = state.graph.edges.filter(edge => edge.from === name).length;
    const incoming = state.graph.edges.filter(edge => edge.to === name).length;
    summary.textContent = `${name} · 转出 ${outgoing} 条 · 转入 ${incoming} 条`;
}

function renderEdges() {
    const edges = state.graph?.edges ?? [];
    const total = Math.max(1, Math.ceil(edges.length / pageSize));
    const start = state.page * pageSize;
    const rows = edges.slice(start, start + pageSize).map(({ from, to, rate }, pageIndex) => {
        const index = start + pageIndex;
        const row = document.createElement('tr');
        row.classList.toggle('is-cycle', state.cycle.includes(index));
        row.append(textElement('td', from), textElement('td', to), textElement('td', rate));
        if (state.weights) row.append(textElement('td', state.weights[index]));
        const actions = document.createElement('td');
        actions.className = 'edge-actions';
        const edit = textElement('button', '修改');
        const remove = textElement('button', '删除');
        edit.setAttribute('aria-label', `修改 ${from} 到 ${to} 的汇率`);
        remove.setAttribute('aria-label', `删除 ${from} 到 ${to} 的兑换边`);
        edit.addEventListener('click', () => {
            if (!requireAppliedDraft()) return;
            byId('from').value = from;
            byId('to').value = to;
            byId('rate').value = rate;
            byId('rate').focus();
            byId('rate').select();
        });
        remove.addEventListener('click', () => {
            if (!requireAppliedDraft()) return;
            const remaining = edges.filter((_, edgeIndex) => edgeIndex !== index);
            applyRemoval({ ...state.graph, edges: remaining }, `已删除 ${from} → ${to}。`);
            byId('edges-title').focus();
        });
        actions.append(edit, remove);
        row.append(actions);
        return row;
    });
    if (rows.length === 0) {
        const row = document.createElement('tr');
        const cell = textElement('td', '当前草稿没有可显示的兑换边。');
        cell.colSpan = state.weights ? 5 : 4;
        row.append(cell);
        rows.push(row);
    }
    byId('edge-rows').replaceChildren(...rows);
    byId('page-count').textContent = `${state.page + 1} / ${total}`;
    byId('previous').disabled = state.page === 0;
    byId('next').disabled = state.page + 1 >= total;
    byId('weight-head').hidden = !state.weights;
    byId('edges-caption').textContent = state.weights
        ? '负对数权重来自 C++ 模块 B1。'
        : '从图草稿读取的单向汇率。';
}

function changeDraft(source, sample = 'custom', allowInvalid = false, page = 0) {
    let graph = null;
    let previewError = '';
    try {
        graph = parseDraft(source);
    } catch (error) {
        if (!allowInvalid) throw error;
        previewError = error.message;
    }
    state.sourceRequest += 1;
    state.source = source;
    state.graph = graph;
    state.sample = sample;
    state.weights = null;
    state.cycle = [];
    state.page = Math.min(page, Math.max(0, Math.ceil((graph?.edges.length ?? 0) / pageSize) - 1));
    state.activeRequest = null;
    state.lastAction = null;
    state.removal = null;
    byId('undo-removal').hidden = true;
    if (sample === 'custom' && graph) rememberCustom(source);
    byId('sample').value = sample;
    byId('sample-note').hidden = !examples[sample];
    byId('sample-note-title').textContent = sample === 'network_demo' ? '大网示例' : '示例预期';
    byId('sample-expectation').textContent = examples[sample] ?? '';
    byId('draft').value = source;
    setDraftDirty(false);
    byId('graph-count').textContent = graph
        ? `${graph.currencies.length} 个币种 · ${graph.edges.length} 条兑换边`
        : '草稿有格式错误';
    view.setGraph(graph, previewError);
    fillCurrencies();
    renderEdges();
    editorMessage();
    blankResult();
    refreshButtons();
}

function applyRemoval(graph, message) {
    const undo = { source: state.source, sample: state.sample, customSource: state.customSource, page: state.page };
    changeDraft(serializeDraft(graph), 'custom', false, state.page);
    state.removal = undo;
    byId('undo-removal').hidden = false;
    editorMessage(message);
}

async function loadSample(sample) {
    const request = ++state.sourceRequest;
    if (sample === 'custom') {
        changeDraft(state.customSource ?? (state.graph ? state.source : '0 0\n'));
        return;
    }
    try {
        const response = await fetch(new URL(`../data/${sample}.txt`, import.meta.url));
        if (!response.ok) throw new Error('找不到示例文件。');
        const source = await response.text();
        if (request === state.sourceRequest) changeDraft(source, sample, true);
    } catch (error) {
        if (request === state.sourceRequest) {
            byId('sample').value = state.sample;
            editorMessage(error.message, true);
        }
    }
}

function showAnalysis(reply) {
    if (!reply.hasCandidate) {
        runResult('未检测到负环', '检测结果适用于当前图数据和浮点容差。');
        return;
    }
    const names = state.graph?.currencies ?? [];
    const name = id => names[id] ?? `#${id}`;
    const first = name(reply.steps[0].from);
    const path = [first, ...reply.steps.map(step => name(step.to))].join(' → ');
    const steps = document.createElement('ol');
    for (const { from, to, before, after, rate } of reply.steps) {
        steps.append(textElement('li', `${before} ${name(from)} × ${rate} = ${after} ${name(to)}`));
    }
    const rate = textElement('p', reply.profitPercent
        ? `收益率 ${reply.profitPercent}%`
        : `相对收益 ${reply.profitRate}`);
    const amount = textElement('p',
        `最终金额 ${reply.finalAmount} ${first}，利润 ${reply.profit} ${first}。`);
    runResult('发现已复核的盈利闭环', path, 'success', [rate, amount, steps]);
    state.cycle = reply.edgeIds;
    view.setCycle(state.cycle);
    renderEdges();
}

async function runAction(action) {
    if (!native || state.activeRequest !== null) return;
    if (action !== 'parse' && !byId('draft-dirty').hidden) {
        runResult('请先应用图文本', '草稿编辑器里有尚未应用的修改。', 'warning');
        return;
    }
    if (action !== 'parse' && !state.graph) {
        runResult('请先修正图草稿', '可点击解析 TXT，由 C++ 模块检查原始输入。', 'warning');
        return;
    }
    const amount = byId('amount').value.trim();
    if (action === 'analyze' && !isPositiveDecimal(amount)) {
        runResult('初始金额应为正数', '可输入整数、小数或科学计数法。', 'warning');
        return;
    }
    const request = {};
    state.activeRequest = request;
    state.lastAction = action;
    if (action === 'analyze') {
        state.cycle = [];
        view.setCycle([]);
        renderEdges();
    }
    refreshButtons();
    runResult('正在调用 C++ 模块', '请稍候。');
    try {
        const query = action === 'analyze' ? `?amount=${encodeURIComponent(amount)}` : '';
        const response = await fetch(`./api/${action}${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: action === 'parse'
                ? (byId('draft-dirty').hidden ? state.source : byId('draft').value)
                : serializeSnapshot(state.graph),
        });
        const reply = await response.json();
        if (state.activeRequest !== request) return;

        if (reply.status === 'NotImplemented') {
            runResult(`模块 ${reply.stage} 待填写`, 'C++ 程序已接通。填写该模块后重新编译，即可继续联调。', 'warning');
        } else if (reply.status !== 'Ok') {
            const [title, copy] = statusCopy[reply.status] ?? statusCopy.EngineError;
            runResult(title, copy, 'warning');
        } else if (action === 'analyze') {
            showAnalysis(reply);
        } else if (action === 'weights') {
            state.weights = reply.weights;
            renderEdges();
            runResult('权重已生成', `下方兑换边表显示 ${reply.weights.length} 条 −ln(汇率) 权重。`, 'success');
        } else if (action === 'parse') {
            runResult('C++ 校验通过', '当前图文本已通过解析模块的完整检查。', 'success');
        } else {
            runResult('图结构校验通过', '当前图已通过 C++ 模块 A4 的结构检查。', 'success');
        }
    } catch {
        if (state.activeRequest === request) {
            runResult('无法连接本地服务', '请确认服务正在运行。', 'warning');
        }
    } finally {
        if (state.activeRequest === request) {
            state.activeRequest = null;
            refreshButtons();
        }
    }
}

byId('sample').addEventListener('change', event => {
    if (requireAppliedDraft()) {
        void loadSample(event.target.value);
    } else {
        event.target.value = state.sample;
    }
});
byId('clear-graph').addEventListener('click', () => {
    if (requireAppliedDraft()) applyRemoval(none, '已新建空图。');
});
byId('undo-removal').addEventListener('click', () => {
    if (!requireAppliedDraft() || !state.removal) return;
    const { source, sample, customSource, page } = state.removal;
    if (sample !== 'custom') rememberCustom(customSource);
    changeDraft(source, sample, true, page);
    byId('clear-graph').focus();
    editorMessage('已恢复上一次删除或清空前的图。');
});
byId('zoom-in').addEventListener('click', () => view.zoomBy(1.25));
byId('zoom-out').addEventListener('click', () => view.zoomBy(.8));
byId('zoom-reset').addEventListener('click', view.reset);
byId('focus-currency').addEventListener('change', event => focusCurrency(event.target.value));
byId('run-form').addEventListener('submit', event => {
    event.preventDefault();
    void runAction('analyze');
});
byId('amount').addEventListener('input', () => {
    if (state.lastAction !== 'analyze') return;
    state.lastAction = null;
    state.activeRequest = null;
    state.cycle = [];
    view.setCycle([]);
    renderEdges();
    blankResult();
    refreshButtons();
});
for (const action of ['parse', 'validate', 'weights']) {
    byId(action).addEventListener('click', () => void runAction(action));
}
byId('previous').addEventListener('click', () => {
    state.page -= 1;
    renderEdges();
});
byId('next').addEventListener('click', () => {
    state.page += 1;
    renderEdges();
});
byId('draft').addEventListener('input', event => {
    state.sourceRequest += 1;
    byId('sample').value = state.sample;
    setDraftDirty(event.target.value !== state.source.replace(/\r\n?/gu, '\n'));
    clearParseResult();
});

byId('apply-draft').addEventListener('click', () => {
    try {
        changeDraft(byId('draft').value);
        editorMessage('图文本已应用到草稿。');
    } catch (error) {
        editorMessage(error.message, true);
    }
});
byId('discard-draft').addEventListener('click', () => {
    byId('draft').value = state.source;
    setDraftDirty(false);
    clearParseResult();
    editorMessage('已恢复应用前的图文本。');
});
byId('currency-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!requireAppliedDraft()) return;
    const name = byId('currency').value.trim();
    if (!state.graph) {
        editorMessage('请先修正草稿格式，或新建空图。', true);
        return;
    }
    if (!name || /\s/u.test(name)) {
        editorMessage('币种名称不能为空或包含空白。', true);
        return;
    }
    try {
        changeDraft(serializeDraft({ ...state.graph, currencies: [...state.graph.currencies, name] }));
        byId('currency-form').reset();
        editorMessage(`已添加 ${name}。`);
    } catch (error) {
        editorMessage(error.message, true);
    }
});
byId('remove-currency-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!requireAppliedDraft() || !state.graph) return;
    const name = byId('remove-currency').value;
    if (!state.graph.currencies.includes(name)) return;
    const currencies = state.graph.currencies.filter(currency => currency !== name);
    const edges = state.graph.edges.filter(edge => edge.from !== name && edge.to !== name);
    const removedCount = state.graph.edges.length - edges.length;
    applyRemoval({ currencies, edges }, `已删除 ${name} 及其关联的 ${removedCount} 条兑换边。`);
});
byId('rate-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!requireAppliedDraft()) return;
    const from = byId('from').value;
    const to = byId('to').value;
    const rate = byId('rate').value.trim();
    if (!state.graph || !from || !to) return;
    const replacement = { from, to, rate };
    const index = state.graph.edges.findIndex(edge => edge.from === from && edge.to === to);
    const edges = state.graph.edges.slice();
    if (index >= 0) edges[index] = replacement;
    else edges.push(replacement);
    try {
        changeDraft(serializeDraft({ ...state.graph, edges }));
        byId('rate').value = '';
        editorMessage(`已设置 ${from} → ${to} 的汇率。`);
    } catch (error) {
        editorMessage(error.message, true);
    }
});
byId('import-file-button').addEventListener('click', () => {
    if (requireAppliedDraft()) byId('import-file').click();
});
byId('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const request = ++state.sourceRequest;
    try {
        if (file.size > maxDraftBytes) throw new Error('草稿不能超过 2 MB。');
        const source = await file.text();
        if (request === state.sourceRequest) {
            changeDraft(source);
            editorMessage(`已导入 ${file.name} 到草稿。`);
        }
    } catch (error) {
        if (request === state.sourceRequest) editorMessage(error.message, true);
    }
});
byId('download').addEventListener('click', () => {
    if (!byId('draft-dirty').hidden) {
        editorMessage('请先应用图文本，再下载草稿。', true);
        return;
    }
    const blob = new Blob([state.source], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exchange-graph.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

byId('runtime-tag').textContent = native ? '本地 C++ 接口' : '网页预览';
let savedDraft = null;
try {
    savedDraft = localStorage.getItem(draftKey);
    if (savedDraft !== null) changeDraft(savedDraft);
} catch {
    savedDraft = null;
}
if (savedDraft === null) {
    byId('draft').value = state.source;
    byId('sample-note').hidden = true;
    view.setGraph(none);
    blankResult();
    fillCurrencies();
    refreshButtons();
    renderEdges();
    void loadSample('network_demo');
}
