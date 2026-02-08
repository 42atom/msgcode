# language: zh-CN
# msgcode: /loglevel 命令 BDD 测试

Feature: /loglevel 日志级别命令
  作为 msgcode 用户
  我想动态调整日志级别并持久化
  以便快速诊断问题而不重启服务

  Scenario A: /loglevel debug 后持久化并可读回
    Given settings.json 不存在或没有 logLevel 字段
    When 用户发送 "/loglevel debug"
    Then 日志级别应立即设置为 "debug"
    And settings.json 应包含 "logLevel": "debug"
    When 用户再次发送 "/loglevel"
    Then 应显示 "当前日志级别: debug"
    And 应显示 "来源: settings.json (持久化)"

  Scenario B: LOG_LEVEL=error 时 /loglevel debug 给出覆盖提示
    Given 环境变量 LOG_LEVEL 设置为 "error"
    And settings.json 不存在或没有 logLevel 字段
    When 用户发送 "/loglevel debug"
    Then 应显示 "已写入 settings.json"
    And 应显示 "但当前进程仍受 ENV 覆盖"
    And 当前进程日志级别应保持为 "error"
