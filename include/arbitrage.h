#ifndef ARBITRAGE_SCAFFOLD_H
#define ARBITRAGE_SCAFFOLD_H

#include <istream>
#include <string>
#include <unordered_map>
#include <vector>

// 原题的“有向无环图”与套汇闭环矛盾。本框架按允许有环的有向带权图设计。
// 学生填写核心业务，主菜单已接线。C++11，全部文本使用 UTF-8。
constexpr int MAX_CURRENCIES = 100;
constexpr int MAX_RATES = 10000;
constexpr long double RELAX_EPS = 1e-12L;   // 距离松弛的绝对容差
constexpr long double PROFIT_EPS = 1e-10L;  // 最终相对收益阈值

enum class Status {
    Ok,
    NotImplemented,
    InvalidInput,
    NotFound,
    DuplicateCurrency,
    DuplicateRate,
    CapacityExceeded,
    EmptyGraph,
    FileError,
    InvalidCycle,
    BelowProfitThreshold,
    NumericError
};

struct ExchangeEdge {
    int from = -1;
    int to = -1;
    long double rate = 0.0L; // 1单位 from 可兑换 rate 单位 to
};

struct ExchangeGraph {
    std::vector<std::string> currencies;            // 下标就是币种编号
    std::unordered_map<std::string, int> index;     // 名称 -> 币种编号
    std::vector<ExchangeEdge> edges;                // 下标就是兑换边编号
};

struct DetectionResult {
    bool hasCandidate = false;                     // 仅在函数返回 Ok 时有效
    int witnessVertex = -1;                         // 第n轮最后更新的顶点
    std::vector<int> predecessorEdge;              // 每个顶点的前驱边；无则-1
};

struct ExchangeCycle {
    std::vector<int> edgeIds;                       // 实际兑换方向排列的边编号
};

struct ConversionStep {
    int from = -1;
    int to = -1;
    long double rate = 0.0L;
    long double before = 0.0L;
    long double after = 0.0L;
};

struct ArbitrageReport {
    std::vector<ConversionStep> steps;
    long double initialAmount = 0.0L;
    long double finalAmount = 0.0L;
    long double profit = 0.0L;
    long double profitRate = 0.0L;                   // 0.064 表示 6.4%
    long double logGain = 0.0L;
};

// 公共约定：
// - 每个TODO默认返回NotImplemented。所有输出参数仅在返回Ok时有效。
// - 图操作失败时保留原图；只读操作不得修改图；输出参数失败时保持原值。
// - 币种名称非空且不含空白字符；名称区分大小写。index与currencies必须一致。
// - 汇率必须有限且>0；只保存显式输入的方向，不自动添加倒数方向。
// - 同一(from,to)只存一条边：交互录入可更新，整图文本的重复边须报错。
// - 允许自环；实际题目示例以不同币种组成的闭环为主。
// - 检测、恢复、计算必须使用同一张未被修改的图；本框架不缓存旧检测结果。

// 第1人：src/graph.cpp，A1—A4。
Status findCurrency(const ExchangeGraph& graph, const std::string& name, int& id);
Status addCurrency(ExchangeGraph& graph, const std::string& name);
Status setExchangeRate(ExchangeGraph& graph, const std::string& from,
                       const std::string& to, long double rate);
Status validateGraph(const ExchangeGraph& graph);

// 第2人：src/detector.cpp，B1—B2。
// 权重独立计算，避免缓存权重与原汇率不同步；weights顺序与edges一致。
Status buildLogWeights(const ExchangeGraph& graph, std::vector<long double>& weights);
// 内部调用B1；所有距离初始为0，覆盖所有不连通分量。
Status detectArbitrage(const ExchangeGraph& graph, DetectionResult& result);

// 第3人：src/cycle.cpp，C1—C2。
Status recoverCycle(const ExchangeGraph& graph, const DetectionResult& detection,
                    ExchangeCycle& cycle);
// initialAmount是找到的环起点币种金额，不是用户指定从某一固定币种开始。
// 只有闭环有效、收益超过PROFIT_EPS、金额可表示时才返回Ok。
Status evaluateCycle(const ExchangeGraph& graph, const ExchangeCycle& cycle,
                     long double initialAmount, ArbitrageReport& report);

// 第4人：src/data_io.cpp，D1—D3。
// 整图格式：n m；随后n个币种名；随后m条“起点名称 终点名称 汇率”。
// 文本以空白分隔，不含注释。全部校验成功后替换原图；失败保留原图。
Status parseGraph(std::istream& input, ExchangeGraph& graph);
Status loadFromFile(ExchangeGraph& graph, const std::string& filename);
Status saveToFile(const ExchangeGraph& graph, const std::string& filename);

#endif
