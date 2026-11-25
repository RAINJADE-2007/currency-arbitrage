#include "arbitrage.h"

#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

// 菜单和模块调用已连接。你们填写四个业务源文件中的11个TODO。
namespace {

bool readText(const std::string& prompt, std::string& value) {
    std::cout << prompt;
    if (std::getline(std::cin, value)) return true;
    std::cout << "\n输入结束，程序退出。\n";
    return false;
}

template <typename T>
bool readNumber(const std::string& prompt, T& value) {
    std::string line;
    while (readText(prompt, line)) {
        std::istringstream input(line);
        T parsed;
        if (input >> parsed) {
            input >> std::ws;
            if (input.eof()) {
                value = parsed;
                return true;
            }
        }
        std::cout << "请输入格式正确、在类型范围内的完整数值。\n";
    }
    return false;
}

bool reportStatus(Status status, const std::string& task) {
    switch (status) {
        case Status::Ok:
            return true;
        case Status::NotImplemented:
            std::cout << "尚未实现：" << task << "，请填写对应TODO。\n";
            break;
        case Status::InvalidInput:
            std::cout << "输入或图结构不合法，请检查字段、范围和文件格式。\n";
            break;
        case Status::NotFound:
            std::cout << "未找到币种，请先添加币种。\n";
            break;
        case Status::DuplicateCurrency:
            std::cout << "币种名称重复。\n";
            break;
        case Status::DuplicateRate:
            std::cout << "整图数据中出现重复的同方向兑换边。\n";
            break;
        case Status::CapacityExceeded:
            std::cout << "币种或兑换边数量超过约定上限。\n";
            break;
        case Status::EmptyGraph:
            std::cout << "当前没有币种，请先输入图数据。\n";
            break;
        case Status::FileError:
            std::cout << "文件打开、读写或替换失败。\n";
            break;
        case Status::InvalidCycle:
            std::cout << "候选环或前驱信息不合法，无法恢复有效闭环。\n";
            break;
        case Status::BelowProfitThreshold:
            std::cout << "本次候选环的收益未超过阈值，不能据此排除其他盈利环。\n";
            break;
        case Status::NumericError:
            std::cout << "数值计算超出可表示范围，无法给出可靠的金额结果。\n";
            break;
    }
    return false;
}

std::string currencyName(const ExchangeGraph& graph, int id) {
    if (id < 0 || id >= static_cast<int>(graph.currencies.size()))
        return "[非法币种编号]";
    return graph.currencies[id];
}

void showGraph(const ExchangeGraph& graph) {
    std::cout << "币种数：" << graph.currencies.size()
              << "；兑换边数：" << graph.edges.size() << '\n';
    for (std::size_t i = 0; i < graph.currencies.size(); ++i)
        std::cout << "币种 " << i << "：" << graph.currencies[i] << '\n';
    for (std::size_t i = 0; i < graph.edges.size(); ++i) {
        const ExchangeEdge& e = graph.edges[i];
        std::cout << "边 " << i << "：1 " << currencyName(graph, e.from)
                  << " = " << e.rate << ' ' << currencyName(graph, e.to) << '\n';
    }
}

bool inputWholeGraph(ExchangeGraph& graph) {
    std::cout << "请输入整张图，格式：n m；n个币种名；m条 起点 终点 汇率。\n"
              << "最后输入单独一行 END 结束输入。END不属于文件格式。\n"
              << "示例：\n3 3\nUSD\nGBP\nFRF\n"
              << "USD GBP 0.7\nGBP FRF 9.5\nFRF USD 0.16\nEND\n"
              << "开始输入（成功后替换当前图）：\n";
    std::ostringstream buffer;
    std::string line;
    while (true) {
        if (!readText("", line)) return false;
        if (line == "END") break;
        buffer << line << '\n';
    }
    std::istringstream input(buffer.str());
    if (reportStatus(parseGraph(input, graph), "D1 parseGraph"))
        std::cout << "整图输入成功。\n";
    return true;
}

void showReport(const ExchangeGraph& graph, const ArbitrageReport& report) {
    if (report.steps.empty()) {
        std::cout << "接口错误：成功的收益报告应包含兑换步骤，请检查C2。\n";
        return;
    }
    const int start = report.steps.front().from;
    std::cout << "已找到并复核一条盈利闭环。\n路径：" << currencyName(graph, start);
    for (const ConversionStep& step : report.steps)
        std::cout << " -> " << currencyName(graph, step.to);
    std::cout << '\n';
    for (const ConversionStep& step : report.steps) {
        std::cout << step.before << ' ' << currencyName(graph, step.from)
                  << " * " << step.rate << " = " << step.after << ' '
                  << currencyName(graph, step.to) << '\n';
    }
    std::cout << "初始金额：" << report.initialAmount << ' ' << currencyName(graph, start)
              << "\n最终金额：" << report.finalAmount << ' ' << currencyName(graph, start)
              << "\n利润：" << report.profit << ' ' << currencyName(graph, start)
              << "\n收益率：" << report.profitRate * 100.0L << "%\n";
}

bool runAnalysis(const ExchangeGraph& graph) {
    DetectionResult detection;
    if (!reportStatus(detectArbitrage(graph, detection), "B2 detectArbitrage"))
        return true;
    if (!detection.hasCandidate) {
        std::cout << "在当前浮点容差下未检测到负环。\n";
        return true;
    }

    ExchangeCycle cycle;
    if (!reportStatus(recoverCycle(graph, detection, cycle), "C1 recoverCycle"))
        return true;
    if (cycle.edgeIds.empty() || cycle.edgeIds.front() < 0
        || cycle.edgeIds.front() >= static_cast<int>(graph.edges.size())) {
        std::cout << "接口错误：恢复结果没有有效起始边，请检查C1。\n";
        return true;
    }
    const int start = graph.edges[cycle.edgeIds.front()].from;
    long double amount = 1.0L;
    if (!readNumber("请输入该候选环起点币种 " + currencyName(graph, start)
                    + " 的初始金额（例如1）：", amount)) return false;

    ArbitrageReport report;
    if (reportStatus(evaluateCycle(graph, cycle, amount, report), "C2 evaluateCycle"))
        showReport(graph, report);
    return true;
}

void showMenu() {
    std::cout << "\n===== 套汇程序 · 四人填写框架 =====\n"
              << " 1. 添加币种\n"
              << " 2. 添加或修改单向汇率\n"
              << " 3. 整图人工输入\n"
              << " 4. 从文件导入整图\n"
              << " 5. 保存整图到文件\n"
              << " 6. 查看当前币种与汇率\n"
              << " 7. 查看负对数权重\n"
              << " 8. 检测套汇并展示兑换方案\n"
              << " 9. 按名称查询币种编号\n"
              << "10. 检查图数据是否合法\n"
              << " 0. 退出\n";
}

} // namespace

int main() {
    ExchangeGraph graph; // 唯一图对象。每次分析都即时计算，不保留过期结果。
    std::cout << std::setprecision(12)
              << "这是可编译的程序大纲，核心业务请填写各文件中的TODO。\n"
              << "模型：允许有环的有向带权图；题目中的无环表述需向教师核实。\n";
    while (true) {
        showMenu();
        int choice = 0;
        if (!readNumber("请选择：", choice)) return 0;
        switch (choice) {
            case 0:
                std::cout << "已退出。需要保留图数据时，请提前使用保存功能。\n";
                return 0;
            case 1: {
                std::string name;
                if (!readText("币种名称：", name)) return 0;
                if (reportStatus(addCurrency(graph, name), "A2 addCurrency"))
                    std::cout << "币种添加成功。\n";
                break;
            }
            case 2: {
                std::string from, to;
                long double rate = 0.0L;
                if (!readText("起点币种：", from) || !readText("终点币种：", to)
                    || !readNumber("1单位起点币种可兑换的终点数量：", rate)) return 0;
                if (reportStatus(setExchangeRate(graph, from, to, rate), "A3 setExchangeRate"))
                    std::cout << "汇率设置成功。\n";
                break;
            }
            case 3:
                if (!inputWholeGraph(graph)) return 0;
                break;
            case 4:
            case 5: {
                std::string filename;
                if (!readText("文件路径（例如 data/profitable.txt）：", filename)) return 0;
                if (choice == 4) {
                    if (reportStatus(loadFromFile(graph, filename), "D2 loadFromFile"))
                        std::cout << "文件导入成功。\n";
                } else {
                    if (reportStatus(saveToFile(graph, filename), "D3 saveToFile"))
                        std::cout << "文件保存成功。\n";
                }
                break;
            }
            case 6:
                showGraph(graph);
                break;
            case 7: {
                std::vector<long double> weights;
                if (reportStatus(buildLogWeights(graph, weights), "B1 buildLogWeights")) {
                    if (weights.size() != graph.edges.size())
                        std::cout << "接口错误：权重数量应与兑换边数量一致，请检查B1。\n";
                    else
                        for (std::size_t i = 0; i < weights.size(); ++i)
                            std::cout << "边 " << i << "：w = " << weights[i] << '\n';
                }
                break;
            }
            case 8:
                if (!runAnalysis(graph)) return 0;
                break;
            case 9: {
                std::string name;
                int id = -1;
                if (!readText("币种名称：", name)) return 0;
                if (reportStatus(findCurrency(graph, name, id), "A1 findCurrency"))
                    std::cout << "币种编号：" << id << '\n';
                break;
            }
            case 10:
                if (reportStatus(validateGraph(graph), "A4 validateGraph"))
                    std::cout << "图数据检查通过。\n";
                break;
            default:
                std::cout << "没有这个菜单选项，请输入0到10。\n";
                break;
        }
    }
}
