import { layoutNetwork } from './network-layout.js';

const colors = {
    edge: '#7eacc9',
    outgoing: '#68e6e1',
    incoming: '#b4c4ff',
    profit: '#92efa9',
    rateUp: '#ffb386',
    rateDown: '#91cfff',
    node: '#143a4d',
    border: '#80e3e2',
    label: '#e8f7ff',
};

const rateHighlightMs = 2200;

function pointToward(from, to, distance) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return {
        x: from.x + (to.x - from.x) * distance / length,
        y: from.y + (to.y - from.y) * distance / length,
    };
}

function drawArrow(context, from, to, length) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    context.beginPath();
    context.moveTo(to.x, to.y);
    for (const offset of [-.48, .48]) {
        context.lineTo(to.x - length * Math.cos(angle + offset), to.y - length * Math.sin(angle + offset));
    }
    context.closePath();
    context.fill();
}

function drawRate(context, text, x, y, color, occupied) {
    const label = text.length > 18 ? `${text.slice(0, 15)}…` : text;
    context.font = '600 12px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const half = context.measureText(label).width / 2 + 7;
    if (occupied.some(other => Math.abs(other.x - x) < other.half + half + 3 && Math.abs(other.y - y) < 24)) return;
    occupied.push({ x, y, half });
    context.fillStyle = '#0f1a29';
    context.strokeStyle = color;
    context.beginPath();
    context.roundRect(x - half, y - 11, half * 2, 22, 6);
    context.fill();
    context.stroke();
    context.fillStyle = '#e5f4ff';
    context.fillText(label, x, y);
}

export function createGraphView(canvas, empty, onFocus = () => {}) {
    const context = canvas.getContext('2d');
    const emptyGraph = { currencies: [], edges: [] };
    let graph = emptyGraph;
    let links = [];
    let degree = [];
    let cycle = new Set();
    let rateChanges = new Map();
    let rateTimer = null;
    let focused = '';
    let hovered = -1;
    let placement = null;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let pointer = null;
    let pending = false;

    function currentLayout() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (placement?.width !== width || placement?.height !== height) {
            const { points, radius } = layoutNetwork(graph, width, height);
            const radii = points.map((point, index) => {
                const desired = radius * (1 + Math.min(.32, Math.max(0, degree[index] - 3) * .035));
                let limit = Infinity;
                for (const other of points) {
                    if (other === point) continue;
                    limit = Math.min(limit, (Math.hypot(point.x - other.x, point.y - other.y) - 2) / 2);
                }
                return Math.max(0, Math.min(desired, limit));
            });
            placement = { width, height, points, radii };
        }
        return placement;
    }

    function drawLink(link, color, emphasis, label, direction = 0) {
        const { points, radii } = placement;
        const { fromIndex, toIndex, paired, rate } = link;
        const from = points[fromIndex];
        const to = points[toIndex];
        const fromRadius = radii[fromIndex];
        const toRadius = radii[toIndex];
        context.strokeStyle = context.fillStyle = color;
        context.lineWidth = direction ? 3.2 : emphasis ? 2.25 : 1.25;
        context.beginPath();
        let labelPoint;
        if (fromIndex === toIndex) {
            const loop = Math.max(11, fromRadius * .73);
            const center = { x: from.x, y: from.y - fromRadius - loop + 3 };
            const endAngle = Math.PI / 2 - .42 + (2 * Math.PI);
            const end = {
                x: center.x + loop * Math.cos(endAngle),
                y: center.y + loop * Math.sin(endAngle),
            };
            context.arc(center.x, center.y, loop, Math.PI / 2 + .42, endAngle);
            context.stroke();
            drawArrow(context, { x: end.x + Math.sin(endAngle), y: end.y - Math.cos(endAngle) }, end, 7.5);
            labelPoint = { x: center.x, y: center.y - loop - 6 };
        } else {
            const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            const side = paired ? Math.min(48, length * .19) : 0;
            const control = {
                x: (from.x + to.x) / 2 - (to.y - from.y) * side / length,
                y: (from.y + to.y) / 2 + (to.x - from.x) * side / length,
            };
            const start = pointToward(from, control, Math.min(length * .42, fromRadius + 2));
            const end = pointToward(to, control, Math.min(length * .42, toRadius + 3));
            context.moveTo(start.x, start.y);
            context.quadraticCurveTo(control.x, control.y, end.x, end.y);
            context.stroke();
            drawArrow(context, control, end, Math.min(10, Math.max(5, length * .2)));
            labelPoint = { x: .25 * start.x + .5 * control.x + .25 * end.x,
                y: .25 * start.y + .5 * control.y + .25 * end.y };
        }
        const marker = direction > 0 ? '↑ ' : direction < 0 ? '↓ ' : '';
        return label ? [marker + rate, labelPoint.x, labelPoint.y, color] : null;
    }

    function draw() {
        pending = false;
        const density = Math.min(window.devicePixelRatio || 1, 2);
        const { width, height, points, radii } = currentLayout();
        canvas.width = Math.round(width * density);
        canvas.height = Math.round(height * density);
        if (!context || width === 0 || height === 0) return;
        context.setTransform(density, 0, 0, density, 0, 0);
        context.translate(width / 2 + offsetX, height / 2 + offsetY);
        context.scale(scale, scale);
        context.translate(-width / 2, -height / 2);

        const relatedNodes = new Set();
        const profitableNodes = new Set();
        const focusedLinks = [];
        const profitableLinks = [];
        const changedLinks = [];
        const baseLabels = [];
        const showBaseRates = !focused && (links.length <= 12 || (links.length <= 50 && scale > 1.65));
        links.forEach((link, index) => {
            const followsFocus = link.from === focused || link.to === focused;
            if (followsFocus) {
                relatedNodes.add(link.fromIndex);
                relatedNodes.add(link.toIndex);
            }
            const direction = rateChanges.get(index);
            if (direction) {
                changedLinks.push({ link, direction });
            } else if (cycle.has(index)) {
                profitableNodes.add(link.fromIndex);
                profitableNodes.add(link.toIndex);
                profitableLinks.push(link);
            } else if (followsFocus) {
                focusedLinks.push(link);
            } else {
                context.globalAlpha = focused ? .13 : links.length > 150 ? .23 : links.length > 12 ? .57 : .91;
                const label = drawLink(link, colors.edge, false, showBaseRates);
                if (label) baseLabels.push(label);
            }
        });
        context.globalAlpha = 1;
        const focusLabels = focusedLinks.map((link, index) =>
            drawLink(link, link.from === focused ? colors.outgoing : colors.incoming, true, index < 16));
        const profitLabels = profitableLinks.map((link, index) => drawLink(link, colors.profit, true, index < 16));
        const changeLabels = changedLinks.map(({ link, direction }) =>
            drawLink(link, direction > 0 ? colors.rateUp : colors.rateDown, true, true, direction));
        const occupied = [];
        for (const label of [...changeLabels, ...profitLabels, ...focusLabels, ...baseLabels]) {
            if (label) drawRate(context, ...label, occupied);
        }

        graph.currencies.forEach((name, index) => {
            const { x, y } = points[index];
            const radius = radii[index];
            const selected = name === focused;
            const related = relatedNodes.has(index);
            const profitable = profitableNodes.has(index);
            const hub = degree[index] >= 7;
            context.globalAlpha = focused && !selected && !related && !profitable ? .34 : 1;
            context.strokeStyle = profitable ? colors.profit : selected || index === hovered ? '#ccffff' : colors.border;
            context.fillStyle = selected ? '#236170' : hub ? '#194c65' : colors.node;
            context.lineWidth = selected || profitable ? 2.7 : 1.35;
            if (selected || index === hovered || (hub && !focused)) {
                context.shadowColor = '#6ae5df7c';
                context.shadowBlur = selected ? 23 : 12;
            }
            context.beginPath();
            context.arc(x, y, radius, 0, 2 * Math.PI);
            context.fill();
            context.stroke();
            context.shadowBlur = 0;
            if (graph.currencies.length <= 42 || selected || related || profitable || index === hovered || scale >= 1.8) {
                const label = [...name];
                const abbreviated = label.length > 5 ? `${label.slice(0, 4).join('')}…` : name;
                context.font = `700 ${Math.min(14, radius * .78)}px system-ui, sans-serif`;
                context.fillStyle = selected ? '#ffffff' : colors.label;
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText(abbreviated, x, y + .5, radius * 1.75);
            }
        });
        context.globalAlpha = 1;
    }

    function redraw() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(draw);
    }

    function clearRateChanges() {
        clearTimeout(rateTimer);
        rateTimer = null;
        rateChanges.clear();
    }

    function reset() {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        placement = null;
        hovered = -1;
        canvas.classList.remove('is-over-node');
        redraw();
    }

    function worldPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - bounds.left - bounds.width / 2 - offsetX) / scale + bounds.width / 2,
            y: (event.clientY - bounds.top - bounds.height / 2 - offsetY) / scale + bounds.height / 2,
        };
    }

    function hitNode(event) {
        const cursor = worldPoint(event);
        const { points, radii } = currentLayout();
        let closest = -1;
        let distance = Infinity;
        for (const [index, point] of points.entries()) {
            const next = Math.hypot(point.x - cursor.x, point.y - cursor.y);
            if (next < distance && next <= radii[index] + 4 / scale) {
                closest = index;
                distance = next;
            }
        }
        return closest;
    }

    const sizeObserver = new ResizeObserver(redraw);
    sizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || !graph.currencies.length) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, node: hitNode(event), moved: false };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (!pointer) {
            const node = hitNode(event);
            if (hovered !== node) {
                hovered = node;
                canvas.classList.toggle('is-over-node', hovered >= 0);
                redraw();
            }
            return;
        }
        if (pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        if (!pointer.moved && Math.hypot(dx, dy) < 5) return;
        const point = currentLayout().points[pointer.node];
        if (point) {
            point.x += dx / scale;
            point.y += dy / scale;
        } else {
            offsetX += dx;
            offsetY += dy;
        }
        Object.assign(pointer, { x: event.clientX, y: event.clientY, moved: true });
        canvas.classList.add('is-dragging');
        redraw();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        canvas.addEventListener(eventName, event => {
            if (pointer?.id !== event.pointerId) return;
            const clicked = !pointer.moved && eventName === 'pointerup';
            const name = graph.currencies[pointer.node] ?? '';
            pointer = null;
            canvas.classList.remove('is-dragging');
            if (clicked) onFocus(name === focused ? '' : name);
        });
    }
    canvas.addEventListener('pointerleave', () => {
        hovered = -1;
        canvas.classList.remove('is-over-node');
        redraw();
    });
    canvas.addEventListener('wheel', event => {
        if (!(event.ctrlKey || event.metaKey) || !graph.currencies.length) return;
        event.preventDefault();
        const anchor = worldPoint(event);
        const { width, height } = currentLayout();
        const previous = scale;
        scale = Math.min(4, Math.max(.45, scale * Math.exp(-event.deltaY * .002)));
        offsetX += (anchor.x - width / 2) * (previous - scale);
        offsetY += (anchor.y - height / 2) * (previous - scale);
        redraw();
    }, { passive: false });

    function setGraph(next, error) {
        graph = next ?? emptyGraph;
        clearRateChanges();
        cycle = new Set();
        focused = '';
        pointer = null;
        canvas.classList.remove('is-dragging');
        const indices = new Map(graph.currencies.map((name, index) => [name, index]));
        const pairs = new Set(graph.edges.map(edge => `${edge.from} ${edge.to}`));
        degree = graph.currencies.map(() => 0);
        links = graph.edges.map(edge => {
            const fromIndex = indices.get(edge.from);
            const toIndex = indices.get(edge.to);
            degree[fromIndex] += 1;
            degree[toIndex] += 1;
            return { ...edge, fromIndex, toIndex, paired: pairs.has(`${edge.to} ${edge.from}`) };
        });
        empty.hidden = graph.currencies.length > 0;
        empty.textContent = error || '添加币种或导入草稿以查看有向图。';
        reset();
    }

    function updateRates(nextGraph) {
        // Quote snapshots keep the currency order and directed edge indices stable.
        const sameTopology = nextGraph && graph.currencies.length === nextGraph.currencies.length
            && graph.currencies.every((name, index) => name === nextGraph.currencies[index])
            && links.length === nextGraph.edges.length
            && links.every(({ from, to }, index) =>
                from === nextGraph.edges[index].from && to === nextGraph.edges[index].to);
        if (!sameTopology) {
            setGraph(nextGraph);
            return 0;
        }

        const changes = new Map();
        let newLabel = false;
        links.forEach((link, index) => {
            const { rate } = nextGraph.edges[index];
            if (link.rate === rate) return;
            const direction = Math.sign(Number(rate) - Number(link.rate));
            if (direction) changes.set(index, direction);
            link.rate = rate;
            newLabel = true;
        });
        graph = nextGraph;
        if (changes.size) {
            cycle.clear();
            clearRateChanges();
            rateChanges = changes;
            rateTimer = setTimeout(() => {
                clearRateChanges();
                redraw();
            }, rateHighlightMs);
        }
        if (newLabel) redraw();
        return changes.size;
    }

    return {
        setGraph,
        updateRates,
        setCycle(edgeIds) {
            cycle = new Set(edgeIds);
            redraw();
        },
        focusCurrency(name) {
            focused = name;
            redraw();
        },
        zoomBy(factor) {
            scale = Math.min(4, Math.max(.45, scale * factor));
            redraw();
        },
        reset,
    };
}
