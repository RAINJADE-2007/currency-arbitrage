const maxCurrencies = 100;
const maxRates = 10000;
export const maxDraftBytes = 2 * 1024 * 1024;

export function isPositiveDecimal(text) {
    const match = text.match(/^\+?([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u);
    return match !== null && /[1-9]/u.test(match[1]);
}

export function parseDraft(source) {
    if (new TextEncoder().encode(source).length > maxDraftBytes) throw new Error('草稿不能超过 2 MB。');
    const tokens = source.match(/[^ \t\r\n\f\v]+/gu) ?? [];
    const [rawNodeCount, rawEdgeCount] = tokens;
    const countPattern = /^\+?\d+$/u;
    if (!countPattern.test(rawNodeCount ?? '') || !countPattern.test(rawEdgeCount ?? '')) {
        throw new Error('首行应包含币种数和兑换边数。');
    }
    const nodeCount = Number(rawNodeCount);
    const edgeCount = Number(rawEdgeCount);
    if (nodeCount > maxCurrencies || edgeCount > maxRates) {
        throw new Error('图容量为 100 个币种、10,000 条兑换边。');
    }
    if (tokens.length !== 2 + nodeCount + 3 * edgeCount) {
        throw new Error('币种或兑换边的字段数量与声明不一致。');
    }
    const currencies = tokens.slice(2, 2 + nodeCount);
    const names = new Set(currencies);
    if (names.size !== nodeCount) throw new Error('存在重复的币种名称。');

    const pairs = new Set();
    const edges = [];
    for (let index = 2 + nodeCount; index < tokens.length; index += 3) {
        const [from, to, rate] = tokens.slice(index, index + 3);
        if (!names.has(from) || !names.has(to)) throw new Error('兑换边引用了尚未声明的币种。');
        if (!isPositiveDecimal(rate)) throw new Error('汇率必须填写为正数。');
        const pair = `${from} ${to}`;
        if (pairs.has(pair)) throw new Error('存在重复的同向兑换边。');
        pairs.add(pair);
        edges.push({ from, to, rate });
    }
    return { currencies, edges };
}

export function serializeDraft({ currencies, edges }) {
    return [
        `${currencies.length} ${edges.length}`,
        ...currencies,
        ...edges.map(({ from, to, rate }) => `${from} ${to} ${rate}`),
        '',
    ].join('\n');
}

export function serializeSnapshot({ currencies, edges }) {
    const ids = new Map(currencies.map((name, id) => [name, id]));
    return [
        `${currencies.length} ${edges.length}`,
        ...currencies,
        ...edges.map(({ from, to, rate }) => `${ids.get(from)} ${ids.get(to)} ${rate}`),
        '',
    ].join('\n');
}
