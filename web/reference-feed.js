const checkInterval = 60_000;
const requestTimeout = 12_000;

export function createReferenceFeed({ onChecking, onSnapshot, onFailure }) {
    let active = false;
    let nextCheck;
    let current = null;

    async function refresh() {
        if (!active || current) return;
        clearTimeout(nextCheck);
        const request = new AbortController();
        current = request;
        const timeout = setTimeout(() => request.abort(), requestTimeout);
        onChecking();
        try {
            const response = await fetch('./api/reference-rates', { signal: request.signal });
            if (!response.ok) throw new Error('Reference rates are unavailable');
            const snapshot = await response.json();
            if (!snapshot || snapshot.status !== 'Ok' || !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.date)
                || !Number.isFinite(Date.parse(snapshot.fetchedAt)) || typeof snapshot.stale !== 'boolean') {
                throw new Error('Invalid reference snapshot');
            }
            if (current === request) onSnapshot(snapshot);
        } catch {
            if (current === request) onFailure();
        } finally {
            clearTimeout(timeout);
            if (current === request) {
                current = null;
                nextCheck = setTimeout(refresh, checkInterval);
            }
        }
    }

    return {
        start() {
            active = true;
            void refresh();
        },
        stop() {
            active = false;
            clearTimeout(nextCheck);
            current?.abort();
            current = null;
        },
        refresh,
    };
}
