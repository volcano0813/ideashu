#!/usr/bin/env python3
"""
IdeaShu 热点格式化工具
────────────────────
不做爬取，不依赖 agent-browser。
职责：接收 LLM 输出的热点 JSON，校验字段、评分、去重、排序后输出标准格式。

用法:
  # 从文件读取
  python hot_search.py --input raw_topics.json --domain "日咖夜酒探店"

  # 从 stdin 读取（管道）
  echo '[{"title":"..."}]' | python hot_search.py --domain "穿搭"

  # Skill 内部调用：LLM 把 json:topics 写入临时文件后调用本脚本格式化
"""

import json
import sys
import argparse
from datetime import datetime
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "config" / "config.json"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def calculate_heat_score(topic: dict, config: dict) -> int:
    """根据 config 中的权重计算热度分"""
    weights = (
        config.get("hotSearch", {})
        .get("scoring", {})
        .get("weights", {})
    )
    w_cross = weights.get("crossSource", 0.30)
    w_fresh = weights.get("freshness", 0.25)
    w_domain = weights.get("domainMatch", 0.25)
    w_space = weights.get("contentSpace", 0.20)

    # 如果 LLM 已经给了 heatScore，直接用
    if topic.get("heatScore") and int(topic["heatScore"]) > 0:
        return int(topic["heatScore"])

    # 否则用简单启发式
    score = 0
    score += 20 * w_cross  # 默认单源
    score += 15 * w_fresh   # 默认中等新鲜度
    score += 20 * w_domain  # 默认中等匹配
    score += 15 * w_space   # 默认中等空间
    return max(int(score * 100 / 25), 50)


def dedup(topics: list) -> list:
    """标题去重（字符重叠 >80% 视为重复）"""
    unique = []
    for t in topics:
        title = t.get("title", "").lower()
        is_dup = False
        for u in unique:
            u_title = u.get("title", "").lower()
            common = len(set(title) & set(u_title))
            avg = (len(title) + len(u_title)) / 2
            if avg > 0 and common / avg > 0.8:
                is_dup = True
                # 保留热度更高的
                if t.get("heatScore", 0) > u.get("heatScore", 0):
                    unique.remove(u)
                    unique.append(t)
                break
        if not is_dup:
            unique.append(t)
    return unique


REQUIRED_FIELDS = {"title", "source", "angle", "hook", "heatScore", "timing"}


def validate_topic(t: dict) -> dict:
    """补全缺失字段"""
    t.setdefault("title", "")
    t.setdefault("source", "综合")
    t.setdefault("sourceUrl", "")
    t.setdefault("angle", "")
    t.setdefault("hook", "")
    t.setdefault("heatScore", 50)
    t.setdefault("timing", "hot")
    t.setdefault("timingDetail", "")
    t.setdefault("materialMatch", False)
    t.setdefault("materialCount", 0)
    return t


def format_topics(raw_topics: list, domain: str = "", config: dict | None = None) -> dict:
    """主处理流程：校验 → 评分 → 去重 → 过滤 → 排序"""
    if config is None:
        config = load_config()

    hot_config = config.get("hotSearch", {})
    min_score = hot_config.get("scoring", {}).get("minScore", 50)
    max_topics = hot_config.get("output", {}).get("maxTopics", 8)

    # 1. 校验字段
    topics = [validate_topic(t) for t in raw_topics if t.get("title")]

    # 2. 评分（如果 LLM 没给分）
    for t in topics:
        t["heatScore"] = calculate_heat_score(t, config)

    # 3. 去重
    topics = dedup(topics)

    # 4. 过滤低分
    topics = [t for t in topics if t["heatScore"] >= min_score]

    # 5. 排序
    topics.sort(key=lambda x: x["heatScore"], reverse=True)

    # 6. 截断
    topics = topics[:max_topics]

    # 7. 补 id
    for i, t in enumerate(topics, 1):
        t["id"] = i

    return {
        "domain": domain,
        "formattedAt": datetime.now().isoformat(),
        "topicsCount": len(topics),
        "topics": topics,
    }


def main():
    parser = argparse.ArgumentParser(description="IdeaShu 热点格式化工具")
    parser.add_argument("--input", "-i", help="输入 JSON 文件路径（不指定则从 stdin 读取）")
    parser.add_argument("--domain", "-d", default="", help="账号领域")
    parser.add_argument("--output", "-o", help="输出文件路径（不指定则输出到 stdout）")
    args = parser.parse_args()

    # 读取输入
    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            raw = json.load(f)
    else:
        raw = json.load(sys.stdin)

    # 兼容两种输入格式：直接数组 或 {topics: [...]}
    if isinstance(raw, list):
        raw_topics = raw
    elif isinstance(raw, dict) and "topics" in raw:
        raw_topics = raw["topics"]
    else:
        print("Error: input must be a JSON array or {topics: [...]}", file=sys.stderr)
        sys.exit(1)

    # 处理
    result = format_topics(raw_topics, domain=args.domain)

    # 输出
    output_json = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_json)
        print(f"[OK] {result['topicsCount']} topics → {args.output}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
