const colors = {
    edge: '#81a2bf',
    glow: '#92efa9',
    node: '#1e485f',
    border: '#80e3e2',
    label: '#e8f7ff',
};

function pointToward(from, to, distance) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return {
        x: from.x + (to.x - from.x) * distance / length,
        y: from.y + (to.y - from.y) * distance / length,
    };
}

function layout(currencies, width, height) {
    const count = currencies.length;
    const space = Math.min(width, height);
    const orbit = count === 1 ? 0 : space * .34;
    const radius = Math.max(7, Math.min(29, orbit * Math.PI / Math.max(1, count) * .75 || 29));
    const points = currencies.map((_, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI / count);
        return {
            x: (width / 2) + orbit * Math.cos(angle),
            y: (height / 2) + orbit * Math.sin(angle),
        };
    });
    return { points, radius };
}

function drawArrow(context, from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = 9;
    context.beginPath();
    context.moveTo(to.x, to.y);
    for (const offset of [-.48, .48]) {
        context.lineTo(to.x - length * Math.cos(angle + offset), to.y - length * Math.sin(angle + offset));
    }
    context.closePath();
    context.fill();
}

function drawRate(context, text, x, y, emphasis) {
    const label = text.length > 18 ? `${text.slice(0, 15)}…` : text;
    context.font = '600 12px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const half = context.measureText(label).width / 2 + 7;
    context.fillStyle = '#0f1a29';
    context.strokeStyle = emphasis ? colors.glow : '#456179';
    context.beginPath();
    context.roundRect(x - half, y - 11, half * 2, 22, 6);
    context.fill();
    context.stroke();
    context.fillStyle = emphasis ? colors.glow : '#d8eafa';
    context.fillText(label, x, y);
}

export function createGraphView(canvas, empty) {
    const context = canvas.getContext('2d');
    let graph = { currencies: [], edges: [] };
    let cycle = new Set();
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let pointer = null;
    let pending = false;

    function draw() {
        pending = false;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const density = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * density);
        canvas.height = Math.round(height * density);
        if (!context || width === 0 || height === 0) return;
        context.setTransform(density, 0, 0, density, 0, 0);
        context.translate(width / 2 + offsetX, height / 2 + offsetY);
        context.scale(scale, scale);
        context.translate(-width / 2, -height / 2);

        const { points, radius } = layout(graph.currencies, width, height);
        const indices = new Map(graph.currencies.map((name, index) => [name, index]));
        const pairs = new Set(graph.edges.map(edge => `${edge.from} ${edge.to}`));
        const labels = [];
        const highlightedNodes = new Set();
        graph.edges.forEach((edge, index) => {
            const from = points[indices.get(edge.from)];
            const to = points[indices.get(edge.to)];
            const emphasis = cycle.has(index);
            if (emphasis) {
                highlightedNodes.add(edge.from);
                highlightedNodes.add(edge.to);
            }
            context.globalAlpha = !emphasis && graph.edges.length > 40 ? .30 : 1;
            context.strokeStyle = context.fillStyle = emphasis ? colors.glow : colors.edge;
            context.lineWidth = emphasis ? 2.7 : 1.6;
            context.beginPath();
            let labelPoint;
            if (from === to) {
                const loop = Math.max(13, radius * .68);
                const center = { x: from.x, y: from.y - radius - loop + 3 };
                const endAngle = Math.PI / 2 - .42 + (2 * Math.PI);
                const end = {
                    x: center.x + loop * Math.cos(endAngle),
                    y: center.y + loop * Math.sin(endAngle),
                };
                context.arc(center.x, center.y, loop, Math.PI / 2 + .42, endAngle);
                context.stroke();
                drawArrow(context, { x: end.x + Math.sin(endAngle), y: end.y - Math.cos(endAngle) }, end);
                labelPoint = { x: center.x, y: center.y - loop - 7 };
            } else {
                const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                const side = pairs.has(`${edge.to} ${edge.from}`) ? Math.min(46, length * .2) : 0;
                const control = {
                    x: (from.x + to.x) / 2 - (to.y - from.y) * side / length,
                    y: (from.y + to.y) / 2 + (to.x - from.x) * side / length,
                };
                const clearance = Math.min(length * .25, radius + 3);
                const start = pointToward(from, control, clearance);
                const end = pointToward(to, control, clearance);
                context.moveTo(start.x, start.y);
                context.quadraticCurveTo(control.x, control.y, end.x, end.y);
                context.stroke();
                drawArrow(context, control, end);
                labelPoint = { x: .25 * start.x + .5 * control.x + .25 * end.x,
                    y: .25 * start.y + .5 * control.y + .25 * end.y };
            }
            if (emphasis || graph.edges.length <= 20) {
                labels.push([edge.rate, labelPoint.x, labelPoint.y, emphasis]);
            }
        });
        context.globalAlpha = 1;
        for (const label of labels) drawRate(context, ...label);

        graph.currencies.forEach((name, index) => {
            const { x, y } = points[index];
            context.strokeStyle = highlightedNodes.has(name) ? colors.glow : colors.border;
            context.fillStyle = colors.node;
            context.lineWidth = 1.8;
            context.beginPath();
            context.arc(x, y, radius, 0, 2 * Math.PI);
            context.fill();
            context.stroke();
            if (graph.currencies.length <= 36 || highlightedNodes.has(name) || scale >= 1.8) {
                const label = [...name];
                const abbreviated = label.length > 4 ? `${label.slice(0, 3).join('')}…` : name;
                context.font = `700 ${Math.min(14, radius * .78)}px system-ui, sans-serif`;
                context.fillStyle = colors.label;
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText(abbreviated, x, y + .5, radius * 1.75);
            }
        });
    }

    function redraw() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(draw);
    }

    function reset() {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        redraw();
    }

    const sizeObserver = new ResizeObserver(redraw);
    sizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || !graph.currencies.length) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', event => {
        if (pointer?.id !== event.pointerId) return;
        offsetX += event.clientX - pointer.x;
        offsetY += event.clientY - pointer.y;
        pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
        redraw();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        canvas.addEventListener(eventName, event => {
            if (pointer?.id !== event.pointerId) return;
            pointer = null;
            canvas.classList.remove('is-dragging');
        });
    }

    return {
        setGraph(next, error) {
            graph = next ?? { currencies: [], edges: [] };
            cycle = new Set();
            empty.hidden = graph.currencies.length > 0;
            empty.textContent = error || '添加币种或导入草稿以查看有向图。';
            reset();
        },
        setCycle(edgeIds) {
            cycle = new Set(edgeIds);
            redraw();
        },
        zoomBy(factor) {
            scale = Math.min(3.5, Math.max(.55, scale * factor));
            redraw();
        },
        reset,
    };
}
