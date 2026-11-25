#include "arbitrage.h"

// 第1人：币种与有向汇率图管理。
// 所有数据规则遵守 arbitrage.h；只保存明确输入的方向，允许自环。
// 以下均为占位函数，尚不修改图或输出参数；完成后失败也必须保留原值。

Status findCurrency(const ExchangeGraph& graph, const std::string& name, int& id) {
    // TODO A1：按名称查找币种编号，名称区分大小写。
    // 输入：符合公共约定的图、币种名称；输出：currencies 中对应的下标 id。
    // 成功：找到币种时设置 id，返回 Ok。
    // 失败：名称为空或包含空白返回 InvalidInput；不存在该名称返回 NotFound。
    // 边界：空图查找返回 NotFound；失败时 id 保持原值，不能插入不存在的名称。
    (void)graph;
    (void)name;
    (void)id;
    return Status::NotImplemented;
}

Status addCurrency(ExchangeGraph& graph, const std::string& name) {
    // TODO A2：新增一个币种，并同时维护 currencies 和 index。
    // 输入：现有图和新币种名称；名称必须非空、不含空白且未被使用。
    // 成功：追加币种并建立正确编号映射，返回 Ok；原有编号和边保持不变。
    // 失败：名称非法返回 InvalidInput；名称重复返回 DuplicateCurrency；
    //       币种数量达到 MAX_CURRENCIES 返回 CapacityExceeded。
    // 边界：失败不得只更新容器中的一部分；空图允许新增第一个币种。
    (void)graph;
    (void)name;
    return Status::NotImplemented;
}

Status setExchangeRate(ExchangeGraph& graph, const std::string& from,
                       const std::string& to, long double rate) {
    // TODO A3：设置一条指定方向的汇率；已有同一币种对时更新该边。
    // 输入：现有图、起点名称、终点名称、有限且严格大于 0 的汇率。
    // 成功：添加或更新唯一的 (from,to) 边，返回 Ok；绝不自动添加倒数方向。
    // 失败：名称或汇率非法返回 InvalidInput；任一币种不存在返回 NotFound；
    //       需要新增边但边数已达 MAX_RATES 时返回 CapacityExceeded。
    // 边界：容量已满时仍可更新已有边；允许 from 与 to 相同；失败保留原图。
    (void)graph;
    (void)from;
    (void)to;
    (void)rate;
    return Status::NotImplemented;
}

Status validateGraph(const ExchangeGraph& graph) {
    // TODO A4：只读校验整张图的结构和数据，不修复或改写图。
    // 输入：待检查图；检查容量、币种名称、唯一性、index 与 currencies 的完整一致性、
    //       每条边的端点范围、有限正汇率，以及同一 (from,to) 是否重复。
    // 成功：全部合法返回 Ok；完全空的图也合法。
    // 失败：超容量返回 CapacityExceeded；币种重名返回 DuplicateCurrency；
    //       重复兑换边返回 DuplicateRate；其他结构或字段非法返回 InvalidInput。
    // 边界：非空币种集合可以没有边；index 不能缺项、多项或指向错误编号；自环合法。
    (void)graph;
    return Status::NotImplemented;
}
