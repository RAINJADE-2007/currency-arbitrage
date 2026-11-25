const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function connect(graph) {
    const indices = new Map(graph.currencies.map((name, index) => [name, index]));
    const neighbors = graph.currencies.map(() => new Set());
    for (const { from, to } of graph.edges) {
        const start = indices.get(from);
        const end = indices.get(to);
        // Direction and parallel reverse lines affect drawing, rather than node placement.
        if (start === undefined || end === undefined || start === end) continue;
        neighbors[start].add(end);
        neighbors[end].add(start);
    }
    const components = [];
    const visited = new Set();
    for (const start of neighbors.keys()) {
        if (visited.has(start)) continue;
        const nodes = [start];
        visited.add(start);
        for (let next = 0; next < nodes.length; next += 1) {
            for (const neighbor of neighbors[nodes[next]]) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                nodes.push(neighbor);
            }
        }
        components.push(nodes);
    }
    components.sort((left, right) => right.length - left.length || left[0] - right[0]);
    return { neighbors, components };
}

function spread(nodes, neighbors, aspect) {
    const order = [...nodes].sort((left, right) => neighbors[right].size - neighbors[left].size || left - right);
    const positions = order.map((node, index) => {
        const angle = index * goldenAngle;
        const distance = Math.sqrt(index);
        return { node, x: Math.cos(angle) * distance * aspect, y: Math.sin(angle) * distance / aspect };
    });
    const indices = new Map(order.map((node, index) => [node, index]));
    const springs = positions.flatMap(({ node }, index) => [...neighbors[node]]
        .map(neighbor => indices.get(neighbor))
        .filter(other => other > index)
        .map(other => [index, other]));
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    const rounds = 118;

    function applyForce(i, j, factor) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        forces[i].x += dx * factor;
        forces[i].y += dy * factor;
        forces[j].x -= dx * factor;
        forces[j].y -= dy * factor;
    }

    for (let round = 0; round < rounds; round += 1) {
        for (const [i, point] of positions.entries()) {
            forces[i].x = -point.x * .058;
            forces[i].y = -point.y * .058;
        }
        for (let i = 0; i < positions.length; i += 1) {
            for (let j = 0; j < i; j += 1) {
                const dx = positions[i].x - positions[j].x;
                const dy = positions[i].y - positions[j].y;
                applyForce(i, j, .78 / Math.max(.01, dx * dx + dy * dy));
            }
        }
        for (const [i, j] of springs) {
            const distance = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
            applyForce(i, j, -.15 * distance);
        }
        const step = .048 * (1 - round / rounds) + .012;
        positions.forEach((point, index) => {
            point.x += clamp(forces[index].x, -4, 4) * step;
            point.y += clamp(forces[index].y, -4, 4) * step;
        });
    }
    return positions;
}

function separate(points, nodes, area, distance) {
    // Use a small collision pass in screen space after stretching the force layout to fit.
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    for (let round = 0; round < 30; round += 1) {
        let adjusted = false;
        for (const [index, node] of nodes.entries()) {
            const first = points[node];
            for (let previous = 0; previous < index; previous += 1) {
                const second = points[nodes[previous]];
                const dx = first.x - second.x;
                const dy = first.y - second.y;
                const length = Math.hypot(dx, dy);
                if (length < .001 || length >= distance) continue;
                const shift = (distance - length) / length * .51;
                first.x = clamp(first.x + dx * shift, area.x, right);
                first.y = clamp(first.y + dy * shift, area.y, bottom);
                second.x = clamp(second.x - dx * shift, area.x, right);
                second.y = clamp(second.y - dy * shift, area.y, bottom);
                adjusted = true;
            }
        }
        if (!adjusted) break;
    }
}

function place(nodes, neighbors, area, radius, target) {
    const { x, y, width, height } = area;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    if (nodes.length <= 3) {
        if (nodes.length === 1) {
            target[nodes[0]] = { x: centerX, y: centerY };
            return;
        }
        if (nodes.length === 2) {
            const horizontal = width >= height;
            const distance = Math.min(Math.max(width, height) * .27, Math.min(width, height) * .48);
            target[nodes[0]] = { x: centerX - (horizontal ? distance : 0), y: centerY - (horizontal ? 0 : distance) };
            target[nodes[1]] = { x: centerX + (horizontal ? distance : 0), y: centerY + (horizontal ? 0 : distance) };
            return;
        }
        nodes.forEach((node, index) => {
            const angle = -Math.PI / 2 + 2 * Math.PI * index / nodes.length;
            target[node] = { x: centerX + Math.cos(angle) * Math.min(width * .4, height * .76),
                y: centerY + Math.sin(angle) * Math.min(height * .42, width * .55) };
        });
        return;
    }

    const aspect = Math.pow(clamp(width / Math.max(1, height), .4, 2.7), .28);
    const positions = spread(nodes, neighbors, aspect);
    const xs = positions.map(point => point.x);
    const ys = positions.map(point => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const spanX = Math.max(...xs) - left;
    const spanY = Math.max(...ys) - top;
    const scaleX = width / Math.max(.1, spanX);
    const scaleY = height / Math.max(.1, spanY);
    for (const point of positions) {
        // Fit the panel while keeping nearby points from becoming too stretched along one axis.
        target[point.node] = {
            x: centerX + (point.x - left - spanX / 2) * Math.min(scaleX, scaleY * 2.1),
            y: centerY + (point.y - top - spanY / 2) * Math.min(scaleY, scaleX * 2.1),
        };
    }
    separate(target, nodes, area, radius * 2 + 5);
}

function placeComponents(components, neighbors, area, radius, padding, target) {
    if (components.length === 1) {
        const inset = Math.min(padding, area.width / 5, area.height / 5);
        place(components[0], neighbors, {
            x: area.x + inset,
            y: area.y + inset,
            width: area.width - inset * 2,
            height: area.height - inset * 2,
        }, radius, target);
        return;
    }
    const count = components.reduce((sum, nodes) => sum + nodes.length, 0);
    let split = 1;
    let firstCount = components[0].length;
    while (split < components.length - 1 && firstCount + components[split].length / 2 < count / 2) {
        firstCount += components[split].length;
        split += 1;
    }
    const fraction = firstCount / count;
    const first = { ...area };
    const second = { ...area };
    if (area.width >= area.height) {
        first.width = area.width * fraction;
        second.x += first.width;
        second.width -= first.width;
    } else {
        first.height = area.height * fraction;
        second.y += first.height;
        second.height -= first.height;
    }
    placeComponents(components.slice(0, split), neighbors, first, radius, padding, target);
    placeComponents(components.slice(split), neighbors, second, radius, padding, target);
}

export function layoutNetwork(graph, width, height) {
    const count = graph.currencies.length;
    if (count === 0) return { points: [], radius: 0 };
    const desiredRadius = Math.min(26, Math.sqrt(width * height / count) * .25);
    const paddingX = Math.min(width * .14, desiredRadius * 2 + 16);
    const paddingY = Math.min(height * .16, desiredRadius * 2.65 + 9);
    const area = { x: paddingX, y: paddingY, width: width - paddingX * 2, height: height - paddingY * 2 };
    const points = new Array(count);
    const { neighbors, components } = connect(graph);
    placeComponents(components, neighbors, area, desiredRadius, components.length > 1 ? desiredRadius * .75 : 0, points);

    let closest = Infinity;
    for (let i = 0; i < points.length; i += 1) {
        for (let j = 0; j < i; j += 1) {
            closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
        }
    }
    const radius = Math.min(desiredRadius, Math.max(0, (closest - 3) / 2));
    return { points, radius };
}
