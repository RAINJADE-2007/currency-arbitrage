import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = new URL('../', import.meta.url);
const compiler = process.env.CXX || 'g++';
const suffix = process.platform === 'win32' ? '.exe' : '';
const core = ['src/graph.cpp', 'src/detector.cpp', 'src/cycle.cpp', 'src/data_io.cpp'];

mkdirSync(new URL('build/', project), { recursive: true });

function run(args) {
    const result = spawnSync(compiler, args, {
        cwd: fileURLToPath(project),
        stdio: 'inherit',
    });
    if (result.error) {
        console.error('找不到可用的 C++ 编译器，请将 g++ 加入 PATH 或设置 CXX。');
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status || 1);
}

function compile(source) {
    // 直接输出对象文件。-pipe 避免 MinGW 通过含中文的临时目录传递汇编文件。
    const object = `build/${basename(source, '.cpp')}.o`;
    run(['-std=c++11', '-Wall', '-Wextra', '-Wpedantic', '-Iinclude', '-pipe', '-c', source, '-o', object]);
    return object;
}

const objects = core.map(compile);
for (const [source, target] of [['src/main.cpp', 'arbitrage'], ['web/bridge.cpp', 'arbitrage_web']]) {
    run([...objects, compile(source), '-o', `build/${target}${suffix}`]);
}
