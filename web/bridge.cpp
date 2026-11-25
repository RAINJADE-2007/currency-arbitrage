#include "arbitrage.h"

#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>

namespace {

const char* statusName(Status status) {
    switch (status) {
        case Status::Ok: return "Ok";
        case Status::NotImplemented: return "NotImplemented";
        case Status::InvalidInput: return "InvalidInput";
        case Status::NotFound: return "NotFound";
        case Status::DuplicateCurrency: return "DuplicateCurrency";
        case Status::DuplicateRate: return "DuplicateRate";
        case Status::CapacityExceeded: return "CapacityExceeded";
        case Status::EmptyGraph: return "EmptyGraph";
        case Status::FileError: return "FileError";
        case Status::InvalidCycle: return "InvalidCycle";
        case Status::BelowProfitThreshold: return "BelowProfitThreshold";
        case Status::NumericError: return "NumericError";
    }
    return "UnknownStatus";
}

void showStatus(Status status, const char* stage) {
    std::cout << "{\"status\":\"" << statusName(status)
              << "\",\"stage\":\"" << stage << "\"}\n";
}

void showWeights(const ExchangeGraph& graph) {
    std::vector<long double> weights;
    const Status status = buildLogWeights(graph, weights);
    if (status != Status::Ok) {
        showStatus(status, "B1");
        return;
    }
    if (weights.size() != graph.edges.size()) {
        showStatus(Status::InvalidInput, "B1");
        return;
    }
    // 使用字符串传输 long double，避免浏览器的 Number 丢失精度或溢出。
    std::cout << "{\"status\":\"Ok\",\"weights\":[";
    for (std::size_t i = 0; i < weights.size(); ++i) {
        if (i) std::cout << ',';
        std::cout << '"' << weights[i] << '"';
    }
    std::cout << "]}\n";
}

void showReport(const ExchangeCycle& cycle, const ArbitrageReport& report) {
    std::cout << "{\"status\":\"Ok\",\"hasCandidate\":true,\"edgeIds\":[";
    for (std::size_t i = 0; i < cycle.edgeIds.size(); ++i) {
        if (i) std::cout << ',';
        std::cout << cycle.edgeIds[i];
    }
    const long double percent = report.profitRate * 100.0L;
    std::cout << "],\"initialAmount\":\"" << report.initialAmount
              << "\",\"finalAmount\":\"" << report.finalAmount
              << "\",\"profit\":\"" << report.profit
              << "\",\"profitRate\":\"" << report.profitRate
              << "\",\"profitPercent\":\"";
    if (std::isfinite(percent)) std::cout << percent;
    std::cout << "\",\"steps\":[";
    for (std::size_t i = 0; i < report.steps.size(); ++i) {
        const ConversionStep& step = report.steps[i];
        if (i) std::cout << ',';
        std::cout << "{\"from\":" << step.from << ",\"to\":" << step.to
                  << ",\"rate\":\"" << step.rate << "\",\"before\":\""
                  << step.before << "\",\"after\":\"" << step.after << "\"}";
    }
    std::cout << "]}\n";
}

void analyze(const ExchangeGraph& graph, long double amount) {
    DetectionResult detection;
    Status status = detectArbitrage(graph, detection);
    if (status != Status::Ok) {
        showStatus(status, "B2");
        return;
    }
    if (!detection.hasCandidate) {
        std::cout << "{\"status\":\"Ok\",\"hasCandidate\":false}\n";
        return;
    }

    ExchangeCycle cycle;
    status = recoverCycle(graph, detection, cycle);
    if (status != Status::Ok) {
        showStatus(status, "C1");
        return;
    }
    ArbitrageReport report;
    status = evaluateCycle(graph, cycle, amount, report);
    if (status != Status::Ok || report.steps.empty()) {
        showStatus(status == Status::Ok ? Status::InvalidCycle : status, "C2");
        return;
    }
    showReport(cycle, report);
}

// 浏览器快照以数值编号传输边，只处理适配层的边界和字段结构。
// 文件文本仍由 D1 完整解析，图业务校验仍由 A4 实现。
bool readSnapshot(std::istream& input, ExchangeGraph& graph) {
    int nodeCount = 0;
    int edgeCount = 0;
    if (!(input >> nodeCount >> edgeCount)
        || nodeCount < 0 || nodeCount > MAX_CURRENCIES
        || edgeCount < 0 || edgeCount > MAX_RATES) {
        return false;
    }
    graph.currencies.resize(nodeCount);
    graph.edges.resize(edgeCount);
    for (int id = 0; id < nodeCount; ++id) {
        std::string& name = graph.currencies[id];
        if (!(input >> name) || !graph.index.emplace(name, id).second) return false;
    }
    for (ExchangeEdge& edge : graph.edges) {
        if (!(input >> edge.from >> edge.to >> edge.rate)
            || edge.from < 0 || edge.from >= nodeCount
            || edge.to < 0 || edge.to >= nodeCount) {
            return false;
        }
    }
    return (input >> std::ws).eof() && !input.bad();
}

} // namespace

int main(int argc, char** argv) {
    std::locale::global(std::locale::classic());
    std::cout << std::setprecision(std::numeric_limits<long double>::max_digits10);
    const std::string action = argc == 2 ? argv[1] : "";
    if (action != "parse" && action != "validate" && action != "weights" && action != "analyze") {
        showStatus(Status::InvalidInput, "request");
        return 0;
    }

    long double amount = 1.0L;
    if (action == "analyze") {
        std::string amountLine;
        std::getline(std::cin, amountLine);
        std::istringstream parsed(amountLine);
        if (!(parsed >> amount) || !std::isfinite(amount) || amount <= 0.0L
            || !(parsed >> std::ws).eof()) {
            showStatus(Status::InvalidInput, "amount");
            return 0;
        }
    }

    ExchangeGraph graph;
    if (action == "parse") {
        showStatus(parseGraph(std::cin, graph), "D1");
    } else if (!readSnapshot(std::cin, graph)) {
        showStatus(Status::InvalidInput, "snapshot");
    } else if (action == "validate") {
        showStatus(validateGraph(graph), "A4");
    } else if (action == "weights") {
        showWeights(graph);
    } else {
        analyze(graph, amount);
    }
}
