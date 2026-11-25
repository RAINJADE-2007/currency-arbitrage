const provider = 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,GBP,JPY';
const currencies = ['USD', 'EUR', 'GBP', 'JPY'];
const unavailable = { status: 'RatesUnavailable' };

function isObservationDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
    const timestamp = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(timestamp.getTime()) && timestamp.toISOString().startsWith(date);
}

function readSnapshot(rows, fetchedAt) {
    if (!Array.isArray(rows) || rows.length !== currencies.length - 1) {
        throw new Error('Incomplete ECB reference rates');
    }
    const date = rows[0]?.date;
    if (!isObservationDate(date)) throw new Error('Invalid ECB observation date');
    const unitsPerEuro = new Map([['EUR', 1]]);
    for (const row of rows) {
        if (!row || row.date !== date || row.base !== 'EUR' || !currencies.includes(row.quote)
            || unitsPerEuro.has(row.quote) || !Number.isFinite(row.rate) || row.rate <= 0) {
            throw new Error('Invalid ECB reference rate');
        }
        unitsPerEuro.set(row.quote, row.rate);
    }

    const edges = [];
    for (const from of currencies) {
        for (const to of currencies) {
            if (from === to) continue;
            const rate = unitsPerEuro.get(to) / unitsPerEuro.get(from);
            if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid cross rate');
            edges.push({ from, to, rate: String(rate) });
        }
    }
    return { status: 'Ok', date, fetchedAt, stale: false, graph: { currencies, edges } };
}

export function createReferenceRates({ request = fetch, now = Date.now, cacheMs = 60_000, retryMs = 30_000 } = {}) {
    let result = unavailable;
    let nextRefresh = 0;
    let pending;

    async function refresh() {
        try {
            const response = await request(provider, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(8_000),
                redirect: 'error',
            });
            if (!response.ok) throw new Error(`Reference rates returned HTTP ${response.status}`);
            const rows = await response.json();
            const fetchedAt = now();
            const latest = readSnapshot(rows, new Date(fetchedAt).toISOString());
            if (result.date && latest.date < result.date) throw new Error('Outdated ECB observation');
            result = latest;
            nextRefresh = fetchedAt + cacheMs;
        } catch {
            if (result.status === 'Ok') result = { ...result, stale: true };
            nextRefresh = now() + retryMs;
        }
        return result;
    }

    return function getReferenceRates() {
        if (now() < nextRefresh) return Promise.resolve(result);
        pending ??= refresh().finally(() => { pending = undefined; });
        return pending;
    };
}
